import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PageHeader from '../../../shared/components/PageHeader';
import Checkbox from '../../../shared/components/Checkbox';
import TaskForm from './TaskForm';
import SubtaskList from './SubtaskList';
import XpToast, { type XpToastData } from './XpToast';
import ProjectManager from './ProjectManager';
import { type Task, type TaskTier, type Subtask, type Project, XP_MAP } from '../types';
import { TierBadge, calculateXpForAction } from '../utils';
import { playTaskComplete, playDelete } from '../../../shared/audio';

export default function TaskList() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [activeProjectId, setActiveProjectId] = useState<string | null | undefined>(undefined); // undefined = all, null = unassigned
  const [filter, setFilter] = useState('');
  const [toastData, setToastData] = useState<XpToastData | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('questify_collapsed_projects');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const formRef = useRef<HTMLDivElement>(null);

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
    } catch (err) {
      console.error(err);
    }
  }, [activeProjectId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    if (editingTask && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // Filter by active project
  const filteredByProject = useMemo(() => {
    if (activeProjectId === undefined) return tasks;
    return tasks.filter((t) => (activeProjectId === null ? t.projectId === null : t.projectId === activeProjectId));
  }, [tasks, activeProjectId]);

  const pending = useMemo(() =>
    filteredByProject.filter((t) => !t.status)
      .sort((a, b) => a.order - b.order)
      .filter((t) => !filter || t.category === filter)
      .filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [filteredByProject, filter, searchQuery]
  );

  const completed = useMemo(() =>
    filteredByProject.filter((t) => t.status)
      .filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [filteredByProject, searchQuery]
  );

  // Group pending by project for global view
  const pendingByProject = useMemo(() => {
    if (activeProjectId !== undefined) return null;
    const groups: Array<{ project: Project | null; tasks: Task[] }> = [];
    const grouped = new Map<string | null, Task[]>();
    for (const task of pending) {
      const key = task.projectId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    }
    for (const p of projects) {
      const projectTasks = grouped.get(p.id);
      if (projectTasks && projectTasks.length > 0) groups.push({ project: p, tasks: projectTasks });
    }
    const unassigned = grouped.get(null);
    if (unassigned && unassigned.length > 0) groups.push({ project: null, tasks: unassigned });
    return groups;
  }, [pending, projects, activeProjectId]);

  const handleComplete = async (task: Task) => {
    const newStatus = !task.status;
    if (newStatus) {
      const { xp, bonus, comboMult } = calculateXpForAction(task.tier, todayCount);
      await window.api.questsSetTaskStatus(task.id, true);
      const result = await window.api.processRpgEvent({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp, hp: 0, taskId: task.id, tier: task.tier },
        timestamp: Date.now(),
      });
      playTaskComplete();
      setToastData({ xp, bonusTier: bonus.tier, comboMultiplier: comboMult, streakMilestone: result.milestoneXp || null });
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
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    playDelete();
    await window.api.questsDeleteTasks(Array.from(selectedIds));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    await loadTasks();
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
  };

  const toggleProjectCollapse = (key: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem('questify_collapsed_projects', JSON.stringify([...next]));
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
    projects,
    showProjectBadge: activeProjectId === undefined,
    onToggleExpand: () => toggleExpand(task.id),
    onComplete: () => handleComplete(task),
    onEdit: () => setEditingTask(task),
    onToggleSelect: () => setSelectedIds((prev) => {
      const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next;
    }),
    onShowToast: setToastData,
    onSubtaskChanged: () => { loadSubtasks(task.id); loadTasks(); },
  });

  return (
    <div>
      <PageHeader title={t('questify.title')} subtitle={t('questify.subtitle')} />
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rpg-input"
          style={{ width: '100%' }}
        />
      </div>
      <div ref={formRef}>
        <TaskForm
          editingTask={editingTask}
          categories={categories}
          projects={projects}
          activeProjectId={activeProjectId === undefined ? null : activeProjectId}
          onSaved={() => { setEditingTask(null); loadTasks(); }}
        />
      </div>

      {/* Tabs + filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="rpg-button"
          onClick={() => setActiveTab('pending')}
          style={{ opacity: activeTab === 'pending' ? 1 : 0.6 }}>
          {t('questify.pending')} ({pending.length})
        </button>
        <button className="rpg-button"
          onClick={() => setActiveTab('completed')}
          style={{ opacity: activeTab === 'completed' ? 1 : 0.6 }}>
          {t('questify.completed')} ({completed.length})
        </button>

        {/* Project filter */}
        <select
          value={activeProjectId === undefined ? '__all__' : (activeProjectId ?? '__none__')}
          onChange={(e) => {
            const val = e.target.value;
            setActiveProjectId(val === '__all__' ? undefined : val === '__none__' ? null : val);
            setFilter('');
          }}
          style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid var(--rpg-wood)',
            borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)', fontSize: '0.85rem' }}>
          <option value="__all__">{t('questify.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="__none__">{t('questify.noProject')}</option>
        </select>

        {/* Manage projects */}
        <button className="rpg-button" onClick={() => setShowProjectManager(true)}
          title={t('questify.manageProjects')}
          style={{ padding: '4px 8px', opacity: 0.6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>

        {/* Category filter */}
        {uniqueCategories.length > 0 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid var(--rpg-wood)',
              borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)', fontSize: '0.85rem' }}>
            <option value="">{t('questify.allCategories')}</option>
            {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {selectedIds.size > 0 && !showDeleteConfirm && (
          <button className="rpg-button" onClick={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--rpg-hp-red)', marginLeft: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
            </svg>
            {t('questify.delete')} ({selectedIds.size})
          </button>
        )}

        {showDeleteConfirm && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8,
            padding: '4px 10px', background: 'rgba(139,32,32,0.1)',
            border: '1px solid var(--rpg-hp-red)', borderRadius: 'var(--rpg-radius)',
          }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--rpg-hp-red)' }}>
              {t('questify.deleteConfirm', { count: selectedIds.size })}
            </span>
            <button className="rpg-button" onClick={confirmDelete}
              style={{ background: 'var(--rpg-hp-red)', padding: '3px 10px', fontSize: '0.8rem' }}>
              {t('questify.delete')}
            </button>
            <button className="rpg-button" onClick={() => setShowDeleteConfirm(false)}
              style={{ padding: '3px 10px', fontSize: '0.8rem', opacity: 0.7 }}>
              {t('questify.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Task lists */}
      {activeTab === 'pending' && pendingByProject ? (
        /* Global view — sections by project */
        pendingByProject.map(({ project, tasks: sectionTasks }) => {
          const sectionKey = project?.id ?? '__none__';
          const isCollapsed = collapsedProjects.has(sectionKey);
          return (
            <div key={sectionKey} style={{ marginBottom: 12 }}>
              <div onClick={() => toggleProjectCollapse(sectionKey)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  cursor: 'pointer', borderBottom: '1px solid var(--rpg-parchment-dark)',
                  userSelect: 'none',
                }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                  style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
                  <path d="M3 1l4 4-4 4"/>
                </svg>
                {project && <span style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, flexShrink: 0 }} />}
                <span style={{ fontWeight: 'bold', flex: 1 }}>{project?.name ?? t('questify.noProject')}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                  {t('questify.pendingCount', { count: sectionTasks.length })}
                </span>
              </div>
              {!isCollapsed && (
                <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onDragEndInSection(event, sectionTasks)}>
                  <SortableContext items={sectionTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {sectionTasks.map((task) => (
                      <SortableTaskItem key={task.id} {...taskItemProps(task)} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          );
        })
      ) : activeTab === 'pending' ? (
        /* Single project view — flat list */
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {pending.map((task) => (
              <SortableTaskItem key={task.id} {...taskItemProps(task)} />
            ))}
          </SortableContext>
        </DndContext>
      ) : null}

      {activeTab === 'completed' && completed.map((task) => (
        <div key={task.id} className="rpg-card" style={{ marginBottom: 8, opacity: 0.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox checked onChange={() => handleComplete(task)} />
            <span style={{ textDecoration: 'line-through', flex: 1 }}>{task.name}</span>
            <TierBadge tier={task.tier} />
          </div>
        </div>
      ))}

      {activeTab === 'pending' && pending.length === 0 && (
        <p style={{ textAlign: 'center', opacity: 0.5, padding: 24, fontStyle: 'italic' }}>
          {t('questify.noQuests')}
        </p>
      )}

      <XpToast data={toastData} />

      {showProjectManager && (
        <ProjectManager
          projects={projects}
          onClose={() => setShowProjectManager(false)}
          onSaved={() => loadTasks()}
        />
      )}
    </div>
  );
}

function SortableTaskItem({ task, expanded, selected, subtasks, todayCount, projects, showProjectBadge,
  onToggleExpand, onComplete, onEdit, onToggleSelect, onShowToast, onSubtaskChanged }: {
  task: Task; expanded: boolean; selected: boolean; subtasks: Subtask[];
  todayCount: number; projects: Project[]; showProjectBadge: boolean;
  onToggleExpand: () => void; onComplete: () => void; onEdit: () => void;
  onToggleSelect: () => void; onShowToast: (d: XpToastData) => void;
  onSubtaskChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;

  return (
    <div ref={setNodeRef} style={{ ...style, marginBottom: 8 }} {...attributes} className="rpg-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: expanded ? 8 : 0 }}>
        <svg {...listeners} width="14" height="14" viewBox="0 0 14 14"
          style={{ cursor: 'grab', opacity: 0.4, flexShrink: 0 }}
          fill="var(--rpg-gold-dark)" aria-label="Drag to reorder">
          <circle cx="4" cy="3" r="1.2"/><circle cx="10" cy="3" r="1.2"/>
          <circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/>
          <circle cx="4" cy="11" r="1.2"/><circle cx="10" cy="11" r="1.2"/>
        </svg>
        <Checkbox onChange={onComplete} />
        <svg onClick={onToggleExpand} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.4, flexShrink: 0, cursor: 'pointer' }}>
          <path d="M3 1l4 4-4 4"/>
        </svg>
        <span onClick={onToggleExpand} style={{ flex: 1, cursor: 'pointer', fontWeight: 'bold' }}>
          {task.name}
        </span>
        {subtasks.length > 0 && (
          <span style={{ fontSize: '0.7rem', opacity: 0.5, fontFamily: 'Fira Code, monospace' }}>
            ({subtasks.filter(s => s.status).length}/{subtasks.length})
          </span>
        )}
        <TierBadge tier={task.tier} />
        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>+{XP_MAP[task.tier]}</span>
        {showProjectBadge && project && (
          <span style={{
            fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3,
            background: project.color, color: '#f5f0e1', opacity: 0.9,
          }}>
            {project.name}
          </span>
        )}
        {task.category && (
          <span style={{ fontSize: '0.75rem', background: 'var(--rpg-gold)', color: 'var(--rpg-ink)',
            padding: '1px 6px', borderRadius: 3 }}>{task.category}</span>
        )}
        {task.dueDate && (
          <span style={{
            fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3,
            background: new Date(task.dueDate) < new Date() ? 'var(--rpg-hp-red)' : 'var(--rpg-parchment-dark)',
            color: new Date(task.dueDate) < new Date() ? 'var(--rpg-parchment)' : 'var(--rpg-ink-light)',
          }}>
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
        <svg onClick={onEdit} width="16" height="16" viewBox="0 0 16 16"
          style={{ cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.5')}
          fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round"
          aria-label="Edit">
          <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
        </svg>
        <svg onClick={onToggleSelect} width="14" height="14" viewBox="0 0 14 14"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}
          fill="none" stroke={selected ? 'var(--rpg-hp-red)' : 'var(--rpg-gold-dark)'} strokeWidth="1.3"
          aria-label="Select for deletion">
          <rect x="1" y="1" width="12" height="12" rx="2"/>
          {selected && <path d="M3.5 7l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round"/>}
        </svg>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 32 }}>
          {task.description && <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: 8 }}>{task.description}</p>}
          {task.dueDate && <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>Due: {new Date(task.dueDate).toLocaleString()}</p>}
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
