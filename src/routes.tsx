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

/** Warm-up order: what Ctrl+1..6 reaches first, then the finance sub-tabs. */
const PRELOAD_ORDER: Array<() => Promise<unknown>> = [
  TaskList.preload,
  Today.preload,
  FinanceLayout.preload,
  FinanceDashboard.preload,
  CauldronPage.preload,
  CharacterPage.preload,
  SettingsPage.preload,
  Transactions.preload,
  Installments.preload,
  CreditCards.preload,
  Loans.preload,
  Recurring.preload,
  NutritionCharts.preload,
  NutritionSettings.preload,
  Import.preload,
];

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
