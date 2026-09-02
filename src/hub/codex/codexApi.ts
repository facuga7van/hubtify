/**
 * Codex (day sealing) + Achievements — renderer-side access to the RPG API.
 *
 * The handlers live in the main process and reach the renderer through
 * `electron/preload.ts` + the `HubtifyApi` interface in `shared/types.ts`.
 * Every Codex call in the UI goes through this module: it feature-detects each
 * method on `window.api`, so a build whose bridge does not carry one of them
 * (an older mobile shell, a test harness) runs degraded, never crashing.
 *
 * The TYPES are not declared here. They are derived from `HubtifyApi` — what a
 * method promises to return is, by construction, what the UI gets. A local copy
 * once drifted from the handler (`xpTotal` vs `totalXp`) and the codex painted
 * «XP DEL DÍA +NaN» with zero compiler complaints; deriving makes that class
 * of bug a type error at the consumer.
 */

import type { HubtifyApi } from '../../../shared/types';

/* ── contract types (derived, never copied) ───────── */

type ApiResult<K extends keyof HubtifyApi> =
  HubtifyApi[K] extends (...args: never[]) => Promise<infer R> ? R : never;

export type DaySummary = ApiResult<'rpgGetDaySummary'>;
export type DaySummaryEvent = DaySummary['events'][number];
export type SealResult = ApiResult<'rpgSealDay'>;
export type SealFailReason = Extract<SealResult, { ok: false }>['reason'];
export type DaySeal = ApiResult<'rpgGetSeals'>[number];
export type AchievementState = ApiResult<'rpgGetAchievements'>[number];

/* ── óbolos + recompensas (phase 3) ───────────────── */

export type ObolosBalance = ApiResult<'rpgGetObolosBalance'>;
export type Reward = ApiResult<'rpgGetRewards'>[number];
export type RedeemResult = ApiResult<'rpgRedeemReward'>;

/** What the UI sends to `rpgSaveReward` (the handler takes a loose record). */
export interface RewardInput {
  id?: string;
  name: string;
  cost: number;
  icon?: string | null;
}

/* ── la tienda + maestrías (phase 4) ──────────────── */

export type ShopCatalogResult = ApiResult<'rpgGetShopCatalog'>;
export type ShopCatalogEntry = ShopCatalogResult['items'][number];
export type ShopEquipped = ShopCatalogResult['equipped'];
export type ShopItemKind = ShopCatalogEntry['kind'];
export type PurchaseShopResult = ApiResult<'rpgPurchaseShopItem'>;
export type EquipShopResult = ApiResult<'rpgEquipShopItem'>;
export type MasteryState = ApiResult<'rpgGetMasteries'>[number];

/** The slice of `window.api` this module uses; every member may be missing. */
type CodexApiShape = Partial<Pick<HubtifyApi,
  | 'rpgGetDaySummary'
  | 'rpgSealDay'
  | 'rpgGetSeals'
  | 'rpgGetAchievements'
  | 'onRpgAchievementUnlocked'
  | 'rpgGetObolosBalance'
  | 'rpgGetRewards'
  | 'rpgSaveReward'
  | 'rpgDeleteReward'
  | 'rpgRedeemReward'
  | 'rpgGetShopCatalog'
  | 'rpgPurchaseShopItem'
  | 'rpgEquipShopItem'
  | 'rpgGetMasteries'
>>;

function api(): CodexApiShape {
  if (typeof window === 'undefined') return {};
  return ((window as unknown as { api?: unknown }).api as CodexApiShape | undefined) ?? {};
}

/** True once the main process actually exposes the day-summary handler. */
export function codexApiReady(): boolean {
  return typeof api().rpgGetDaySummary === 'function';
}

/* ── calls (all feature-detected, all failure-tolerant) ── */

export async function getDaySummary(date?: string): Promise<DaySummary | null> {
  const fn = api().rpgGetDaySummary;
  if (!fn) return null;
  try {
    return (await fn(date)) ?? null;
  } catch {
    return null;
  }
}

export async function sealDay(date?: string): Promise<SealResult | null> {
  const fn = api().rpgSealDay;
  if (!fn) return null;
  try {
    return (await fn(date)) ?? null;
  } catch {
    return null;
  }
}

