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

/** Pardons still available in `month`, given the stored counter and its month. */
export function pardonsRemaining(
  storedMonth: string | null,
  storedUsed: number,
  month: string,
): number {
  const used = storedMonth === month ? Math.max(0, storedUsed || 0) : 0;
  return Math.max(0, PARDONS_PER_MONTH - used);
}

export function xpToNextLevel(totalXp: number): number {
  const level = getLevel(totalXp);
  return xpThreshold(level + 1) - totalXp;
}

export function getStreakMilestoneBonus(streak: number): number {
  return STREAK_MILESTONES[streak] ?? 0;
}

export { todayDateString as getLocalDateString } from './date-utils';

export function daysDiff(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
