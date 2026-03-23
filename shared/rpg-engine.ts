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

export function getTitle(level: number): string {
  for (const [threshold, title] of TITLE_THRESHOLDS) {
    if (level >= threshold) return title;
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

export function isStreakActive(lastDate: string | null, today: string): boolean {
  if (!lastDate) return false;
  const last = new Date(lastDate);
  const now = new Date(today);
  const diffMs = now.getTime() - last.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays <= 1;
}

export function getLocalDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function daysDiff(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
