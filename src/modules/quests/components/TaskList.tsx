import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../../../shared/AuthContext';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import gsap from 'gsap';
import { BookPage } from '../../../shared/components/codex/BookPage';
import {
  Section, Rune, Tick, Gauge, SmallCount, Banner, QBDividerSection,
} from '../../../shared/components/codex/CodexPrimitives';
import { Quill, Sword, Compass, Map as MapIcon } from '../../../shared/components/icons/CodexIcons';
import TaskForm from './TaskForm';
import SubtaskList from './SubtaskList';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import type { XpToastData } from '../types';
import ProjectManager from './ProjectManager';
import ScrollNotes from './ScrollNotes';
import HabitTracker from './HabitTracker';
import { type Task, type Subtask, type Project, XP_MAP } from '../types';
import { getDueDateStatus, bonusMultiplierToTier, notifyStreakSaved, TierBadge } from '../utils';
import { playTaskComplete, playDelete } from '../../../shared/audio';
import { useAnimatedNavigate } from '../../../shared/components/AnimatedOutlet';
import QuillCheckbox from '../../../shared/components/QuillCheckbox';
import { completeTask as completeTaskAnim, removeItem } from '../../../shared/animations/feedback';
import Tooltip from '../../../shared/components/Tooltip';
import HelpBubble from '../../../shared/components/HelpBubble';

/* ── Tier mapping from numeric tier to codex labels/colors ── */
const TIER_MAP: Record<number, { i18nKey: string; cls: string; color: string }> = {
  1: { i18nKey: 'questify.tiers.common', cls: 'communis', color: 'var(--ink-soft)' },
  2: { i18nKey: 'questify.tiers.rare', cls: 'rara', color: 'var(--moss)' },
  3: { i18nKey: 'questify.tiers.epic', cls: 'epica', color: 'var(--gold-dark)' },
};

function getTierInfo(task: Task) {
  const isOverdue = task.dueDate && getDueDateStatus(task.dueDate) === 'overdue';
  if (isOverdue && !task.status) {
    return { i18nKey: 'questify.tiers.overdue', cls: 'delata', color: 'var(--rubric)' };
  }
  return TIER_MAP[task.tier] ?? TIER_MAP[2];
}

