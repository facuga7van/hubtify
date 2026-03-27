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
  1: 'questify.tier.quick',
  2: 'questify.tier.normal',
  3: 'questify.tier.epic',
};

export function tierEmoji(tier: number): string {
  return TIER_EMOJI[tier as TaskTier] ?? '⚔️';
}

export function tierLabel(tier: number): string {
  return TIER_LABEL[tier as TaskTier] ?? 'questify.tier.normal';
}

export function tierXp(tier: number): number {
  return XP_MAP[tier as TaskTier] ?? 15;
}

export function TierBadge({ tier, size = 16, active = false }: { tier: number; size?: number; active?: boolean }) {
  const colors = {
    1: active ? 'var(--rpg-ink)' : '#3498db',
    2: active ? 'var(--rpg-ink)' : 'var(--rpg-gold-dark)',
    3: active ? 'var(--rpg-ink)' : '#c0392b',
  };
  const color = colors[tier as TaskTier] ?? colors[2];

  if (tier === 1) {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={{ display: 'block', flexShrink: 0 }}><path d="M9 1L4 9h4l-1 6 5-8H8l1-6z"/></svg>;
  }
  if (tier === 3) {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={{ display: 'block', flexShrink: 0 }}><path d="M8 1c-1 2-4 4-4 7a4 4 0 008 0c0-1-.5-2-1.5-3 .5 1 .5 2-.5 3-1-1-1-3-2-4-.5 1.5-1 2.5-1 3.5a1.5 1.5 0 003 0c0-.5-.3-1.5-1-2.5z"/></svg>;
  }
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" style={{ display: 'block', flexShrink: 0 }}><path d="M2 14l5-5M7 9l3.5-3.5M12 2l2 2-1.5 1.5M2 2l12 12"/></svg>;
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
