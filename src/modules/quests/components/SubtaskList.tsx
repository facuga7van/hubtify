import { useState, useMemo } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SubtaskInlineForm from './SubtaskInlineForm';
import type { XpToastData } from './XpToast';
import { type TaskTier, type Subtask, XP_MAP, MAX_SUBTASKS } from '../types';
import { TierBadge, tierXp, calculateXpForAction } from '../utils';
import { getLocalDateString } from '../../../../shared/rpg-engine';

interface Props {
  taskId: string;
  subtasks: Subtask[];
  countCompletedToday: number;
  onShowToast: (data: XpToastData) => void;
  onSubtaskChanged: () => void;
}

export default function SubtaskList({ taskId, subtasks, countCompletedToday, onShowToast, onSubtaskChanged }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState<Subtask | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const pending = useMemo(() => subtasks.filter((s) => !s.status).sort((a, b) => a.order - b.order), [subtasks]);
  const completed = useMemo(() => subtasks.filter((s) => s.status), [subtasks]);

  const handleSave = async (data: { name: string; description: string; tier: TaskTier }) => {
    if (editingSubtask) {
      await window.api.questsUpdateSubtask(editingSubtask.id, data);
      setEditingSubtask(null);
      setShowForm(false);
    } else {
      await window.api.questsAddSubtask(taskId, data);
    }
    onSubtaskChanged();
  };

  const handleComplete = async (subtask: Subtask) => {
    const tier = subtask.tier as TaskTier;
    if (!subtask.status) {
      const today = getLocalDateString();
      const { xp, bonus, comboMult } = calculateXpForAction(tier, countCompletedToday);

      await window.api.questsSetSubtaskStatus(subtask.id, true, today);
      const result = await window.api.processRpgEvent({
        type: 'SUBTASK_COMPLETED', moduleId: 'quests',
        payload: { xp, hp: 0, subtaskId: subtask.id, tier },
        timestamp: Date.now(),
      });

      onShowToast({ xp, bonusTier: bonus.tier, comboMultiplier: comboMult, streakMilestone: result.milestoneXp || null });
    } else {
      await window.api.questsSetSubtaskStatus(subtask.id, false);
      await window.api.processRpgEvent({
        type: 'SUBTASK_UNCOMPLETED', moduleId: 'quests',
        payload: { xp: -XP_MAP[tier], hp: 0, subtaskId: subtask.id },
        timestamp: Date.now(),
      });
    }
    onSubtaskChanged();
  };

  const handleDelete = async (subtaskId: string) => {
    await window.api.questsDeleteSubtask(subtaskId);
    onSubtaskChanged();
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = pending.findIndex((s) => s.id === active.id);
    const newIdx = pending.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(pending, oldIdx, newIdx);
    await window.api.questsSyncSubtaskOrders(taskId, reordered.map((s) => s.id));
    onSubtaskChanged();
  };

  const atLimit = subtasks.length >= MAX_SUBTASKS;

  return (
    <div className="subtask-list">
      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pending.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {pending.map((subtask) => (
            <SortableSubtaskItem
              key={subtask.id}
              subtask={subtask}
              onComplete={handleComplete}
              onEdit={(s) => { setEditingSubtask(s); setShowForm(true); }}
              onDelete={handleDelete}
            />
          ))}
        </SortableContext>
      </DndContext>

      {completed.length > 0 && (
        <button className="subtask-toggle-completed" onClick={() => setShowCompleted(!showCompleted)}>
          {showCompleted ? 'Hide' : 'Show'} completed ({completed.length})
        </button>
      )}

      {showCompleted && completed.map((subtask) => (
        <div key={subtask.id} className="subtask-item subtask-item--completed">
          <svg onClick={() => handleComplete(subtask)} width="20" height="20" viewBox="0 0 20 20"
            style={{ cursor: 'pointer', flexShrink: 0 }}
            fill="none" stroke="var(--rpg-xp-green)" strokeWidth="1.5">
            <rect x="3" y="3" width="14" height="14" rx="2"/>
            <path d="M6 10l3 3 5-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{subtask.name}</span>
        </div>
      ))}

      {showForm || editingSubtask ? (
        <SubtaskInlineForm
          editing={editingSubtask}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingSubtask(null); }}
        />
      ) : (
        <button className="rpg-button" disabled={atLimit} onClick={() => setShowForm(true)}
          style={{ fontSize: '0.8rem', padding: '4px 10px', marginTop: 6 }}>
          + Add Subtask
        </button>
      )}
    </div>
  );
}

function SortableSubtaskItem({ subtask, onComplete, onEdit, onDelete }: {
  subtask: Subtask; onComplete: (s: Subtask) => void;
  onEdit: (s: Subtask) => void; onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="subtask-item">
      <svg onClick={() => onComplete(subtask)} width="20" height="20" viewBox="0 0 20 20"
        style={{ cursor: 'pointer', flexShrink: 0 }}
        fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5">
        <rect x="3" y="3" width="14" height="14" rx="2" />
      </svg>
      <span className="subtask-name" onClick={() => onEdit(subtask)} style={{ cursor: 'pointer', flex: 1 }}>
        {subtask.name}
      </span>
      <TierBadge tier={subtask.tier} />
      <span className="subtask-xp-hint" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
        +{tierXp(subtask.tier)}
      </span>
      <svg onClick={() => onDelete(subtask.id)} width="12" height="12" viewBox="0 0 12 12"
        style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
        onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}
        stroke="var(--rpg-hp-red)" strokeWidth="1.8" strokeLinecap="round">
        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
      </svg>
    </div>
  );
}
