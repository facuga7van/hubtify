import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tick } from '../../../shared/components/codex/CodexPrimitives';
import { NoonSun, Sparkle } from '../../../shared/components/icons/CodexIcons';
import QuillCheckbox from '../../../shared/components/QuillCheckbox';
import { useToast } from '../../../shared/components/useToast';
import { playTaskComplete } from '../../../shared/audio';
import PostponeMenu from './PostponeMenu';
import type { Task, Project, HabitWithStreak } from '../types';
import { getDueDateStatus, TierBadge, processHabitCheck } from '../utils';

interface Props {
  /** Every pending task, unfiltered: this view deliberately ignores the filters. */
  tasks: Task[];
  projects: Project[];
  onComplete: (task: Task) => void;
  /** Fase 1 reschedule. Receives 'today' | 'tomorrow' | 'YYYY-MM-DDTHH:mm'. */
  onPostpone: (taskId: string, target: string) => void;
  /** Sends the user to the Pendientes tab — the planning surface. */
  onPlanAhead: () => void;
  /** Habits moved, so the parent's task counters may need a refresh. */
  onHabitChecked: () => void;
}

/** How many "day conquered" lines the pool holds. */
const PRAISE_COUNT = 4;

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8.5" r="6" />
      <path d="M8 5v3.5l2.2 1.5" />
    </svg>
  );
}

/** 'YYYY-MM-DDTHH:mm' → 'HH:mm'. A bare date has no time to show. */
function dueTimeOf(dueDate: string | null): string | null {
  if (!dueDate || !dueDate.includes('T')) return null;
  return dueDate.slice(11, 16);
}

/**
 * The execution list.
 *
 * Everything here is deliberately absent: no search, no filters, no drag, no
 * expand, no project grouping. Those belong to Pendientes, which is one click
 * away. This tab answers one question — what do I do now — and the only verbs
 * it offers are "tick it" and "move it".
 */
