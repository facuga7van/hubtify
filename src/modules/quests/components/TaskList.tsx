import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../../shared/format-date';
import { useAuthContext } from '../../../shared/AuthContext';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import gsap from 'gsap';
import { BookPage } from '../../../shared/components/codex/BookPage';
import {
  Section, Tick, Gauge, SmallCount, Banner, QBDividerSection,
} from '../../../shared/components/codex/CodexPrimitives';
import { Compass, Map as MapIcon, Sword } from '../../../shared/components/icons/CodexIcons';
import TaskForm from './TaskForm';
import SubtaskList from './SubtaskList';
import QuestRowActions from './QuestRowActions';
import PostponeMenu from './PostponeMenu';
import TodayView from './TodayView';
import { questsApi } from '../api';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import type { XpToastData } from '../types';
import ProjectManager from './ProjectManager';
import ScrollNotes from './ScrollNotes';
import HabitTracker from './HabitTracker';
import { type Task, type Subtask, type Project, XP_MAP } from '../types';
import { getDueDateStatus, bonusMultiplierToTier, notifyStreakSaved, TierBadge } from '../utils';
import { playTaskComplete, playDelete } from '../../../shared/audio';
import QuillCheckbox from '../../../shared/components/QuillCheckbox';
import { completeTask as completeTaskAnim, removeItem } from '../../../shared/animations/feedback';
import { celebrateCompletion } from '../../../shared/animations/celebrate';
import Tooltip from '../../../shared/components/Tooltip';
import HelpBubble from '../../../shared/components/HelpBubble';

/* ── Tier mapping from numeric tier to codex row styling ──
   Labels come from `questify.tier.*` via TIER_LABEL (utils) — one vocabulary
   for the form, the row and the help text. */
const TIER_MAP: Record<number, { cls: string; color: string }> = {
  1: { cls: 'communis', color: 'var(--ink-soft)' },
  2: { cls: 'rara', color: 'var(--moss)' },
  3: { cls: 'epica', color: 'var(--gold-dark)' },
};

function getTierInfo(task: Task) {
  const isOverdue = task.dueDate && getDueDateStatus(task.dueDate) === 'overdue';
  if (isOverdue && !task.status) {
    return { cls: 'delata', color: 'var(--rubric)' };
  }
  return TIER_MAP[task.tier] ?? TIER_MAP[2];
}

