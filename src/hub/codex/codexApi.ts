/**
 * Codex (day sealing) + Achievements — renderer-side contract.
 *
 * The handlers live in the main process and reach the renderer through
 * `electron/preload.ts` + the `HubtifyApi` interface in `shared/types.ts`.
 * That wiring lands in a separate pass, so until then `window.api` carries
 * none of these methods and `shared/types.ts` declares none of them.
 *
 * Every Codex call in the UI therefore goes through this module. It casts
 * `window.api` to a LOCAL copy of the agreed contract and feature-detects each
 * method, so the renderer compiles and runs — degraded, never crashing —
 * both before and after the preload is wired. Once the real types land nothing
 * here has to change: the shapes already match.
 *
 * Contract (main process):
 *   rpgGetDaySummary(date?) -> DaySummary
 *   rpgSealDay(date?)       -> SealResult
 *   rpgGetSeals(from, to)   -> DaySeal[]
 *   rpgGetAchievements()    -> AchievementState[]
 *   onRpgAchievementUnlocked(cb) -> unsubscribe
 */

/* ── contract types ───────────────────────────────── */

export interface DaySummaryEvent {
  moduleId: string;
  eventType: string;
  xpGained: number;
  /** ISO timestamp or HH:mm — both are rendered. */
  time: string;
}

export interface DaySummary {
  /** Local YYYY-MM-DD. */
  date: string;
  sealed: boolean;
  xpTotal: number;
  eventsCount: number;
  maxCombo: number;
  modules: string[];
  vigor: number;
  streak: number;
  events: DaySummaryEvent[];
}

export type SealFailReason = 'too_old' | 'already_sealed' | 'empty_day';

export type SealResult =
  | {
      ok: true;
      xpAwarded: number;
      vigor: number;
      achievementIds: string[];
      /** Óbolos minted by this seal. Absent/0 on builds without the ledger. */
      obolosGranted?: number;
    }
  | { ok: false; reason: SealFailReason };

export interface DaySeal {
  date: string;
  sealedAt: string;
  xpAwarded: number;
}

export interface AchievementState {
  id: string;
  hidden: boolean;
  unlocked: boolean;
  unlockedAt?: string;
}

/* ── óbolos + recompensas (phase 3) ───────────────── */

export interface ObolosBalance {
  balance: number;
  earned: number;
  spent: number;
}

export interface Reward {
  id: string;
  name: string;
  cost: number;
  /** Name of an icon from the app's own SVG set — never an emoji. */
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  redeemedCount: number;
}

export interface RewardInput {
  id?: string;
  name: string;
  cost: number;
  icon?: string | null;
}

export type RedeemResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'insufficient' | 'not_found' };

interface CodexApiShape {
  rpgGetDaySummary?: (date?: string) => Promise<DaySummary>;
  rpgSealDay?: (date?: string) => Promise<SealResult>;
  rpgGetSeals?: (from: string, to: string) => Promise<DaySeal[]>;
  rpgGetAchievements?: () => Promise<AchievementState[]>;
  onRpgAchievementUnlocked?: (cb: (id: string) => void) => () => void;
  rpgGetObolosBalance?: () => Promise<ObolosBalance>;
  rpgGetRewards?: () => Promise<Reward[]>;
  rpgSaveReward?: (input: Record<string, unknown>) => Promise<Reward | null>;
  rpgDeleteReward?: (id: string) => Promise<{ ok: boolean }>;
  rpgRedeemReward?: (id: string) => Promise<RedeemResult>;
}

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