export default function TodayView({
  tasks, projects, onComplete, onPostpone, onPlanAhead, onHabitChecked,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);

  const loadHabits = useCallback(async () => {
    try {
      const result = await window.api.questsGetHabits();
      setHabits(result as HabitWithStreak[]);
    } catch {
      // A habits hiccup must not blank out today's tasks.
    }
  }, []);

  useEffect(() => { loadHabits(); }, [loadHabits]);

  useEffect(() => {
    const handler = () => loadHabits();
    window.addEventListener('account:switched', handler);
    window.addEventListener('sync:questsUpdated', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('sync:questsUpdated', handler);
    };
  }, [loadHabits]);

  const pending = useMemo(() => tasks.filter((task) => !task.status), [tasks]);

  const overdue = useMemo(
    () => pending
      .filter((task) => task.dueDate && getDueDateStatus(task.dueDate) === 'overdue')
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [pending],
  );

  /* Timed items first, in clock order — the day reads as a schedule and the
     open-ended work sinks below it. */
  const today = useMemo(
    () => pending
      .filter((task) => task.dueDate && getDueDateStatus(task.dueDate) === 'today')
      .sort((a, b) => {
        const at = dueTimeOf(a.dueDate);
        const bt = dueTimeOf(b.dueDate);
        if (at && bt) return at.localeCompare(bt);
        if (at) return -1;
        if (bt) return 1;
        return a.order - b.order;
      }),
    [pending],
  );

  const pendingHabits = useMemo(() => habits.filter((h) => h.pendingToday), [habits]);

  const handleHabitCheck = async (habitId: string) => {
    await processHabitCheck(habitId, habits, { toast, t, onXpGained: onHabitChecked });
    await loadHabits();
    onHabitChecked();
  };

  const projectOf = (task: Task) => projects.find((p) => p.id === task.projectId) ?? null;

  const isClear = overdue.length === 0 && today.length === 0 && pendingHabits.length === 0;

  /* One line per day, not per render: a phrase that reshuffles while you look
     at it reads as a glitch, not as a reward. */
  const praiseIndex = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return (dayOfYear % PRAISE_COUNT) + 1;
  }, []);

  const PRAISE_FALLBACK: Record<number, string> = {
    1: 'El día está conquistado.',
    2: 'Nada pende sobre tu cabeza. Descansá, héroe.',
    3: 'El códice de hoy quedó cerrado y en orden.',
    4: 'Ni una misión en pie. El reino puede esperar a mañana.',
  };

  if (isClear) {
    return (
      <div className="quest-today-clear">
        {/* Codex primitives, nothing imported for the occasion. */}
        <div className="quest-today-crest" aria-hidden="true">
          <Sparkle width={14} height={14} style={{ color: 'var(--gold-dark)', opacity: 0.7 }} />
          <NoonSun width={54} height={54} style={{ color: 'var(--gold)' }} />
          <Sparkle width={14} height={14} style={{ color: 'var(--gold-dark)', opacity: 0.7 }} />
        </div>
        <p className="quest-today-praise">
          {t(`questify.todayClear${praiseIndex}`, PRAISE_FALLBACK[praiseIndex])}
        </p>
        <button type="button" className="qb-rune quest-rune-btn" onClick={onPlanAhead}>
          {t('questify.todayPlanAhead', 'Planear mañana')}
        </button>
      </div>
    );
  }

  return (
    <div className="quest-today">
      {overdue.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <div className="quest-project-header">
            <button
              type="button"
              className="quest-project-header-btn"
              onClick={() => setOverdueCollapsed((v) => !v)}
              aria-expanded={!overdueCollapsed}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"
                style={{ transition: 'transform 0.2s', transform: overdueCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', opacity: 0.5 }}>
                <path d="M3 1l4 4-4 4" />
              </svg>
              <span className="quest-project-header-name" style={{ color: 'var(--rubric)' }}>
                {t('questify.groupOverdue', 'Vencidas')}
              </span>
              <span className="quest-project-header-count">
                {t('questify.pendingCount', { count: overdue.length })}
              </span>
            </button>
          </div>
          {!overdueCollapsed && overdue.map((task) => (
            <TodayRow
              key={task.id}
              task={task}
              project={projectOf(task)}
              overdue
              onComplete={() => onComplete(task)}
              onPostpone={(target) => onPostpone(task.id, target)}
            />
          ))}
        </section>
      )}

      {today.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <div className="quest-today-heading">{t('questify.groupToday', 'Hoy')}</div>
          {today.map((task) => (
            <TodayRow
              key={task.id}
              task={task}
              project={projectOf(task)}
              onComplete={() => onComplete(task)}
            />
          ))}
        </section>
      )}

      {pendingHabits.length > 0 && (
        <section>
          <div className="quest-today-heading">{t('questify.todayHabits', 'Rituales de hoy')}</div>
          {pendingHabits.map((habit) => (
            <div key={habit.id} className="quest-today-habit">
              <Tick checked={false} onChange={() => handleHabitCheck(habit.id)} label={habit.name} />
              <button
                type="button"
                className="quest-today-habit-name"
                onClick={() => handleHabitCheck(habit.id)}
                title={habit.name}
              >
                {habit.name}
              </button>
              {habit.streak > 0 && (
                <span className="quest-habit-streak">
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="var(--rubric)" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z" />
                  </svg>
                  {habit.streak}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/* ── One executable line ──────────────────────────── */

function TodayRow({ task, project, overdue, onComplete, onPostpone }: {
  task: Task;
  project: Project | null;
  overdue?: boolean;
  onComplete: () => void;
  onPostpone?: (target: string) => void;
}) {
  const { t } = useTranslation();
  const [ticking, setTicking] = useState(false);
  const time = dueTimeOf(task.dueDate);

  return (
    <div className={`quest-row quest-today-row${overdue ? ' quest-row--delata quest-row--overdue' : ' quest-row--rara'}`}>
      <div className="quest-row-inner">
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <QuillCheckbox
            checked={ticking}
            onChange={() => { if (ticking) return; setTicking(true); playTaskComplete(); }}
            onDrawComplete={onComplete}
          />
        </span>

        <div className="quest-row-body quest-today-body">
          <div className="quest-row-header">
            <TierBadge tier={task.tier} size={14} />
            <span className="quest-row-title" title={task.name}>{task.name}</span>
          </div>
          {(time || project || overdue) && (
            <div className="quest-row-meta">
              {time && (
                <span className="quest-today-time"><ClockIcon /> {time}</span>
              )}
              {overdue && task.dueDate && (
                <span className="quest-due--overdue">
                  {new Date(`${task.dueDate.slice(0, 10)}T00:00:00`).toLocaleDateString()}
                </span>
              )}
              {project && (
                <span className="quest-today-project">
                  <span aria-hidden="true" style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: project.color, display: 'inline-block', flexShrink: 0,
                  }} />
                  {project.name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Rescheduling is the one escape a stale row needs, and it costs
            nothing (Fase 1): no XP, no penalty, no confirmation. */}
        {overdue && onPostpone && (
          <PostponeMenu
            onPick={onPostpone}
            className="quest-icon-btn tap-target"
            title={t('questify.postpone', 'Posponer')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8.5" r="6" />
              <path d="M8 5v3.5l2.2 1.5" />
              <path d="M5.5 1.6L3.4 3M10.5 1.6L12.6 3" />
            </svg>
          </PostponeMenu>
        )}
      </div>
    </div>
  );
}
