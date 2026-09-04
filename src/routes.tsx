import type { ComponentType } from 'react';

/**
 * Route-level code splitting.
 *
 * `React.lazy` always suspends at least once per component, even when the chunk
 * is already in memory — which would make every first navigation flash the
 * Suspense fallback, and would feed that spinner to the page-flip transition in
 * AnimatedOutlet as if it were the destination page. This helper keeps the
 * resolved module in a closure instead, so once `preload()` has run the
 * component renders synchronously and navigation looks exactly like it did when
 * everything was in one chunk.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

export interface LazyRoute<T extends AnyComponent> {
  (props: React.ComponentProps<T>): React.ReactElement;
  preload: () => Promise<unknown>;
}

function lazyRoute<T extends AnyComponent>(
  factory: () => Promise<{ default: T }>,
  displayName: string,
): LazyRoute<T> {
  let Loaded: T | null = null;
  let pending: Promise<unknown> | null = null;

  const preload = () => {
    if (Loaded) return Promise.resolve();
    if (!pending) {
      pending = factory().then(
        (m) => { Loaded = m.default; },
        // Do not cache the failure: a chunk that failed once (disk hiccup) can
        // still load on the next attempt instead of wedging the route forever.
        (err) => { pending = null; throw err; },
      );
    }
    return pending;
  };

  const Route = (props: React.ComponentProps<T>) => {
    if (!Loaded) throw preload();
    const Component = Loaded;
    return <Component {...props} />;
  };
  Route.preload = preload;
  Route.displayName = displayName;
  return Route as LazyRoute<T>;
}

/* ── Heavy, rarely-first screens ─────────────────────────────────
   The dashboard (`/`) stays in the entry chunk on purpose: it is what the app
   opens on, so splitting it would only add a fallback to the cold start. */

export const CharacterPage = lazyRoute(() => import('./hub/CharacterPage'), 'CharacterPage');
export const SettingsPage = lazyRoute(() => import('./hub/SettingsPage'), 'SettingsPage');
export const CauldronPage = lazyRoute(() => import('./modules/cauldron/components/CauldronPage'), 'CauldronPage');

/* These two used to be `React.lazy` in App.tsx, outside this module — so
   `prefetchRoutes()` never warmed them and the page flip turned to a blank
   page while their chunk was still on disk. */
export const AchievementsPage = lazyRoute(() => import('./hub/AchievementsPage'), 'AchievementsPage');
export const RewardsPage = lazyRoute(() => import('./hub/rewards/RewardsPage'), 'RewardsPage');

export const TaskList = lazyRoute(() => import('./modules/quests/components/TaskList'), 'TaskList');

export const Today = lazyRoute(() => import('./modules/nutrition/components/Today'), 'Today');
export const NutritionCharts = lazyRoute(() => import('./modules/nutrition/components/NutritionCharts'), 'NutritionCharts');
export const NutritionSettings = lazyRoute(() => import('./modules/nutrition/components/NutritionSettings'), 'NutritionSettings');

export const FinanceLayout = lazyRoute(() => import('./modules/finance/components/FinanceLayout'), 'FinanceLayout');
export const FinanceDashboard = lazyRoute(() => import('./modules/finance/components/Dashboard'), 'FinanceDashboard');
export const Transactions = lazyRoute(() => import('./modules/finance/components/Transactions'), 'Transactions');
export const Installments = lazyRoute(() => import('./modules/finance/components/Installments'), 'Installments');
export const Loans = lazyRoute(() => import('./modules/finance/components/Loans'), 'Loans');
export const Recurring = lazyRoute(() => import('./modules/finance/components/Recurring'), 'Recurring');
export const Import = lazyRoute(() => import('./modules/finance/components/Import'), 'Import');
export const CreditCards = lazyRoute(() => import('./modules/finance/components/CreditCards'), 'CreditCards');
/** «Compromisos»: la sub-navegación que agrupa cuotas, recurrentes, tarjetas y préstamos. */
export const Commitments = lazyRoute(() => import('./modules/finance/components/Commitments'), 'Commitments');

