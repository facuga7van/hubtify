import {
  COMBO_MULTIPLIERS,
  RANDOM_BONUS_TABLE,
  TITLE_THRESHOLDS,
  STREAK_MILESTONES,
} from './types';

export function xpThreshold(n: number): number {
  if (n <= 1) return 0;
  return Math.round(120 * Math.pow(n, 1.5));
}

export function getLevel(totalXp: number): number {
  let level = 1;
  while (xpThreshold(level + 1) <= totalXp) {
    level++;
  }
  return level;
}

/** Returns the i18n key for the title at this level. */
export function getTitleKey(level: number): string {
  for (const [threshold, key] of TITLE_THRESHOLDS) {
    if (level >= threshold) return key;
  }
  return 'rpg.titles.peasant';
}

/** Returns the fallback (untranslated) title name. */
export function getTitle(level: number): string {
  for (const [threshold, , fallback] of TITLE_THRESHOLDS) {
    if (level >= threshold) return fallback;
  }
  return 'Campesino';
}

export function getComboMultiplier(actionsToday: number): number {
  const index = Math.min(actionsToday, COMBO_MULTIPLIERS.length - 1);
  return COMBO_MULTIPLIERS[index];
}

export function rollRandomBonus(): number {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const { weight, multiplier } of RANDOM_BONUS_TABLE) {
    cumulative += weight;
    if (roll < cumulative) return multiplier;
  }
  return 1.0;
}

/**
 * XP is NEVER reduced by low HP.
 *
 * `calculateHpPenalty` used to halve every gain at hp = 0, and nothing in the
 * whole codebase regenerated HP — the only exit was the (nonexistent) one. That
 * is accumulated debt punishment, the exact mechanic that burns Habitica users
 * out, and it ran on a single axis (only Nutrify moved HP). HP is now **Vigor**:
 * the state of TODAY, reset to 100 every local morning (see `rolloverVigor` in
 * electron/ipc/rpg-stats.ts). A bad day dies with the day.
 */
export function calculateXpGain(
  baseXp: number,
  comboMultiplier: number,
  randomBonus: number,
): number {
  return baseXp * comboMultiplier * randomBonus;
}

/**
 * Vigor pays a BONUS, never a penalty — the carrot replacing the old stick.
 *
 * Proposed mapping (phase 2, "Cierre del Códice"): the day's closing multiplier
 * applied ONCE to the day's summary, not per event.
 *   hp >= 90 → 1.10   (day closed in full health)
 *   hp >= 70 → 1.05
 *   hp <  70 → 1.00   (never below 1.0 — a bad day costs the bonus, not XP)
 *
 * Exported with no callers on purpose: phase 1 only clears the ground.
 */
export function vigorBonus(hp: number): number {
  if (hp >= 90) return 1.1;
  if (hp >= 70) return 1.05;
  return 1.0;
}

export function clampHp(hp: number): number {
  return Math.max(0, Math.min(100, Math.round(hp)));
}

// ── Cierre del Códice (phase 2) ────────────────────────────────────────────
//
// Sealing a day is a RITUAL, not a chore:
//   - skipping it costs nothing (no decay, no seal-streak, no penalty),
//   - it can be back-sealed for one day (the grace window below),
//   - it refuses to seal a day with no events, because the seal certifies a day
//     that was LIVED, not a button that was pressed.

/**
 * Event types that are bookkeeping, not living: the undo family, the
 * zero-impact registrations and the engine's own output. They stay in the log
 * (the Códice timeline shows them) but they are never "an event of the day".
 *
 * Belt AND braces: `isMeaningfulEvent` also demands xp > 0 and a real module,
 * so a future type that pays nothing is excluded even before it lands here.
 */
export const NON_MEANINGFUL_EVENT_TYPES: readonly string[] = [
  'TASK_UNCOMPLETED',
  'SUBTASK_UNCOMPLETED',
  'HABIT_UNCHECKED',
  'TASK_CREATED',
  'HABIT_SKIPPED',
  'NUTRITION_DAY_REOPENED',
  'STATEMENT_IMPORTED',
  'POMODORO_ABANDONED',
  'DAY_SEALED',
  'ACHIEVEMENT_UNLOCKED',
];

