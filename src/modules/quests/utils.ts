import type { TaskTier } from './types';
import { XP_MAP } from './types';
import { getComboMultiplier } from '../../../shared/rpg-engine';

export { getComboMultiplier };

export const TIER_EMOJI: Record<TaskTier, string> = {
  1: '⚡',
  2: '⚔️',
  3: '🐉',
};

export const TIER_LABEL: Record<TaskTier, string> = {
  1: 'Quick',
  2: 'Normal',
  3: 'Epic',
};

export function tierEmoji(tier: number): string {
  return TIER_EMOJI[tier as TaskTier] ?? '⚔️';
}

export function tierLabel(tier: number): string {
  return TIER_LABEL[tier as TaskTier] ?? 'Normal';
}

export function tierXp(tier: number): number {
  return XP_MAP[tier as TaskTier] ?? 15;
}

export function rollBonus(): { tier: 'normal' | 'good' | 'critical' | 'legendary'; multiplier: number } {
  const roll = Math.random();
  if (roll < 0.70) return { tier: 'normal', multiplier: 1.0 };
  if (roll < 0.90) return { tier: 'good', multiplier: 1.5 };
  if (roll < 0.98) return { tier: 'critical', multiplier: 2.0 };
  return { tier: 'legendary', multiplier: 3.0 };
}

export function calculateXpForAction(tier: number, todayCount: number): { xp: number; bonus: ReturnType<typeof rollBonus>; comboMult: number } {
  const bonus = rollBonus();
  const comboMult = getComboMultiplier(todayCount);
  const xp = Math.round(tierXp(tier) * comboMult * bonus.multiplier);
  return { xp, bonus, comboMult };
}