/** Warm-up order: what Ctrl+1..6 reaches first, then the finance sub-tabs. */
const PRELOAD_ORDER: Array<() => Promise<unknown>> = [
  TaskList.preload,
  Today.preload,
  FinanceLayout.preload,
  FinanceDashboard.preload,
  CauldronPage.preload,
  CharacterPage.preload,
  SettingsPage.preload,
  AchievementsPage.preload,
  RewardsPage.preload,
  Transactions.preload,
  Commitments.preload,
  Installments.preload,
  CreditCards.preload,
  Loans.preload,
  Recurring.preload,
  NutritionCharts.preload,
  NutritionSettings.preload,
  Import.preload,
];

/** First path segment → EVERY chunk that segment has to have in memory before
    it can render without suspending. Lets AnimatedOutlet wait for the
    destination before it starts the flip, instead of flipping to an empty page.

    A list, not a single entry, because of `/finance`: the segment renders
    `FinanceLayout` AND its index child `FinanceDashboard`, and they are separate
    chunks. Waiting only for the shell let the child suspend after the flip had
    already begun — the only Suspense boundary is AnimatedOutlet's, so the child
    replaced the WHOLE outlet subtree with the spinner, `waitForSwap` saw the
    node identity change and resolved, and the flip cloned a bare spinner as its
    destination page. Reachable by clicking Coinify in the first second, before
    the idle prefetch reached FinanceDashboard (4th in PRELOAD_ORDER).

    `/nutrition` does NOT need this: its parent route element is a plain
    `<Outlet/>`, so the index child IS the whole chunk. */
const ROUTE_PRELOAD: Record<string, Array<() => Promise<unknown>>> = {
  '/quests': [TaskList.preload],
  '/nutrition': [Today.preload],
  '/finance': [FinanceLayout.preload, FinanceDashboard.preload],
  '/cauldron': [CauldronPage.preload],
  '/achievements': [AchievementsPage.preload],
  '/rewards': [RewardsPage.preload],
  '/character': [CharacterPage.preload],
  '/settings': [SettingsPage.preload],
};

/** Resolves when every chunk `pathname`'s segment needs is in memory. Unknown or
    already-loaded routes resolve immediately. Never rejects — a chunk that
    fails to preload surfaces on render, not here. */
export function preloadRoute(pathname: string): Promise<unknown> {
  const seg = '/' + (pathname.split('/')[1] || '');
  const loads = ROUTE_PRELOAD[seg];
  if (!loads) return Promise.resolve();
  return Promise.all(loads.map((load) => load()))
    .catch(() => { /* falls back to the Suspense path */ });
}

type IdleHandle = number;
const scheduleIdle: (cb: () => void) => IdleHandle =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(() => cb(), { timeout: 2000 })
    : (cb) => window.setTimeout(cb, 300);
const cancelIdle = (h: IdleHandle) => {
  if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(h);
  else window.clearTimeout(h);
};

/**
 * Pull the route chunks in one at a time while the main thread is idle, so a
 * navigation a few seconds after startup is as instant as it was before the
 * split. Returns a cancel function.
 */
export function prefetchRoutes(): () => void {
  let cancelled = false;
  let handle: IdleHandle | null = null;
  let index = 0;

  const step = () => {
    handle = null;
    if (cancelled || index >= PRELOAD_ORDER.length) return;
    const load = PRELOAD_ORDER[index++];
    load()
      .catch(() => { /* a missing chunk surfaces on navigation, not here */ })
      .then(() => { if (!cancelled) handle = scheduleIdle(step); });
  };

  handle = scheduleIdle(step);
  return () => {
    cancelled = true;
    if (handle !== null) cancelIdle(handle);
  };
}
