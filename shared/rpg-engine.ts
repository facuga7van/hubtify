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

export function calculateHpPenalty(currentHp: number): number {
  return currentHp === 0 ? 0.5 : 1.0;
}

export function calculateXpGain(
  baseXp: number,
  comboMultiplier: number,
  randomBonus: number,
  currentHp: number,
): number {
  return baseXp * comboMultiplier * randomBonus * calculateHpPenalty(currentHp);
}

export function clampHp(hp: number): number {
  return Math.max(0, Math.min(100, Math.round(hp)));
}

export function xpToNextLevel(totalXp: number): number {
  const level = getLevel(totalXp);
  return xpThreshold(level + 1) - totalXp;
}

export function getStreakMilestoneBonus(streak: number): number {
  return STREAK_MILESTONES[streak] ?? 0;
}

/**
 * Computes the next streak value applying a one-day grace period ("streak freeze").
 * The grace lets a single missed day survive the streak instead of resetting it to 1,
 * which is the biggest abandonment trigger in streak-based apps.
 *
 *  - Same day            → unchanged (today already counted).
 *  - Consecutive (diff 1) → +1, the player advances.
 *  - One day missed (diff 2) → streak survives but does NOT advance (grace, can't be farmed).
 *  - Two+ days missed (diff ≥ 3) or any anomaly → reset to 1.
 *  - No prior activity → starts at 1.
 *
 * `saved` is true only when the grace period kept an existing streak alive,
 * so the UI can show an empathetic "your streak survived" message.
 */
export function nextStreak(
  currentStreak: number,
  lastDate: string | null,
  today: string,
): { streak: number; saved: boolean } {
  if (lastDate === today) return { streak: currentStreak, saved: false };
  if (!lastDate) return { streak: 1, saved: false };
  const diff = daysDiff(lastDate, today);
  if (diff === 1) return { streak: currentStreak + 1, saved: false };
  if (diff === 2 && currentStreak >= 1) return { streak: currentStreak, saved: true };
  return { streak: 1, saved: false };
}

export { todayDateString as getLocalDateString } from './date-utils';

export function daysDiff(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
