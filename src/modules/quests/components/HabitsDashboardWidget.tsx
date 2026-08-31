import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tick } from '../../../shared/components/codex';
import { useToast } from '../../../shared/components/useToast';
import type { HabitWithStreak } from '../types';
import { processHabitCheck } from '../utils';

const MAX_WIDGET_HABITS = 8;

export default function HabitsDashboardWidget() {
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
      await processHabitCheck(habitId, habits, { toast, t });
      await loadData();
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
  // Same cap as the tasks widget — an unbounded list turned this card into a
  // permanent scroll well once you had a dozen habits.
  const displayHabits = habits.slice(0, MAX_WIDGET_HABITS);

  return (
    <div>
      <div className="widget-list-flow">
        {displayHabits.map((h) => (
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
              title={h.name}
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
        {habits.length > MAX_WIDGET_HABITS && (
          <span className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', padding: '2px 0' }}>
            +{habits.length - MAX_WIDGET_HABITS} {t('questify.showMore', 'más')}
          </span>
        )}
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