export default function TaskList() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuthContext();
  const animatedNavigate = useAnimatedNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [activeProjectId, setActiveProjectId] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState('');
  const [todayCount, setTodayCount] = useState(0);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [notesTaskId, setNotesTaskId] = useState<string | null>(null);
  const [drawingCounts, setDrawingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const completingRef = useRef(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const collapsedStorageKey = user?.uid
    ? `questify_collapsed_projects_${user.uid}`
    : 'questify_collapsed_projects';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(collapsedStorageKey);
      setCollapsedProjects(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch { setCollapsedProjects(new Set()); }
  }, [collapsedStorageKey]);
  const formRef = useRef<HTMLDivElement>(null);

  /* ── Data loading ───────────────────────────────── */
  const loadTasks = useCallback(async () => {
    try {
      const catProjectId = activeProjectId === undefined ? undefined : activeProjectId;
      const [allTasks, cats, count, projs] = await Promise.all([
        window.api.questsGetTasks(),
        window.api.questsGetCategories(catProjectId),
        window.api.questsCountCompletedToday(),
        window.api.questsGetProjects(),
      ]);
      setTasks(allTasks as Task[]);
      setCategories(cats);
      setTodayCount(count);
      setProjects(projs as Project[]);
      const drawCountsRaw = await window.api.questsGetAllDrawingCounts();
      const counts: Record<string, number> = Object.fromEntries(
        drawCountsRaw.filter(dc => dc.count > 0).map(dc => [dc.task_id, dc.count])
      );
      setDrawingCounts(counts);
      setLoading(false);
    } catch (err) {
      console.error('[Quests]', err);
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('sync:questsUpdated', handler);
    return () => window.removeEventListener('sync:questsUpdated', handler);
  }, [loadTasks]);

  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadTasks]);

  useEffect(() => {
    if (editingTask) {
      setShowForm(true);
      if (formRef.current) {
        formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const card = formRef.current.querySelector('.rpg-card') as HTMLElement;
        if (!card) return;
        const tl = gsap.timeline();
        tl.fromTo(card, {
          boxShadow: '0 0 12px 4px rgba(168, 138, 60, 0.6), inset 0 0 8px rgba(168, 138, 60, 0.2)',
          borderColor: 'var(--gold)',
        }, {
          boxShadow: '0 0 0 0 transparent, inset 0 0 0 transparent',
          borderColor: 'rgba(74, 55, 32, 0.45)',
          duration: 1.8,
          ease: 'power2.out',
        });
        tl.fromTo(card, { scale: 1.015 }, { scale: 1, duration: 0.5, ease: 'power2.out' }, 0);
      }
    }
  }, [editingTask]);

  const loadSubtasks = useCallback(async (taskId: string) => {
    const subs = await window.api.questsGetSubtasks(taskId);
    setSubtasksMap((prev) => ({ ...prev, [taskId]: subs as Subtask[] }));
  }, []);

  const toggleExpand = (taskId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else { next.add(taskId); loadSubtasks(taskId); }
      return next;
    });
  };

  /* ── Filtering ──────────────────────────────────── */
  const filteredByProject = useMemo(() => {
    if (activeProjectId === undefined) return tasks;
    return tasks.filter((t) => (activeProjectId === null ? t.projectId === null : t.projectId === activeProjectId));
  }, [tasks, activeProjectId]);

  const matchesSearch = useCallback((task: Task) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return task.name.toLowerCase().includes(q) || (task.description?.toLowerCase().includes(q) ?? false);
  }, [searchQuery]);

  const pending = useMemo(() =>
    filteredByProject.filter((t) => !t.status)
      .sort((a, b) => a.order - b.order)
      .filter((t) => !filter || t.category === filter)
      .filter(matchesSearch),
    [filteredByProject, filter, matchesSearch]
  );

  const completed = useMemo(() =>
    filteredByProject
      .filter((t) => t.status)
      .filter((t) => !filter || t.category === filter)
      .filter(matchesSearch)
      .sort((a, b) => {
        if (!a.completedAt || !b.completedAt) return 0;
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      }),
    [filteredByProject, filter, matchesSearch]
  );

  type DueDateGroup = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDate';
  const DUE_GROUP_ORDER: DueDateGroup[] = ['overdue', 'today', 'thisWeek', 'later', 'noDate'];

  const pendingByDueDate = useMemo(() => {
    if (activeProjectId !== undefined) return null;
    const grouped: Record<DueDateGroup, Task[]> = {
      overdue: [], today: [], thisWeek: [], later: [], noDate: [],
    };
    for (const task of pending) {
      if (!task.dueDate) {
        grouped.noDate.push(task);
      } else {
        const status = getDueDateStatus(task.dueDate);
        if (status === 'overdue') grouped.overdue.push(task);
        else if (status === 'today') grouped.today.push(task);
        else if (status === 'this-week') grouped.thisWeek.push(task);
        else grouped.later.push(task);
      }
    }
    return DUE_GROUP_ORDER
      .filter(key => grouped[key].length > 0)
      .map(key => ({ key, tasks: grouped[key] }));
  }, [pending, activeProjectId]);

  /* ── Counts for stats strip ─────────────────────── */
  const inProgressCount = pending.length;
  const overdueCount = useMemo(() =>
    pending.filter(t => t.dueDate && getDueDateStatus(t.dueDate) === 'overdue').length,
    [pending]
  );
  const todayDueCount = useMemo(() =>
    pending.filter(t => t.dueDate && getDueDateStatus(t.dueDate) === 'today').length,
    [pending]
  );

  /* ── Campaigns (project progress) ───────────────── */
  const campaignData = useMemo(() => {
    return projects.map(p => {
      const projectTasks = tasks.filter(t => t.projectId === p.id);
      const done = projectTasks.filter(t => t.status).length;
      const total = projectTasks.length;
      return { project: p, done, total };
    }).filter(c => c.total > 0);
  }, [projects, tasks]);

  /* ── Actions ────────────────────────────────────── */
  const handleComplete = async (task: Task) => {
    const newStatus = !task.status;
    if (newStatus) {
      const [, result] = await Promise.all([
        window.api.questsSetTaskStatus(task.id, true),
        window.api.processRpgEvent({
          type: 'TASK_COMPLETED', moduleId: 'quests',
          payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
          timestamp: Date.now(),
        }),
      ]);
      toast({ type: 'xp', message: `+${result.xpGained} XP`, details: { xp: result.xpGained, bonusTier: bonusMultiplierToTier(result.bonusMultiplier), comboMultiplier: result.comboMultiplier, streakMilestone: result.milestoneXp || undefined } });
      notifyStreakSaved(result, { toast, t });
    } else {
      await window.api.questsSetTaskStatus(task.id, false);
      await window.api.processRpgEvent({
        type: 'TASK_UNCOMPLETED', moduleId: 'quests',
        payload: { xp: -XP_MAP[task.tier], hp: 0, taskId: task.id },
        timestamp: Date.now(),
      });
    }
    await loadTasks();
    window.dispatchEvent(new Event('rpg:statsChanged'));
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const handleBatchComplete = async () => {
    const ids = Array.from(selectedIds);
    const tasksToComplete = ids.map(id => pending.find(t => t.id === id)).filter(Boolean) as Task[];
    await Promise.all(tasksToComplete.map(async (task) => {
      await window.api.questsSetTaskStatus(task.id, true);
      await window.api.processRpgEvent({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
        timestamp: Date.now(),
      });
    }));
    playTaskComplete();
    toast({
      type: 'xp',
      message: t('questify.batchCompleted', '{{count}} quests completed!', { count: ids.length }),
    });
    setSelectedIds(new Set());
    await loadTasks();
    window.dispatchEvent(new Event('rpg:statsChanged'));
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      message: t('questify.deleteConfirm', { count: selectedIds.size }),
      danger: true,
      confirmText: t('questify.delete'),
    });
    if (!ok) return;
    playDelete();
    await window.api.questsDeleteTasks(Array.from(selectedIds));
    setSelectedIds(new Set());
    await loadTasks();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = pending.findIndex((t) => t.id === active.id);
    const newIdx = pending.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(pending, oldIdx, newIdx);
    const orders = reordered.map((t, i) => ({ id: t.id, order: i }));
    setTasks((prev) => {
      const updated = [...prev];
      for (const { id, order } of orders) {
        const idx = updated.findIndex((t) => t.id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], order };
      }
      return updated;
    });
    await window.api.questsSyncTaskOrders(orders);
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const onDragEndInSection = async (event: DragEndEvent, sectionTasks: Task[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionTasks.findIndex((t) => t.id === active.id);
    const newIdx = sectionTasks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(sectionTasks, oldIdx, newIdx);
    const orders = reordered.map((t, i) => ({ id: t.id, order: i }));
    setTasks((prev) => {
      const updated = [...prev];
      for (const { id, order } of orders) {
        const idx = updated.findIndex((t) => t.id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], order };
      }
      return updated;
    });
    await window.api.questsSyncTaskOrders(orders);
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const toggleProjectCollapse = (key: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const uniqueCategories = useMemo(() => {
    const cats = new Set(filteredByProject.map((t) => t.category).filter(Boolean));
    return Array.from(cats);
  }, [filteredByProject]);

  const taskItemProps = (task: Task) => ({
    task,
    expanded: expandedIds.has(task.id),
    selected: selectedIds.has(task.id),
    subtasks: subtasksMap[task.id] ?? [],
    todayCount,
    onToggleExpand: () => toggleExpand(task.id),
    onComplete: () => handleComplete(task),
    onEdit: () => setEditingTask(task),
    onToggleSelect: () => setSelectedIds((prev) => {
      const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next;
    }),
    onShowToast: (d: XpToastData) => toast({ type: 'xp', message: `+${d.xp} XP`, details: { xp: d.xp, bonusTier: d.bonusTier, comboMultiplier: d.comboMultiplier, streakMilestone: d.streakMilestone || undefined } }),
    onSubtaskChanged: () => { loadSubtasks(task.id); loadTasks(); window.dispatchEvent(new Event('quests:dataChanged')); },
    drawingCount: drawingCounts[task.id] ?? 0,
    onOpenNotes: () => setNotesTaskId(task.id),
    isEditing: editingTask?.id === task.id,
  });

  const SkeletonCards = () => (
    <>
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="quest-skeleton" style={{ animationDelay: `${i * 100}ms` }} />
      ))}
    </>
  );

  /* ── Render ─────────────────────────────────────── */
  return (
    <BookPage
      data-tour="quests"
      eyebrow={t('questify.eyebrow', 'QUESTIFY — LIBER MISSIONUM')}
      title={t('questify.title')}
      subtitle={t('questify.subtitle')}
    >
      {/* ── Stats strip ──────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <HelpBubble text={t('questify.statsHelp', 'Resumen de misiones: en progreso, vencidas, para hoy y completadas.')} />
        <div className="quest-stats-strip">
          <SmallCount label={t('questify.inProgress', 'EN CURSO')} value={inProgressCount} />
          <SmallCount label={t('questify.overdue', 'VENCIDAS')} value={overdueCount} tone="rubric" />
          <SmallCount label={t('questify.todayDue', 'HODIE')} value={todayDueCount} />
          <SmallCount label={t('questify.completedCount', 'CUMPLIDAS')} value={completed.length} />
        </div>
      </div>

      {/* ── Task form (collapsible) ─────────────── */}
      <div ref={formRef} data-tour="quests-add" className={`quest-form-wrapper${showForm || editingTask ? ' quest-form-wrapper--open' : ''}`}>
        <TaskForm
          editingTask={editingTask}
          projects={projects}
          activeProjectId={activeProjectId === undefined ? null : activeProjectId}
          onSaved={() => { setEditingTask(null); setShowForm(false); loadTasks(); window.dispatchEvent(new Event('quests:dataChanged')); }}
          onCancel={() => { setEditingTask(null); setShowForm(false); }}
          shouldFocus={showForm || !!editingTask}
        />
      </div>

      {/* ── Add quest toggle button ────────────── */}
      <div className="quest-add-toggle-wrapper">
        <button
          type="button"
          className={`quest-add-toggle${showForm || editingTask ? ' quest-add-toggle--active' : ''}`}
          onClick={() => { setShowForm(prev => !prev); if (editingTask) setEditingTask(null); }}
          title={t('questify.addQuest')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {showForm || editingTask ? <path d="M4 8h8" /> : <><path d="M8 3v10" /><path d="M3 8h10" /></>}
          </svg>
          {showForm || editingTask ? t('questify.cancel', 'Cancelar') : t('questify.addQuest')}
        </button>
      </div>

      {/* ── Tabs + filters bar ───────────────────── */}
      <div className="quest-tab-bar">
        <span
          className={`qb-rune${activeTab === 'pending' ? ' qb-rune--active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          {t('questify.pending')} ({pending.length})
        </span>
        <span
          className={`qb-rune${activeTab === 'completed' ? ' qb-rune--active' : ''}`}
          onClick={() => setActiveTab('completed')}
        >
          {t('questify.completed')} ({completed.length})
        </span>

        <select
          className="quest-project-select"
          value={activeProjectId === undefined ? '__all__' : (activeProjectId ?? '__none__')}
          onChange={(e) => {
            const val = e.target.value;
            setActiveProjectId(val === '__all__' ? undefined : val === '__none__' ? null : val);
            setFilter('');
          }}
        >
          <option value="__all__">{t('questify.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="__none__">{t('questify.noProject')}</option>
        </select>

        <span
          className="qb-rune"
          onClick={() => setShowProjectManager(true)}
          title={t('questify.manageProjects')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4h5l2 2h5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>
            <path d="M2 4V3a1 1 0 011-1h4l2 2"/>
          </svg>
        </span>

        {uniqueCategories.length > 0 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="quest-filter-select">
            <option value="">{t('questify.allCategories')}</option>
            {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <input
          type="text"
          className="rpg-input quest-search-input"
          placeholder={t('questify.searchPlaceholder', 'Buscar...')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {selectedIds.size > 0 && (
          <>
            <Rune tone="sage">
              <span style={{ cursor: 'pointer' }} onClick={handleBatchComplete}>
                {t('questify.batchComplete', 'Complete')} ({selectedIds.size})
              </span>
            </Rune>
            <Rune tone="rubric">
              <span style={{ cursor: 'pointer' }} onClick={handleDelete}>
                {t('questify.delete')} ({selectedIds.size})
              </span>
            </Rune>
          </>
        )}
      </div>

      {/* ── Two-column layout ────────────────────── */}
      <div className="quest-columns">
        {/* ── LEFT: Quest rows ─────────────────── */}
        <div>
          {loading ? <SkeletonCards /> : (<>
            {activeTab === 'pending' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Banner>{t('questify.pendingBanner', 'EMPRESAS POR ACOMETER')}</Banner>
                  <HelpBubble variant="inline" text={t('questify.taskListHelp', 'Misiones ordenadas por vencimiento y prioridad. Tier I = 5 XP, Tier II = 15 XP, Tier III = 30 XP.')} />
                </div>

                {pendingByDueDate ? (
                  pendingByDueDate.map(({ key: groupKey, tasks: sectionTasks }) => {
                    const isCollapsed = collapsedProjects.has(`due_${groupKey}`);
                    const groupLabels: Record<DueDateGroup, string> = {
                      overdue: t('questify.groupOverdue', 'Overdue'),
                      today: t('questify.groupToday', 'Today'),
                      thisWeek: t('questify.groupThisWeek', 'This Week'),
                      later: t('questify.groupLater', 'Later'),
                      noDate: t('questify.groupNoDate', 'No Date'),
                    };
                    const groupTones: Record<DueDateGroup, string> = {
                      overdue: 'var(--rubric)', today: 'var(--gold-dark)',
                      thisWeek: 'var(--moss)', later: 'var(--ink-faded)', noDate: 'var(--ink-faded)',
                    };
                    return (
                      <div key={groupKey} style={{ marginBottom: 12 }}>
                        <div className="quest-project-header" onClick={() => toggleProjectCollapse(`due_${groupKey}`)}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                            style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', opacity: 0.5 }}>
                            <path d="M3 1l4 4-4 4"/>
                          </svg>
                          <span className="quest-project-header-name" style={{ color: groupTones[groupKey] }}>
                            {groupLabels[groupKey]}
                          </span>
                          <span className="quest-project-header-count">
                            {t('questify.pendingCount', { count: sectionTasks.length })}
                          </span>
                        </div>
                        {!isCollapsed && (
                          <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onDragEndInSection(event, sectionTasks)}>
                            <SortableContext items={sectionTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                              {sectionTasks.map((task) => (
                                <SortableQuestRow key={task.id} {...taskItemProps(task)} />
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      {pending.map((task) => (
                        <SortableQuestRow key={task.id} {...taskItemProps(task)} />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}

                {pending.length === 0 && (
                  <p className="quest-empty">{t('questify.noQuests')}</p>
                )}
              </>
            )}

            {activeTab === 'completed' && completed.length === 0 && (
              <p className="quest-empty">{t('questify.noCompletedQuests', 'Aún no has completado ninguna misión. ¡Adelante, héroe!')}</p>
            )}

            {activeTab === 'completed' && completed.map((task) => {
              const isExpanded = expandedIds.has(task.id);
              const subs = subtasksMap[task.id] ?? [];
              const tier = getTierInfo(task);
              return (
                <div key={task.id} className={`quest-row quest-row--${tier.cls} quest-row--done${isExpanded ? ' quest-row--expanded' : ''}`}>
                  <div className="quest-row-inner">
                    <Tick
                      checked
                      onChange={() => {
                        if (completingRef.current) return;
                        completingRef.current = true;
                        handleComplete(task).finally(() => { completingRef.current = false; });
                      }}
                    />
                    <div className="quest-row-body" onClick={() => toggleExpand(task.id)} style={{ cursor: 'pointer' }}>
                      <div className="quest-row-header">
                        <TierBadge tier={task.tier} size={14} />
                        <span className="quest-row-title">
                          {task.name}
                        </span>
                      </div>
                    </div>
                    <div className="quest-row-xp">
                      <div className="quest-row-xp-value quest-row-xp-value--reward">+{XP_MAP[task.tier]}</div>
                      <div className="quest-row-xp-label">XP</div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="quest-row-expanded">
                      {task.description && <p>{task.description}</p>}
                      <SubtaskList
                        taskId={task.id}
                        subtasks={subs}
                        countCompletedToday={todayCount}
                        onShowToast={(d: XpToastData) => toast({ type: 'xp', message: `+${d.xp} XP`, details: { xp: d.xp, bonusTier: d.bonusTier, comboMultiplier: d.comboMultiplier, streakMilestone: d.streakMilestone || undefined } })}
                        onSubtaskChanged={() => { loadSubtasks(task.id); loadTasks(); window.dispatchEvent(new Event('quests:dataChanged')); }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </>)}
        </div>

        {/* ── RIGHT: Habits + Campaigns + Notes ── */}
        <div>
          {/* Habits */}
          <Section title={t('questify.habits', 'COSTUMBRES DEL HÉROE')} icon={<Compass width={12} height={12} style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('questify.habitsHelp', 'Hábitos diarios que se reinician cada día. Completarlos da XP y mantiene tu racha.')} />}>
            <HabitTracker onXpGained={() => loadTasks()} />
          </Section>

          <QBDividerSection />

          {/* Campaigns (project progress) */}
          <Section title={t('questify.campaigns', 'CAMPAÑAS')} icon={<MapIcon width={12} height={12} style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('questify.campaignsHelp', 'Progreso de tus proyectos activos. Cada tarea completada avanza la barra del proyecto.')} />}>
            {campaignData.length === 0 ? (
              <p className="quest-empty" style={{ padding: 8 }}>{t('questify.noCampaigns', 'Sin campañas activas')}</p>
            ) : (
              campaignData.map((c, i) => {
                const tones: Array<'rubric' | 'sage' | 'gold' | 'ink'> = ['rubric', 'sage', 'gold', 'ink'];
                const tone = tones[i % tones.length];
                return (
                  <div key={c.project.id} className="quest-campaign-row">
                    <div className="quest-campaign-header">
                      <span className="quest-campaign-name">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.project.color, display: 'inline-block', flexShrink: 0 }} aria-hidden="true" /> {c.project.name}
                      </span>
                      <span className="quest-campaign-count">{c.done}/{c.total}</span>
                    </div>
                    <Gauge value={c.done} max={c.total} tone={tone} showPips={false} />
                  </div>
                );
              })
            )}
          </Section>

          <QBDividerSection />

          {/* Quick actions */}
          <Section title={t('questify.actions', 'ACCIONES')} icon={<Sword width={12} height={12} style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('questify.actionsHelp', 'Accesos directos para gestionar proyectos, notas y configuración de misiones.')} />}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Rune>
                <span style={{ cursor: 'pointer' }} onClick={() => setShowProjectManager(true)}>
                  {t('questify.manageProjects')}
                </span>
              </Rune>
            </div>
          </Section>
        </div>
      </div>

      {showProjectManager && (
        <ProjectManager
          projects={projects}
          onClose={() => setShowProjectManager(false)}
          onSaved={() => { loadTasks(); window.dispatchEvent(new Event('quests:dataChanged')); }}
        />
      )}

      {notesTaskId && (
        <ScrollNotes
          taskId={notesTaskId}
          onClose={() => setNotesTaskId(null)}
          onCountChanged={() => loadTasks()}
        />
      )}
    </BookPage>
  );
}

/* ── SortableQuestRow ─────────────────────────────── */

function SortableQuestRow({ task, expanded, selected, subtasks, todayCount,
  onToggleExpand, onComplete, onEdit, onToggleSelect, onShowToast, onSubtaskChanged,
  drawingCount, onOpenNotes, isEditing }: {
  task: Task; expanded: boolean; selected: boolean; subtasks: Subtask[];
  todayCount: number;
  onToggleExpand: () => void; onComplete: () => void; onEdit: () => void;
  onToggleSelect: () => void; onShowToast: (d: XpToastData) => void;
  onSubtaskChanged: () => void;
  drawingCount: number; onOpenNotes: () => void;
  isEditing?: boolean;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [animatingComplete, setAnimatingComplete] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const tier = getTierInfo(task);
  const isOverdue = task.dueDate && getDueDateStatus(task.dueDate) === 'overdue' && !task.status;

  const handleCheckboxComplete = useCallback(() => {
    if (animatingComplete) return;
    setAnimatingComplete(true);
    playTaskComplete();
  }, [animatingComplete]);

  const handleDrawComplete = useCallback(() => {
    const row = rowRef.current;
    const text = textRef.current;
    if (!row || !text) { onComplete(); return; }

    const tl = completeTaskAnim(row, text);
    tl.eventCallback('onComplete', () => {
      const removeTl = removeItem(row);
      removeTl.eventCallback('onComplete', () => onComplete());
    });
  }, [onComplete]);

  // Build meta info
  const meta: string[] = [];
  if (task.category) meta.push(task.category);
  // Due date shown only as colored badge in actions area (avoid duplication)
  const subCount = subtasks.length;
  const doneCount = subtasks.filter(s => s.status).length;
  if (subCount > 0) {
    meta.push(`${doneCount}/${subCount} ${t('questify.subtasksLabel', 'subtareas')}`);
  }

  return (
    <div
      ref={(el) => { setNodeRef(el); rowRef.current = el; }}
      style={style}
      {...attributes}
      className={`quest-row quest-row--${tier.cls}${isOverdue ? ' quest-row--overdue' : ''}${animatingComplete ? ' quest-row--completing' : ''}${isEditing ? ' quest-row--editing' : ''}${expanded ? ' quest-row--expanded' : ''}`}
    >
      <span className="quest-row-ornament" style={{ color: tier.color }} aria-hidden="true">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2.5 5.5L16 8l-5.5 2.5L8 16l-2.5-5.5L0 8l5.5-2.5z"/></svg>
      </span>
      <div className="quest-row-inner">
        {/* Drag handle */}
        <div className="quest-drag-handle" {...listeners} aria-label={t('questify.dragHandle', 'Reorder')} role="button">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="var(--ink-faded)" aria-hidden="true">
            <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
            <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
            <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
          </svg>
        </div>

        {/* QuillCheckbox */}
        <span onPointerDown={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <QuillCheckbox
            checked={animatingComplete}
            onChange={handleCheckboxComplete}
            onDrawComplete={handleDrawComplete}
          />
        </span>

        {/* Body */}
        <div className="quest-row-body" onClick={onToggleExpand} style={{ cursor: 'pointer' }}>
          <div className="quest-row-header">
            <TierBadge tier={task.tier} size={14} />
            <span ref={textRef} className="quest-row-title">
              {task.description ? <Tooltip text={task.description}>{task.name}</Tooltip> : task.name}
            </span>
            {subCount > 0 && (
              <span className="quest-subtask-gauge" style={{ display: 'inline-flex', alignItems: 'center', width: 48, flexShrink: 0 }}>
                <Gauge value={doneCount} max={subCount} tone="sage" showPips={false} />
              </span>
            )}
          </div>
          <div className="quest-row-meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && <span style={{ marginRight: 6, color: 'var(--ink-faded)' }}>&#183;</span>}
                {m}
              </span>
            ))}
          </div>

        </div>

        {/* XP reward */}
        <div className="quest-row-xp">
          <div className={`quest-row-xp-value quest-row-xp-value--reward${isOverdue ? ' quest-row-xp-value--overdue' : ''}`}>
            +{XP_MAP[task.tier]}
          </div>
          <div className="quest-row-xp-label">XP</div>
        </div>

        {/* Action icons */}
        <div className="quest-row-actions">
          {/* Due date badge */}
          {task.dueDate && (() => {
            const status = getDueDateStatus(task.dueDate);
            return <span className={`quest-due--${status}`}>{status === 'today' ? t('questify.dueToday') : status === 'overdue' ? t('questify.overdueLabel', 'vencida') : new Date(task.dueDate).toLocaleDateString()}</span>;
          })()}

          {/* Note icon */}
          <span onClick={onOpenNotes} style={{ position: 'relative', cursor: 'pointer', display: 'inline-flex' }}>
            <svg width="14" height="14" viewBox="0 0 16 16"
              style={{ opacity: drawingCount > 0 ? 0.6 : 0.35 }}
              fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
              role="img" aria-label={t('questify.notes', 'Notes')}>
              <path d="M4 1h8l2 2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/>
              <path d="M10 1v3h3"/>
              <path d="M5 8h6M5 11h4"/>
            </svg>
            {drawingCount > 0 && <span className="quest-note-badge">{drawingCount}</span>}
          </span>

          {/* Edit icon */}
          <svg onClick={onEdit} width="14" height="14" viewBox="0 0 16 16"
            fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round"
            role="button" tabIndex={0} aria-label={t('questify.edit', 'Edit')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}>
            <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
          </svg>

          {/* Select checkbox */}
          <svg onClick={onToggleSelect} width="12" height="12" viewBox="0 0 14 14"
            fill="none" stroke={selected ? 'var(--rubric)' : 'var(--ink-faded)'} strokeWidth="1.3"
            role="checkbox" tabIndex={0} aria-checked={selected} aria-label={t('questify.selectTask', 'Select task')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelect(); } }}>
            <rect x="1" y="1" width="12" height="12" rx="1"/>
            {selected && <path d="M3.5 7l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round"/>}
          </svg>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="quest-row-expanded">
          {task.description && <p>{task.description}</p>}
          {task.dueDate && <p style={{ fontSize: 'var(--fs-label)' }}>{t('questify.dueLabel')} {new Date(task.dueDate).toLocaleString()}</p>}
          <SubtaskList
            taskId={task.id}
            subtasks={subtasks}
            countCompletedToday={todayCount}
            onShowToast={onShowToast}
            onSubtaskChanged={onSubtaskChanged}
          />
        </div>
      )}
    </div>
  );
}
