import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PageHeader from '../../../shared/components/PageHeader';
import TaskForm from './TaskForm';
import SubtaskList from './SubtaskList';
import XpToast, { type XpToastData } from './XpToast';
import { type Task, type TaskTier, type Subtask, XP_MAP } from '../types';
import { TierBadge, calculateXpForAction } from '../utils';
import { playTaskComplete, playDelete } from '../../../shared/audio';

export default function TaskList() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [filter, setFilter] = useState('');
  const [toastData, setToastData] = useState<XpToastData | null>(null);
  const [todayCount, setTodayCount] = useState(0);

  const loadTasks = useCallback(async () => {
    try {
      const [allTasks, cats, count] = await Promise.all([
        window.api.questsGetTasks(),
        window.api.questsGetCategories(),
        window.api.questsCountCompletedToday(),
      ]);
      setTasks(allTasks as Task[]);
      setCategories(cats);
      setTodayCount(count);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

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

  const pending = useMemo(() =>
    tasks.filter((t) => !t.status).sort((a, b) => a.order - b.order)
      .filter((t) => !filter || t.category === filter),
    [tasks, filter]
  );
  const completed = useMemo(() => tasks.filter((t) => t.status), [tasks]);

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
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Delete ${selectedIds.size} quest(s)? This cannot be undone.`);
    if (!confirmed) return;
    playDelete();
    await window.api.questsDeleteTasks(Array.from(selectedIds));
    setSelectedIds(new Set());
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

  const uniqueCategories = useMemo(() => {
    const cats = new Set(tasks.map((t) => t.category).filter(Boolean));
    return Array.from(cats);
  }, [tasks]);

  return (
    <div>
      <PageHeader title={t('questify.title')} subtitle={t('questify.subtitle')} />
      <TaskForm editingTask={editingTask} categories={categories} onSaved={() => { setEditingTask(null); loadTasks(); }} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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

        {uniqueCategories.length > 0 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid var(--rpg-wood)',
              borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)', fontSize: '0.85rem' }}>
            <option value="">{t('questify.allCategories')}</option>
            {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {selectedIds.size > 0 && (
          <button className="rpg-button" onClick={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--rpg-hp-red)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
            </svg>
            {t('questify.delete')} ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Task lists */}
      {activeTab === 'pending' && (
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {pending.map((task) => (
              <SortableTaskItem
                key={task.id}
                task={task}
                expanded={expandedIds.has(task.id)}
                selected={selectedIds.has(task.id)}
                subtasks={subtasksMap[task.id] ?? []}
                todayCount={todayCount}
                onToggleExpand={() => toggleExpand(task.id)}
                onComplete={() => handleComplete(task)}
                onEdit={() => setEditingTask(task)}
                onToggleSelect={() => setSelectedIds((prev) => {
                  const next = new Set(prev);
                  next.has(task.id) ? next.delete(task.id) : next.add(task.id);
                  return next;
                })}
                onShowToast={setToastData}
                onSubtaskChanged={() => { loadSubtasks(task.id); loadTasks(); }}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {activeTab === 'completed' && completed.map((task) => (
        <div key={task.id} className="rpg-card" style={{ marginBottom: 8, opacity: 0.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg onClick={() => handleComplete(task)} width="20" height="20" viewBox="0 0 20 20"
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill="none" stroke="var(--rpg-xp-green)" strokeWidth="1.5">
              <rect x="3" y="3" width="14" height="14" rx="2"/>
              <path d="M6 10l3 3 5-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
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
    </div>
  );
}

function SortableTaskItem({ task, expanded, selected, subtasks, todayCount,
  onToggleExpand, onComplete, onEdit, onToggleSelect, onShowToast, onSubtaskChanged }: {
  task: Task; expanded: boolean; selected: boolean; subtasks: Subtask[];
  todayCount: number;
  onToggleExpand: () => void; onComplete: () => void; onEdit: () => void;
  onToggleSelect: () => void; onShowToast: (d: XpToastData) => void;
  onSubtaskChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={{ ...style, marginBottom: 8 }} {...attributes} className="rpg-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: expanded ? 8 : 0 }}>
        <svg {...listeners} width="14" height="14" viewBox="0 0 14 14"
          style={{ cursor: 'grab', opacity: 0.4, flexShrink: 0 }}
          fill="var(--rpg-gold-dark)">
          <circle cx="4" cy="3" r="1.2"/><circle cx="10" cy="3" r="1.2"/>
          <circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/>
          <circle cx="4" cy="11" r="1.2"/><circle cx="10" cy="11" r="1.2"/>
        </svg>
        {/* Checkbox */}
        <svg onClick={onComplete} width="20" height="20" viewBox="0 0 20 20"
          style={{ cursor: 'pointer', flexShrink: 0 }}
          fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5">
          <rect x="3" y="3" width="14" height="14" rx="2" />
        </svg>
        <span onClick={onToggleExpand} style={{ flex: 1, cursor: 'pointer', fontWeight: 'bold' }}>
          {task.name}
        </span>
        <TierBadge tier={task.tier} />
        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>+{XP_MAP[task.tier]}</span>
        {task.category && (
          <span style={{ fontSize: '0.75rem', background: 'var(--rpg-gold)', color: 'var(--rpg-ink)',
            padding: '1px 6px', borderRadius: 3 }}>{task.category}</span>
        )}
        <svg onClick={onEdit} width="16" height="16" viewBox="0 0 16 16"
          style={{ cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.5')}
          fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
          <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
        </svg>
        <svg onClick={onToggleSelect} width="14" height="14" viewBox="0 0 14 14"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}
          fill="none" stroke={selected ? 'var(--rpg-hp-red)' : 'var(--rpg-gold-dark)'} strokeWidth="1.3">
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