export default function TaskList() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuthContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /* «Hoy» is always the door: the active tab is deliberately NOT persisted, so
     opening Questify never drops you into yesterday's management session. */
  const [activeTab, setActiveTab] = useState<'today' | 'pending' | 'completed'>('today');
  const [activeProjectId, setActiveProjectId] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState('');
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
      const [allTasks, projs] = await Promise.all([
        window.api.questsGetTasks(),
        window.api.questsGetProjects(),
      ]);
      setTasks(allTasks as Task[]);
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
    // Sin deps: la query de tareas ya no depende del proyecto activo (el filtrado
    // es en memoria); dejar activeProjectId aca recargaba todo en cada cambio.
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  /**
   * `quests:dataChanged` is what Ctrl+K (QuickAdd) and the Cauldron's
   * "Completar misión" fire — this list never listened, so a quest created
   * from the palette only showed up after leaving and coming back. The list
   * also EMITS the event after its own actions (for the widget and Layout's
   * sync push); the ref keeps those from triggering a second reload.
   */
  const selfNotifyRef = useRef(false);
  const notifyQuestsChanged = useCallback(() => {
    selfNotifyRef.current = true;
    try {
      // Ojo: acá iba `notifyQuestsChanged()` — la constante llamándose a sí
      // misma. Recursión infinita: completar, borrar, posponer o guardar una
      // misión reventaba con «Maximum call stack size exceeded» antes de
      // avisarle a nadie. Lo que hay que emitir es el evento.
      window.dispatchEvent(new Event('quests:dataChanged'));
    } finally {
      selfNotifyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const handler = () => loadTasks();
    const onDataChanged = () => { if (!selfNotifyRef.current) loadTasks(); };
    window.addEventListener('sync:questsUpdated', handler);
    window.addEventListener('quests:dataChanged', onDataChanged);
    return () => {
      window.removeEventListener('sync:questsUpdated', handler);
      window.removeEventListener('quests:dataChanged', onDataChanged);
    };
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
  /**
   * Resolves `true` when the toggle landed, `false` when the backend refused
   * (DB locked, account mid-switch…) — the row that ticked optimistically
   * reverts on `false` instead of staying grey forever.
   */
  const handleComplete = async (task: Task): Promise<boolean> => {
    const newStatus = !task.status;
    try {
      if (newStatus) {
        // Sequential on purpose: the status answer decides whether XP is owed.
        // `paysXp === false` means another instance of this recurring chain was
        // already completed today (one payment per chain per local day). An
        // older main process answers undefined — that IS the feature detection.
        const statusResult = await questsApi().questsSetTaskStatus(task.id, true);
        if (statusResult && statusResult.paysXp === false) {
          toast({ type: 'info', message: t('questify.repeatAlreadyPaid', 'Esta misión ya pagó hoy — la cadena avanza igual') });
        } else {
          const result = await window.api.processRpgEvent({
            type: 'TASK_COMPLETED', moduleId: 'quests',
            payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
            timestamp: Date.now(),
          });
          toast({ type: 'xp', message: `+${result.xpGained} XP`, details: { xp: result.xpGained, bonusTier: bonusMultiplierToTier(result.bonusMultiplier), comboMultiplier: result.comboMultiplier, streakMilestone: result.milestoneXp || undefined } });
          // Only the branch that actually paid can carry the one-day grace flag.
          notifyStreakSaved(result, { toast, t });
        }
        // Recurring quest: the backend already dealt the next instance.
        if (statusResult && statusResult.repeated) {
          toast({ type: 'info', message: t('questify.repeatNextReady', 'La próxima ya está en el tablero') });
        }
      } else {
        await window.api.questsSetTaskStatus(task.id, false);
        await window.api.processRpgEvent({
          type: 'TASK_UNCOMPLETED', moduleId: 'quests',
          payload: { xp: -XP_MAP[task.tier], hp: 0, taskId: task.id },
          timestamp: Date.now(),
        });
        // Losing XP used to happen in total silence, unlike unchecking a habit.
        toast({
          type: 'warning',
          message: t('questify.taskUncompleted', 'Misión reabierta — {{xp}} XP descontados', { xp: XP_MAP[task.tier] }),
        });
      }
    } catch (err) {
      console.error('[Quests] status toggle failed', err);
      toast({ type: 'warning', message: t('common.somethingWentWrong', 'Algo salió mal') });
      return false;
    }
    await loadTasks();
    window.dispatchEvent(new Event('rpg:statsChanged'));
    notifyQuestsChanged();
    return true;
  };

  const handleBatchComplete = async () => {
    const ids = Array.from(selectedIds);
    const tasksToComplete = ids.map(id => pending.find(t => t.id === id)).filter(Boolean) as Task[];
    await Promise.all(tasksToComplete.map(async (task) => {
      // Same gate as the single tick: a recurring chain pays once per day.
      const status = await questsApi().questsSetTaskStatus(task.id, true);
      if (status && status.paysXp === false) return;
      await window.api.processRpgEvent({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: XP_MAP[task.tier], hp: 0, taskId: task.id, tier: task.tier },
        timestamp: Date.now(),
      });
    }));
    playTaskComplete();
    toast({
      type: 'xp',
      message: t('questify.batchCompleted', '{{count}} misiones completadas!', { count: ids.length }),
    });
    setSelectedIds(new Set());
    await loadTasks();
    window.dispatchEvent(new Event('rpg:statsChanged'));
    notifyQuestsChanged();
  };

  /**
   * Rescheduling is NEUTRAL: no XP, no HP, no penalty event. The "Overdue"
   * group grows until it is background noise precisely because clearing it
   * feels like admitting failure — so moving a quest costs exactly nothing.
   */
  const postpone = useCallback(async (ids: string[], target: string) => {
    if (ids.length === 0) return 0;
    const { moved } = await questsApi().questsPostponeTasks(ids, target);
    if (moved > 0) {
      toast({ type: 'info', message: t('questify.postponed', '{{count}} misión(es) pospuesta(s)', { count: moved }) });
      await loadTasks();
      notifyQuestsChanged();
    }
    return moved;
  }, [loadTasks, toast, t, notifyQuestsChanged]);

  const handleBatchPostpone = async (target: string) => {
    const moved = await postpone(Array.from(selectedIds), target);
    if (moved > 0) setSelectedIds(new Set());
  };

  /** Header shortcut on the Overdue group: one tap empties the whole pile. */
  const handleMoveGroupToToday = async (groupTasks: Task[]) => {
    if (groupTasks.length > 5) {
      const ok = await confirm({
        message: t('questify.moveAllToTodayConfirm', '¿Mover {{count}} misiones vencidas a hoy?', { count: groupTasks.length }),
        confirmText: t('questify.moveAllToToday', 'Mover todo a hoy'),
      });
      if (!ok) return;
    }
    await postpone(groupTasks.map((task) => task.id), 'today');
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
    notifyQuestsChanged();
  };

  /* Deleting ONE quest used to require discovering a 12px selection square
     first; it is now a direct action on the row (and on completed rows too). */
  const handleDeleteOne = async (task: Task) => {
    const ok = await confirm({
      message: t('questify.deleteConfirm', { count: 1 }),
      danger: true,
      confirmText: t('questify.delete'),
    });
    if (!ok) return;
    playDelete();
    await window.api.questsDeleteTasks([task.id]);
    setSelectedIds((prev) => {
      const next = new Set(prev); next.delete(task.id); return next;
    });
    await loadTasks();
    notifyQuestsChanged();
  };

  const hasActiveFilters = !!searchQuery || !!filter || activeProjectId !== undefined;

  const clearFilters = () => {
    setSearchQuery('');
    setFilter('');
    setActiveProjectId(undefined);
  };

  /**
   * Abre el formulario de alta desde cualquier parte de la página. El
   * formulario vive arriba del todo y el hueco vacío abajo: sin el
   * `scrollIntoView` el botón del vacío parecía no hacer nada.
   */
  const openAddForm = useCallback(() => {
    setShowForm(true);
    setEditingTask(null);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  /* Plain render helper, not a nested component: an inline component would be a
     new type every render and remount (stealing focus from "Limpiar filtros").

     Las dos ramas tienen la MISMA forma —ícono, frase, salida— porque un hueco
     que sólo dice una frase es la mitad de un estado vacío (rúbrica C8). La
     rama sin filtros es el primer contacto del héroe nuevo: el botón abre el
     alta acá mismo en vez de mandarlo a buscar el control a otra punta. */
  const renderEmptyState = (noneAtAllText: string) => (
    <div className="quest-empty">
      {hasActiveFilters ? (
        <>
          <Compass width={32} height={32} aria-hidden="true" />
          <p>
            {searchQuery
              ? t('questify.noSearchResults', 'Sin resultados para «{{query}}»', { query: searchQuery })
              : t('questify.noFilterResults', 'Ninguna misión coincide con los filtros activos.')}
          </p>
          <button type="button" className="rpg-button quest-empty__cta" onClick={clearFilters}>
            {t('questify.clearFilters', 'Limpiar filtros')}
          </button>
        </>
      ) : (
        <>
          <Sword width={32} height={32} aria-hidden="true" />
          <p>{noneAtAllText}</p>
          <button type="button" className="rpg-button quest-empty__cta" onClick={openAddForm}>
            {t('questify.addQuest')}
          </button>
        </>
      )}
    </div>
  );

  /**
   * Reorders a *visible* slice (a search result, a category filter, one due-date
   * group) without corrupting the tasks the filter hides.
   *
   * The visible rows occupy a set of slots inside the full pending list; we
   * rewrite only those slots with the reordered block and then renumber the
   * whole list. Renumbering only the visible rows (the old behaviour) handed
   * `order = 0..n-1` to a handful of tasks while the hidden ones kept the same
   * values — so clearing the filter revealed a shuffled list.
   */
  const persistReorder = useCallback(async (visible: Task[], activeId: string, overId: string) => {
    const oldIdx = visible.findIndex((t) => t.id === activeId);
    const newIdx = visible.findIndex((t) => t.id === overId);
    if (oldIdx === -1 || newIdx === -1) return;

    const allPending = tasks.filter((t) => !t.status).sort((a, b) => a.order - b.order);
    const reordered = arrayMove(visible, oldIdx, newIdx);
    const visibleIds = new Set(visible.map((t) => t.id));

    const slots: number[] = [];
    allPending.forEach((t, i) => { if (visibleIds.has(t.id)) slots.push(i); });

    const next = [...allPending];
    slots.forEach((slot, i) => { next[slot] = reordered[i]; });

    const orders = next.map((t, i) => ({ id: t.id, order: i }));
    setTasks((prev) => {
      const updated = [...prev];
      for (const { id, order } of orders) {
        const idx = updated.findIndex((t) => t.id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], order };
      }
      return updated;
    });
    await window.api.questsSyncTaskOrders(orders);
    notifyQuestsChanged();
  }, [tasks, notifyQuestsChanged]);

  const onDragEnd = async (event: DragEndEvent, visible: Task[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    await persistReorder(visible, String(active.id), String(over.id));
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
    onToggleExpand: () => toggleExpand(task.id),
    onComplete: () => handleComplete(task),
    onEdit: () => setEditingTask(task),
    onDelete: () => handleDeleteOne(task),
    onPostpone: (target: string) => postpone([task.id], target),
    onToggleSelect: () => setSelectedIds((prev) => {
      const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next;
    }),
    onShowToast: (d: XpToastData) => toast({ type: 'xp', message: `+${d.xp} XP`, details: { xp: d.xp, bonusTier: d.bonusTier, comboMultiplier: d.comboMultiplier, streakMilestone: d.streakMilestone || undefined } }),
    onSubtaskChanged: () => { loadSubtasks(task.id); loadTasks(); notifyQuestsChanged(); },
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
      /* `--today`: en «Hoy» la lista es una sola columna de renglones cortos y
         lleva medida (960px). Sin la clase, la tira de stats y la de pestañas
         se estiraban a 1640 y la lista arrancaba 312px más adentro: tres ejes
         en la misma página. */
      className={`quest-page${activeTab === 'today' ? ' quest-page--today' : ''}`}
      eyebrow={t('questify.eyebrow', 'QUESTIFY — LIBER MISSIONUM')}
      title={t('questify.title')}
      subtitle={t('questify.subtitle')}
      /* El alta es la acción de la PÁGINA, no un renglón más del cuerpo:
         va en el encabezado, a la derecha, como en todo otro tomo. Antes
         vivía centrada sobre una página alineada a la izquierda. */
      headerExtra={(
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
      )}
    >
      {/* ── Stats strip ──────────────────────────── */}
      {/* Inline help beside the strip — the old `sealed` bubble was absolutely
          positioned on top of the fourth stat card. */}
      <div className="quest-stats-help">
        <HelpBubble variant="inline" text={t('questify.statsHelp', 'Resumen de misiones: en progreso, vencidas, para hoy y completadas.')} />
      </div>
      <div className="quest-stats-strip">
        <SmallCount label={t('questify.inProgress', 'EN CURSO')} value={inProgressCount} />
        <SmallCount label={t('questify.overdue', 'VENCIDAS')} value={overdueCount} tone="rubric" />
        <SmallCount label={t('questify.todayDue', 'HODIE')} value={todayDueCount} />
        <SmallCount label={t('questify.completedCount', 'CUMPLIDAS')} value={completed.length} />
      </div>

      {/* ── Task form (collapsible) ─────────────── */}
      {/* `inert` while collapsed: the form stays mounted, so without it a user
          tabbing through the list landed in invisible inputs and could submit a
          blank quest with Enter. */}
      <div
        ref={formRef}
        data-tour="quests-add"
        className={`quest-form-wrapper${showForm || editingTask ? ' quest-form-wrapper--open' : ''}`}
        inert={!(showForm || editingTask)}
      >
        <div className="quest-form-wrapper-inner">
          <TaskForm
            editingTask={editingTask}
            projects={projects}
            activeProjectId={activeProjectId === undefined ? null : activeProjectId}
            onSaved={() => { setEditingTask(null); setShowForm(false); loadTasks(); notifyQuestsChanged(); }}
            onCancel={() => { setEditingTask(null); setShowForm(false); }}
            shouldFocus={showForm || !!editingTask}
          />
        </div>
      </div>

      {/* ── Tabs + filters bar ───────────────────── */}
      <div className="quest-tab-bar">
        {/* Real tabs: focusable, Enter/Space activated, announced by screen readers. */}
        <div className="quest-tabs" role="tablist" aria-label={t('questify.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'today'}
            className={`qb-rune quest-rune-btn${activeTab === 'today' ? ' qb-rune--active' : ''}`}
            onClick={() => setActiveTab('today')}
          >
            {t('questify.todayTab', 'Hoy')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pending'}
            className={`qb-rune quest-rune-btn${activeTab === 'pending' ? ' qb-rune--active' : ''}`}
            onClick={() => setActiveTab('pending')}
          >
            {t('questify.pending')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'completed'}
            className={`qb-rune quest-rune-btn${activeTab === 'completed' ? ' qb-rune--active' : ''}`}
            onClick={() => setActiveTab('completed')}
          >
            {t('questify.completed')}
          </button>
        </div>

        {/* «Hoy» is the execution list, not the management one: no project
            picker, no category filter, no search. They are one tab away. */}
        {activeTab !== 'today' && (<>
        <select
          className="quest-project-select"
          aria-label={t('questify.allProjects')}
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

        <button
          type="button"
          className="qb-rune quest-rune-btn tap-target"
          onClick={() => setShowProjectManager(true)}
          title={t('questify.manageProjects')}
          aria-label={t('questify.manageProjects')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4h5l2 2h5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>
            <path d="M2 4V3a1 1 0 011-1h4l2 2"/>
          </svg>
        </button>

        {uniqueCategories.length > 0 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="quest-filter-select"
            aria-label={t('questify.allCategories')}>
            <option value="">{t('questify.allCategories')}</option>
            {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Fixed spacer instead of `margin-left: auto` on the category select —
            the search box no longer jumps sides when the first category appears. */}
        <div className="quest-tab-bar-spacer" />

        <input
          type="text"
          className="rpg-input quest-search-input"
          placeholder={t('questify.searchPlaceholder', 'Buscar...')}
          aria-label={t('questify.searchPlaceholder', 'Buscar...')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {selectedIds.size > 0 && (
          <>
            <button type="button" className="qb-rune qb-rune--sage quest-rune-btn" onClick={handleBatchComplete}>
              {t('questify.batchComplete', 'Complete')} ({selectedIds.size})
            </button>
            <PostponeMenu
              onPick={handleBatchPostpone}
              className="qb-rune quest-rune-btn"
              title={t('questify.postpone', 'Posponer')}
            >
              {t('questify.postpone', 'Posponer')} ({selectedIds.size})
            </PostponeMenu>
            <button type="button" className="qb-rune qb-rune--rubric quest-rune-btn" onClick={handleDelete}>
              {t('questify.delete')} ({selectedIds.size})
            </button>
          </>
        )}
        </>)}
      </div>

      {/* ── Two-column layout ────────────────────── */}
      <div className={`quest-columns${activeTab === 'today' ? ' quest-columns--single' : ''}`}>
        {/* ── LEFT: Quest rows ─────────────────── */}
        <div>
          {loading ? <SkeletonCards /> : (<>
            {activeTab === 'today' && (
              <TodayView
                tasks={tasks}
                projects={projects}
                onComplete={handleComplete}
                onPostpone={(taskId, target) => { postpone([taskId], target); }}
                onPlanAhead={() => setActiveTab('pending')}
                onHabitChecked={loadTasks}
              />
            )}

            {activeTab === 'pending' && (
              <>
                {/* 10px left margin: the banner's ::before tail hangs outside
                    the element and was being clipped by the column edge. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 10 }}>
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
                        <div className="quest-project-header">
                          <button
                            type="button"
                            className="quest-project-header-btn"
                            onClick={() => toggleProjectCollapse(`due_${groupKey}`)}
                            aria-expanded={!isCollapsed}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                              aria-hidden="true"
                              style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', opacity: 0.5 }}>
                              <path d="M3 1l4 4-4 4"/>
                            </svg>
                            <span className="quest-project-header-name" style={{ color: groupTones[groupKey] }}>
                              {groupLabels[groupKey]}
                            </span>
                            <span className="quest-project-header-count">
                              {t('questify.pendingCount', { count: sectionTasks.length })}
                            </span>
                          </button>
                          {/* The overdue pile is the one group nobody ever
                              clears one row at a time. One button empties it. */}
                          {groupKey === 'overdue' && (
                            <button
                              type="button"
                              className="qb-rune quest-rune-btn quest-group-action"
                              onClick={(e) => { e.stopPropagation(); handleMoveGroupToToday(sectionTasks); }}
                            >
                              {t('questify.moveAllToToday', 'Mover todo a hoy')}
                            </button>
                          )}
                        </div>
                        {!isCollapsed && (
                          <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onDragEnd(event, sectionTasks)}>
                            <SortableContext items={sectionTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                              {sectionTasks.map((task) => (
                                <SortableQuestRow key={task.id} {...taskItemProps(task)} grouped />
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onDragEnd(event, pending)}>
                    <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      {pending.map((task) => (
                        <SortableQuestRow key={task.id} {...taskItemProps(task)} />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}

                {pending.length === 0 && renderEmptyState(t('questify.noQuests'))}
              </>
            )}

            {activeTab === 'completed' && completed.length === 0
              && renderEmptyState(t('questify.noCompletedQuests', 'Aún no has completado ninguna misión. ¡Adelante, héroe!'))}

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
                    <button
                      type="button"
                      className="quest-row-body"
                      onClick={() => toggleExpand(task.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="quest-row-header">
                        <TierBadge tier={task.tier} size={14} />
                        <span className="quest-row-title" title={task.name}>
                          {task.name}
                        </span>
                      </div>
                    </button>
                    <div className="quest-row-xp" title={t('questify.xpBaseHint', 'XP base; el total real varía con el combo y el bonus aleatorio')}>
                      <div className="quest-row-xp-value quest-row-xp-value--reward">+{XP_MAP[task.tier]}</div>
                      <div className="quest-row-xp-label">{t('questify.xpBaseLabel', 'XP BASE')}</div>
                    </div>
                    {/* Completed rows carry the same actions — otherwise a finished
                        quest could never be deleted without un-completing it first. */}
                    <QuestRowActions
                      task={task}
                      selected={selectedIds.has(task.id)}
                      drawingCount={drawingCounts[task.id] ?? 0}
                      onEdit={() => setEditingTask(task)}
                      onOpenNotes={() => setNotesTaskId(task.id)}
                      onDelete={() => handleDeleteOne(task)}
                      onPostpone={(target) => postpone([task.id], target)}
                      onToggleSelect={() => setSelectedIds((prev) => {
                        const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next;
                      })}
                    />
                  </div>
                  {isExpanded && (
                    <div className="quest-row-expanded">
                      {task.description && <p>{task.description}</p>}
                      <SubtaskList
                        taskId={task.id}
                        subtasks={subs}
                        onShowToast={(d: XpToastData) => toast({ type: 'xp', message: `+${d.xp} XP`, details: { xp: d.xp, bonusTier: d.bonusTier, comboMultiplier: d.comboMultiplier, streakMilestone: d.streakMilestone || undefined } })}
                        onSubtaskChanged={() => { loadSubtasks(task.id); loadTasks(); notifyQuestsChanged(); }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </>)}
        </div>

        {/* ── RIGHT: Habits + Campaigns + Notes ──
            Hidden on «Hoy»: the pending rituals are already inside that list,
            and a second copy beside it would be the same debt counted twice. */}
        {activeTab !== 'today' && (
        <div>
          {/* Habits */}
          <Section title={t('questify.habits', 'COSTUMBRES DEL HÉROE')} icon={<Compass width={12} height={12} style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('questify.habitsHelp', 'Hábitos diarios que se reinician cada día. Completarlos da XP y mantiene tu racha.')} />}>
            <HabitTracker onXpGained={() => loadTasks()} />
          </Section>

          <QBDividerSection />

          {/* Campaigns (project progress) */}
          <Section title={t('questify.campaigns', 'CAMPAÑAS')} icon={<MapIcon width={12} height={12} style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('questify.campaignsHelp', 'Progreso de tus proyectos activos. Cada misión completada avanza la barra del proyecto.')} />}>
            {campaignData.length === 0 ? (
              <div className="quest-empty quest-empty--inline">
                <MapIcon width={24} height={24} aria-hidden="true" />
                <p>{t('questify.noCampaigns', 'Sin campañas activas')}</p>
              </div>
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
        </div>
        )}
      </div>

      {showProjectManager && (
        <ProjectManager
          projects={projects}
          onClose={() => setShowProjectManager(false)}
          onSaved={() => { loadTasks(); notifyQuestsChanged(); }}
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

function SortableQuestRow({ task, expanded, selected, subtasks,
  onToggleExpand, onComplete, onEdit, onDelete, onPostpone, onToggleSelect, onShowToast, onSubtaskChanged,
  drawingCount, onOpenNotes, isEditing, grouped }: {
  task: Task; expanded: boolean; selected: boolean; subtasks: Subtask[];
  onToggleExpand: () => void;
  /** Resolves false when the backend refused: the row undoes its optimistic tick. */
  onComplete: () => void | Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
  onPostpone: (target: string) => void;
  onToggleSelect: () => void; onShowToast: (d: XpToastData) => void;
  onSubtaskChanged: () => void;
  drawingCount: number; onOpenNotes: () => void;
  isEditing?: boolean;
  /** True when the list is split into due-date sections: dragging only reorders inside one. */
  grouped?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [animatingComplete, setAnimatingComplete] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const checkRef = useRef<HTMLSpanElement>(null);
  const tier = getTierInfo(task);
  const isOverdue = task.dueDate && getDueDateStatus(task.dueDate) === 'overdue' && !task.status;

  const handleCheckboxComplete = useCallback(() => {
    if (animatingComplete) return;
    setAnimatingComplete(true);
    playTaskComplete();
    // Los ~300 ms que siguen a completar: chispas doradas desde el checkbox y
    // un pop sutil en la fila. Fire-and-forget — el toast, la regeneración de
    // recurrentes y el resto del flujo no esperan a nadie. El pop va sobre
    // .quest-row-inner y no sobre la fila raíz para no pisar el transform que
    // dnd-kit administra ahí.
    const inner = rowRef.current?.querySelector<HTMLElement>('.quest-row-inner');
    celebrateCompletion(checkRef.current ?? rowRef.current, { popEl: inner });
  }, [animatingComplete]);

  const handleDrawComplete = useCallback(() => {
    const row = rowRef.current;
    const text = textRef.current;

    // The strike + slide already played by the time the backend answers. If it
    // said no, undo both so the row is a row again — not a grey ghost whose
    // checkbox ignores every click (`if (animatingComplete) return`).
    const finish = () => {
      Promise.resolve(onComplete()).then((ok) => {
        if (ok !== false) return;
        if (row) gsap.set(row, { clearProps: 'x,opacity' });
        if (text) {
          // completeTask() appends the 2px strikethrough div to the title span.
          text.querySelectorAll<HTMLElement>(':scope > div').forEach((el) => {
            if (el.style.height === '2px') el.remove();
          });
          gsap.set(text, { clearProps: 'opacity,position' });
        }
        setAnimatingComplete(false);
      });
    };

    if (!row || !text) { finish(); return; }

    const tl = completeTaskAnim(row, text);
    tl.eventCallback('onComplete', () => {
      const removeTl = removeItem(row);
      removeTl.eventCallback('onComplete', finish);
    });
  }, [onComplete]);

  // Build meta info
  const meta: string[] = [];
  if (task.category) meta.push(task.category);
  // Due date shown only as colored badge in actions area (avoid duplication)
  const subCount = subtasks.length;
  const doneCount = subtasks.filter(s => s.status).length;
  if (subCount > 0) {
    meta.push(`${doneCount}/${subCount} ${t('questify.subtasksLabel', 'pasos')}`);
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
        <div className="quest-drag-handle" {...listeners} role="button"
          aria-label={grouped ? t('questify.dragHandleGrouped', 'Reordenar dentro del grupo') : t('questify.dragHandle', 'Reordenar')}
          title={grouped ? t('questify.dragHandleGrouped', 'Reordenar dentro del grupo') : t('questify.dragHandle', 'Reordenar')}>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="var(--ink-faded)" aria-hidden="true">
            <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
            <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
            <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
          </svg>
        </div>

        {/* QuillCheckbox */}
        <span ref={checkRef} onPointerDown={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <QuillCheckbox
            checked={animatingComplete}
            onChange={handleCheckboxComplete}
            onDrawComplete={handleDrawComplete}

            label={t('questify.completeQuest', 'Completar «{{name}}»', { name: task.name })}
          />
        </span>

        {/* Body */}
        <button type="button" className="quest-row-body" onClick={onToggleExpand} aria-expanded={expanded}>
          <div className="quest-row-header">
            <TierBadge tier={task.tier} size={14} />
            <span ref={textRef} className="quest-row-title" title={task.name}>
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

        </button>

        {/* XP reward — the number is the BASE value; combo and random bonus are
            applied by the rpg engine, so the toast almost never matches it. */}
        <div className="quest-row-xp" title={t('questify.xpBaseHint', 'XP base; el total real varía con el combo y el bonus aleatorio')}>
          <div className="quest-row-xp-value quest-row-xp-value--reward">
            +{XP_MAP[task.tier]}
          </div>
          <div className="quest-row-xp-label">{t('questify.xpBaseLabel', 'XP BASE')}</div>
        </div>

        <QuestRowActions
          task={task}
          selected={selected}
          drawingCount={drawingCount}
          onEdit={onEdit}
          onOpenNotes={onOpenNotes}
          onDelete={onDelete}
          onPostpone={onPostpone}
          onToggleSelect={onToggleSelect}
        />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="quest-row-expanded">
          {task.description && <p>{task.description}</p>}
          {task.dueDate && <p style={{ fontSize: 'var(--fs-label)' }}>{t('questify.dueLabel')} {formatDateTime(task.dueDate, i18n.language)}</p>}
          <SubtaskList
            taskId={task.id}
            subtasks={subtasks}
            onShowToast={onShowToast}
            onSubtaskChanged={onSubtaskChanged}
          />
        </div>
      )}
    </div>
  );
}
