import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tick } from '../../../shared/components/codex';
import { useToast } from '../../../shared/components/useToast';
import { playTaskComplete } from '../../../shared/audio';
import type { HabitWithStreak } from '../types';
import { bonusMultiplierToTier } from '../utils';

export default function HabitsDashboardWidget({ colSpan, rowSpan }: { colSpan?: number; rowSpan?: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [loading, setLoading] = useState(true);
  const checkingRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const result = await window.api.questsGetHabits();
      setHabits(result as HabitWithStreak[]);
    } catch (e) {
      console.error('HabitsDashboardWidget load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('sync:questsUpdated', handler);
    window.addEventListener('quests:dataChanged', handler);
    return () => {
      window.removeEventListener('sync:questsUpdated', handler);
      window.removeEventListener('quests:dataChanged', handler);
    };
  }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  const isPeriodComplete = (h: HabitWithStreak) => {
    if (h.frequency === 'daily') return h.checkedToday;
    return h.checksThisPeriod >= h.targetThisPeriod;
  };

  const handleCheck = useCallback(async (habitId: string) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const habit = habits.find(h => h.id === habitId);
      if (!habit) return;
      const result = await window.api.questsCheckHabit(habitId);

      if (result.checked) {
        const justCompletedPeriod = habit.checksThisPeriod + 1 >= habit.targetThisPeriod
          && habit.checksThisPeriod < habit.targetThisPeriod;
        if (justCompletedPeriod) {
          const streak = habit.streak + 1;
          const xp = 5 + Math.min(streak, 10);
          const rpgResult = await window.api.processRpgEvent({
            type: 'HABIT_CHECKED', moduleId: 'quests',
            payload: { xp, hp: 0, habitId },
            timestamp: Date.now(),
          });
          toast({
            type: 'xp',
            message: `+${rpgResult.xpGained} XP`,
            details: {
              xp: rpgResult.xpGained,
              bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier),
              comboMultiplier: rpgResult.comboMultiplier,
              streakMilestone: rpgResult.milestoneXp || undefined,
            },
          });
          window.dispatchEvent(new Event('rpg:statsChanged'));
        }
        playTaskComplete();
      } else {
        const droppedBelowTarget = habit.checksThisPeriod === habit.targetThisPeriod;
        if (droppedBelowTarget) {
          await window.api.processRpgEvent({
            type: 'HABIT_UNCHECKED', moduleId: 'quests',
            payload: { xp: -5, hp: 0, habitId },
            timestamp: Date.now(),
          });
          toast({ type: 'warning', message: t('questify.habitUnchecked', 'Habit unchecked — XP deducted') });
          window.dispatchEvent(new Event('rpg:statsChanged'));
        }
      }
      await loadData();
      window.dispatchEvent(new Event('quests:dataChanged'));
    } finally {
      checkingRef.current = false;
    }
  }, [habits, loadData, toast, t]);

  if (loading) return null;

  if (habits.length === 0) {
    return (
      <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', fontStyle: 'italic', margin: '4px 0' }}>
        {t('questify.noHabits', 'Sin rituales configurados')}
      </p>
    );
  }

  const checkedCount = habits.filter(h => isPeriodComplete(h)).length;

  return (
    <div>
      <div className="widget-list-flow">
        {habits.map((h) => (
          <div
            key={h.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 0',
              fontSize: 'var(--fs-label)',
              color: isPeriodComplete(h) ? 'var(--ink-faded)' : 'var(--ink)',
            }}
          >
            <Tick
              checked={isPeriodComplete(h)}
              onChange={() => handleCheck(h.id)}
              label={h.name}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                textDecoration: isPeriodComplete(h) ? 'line-through' : undefined,
                opacity: isPeriodComplete(h) ? 0.6 : 1,
              }}
            >
              {h.name}
            </span>
            {h.streak > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  fontSize: 'var(--fs-label)',
                  color: h.streak >= 10 ? 'var(--gold)' : 'var(--ink-faded)',
                  fontFamily: "'Cinzel', serif",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 14 14" fill={h.streak >= 10 ? 'var(--gold)' : 'var(--rubric)'} style={{ flexShrink: 0 }}>
                  <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
                </svg>
                {h.streak}d
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          <b className="qb-numeral" style={{ fontSize: 'var(--fs-sub)' }}>{checkedCount}</b>/{habits.length}{' '}
          {t('questify.habitsToday', 'hoy')}
        </span>
      </div>
    </div>
  );
}
