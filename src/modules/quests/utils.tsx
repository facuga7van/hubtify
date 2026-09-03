import type { TFunction } from 'i18next';
import type { TaskTier, HabitWithStreak } from './types';
import { XP_MAP } from './types';
import { playTaskComplete } from '../../shared/audio';
// `getComboMultiplier` is gone from here on purpose: `rollBonus` /
// `calculateXpForAction` were the only callers and they now live in the main
// process (the renderer must not roll its own XP — see the paysXp gate).
import type { ToastData } from '../../shared/components/useToast';
import { GemRough, GemCut, GemBrilliant } from '../../shared/components/icons/CodexIcons';
import { todayDateString } from '../../../shared/date-utils';
import { questsApi } from './api';

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

export function bonusMultiplierToTier(multiplier: number): 'normal' | 'good' | 'critical' | 'legendary' {
  if (multiplier >= 3.0) return 'legendary';
  if (multiplier >= 2.0) return 'critical';
  if (multiplier >= 1.5) return 'good';
  return 'normal';
}

/* ── Shared habit check logic ──────────────────── */

/**
 * Whether a habit owes nothing more TODAY — the tick state every "today"
 * surface (Hub widget, habit list summary) paints.
 *
 * Three ways to be settled:
 *   - explicitly skipped: that is the whole point of skipping, the row stops
 *     nagging without pretending the habit was done;
 *   - already checked today: `habit_checks` is UNIQUE(habit_id, date), so a
 *     second check today is impossible whatever the weekly target. Asking only
 *     "is the period complete?" left a 3x/week habit checked today painted
 *     unticked at 2/3, while the habit row right next to it (which reads
 *     `checkedToday`) showed it done;
 *   - the period's bar is already met: a 3x/week habit that hit 3/3 on Friday
 *     owes nothing on Saturday either.
 */
export function isHabitSettledToday(h: HabitWithStreak): boolean {
  if (h.skippedToday || h.checkedToday) return true;
  if (h.frequency === 'daily') return false;
  return h.checksThisPeriod >= h.targetThisPeriod;
}

/**
 * Whether a habit belongs in "today's" list at all.
 *
 * A Mon/Wed/Fri habit on a Tuesday is neither pending nor complete — it is
 * simply not today's business, so listing it as unchecked is a false debt.
 */
export function isHabitRelevantToday(h: HabitWithStreak): boolean {
  return h.pendingToday || isHabitSettledToday(h);
}

export interface HabitCheckCallbacks {
  toast: (data: Omit<ToastData, 'id'>) => void;
  t: TFunction;
  onXpGained?: () => void;
}

/**
 * Shows an empathetic toast when a pardon kept the streak alive.
 *
 * Upstream shipped this UI against its own unlimited one-day grace
 * (`streakSaved`). The engine we kept is the pardon system — 2 per month,
 * gap === 2, plus Inn Mode — which reports the very same thing under
 * `pardonUsed`. Only the source of the flag changed; the reassurance stays.
 */
export function notifyStreakSaved(
  result: { pardonUsed?: boolean },
  callbacks: { toast: HabitCheckCallbacks['toast']; t: HabitCheckCallbacks['t'] },
): void {
  if (!result.pardonUsed) return;
  callbacks.toast({
    type: 'info',
    message: callbacks.t('questify.streakSaved', 'Tu racha sobrevivió — un día no te define, aventurero'),
  });
}

export async function processHabitCheck(
  habitId: string,
  habits: HabitWithStreak[],
  callbacks: HabitCheckCallbacks,
  date?: string,
): Promise<void> {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;

  const result = date
    ? await questsApi().questsCheckHabitForDate(habitId, date)
    : await questsApi().questsCheckHabit(habitId);

  // Every habit event names the day it is about. The engine reverts a
  // HABIT_UNCHECKED against the HABIT_CHECKED of the same habit, and without
  // the date "uncheck today" could refund yesterday's retro check instead.
  const checkDate = date ?? todayDateString();

  if (result.checked) {
    if (date) {
      // Retroactive check: flat 5 XP (period-completion gate doesn't apply to past dates)
      const rpgResult = await window.api.processRpgEvent({
        type: 'HABIT_CHECKED', moduleId: 'quests',
        payload: { xp: 5, hp: 0, habitId, date: checkDate },
        timestamp: Date.now(),
      });
      callbacks.toast({
        type: 'xp',
        message: `+${rpgResult.xpGained} XP`,
        details: {
          xp: rpgResult.xpGained,
          bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier),
          comboMultiplier: rpgResult.comboMultiplier,
          streakMilestone: rpgResult.milestoneXp || undefined,
        },
      });
      notifyStreakSaved(rpgResult, callbacks);
      callbacks.onXpGained?.();
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } else {
      // Normal check: XP only when period just completed
      const justCompletedPeriod = habit.checksThisPeriod + 1 >= habit.targetThisPeriod
        && habit.checksThisPeriod < habit.targetThisPeriod;
      if (justCompletedPeriod) {
        const streak = habit.streak + 1;
        const xp = 5 + Math.min(streak, 10);
        const rpgResult = await window.api.processRpgEvent({
          type: 'HABIT_CHECKED', moduleId: 'quests',
          payload: { xp, hp: 0, habitId, date: checkDate },
          timestamp: Date.now(),
        });
        callbacks.toast({
          type: 'xp',
          message: `+${rpgResult.xpGained} XP`,
          details: {
            xp: rpgResult.xpGained,
            bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier),
            comboMultiplier: rpgResult.comboMultiplier,
            streakMilestone: rpgResult.milestoneXp || undefined,
          },
        });
        notifyStreakSaved(rpgResult, callbacks);
        callbacks.onXpGained?.();
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
    }
    playTaskComplete();
  } else {
    // A retroactive check ALWAYS paid (flat 5 XP, no period gate), so its
    // uncheck always refunds. Unchecking today refunds only when the period
    // that was paid for is no longer complete. Either way the undo carries the
    // same habitId + date the payment did, so the engine reverts that event.
    const droppedBelowTarget = date
      ? true
      : habit.checksThisPeriod === habit.targetThisPeriod;
    if (droppedBelowTarget) {
      await window.api.processRpgEvent({
        type: 'HABIT_UNCHECKED', moduleId: 'quests',
        payload: { xp: -5, hp: 0, habitId, date: checkDate },
        timestamp: Date.now(),
      });
      callbacks.toast({ type: 'warning', message: callbacks.t('questify.habitUnchecked', 'Habit unchecked — XP deducted') });
      window.dispatchEvent(new Event('rpg:statsChanged'));
    }
  }
  window.dispatchEvent(new Event('quests:dataChanged'));
}

export function getDueDateStatus(dueDate: string): 'overdue' | 'today' | 'this-week' | 'later' {
  const now = new Date();
  // due_date is stored EITHER as 'YYYY-MM-DD' or, when the picker supplied a
  // time, as 'YYYY-MM-DDTHH:mm'. Appending 'T00:00:00' to the second shape
  // produced '…T09:00T00:00:00' — an Invalid Date, whose every comparison is
  // false, so every timed quest silently fell through to 'later' and could
  // never be shown as overdue or due today. Only the day part matters here.
  const due = new Date(dueDate.slice(0, 10) + 'T00:00:00');
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
