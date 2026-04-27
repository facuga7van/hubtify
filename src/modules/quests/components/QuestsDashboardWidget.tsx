import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tick } from '../../../shared/components/codex';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import Loading from '../../../shared/components/Loading';
import { useToast } from '../../../shared/components/useToast';
import { playTaskComplete } from '../../../shared/audio';
import { type Task, XP_MAP } from '../types';
import { getDueDateStatus, bonusMultiplierToTier } from '../utils';

export default function QuestsDashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [previewTasks, setPreviewTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const completingRef = useRef(false);
  const [allPendingTasks, setAllPendingTasks] = useState<Task[]>([]);
  const [habitStreaks, setHabitStreaks] = useState<Array<{ name: string; streak: number }>>([]);

  const loadData = useCallback(() => {
    Promise.all([
      window.api.questsGetPendingCount(),
      window.api.questsGetCompletedTodayCount(),
      window.api.questsGetTasks().catch(() => []),
      window.api.questsGetHabitStreaks().catch(() => []),
    ]).then(([p, c, tasks, streaks]) => {
      setPendingCount(p);
      setCompletedToday(c);
      const all = tasks as Task[];
      const pending = all.filter((t) => !t.status);
      setPreviewTasks(pending.slice(0, 4));
      setAllPendingTasks(pending);
      setHabitStreaks(streaks);
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
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

  const actualOverdueCount = useMemo(() =>
    allPendingTasks.filter(t => t.dueDate && getDueDateStatus(t.dueDate) === 'overdue').length,
    [allPendingTasks]
  );

  /* ── Task completion handler ─────────────────────── */
  const handleComplete = useCallback(async (task: Task) => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      await window.api.questsSetTaskStatus(task.id, true);
      const result = await window.api.processRpgEvent({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
        timestamp: Date.now(),
      });
      playTaskComplete();
      toast({ type: 'xp', message: `+${result.xpGained} XP`, details: { xp: result.xpGained, bonusTier: bonusMultiplierToTier(result.bonusMultiplier), comboMultiplier: result.comboMultiplier, streakMilestone: result.milestoneXp || undefined } });
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('quests:dataChanged'));
    } finally {
      completingRef.current = false;
    }
  }, [loadData, toast]);

  if (loading) return <Loading size="sm" />;
  if (loadError)
    return (
      <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
        {t('common.somethingWentWrong')}
      </p>
    );

  const total = completedToday + pendingCount;

  return (
    <div>
      {/* Mini checklist of pending tasks */}
      {previewTasks.length > 0 ? (
        previewTasks.map((task) => (
          <div
            key={task.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 0',
              fontSize: 'var(--fs-label)',
              color: task.status ? 'var(--ink-faded)' : 'var(--ink)',
            }}
          >
            <Tick checked={false} onChange={() => handleComplete(task)} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {task.name}
            </span>
          </div>
        ))
      ) : (
        <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', margin: '4px 0' }}>
          {t('questify.noQuests', 'No quests yet')}
        </p>
      )}

      {/* Footer stats */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          <b className="qb-numeral" style={{ fontSize: 'var(--fs-sub)' }}>{completedToday}</b>/{total}{' '}
          {t('questify.doneToday', 'done today')}
        </span>
        {actualOverdueCount > 0 && (
          <span style={{ color: 'var(--rubric)', fontWeight: 600 }}>
            {t('questify.overdueCount', '{{count}} overdue', { count: actualOverdueCount })}
          </span>
        )}
      </div>

      {/* Habit streaks */}
      {habitStreaks.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px solid rgba(74,55,32,.15)',
          }}
        >
          {habitStreaks.slice(0, 3).map((s) => (
            <Rune key={s.name} tone="gold">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 14 14" fill="var(--rubric)" style={{ flexShrink: 0 }}>
                  <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
                </svg>
                {s.name}: {t('questify.streakDays', '{{count}} days', { count: s.streak })}
              </span>
            </Rune>
          ))}
        </div>
      )}
    </div>
  );
}