/** The module id the engine writes its own rows under (seal, achievements). */
export const ENGINE_MODULE_ID = 'rpg';

/**
 * THE single rule for "did something happen today".
 *
 * Used by the seal (`eventsCount`, `empty_day`, the sealed modules) and by
 * every achievement that counts events or event kinds (`polymath`,
 * `sunday_guardian`, `chronicler_*`, `perfect_day`). A row is meaningful when
 * it is a REAL action that PAID: positive XP, emitted by a module (never by
 * the engine itself), and not an undo / registration / zero-impact type.
 *
 * Before this rule existed, a retro seal written today counted as "today's
 * event" and let tomorrow's seal pay for it — a streak that fed itself.
 */
export function isMeaningfulEvent(row: {
  moduleId: string;
  eventType: string;
  xpGained: number;
}): boolean {
  if (!row.moduleId || row.moduleId === ENGINE_MODULE_ID) return false;
  if (!(row.xpGained > 0)) return false;
  return !NON_MEANINGFUL_EVENT_TYPES.includes(row.eventType);
}

/** Floor paid by any seal. */
export const SEAL_BASE_XP = 10;
/** XP per event of the sealed day. */
export const SEAL_XP_PER_EVENT = 2;
/** Events beyond this stop paying — a busy day is not a farm. */
export const SEAL_EVENT_CAP = 20;
/** How many days back a day may still be sealed. 1 = today or yesterday. */
export const SEAL_GRACE_DAYS = 1;

/**
 * XP paid for sealing a day.
 *
 *   XP = round((SEAL_BASE_XP + SEAL_XP_PER_EVENT * min(events, SEAL_EVENT_CAP)) * vigorBonus(vigor))
 *
 * Range: 12 XP (one event, low vigor) … 55 XP (20+ events, vigor >= 90).
 * Flat — the seal never takes the daily combo or the random bonus, so the
 * ritual cannot be used to amplify anything.
 */
export function sealXp(eventsCount: number, vigor: number): number {
  const paid = Math.max(0, Math.min(SEAL_EVENT_CAP, Math.floor(eventsCount)));
  return Math.round((SEAL_BASE_XP + SEAL_XP_PER_EVENT * paid) * vigorBonus(vigor));
}

/**
 * Whether `date` is inside the sealing window relative to `today`.
 * Returns the reason it is not, so callers can report it verbatim.
 */
export function sealWindowStatus(date: string, today: string): 'ok' | 'future' | 'too_old' {
  const gap = daysDiff(date, today);
  if (gap < 0) return 'future';
  if (gap > SEAL_GRACE_DAYS) return 'too_old';
  return 'ok';
}

/** Full Vigor. The day always starts here. */
export const MAX_VIGOR = 100;

/**
 * Automatic streak pardons per calendar month.
 *
 * Duolingo reported ~+40% streak adoption after decoupling the streak from
 * perfection (streak freezes). One missed day should not delete months of work;
 * two missed days in a row still does — pardons do not stack.
 */
export const PARDONS_PER_MONTH = 2;

/** The YYYY-MM bucket a YYYY-MM-DD date belongs to. */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Pardons still available in `month`, given the stored counter and its month.
 *
 * `extra` is the count of PURCHASED pardons for that month (the shop's
 * `pardon_extra`, capped at 1/month at purchase time). It raises the month's
 * capacity without touching the used counter, so the automatic 2/month and
 * the bought one share a single bookkeeping path.
 */
export function pardonsRemaining(
  storedMonth: string | null,
  storedUsed: number,
  month: string,
  extra = 0,
): number {
  const used = storedMonth === month ? Math.max(0, storedUsed || 0) : 0;
  const bought = Math.max(0, Math.floor(extra) || 0);
  return Math.max(0, PARDONS_PER_MONTH + bought - used);
}

export function xpToNextLevel(totalXp: number): number {
  const level = getLevel(totalXp);
  return xpThreshold(level + 1) - totalXp;
}