export async function getSeals(from: string, to: string): Promise<DaySeal[]> {
  const fn = api().rpgGetSeals;
  if (!fn) return [];
  try {
    return (await fn(from, to)) ?? [];
  } catch {
    return [];
  }
}

export async function getAchievements(): Promise<AchievementState[] | null> {
  const fn = api().rpgGetAchievements;
  if (!fn) return null;
  try {
    return (await fn()) ?? [];
  } catch {
    return null;
  }
}

/** True once the main process exposes the óbolos/rewards handlers. */
export function rewardsApiReady(): boolean {
  return typeof api().rpgGetRewards === 'function'
    && typeof api().rpgGetObolosBalance === 'function';
}

export async function getObolosBalance(): Promise<ObolosBalance | null> {
  const fn = api().rpgGetObolosBalance;
  if (!fn) return null;
  try {
    return (await fn()) ?? null;
  } catch {
    return null;
  }
}

export async function getRewards(): Promise<Reward[]> {
  const fn = api().rpgGetRewards;
  if (!fn) return [];
  try {
    return (await fn()) ?? [];
  } catch {
    return [];
  }
}

export async function saveReward(input: RewardInput): Promise<Reward | null> {
  const fn = api().rpgSaveReward;
  if (!fn) return null;
  try {
    return (await fn(input as unknown as Record<string, unknown>)) ?? null;
  } catch {
    return null;
  }
}

export async function deleteReward(id: string): Promise<boolean> {
  const fn = api().rpgDeleteReward;
  if (!fn) return false;
  try {
    return (await fn(id))?.ok ?? false;
  } catch {
    return false;
  }
}

export async function redeemReward(id: string): Promise<RedeemResult | null> {
  const fn = api().rpgRedeemReward;
  if (!fn) return null;
  try {
    return (await fn(id)) ?? null;
  } catch {
    return null;
  }
}

/** Fired after a redeem/save/delete so purses elsewhere re-read the balance. */
export const OBOLOS_CHANGED_EVENT = 'obolos:changed';

/* ── la tienda + maestrías (phase 4) ──────────────── */

/** True once the main process exposes the shop handlers. */
export function shopApiReady(): boolean {
  return typeof api().rpgGetShopCatalog === 'function'
    && typeof api().rpgPurchaseShopItem === 'function';
}

/** True once the main process exposes the masteries handler. */
export function masteriesApiReady(): boolean {
  return typeof api().rpgGetMasteries === 'function';
}

export async function getShopCatalog(): Promise<ShopCatalogResult | null> {
  const fn = api().rpgGetShopCatalog;
  if (!fn) return null;
  try {
    return (await fn()) ?? null;
  } catch {
    return null;
  }
}

export async function purchaseShopItem(itemId: string): Promise<PurchaseShopResult | null> {
  const fn = api().rpgPurchaseShopItem;
  if (!fn) return null;
  try {
    return (await fn(itemId)) ?? null;
  } catch {
    return null;
  }
}

export async function equipShopItem(
  itemId: string | null,
  kind?: ShopItemKind,
): Promise<EquipShopResult | null> {
  const fn = api().rpgEquipShopItem;
  if (!fn) return null;
  try {
    return (await fn(itemId, kind)) ?? null;
  } catch {
    return null;
  }
}

export async function getMasteries(): Promise<MasteryState[] | null> {
  const fn = api().rpgGetMasteries;
  if (!fn) return null;
  try {
    return (await fn()) ?? null;
  } catch {
    return null;
  }
}

/** Fired after a purchase or an equip so the card, the modal and the shop agree. */
export const SHOP_CHANGED_EVENT = 'shop:changed';

/* ── equipped cosmetics → data attributes on <html> ──
 *
 * The bought frames/backgrounds/seal styles are pure CSS keyed off
 * `:root[data-equip-frame=…]` etc. (src/hub/styles/codex-seal.css, which the
 * shell loads at boot through Layout → CodexSealModal). Stamping the ids on
 * the root element styles the PlayerCard and the hero portrait WITHOUT
 * touching their components: CSS selects them from above.
 *
 * This module is imported by Layout, so the one-time init below runs with the
 * shell — before any page is visited — and re-runs on account switches and on
 * every equip. All of it degrades to "default look" while the handlers are
 * not wired.
 */

