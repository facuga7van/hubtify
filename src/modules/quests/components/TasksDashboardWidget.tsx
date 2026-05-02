import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tick } from '../../../shared/components/codex';
import Loading from '../../../shared/components/Loading';
import { useToast } from '../../../shared/components/useToast';
import { playTaskComplete } from '../../../shared/audio';
import { type Task, type Project, XP_MAP } from '../types';
import { getDueDateStatus, bonusMultiplierToTier } from '../utils';

export default function TasksDashboardWidget({ colSpan, rowSpan }: { colSpan?: number; rowSpan?: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [allPendingTasks, setAllPendingTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const completingRef = useRef(false);

  const loadData = useCallback(() => {
    Promise.all([
      window.api.questsGetPendingCount(),
      window.api.questsGetCompletedTodayCount(),
      window.api.questsGetTasks().catch(() => []),
      window.api.questsGetProjects().catch(() => []),
    ]).then(([p, c, tasks, projs]) => {
      setPendingCount(p);
      setCompletedToday(c);
      const all = tasks as Task[];
      setAllPendingTasks(all.filter((t) => !t.status));
      setProjects(projs as Project[]);
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

  const filteredTasks = useMemo(() => {
    if (selectedProjectId === null) return allPendingTasks;
    if (selectedProjectId === '__none__') return allPendingTasks.filter(t => !t.projectId);
    return allPendingTasks.filter(t => t.projectId === selectedProjectId);
  }, [allPendingTasks, selectedProjectId]);

  const actualOverdueCount = useMemo(() =>
    filteredTasks.filter(t => t.dueDate && getDueDateStatus(t.dueDate) === 'overdue').length,
    [filteredTasks]
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
    return [...filteredTasks]
      .sort((a, b) => urgencyOrder(a) - urgencyOrder(b))
      .slice(0, MAX_WIDGET_TASKS);
  }, [filteredTasks]);

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
      {/* Project filter */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <select
            className="rpg-select"
            value={selectedProjectId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value === '' ? null : e.target.value)}
            style={{ fontSize: 'var(--fs-label)', padding: '2px 6px', width: '100%' }}
          >
            <option value="">{t('questify.allProjects', 'Todas las misiones')}</option>
            <option value="__none__">{t('questify.noProject', 'Sin proyecto')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
              >
                {task.name}
              </span>
            </div>
          ))}
          {filteredTasks.length > MAX_WIDGET_TASKS && (
            <span className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', padding: '2px 0' }}>
              +{filteredTasks.length - MAX_WIDGET_TASKS} {t('questify.showMore', 'más')}
            </span>
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