// ── Maestrías por módulo (phase 4) ─────────────────────────────────────────
//
// The global level becomes a badge of history; what the day-180 player feels
// is the four per-module bars, each with its own line. Their fuel is the
// `mastery_xp` accumulator (electron/ipc/db.ts core v6): `rpg_events` is
// pruned at 365 days, so a mastery can never be recomputed from it — it is
// summed forward, event by event, and backfilled once from whatever history
// still exists.

/** Mastery levels run 1..10. */
export const MASTERY_MAX_LEVEL = 10;

/**
 * Cumulative XP required to REACH each level (index 0 → level 1).
 *
 * Deliberately slower than the global curve (global L10 ≈ 3.800 XP): a module
 * used seriously earns ~40-60 XP/day, so level 10 at 9.500 XP lands around six
 * months of real use — the brief's target. Early ranks still come fast
 * (level 2 inside the first days), because a bar that never moves teaches
 * nothing.
 */
export const MASTERY_THRESHOLDS: readonly number[] = [
  0, 100, 300, 700, 1300, 2200, 3400, 5000, 7000, 9500,
];

/** Cumulative XP needed to reach mastery level `n` (clamped to 1..10). */
export function masteryThreshold(n: number): number {
  const idx = Math.max(1, Math.min(MASTERY_MAX_LEVEL, Math.floor(n))) - 1;
  return MASTERY_THRESHOLDS[idx];
}

/** Mastery level for an accumulated XP total. Monotonic, 1..10. */
export function masteryLevel(xp: number): number {
  const total = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let level = 1;
  while (level < MASTERY_MAX_LEVEL && MASTERY_THRESHOLDS[level] <= total) level++;
  return level;
}

/**
 * Thematic rank names, one per level — guild ranks, not numbers.
 * `[i18n suffix, Spanish fallback]`; the full key is `rpg.mastery.ranks.<suffix>`.
 */
export const MASTERY_RANKS: ReadonlyArray<readonly [string, string]> = [
  ['apprentice', 'Aprendiz'],
  ['initiate', 'Iniciado'],
  ['journeyman', 'Oficial'],
  ['artisan', 'Artesano'],
  ['adept', 'Adepto'],
  ['veteran', 'Veterano'],
  ['expert', 'Experto'],
  ['master', 'Maestro'],
  ['grandmaster', 'Gran Maestro'],
  ['legend', 'Leyenda del Oficio'],
];

/** i18n key for the rank at mastery level `n`. */
export function masteryRankKey(n: number): string {
  const idx = Math.max(1, Math.min(MASTERY_MAX_LEVEL, Math.floor(n))) - 1;
  return `rpg.mastery.ranks.${MASTERY_RANKS[idx][0]}`;
}

/** Untranslated (Spanish) rank name at mastery level `n`. */
export function masteryRankName(n: number): string {
  const idx = Math.max(1, Math.min(MASTERY_MAX_LEVEL, Math.floor(n))) - 1;
  return MASTERY_RANKS[idx][1];
}

/**
 * Everything a mastery bar renders, derived from the accumulator alone.
 * `nextLevelXp` is null at level 10; `progress` is 0..1 within the level
 * (pinned to 1 at the cap).
 */
export function masteryInfo(xp: number): {
  level: number;
  levelName: string;
  levelKey: string;
  nextLevelXp: number | null;
  progress: number;
} {
  const total = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  const level = masteryLevel(total);
  if (level >= MASTERY_MAX_LEVEL) {
    return {
      level,
      levelName: masteryRankName(level),
      levelKey: masteryRankKey(level),
      nextLevelXp: null,
      progress: 1,
    };
  }
  const floor = MASTERY_THRESHOLDS[level - 1];
  const ceil = MASTERY_THRESHOLDS[level];
  return {
    level,
    levelName: masteryRankName(level),
    levelKey: masteryRankKey(level),
    nextLevelXp: ceil,
    progress: Math.max(0, Math.min(1, (total - floor) / (ceil - floor))),
  };
}

export function getStreakMilestoneBonus(streak: number): number {
  return STREAK_MILESTONES[streak] ?? 0;
}

export { todayDateString as getLocalDateString } from './date-utils';

export function daysDiff(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
