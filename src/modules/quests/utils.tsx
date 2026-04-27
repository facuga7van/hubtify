import type { TaskTier } from './types';
import { XP_MAP } from './types';
import { getComboMultiplier } from '../../../shared/rpg-engine';
import { GemRough, GemCut, GemBrilliant } from '../../shared/components/icons/CodexIcons';

export const TIER_LABEL: Record<TaskTier, string> = {
  1: 'questify.tier.quick',
  2: 'questify.tier.normal',
  3: 'questify.tier.epic',
};

export function tierXp(tier: number): number {
  return XP_MAP[tier as TaskTier] ?? 15;
}

export function TierBadge({ tier, size = 16, active = false }: { tier: number; size?: number; active?: boolean }) {
  const colors = {
    1: active ? 'var(--ink)' : 'var(--ink-soft)',
    2: active ? 'var(--ink)' : 'var(--gold-dark)',
    3: active ? 'var(--ink)' : 'var(--rubric)',
  };
  const color = colors[tier as TaskTier] ?? colors[2];
  const iconProps = { width: size, height: size, style: { color, display: 'block', flexShrink: 0 } as React.CSSProperties };

  if (tier === 1) return <GemRough {...iconProps} />;
  if (tier === 3) return <GemBrilliant {...iconProps} />;
  return <GemCut {...iconProps} />;
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

export function bonusMultiplierToTier(multiplier: number): 'normal' | 'good' | 'critical' | 'legendary' {
  if (multiplier >= 3.0) return 'legendary';
  if (multiplier >= 2.0) return 'critical';
  if (multiplier >= 1.5) return 'good';
  return 'normal';
}

export function getDueDateStatus(dueDate: string): 'overdue' | 'today' | 'this-week' | 'later' {
  const now = new Date();
  const due = new Date(dueDate + 'T00:00:00');
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  if (due < todayStart) return 'overdue';
  if (due < todayEnd) return 'today';
  if (due < weekEnd) return 'this-week';
  return 'later';
}