const EQUIP_ATTRS = {
  sealStyle: 'data-equip-seal',
  frame: 'data-equip-frame',
  background: 'data-equip-bg',
} as const;

function stampEquipped(equipped: ShopEquipped | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of Object.keys(EQUIP_ATTRS) as Array<keyof typeof EQUIP_ATTRS>) {
    const id = equipped?.[key] ?? null;
    if (id) root.setAttribute(EQUIP_ATTRS[key], id);
    else root.removeAttribute(EQUIP_ATTRS[key]);
  }
}

/** Reads the equipment and stamps it on <html>. Safe to call any time. */
export async function applyEquippedCosmetics(): Promise<void> {
  if (!shopApiReady()) { stampEquipped(null); return; }
  const catalog = await getShopCatalog();
  stampEquipped(catalog?.equipped ?? null);
}

/** The seal-style id currently stamped on <html> (null = default rosette). */
export function equippedSealStyleId(): string | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute(EQUIP_ATTRS.sealStyle);
}

let cosmeticsInitDone = false;

/** Idempotent: first call applies and subscribes; later calls are no-ops. */
export function initEquippedCosmetics(): void {
  if (cosmeticsInitDone || typeof window === 'undefined') return;
  cosmeticsInitDone = true;
  const refresh = () => { void applyEquippedCosmetics(); };
  window.addEventListener('account:switched', refresh);
  window.addEventListener(SHOP_CHANGED_EVENT, refresh);
  refresh();
}

// Module-load side effect, on purpose: Layout imports this module at boot and
// nothing else runs early enough to dress the PlayerCard before first paint.
// Deferred a tick so the import itself stays pure-ish and never blocks.
if (typeof window !== 'undefined') {
  setTimeout(initEquippedCosmetics, 0);
}

/** Returns an unsubscribe; a no-op one while the broadcast is not wired. */
export function onAchievementUnlocked(cb: (id: string) => void): () => void {
  const fn = api().onRpgAchievementUnlocked;
  if (!fn) return () => { /* not wired yet */ };
  try {
    return fn(cb) ?? (() => { /* handler returned nothing */ });
  } catch {
    return () => { /* subscription failed */ };
  }
}

/* ── window events used to talk across the shell ──── */

/** Sidebar / Dashboard ask Layout (which owns the modal) to open the codex. */
export const CODEX_OPEN_EVENT = 'codex:open';
/** Fired after a successful seal so invitations and briefs re-read state. */
export const CODEX_SEALED_EVENT = 'codex:sealed';

export interface CodexOpenDetail {
  /** Local YYYY-MM-DD; omitted means today. */
  date?: string;
}

export function openCodex(date?: string) {
  window.dispatchEvent(new CustomEvent<CodexOpenDetail>(CODEX_OPEN_EVENT, { detail: { date } }));
}

/* ── "is the codex modal on screen?" flag ─────────── */

/**
 * When a seal unlocks achievements they are shown INSIDE the ceremony, so the
 * global `onRpgAchievementUnlocked` toast in Layout's RpgMomentsWatcher must
 * stay quiet for as long as the codex modal is up — otherwise the same unlock
 * is announced twice, the toast landing on top of its own ceremony.
 *
 * A plain window flag rather than a context: the watcher and the modal are
 * siblings under Layout and never share a provider, and the flag has to be
 * readable from inside an event callback that does not re-render.
 */
const OPEN_FLAG = '__hubtifyCodexOpen' as const;

type FlagWindow = Window & { [OPEN_FLAG]?: boolean };

export function setCodexModalOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  (window as FlagWindow)[OPEN_FLAG] = open;
}

export function isCodexModalOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as FlagWindow)[OPEN_FLAG] === true;
}

/* ── local-date helpers ───────────────────────────── */

/** Local (not UTC) YYYY-MM-DD — the day the user is actually living. */
export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localDateISO(dt);
}

/** The hour past which the evening invitation appears. */
export const SEAL_INVITE_HOUR = 21;

export function isEveningNow(now: Date = new Date()): boolean {
  return now.getHours() >= SEAL_INVITE_HOUR;
}
