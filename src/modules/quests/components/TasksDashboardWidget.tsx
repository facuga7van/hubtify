import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Tick } from '../../../shared/components/codex';
import Loading from '../../../shared/components/Loading';
import { useToast } from '../../../shared/components/useToast';
import { playTaskComplete } from '../../../shared/audio';
import { type Task, XP_MAP } from '../types';
import { getDueDateStatus, bonusMultiplierToTier } from '../utils';
import { questsApi } from '../api';

export default function TasksDashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [allPendingTasks, setAllPendingTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const completingRef = useRef(false);

  const loadData = useCallback(() => {
    Promise.all([
      window.api.questsGetPendingCount(),
      window.api.questsGetCompletedTodayCount(),
      window.api.questsGetTasks().catch(() => []),
    ]).then(([p, c, tasks]) => {
      setPendingCount(p);
      setCompletedToday(c);
      const all = tasks as Task[];
      setAllPendingTasks(all.filter((t) => !t.status));
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

  /* The project selector was removed: it duplicated the one on the Questify
     page, ate the full width of a small card, and its footer counters still
     reported global totals, so a filtered list read "2 listed / 3 of 17". */
  const actualOverdueCount = useMemo(() =>
    allPendingTasks.filter(t => t.dueDate && getDueDateStatus(t.dueDate) === 'overdue').length,
    [allPendingTasks]
  );

  const MAX_WIDGET_TASKS = 8;
  const displayTasks = useMemo(() => {
    const urgencyOrder = (task: Task) => {
      if (!task.dueDate) return 3;
      const status = getDueDateStatus(task.dueDate);
      if (status === 'overdue') return 0;
      if (status === 'today') return 1;
      return 2;
    };
    return [...allPendingTasks]
      .sort((a, b) => urgencyOrder(a) - urgencyOrder(b))
      .slice(0, MAX_WIDGET_TASKS);
  }, [allPendingTasks]);

  const handleComplete = useCallback(async (task: Task) => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      // `paysXp === false`: another instance of this recurring chain already
      // paid today. The tick still lands, the XP does not. An older main
      // answers undefined, which pays (see quests/api.ts).
      const status = await questsApi().questsSetTaskStatus(task.id, true);
      playTaskComplete();
      if (status && status.paysXp === false) {
        toast({ type: 'info', message: t('questify.repeatAlreadyPaid', 'Esta misión ya pagó hoy — la cadena avanza igual') });
      } else {
        const result = await window.api.processRpgEvent({
          type: 'TASK_COMPLETED', moduleId: 'quests',
          payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
          timestamp: Date.now(),
        });
        toast({ type: 'xp', message: `+${result.xpGained} XP`, details: { xp: result.xpGained, bonusTier: bonusMultiplierToTier(result.bonusMultiplier), comboMultiplier: result.comboMultiplier, streakMilestone: result.milestoneXp || undefined } });
      }
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('quests:dataChanged'));
    } finally {
      completingRef.current = false;
    }
  }, [loadData, toast, t]);

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
      {/* Task checklist */}
      {displayTasks.length > 0 ? (
        <div className="widget-list-flow">
          {displayTasks.map((task) => (
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
                title={task.name}
              >
                {task.name}
              </span>
            </div>
          ))}
          {/* "+N más" now actually goes somewhere instead of being a dead span. */}
          {allPendingTasks.length > MAX_WIDGET_TASKS && (
            <button
              type="button"
              className="qb-hand widget-more-link"
              onClick={() => navigate('/quests')}
            >
              +{allPendingTasks.length - MAX_WIDGET_TASKS} {t('questify.showMore', 'más')}
            </button>
          )}
        </div>
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
    </div>
  );
}
