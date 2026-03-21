import { useState, useMemo } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SubtaskInlineForm from './SubtaskInlineForm';
import type { XpToastData } from './XpToast';
import { type TaskTier, type Subtask, XP_MAP, MAX_SUBTASKS, rollBonus } from '../types';

const COMBO_MULTS = [1.0, 1.25, 1.5, 1.75, 2.0];

function getComboMultiplier(count: number): number {
  return COMBO_MULTS[Math.min(count, COMBO_MULTS.length - 1)];
}

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
      const today = new Date().toLocaleDateString('en-CA');
      const bonus = rollBonus();
      const comboMult = getComboMultiplier(countCompletedToday);
      const xp = Math.round(XP_MAP[tier] * comboMult * bonus.multiplier);

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
          <input type="checkbox" checked onChange={() => handleComplete(subtask)} />
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
  const tierEmoji = subtask.tier === 1 ? '\u26A1' : subtask.tier === 3 ? '\uD83D\uDC09' : '\u2694\uFE0F';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="subtask-item">
      <input type="checkbox" onChange={() => onComplete(subtask)} />
      <span className="subtask-name" onClick={() => onEdit(subtask)} style={{ cursor: 'pointer', flex: 1 }}>
        {subtask.name}
      </span>
      <span className="subtask-tier-badge">{tierEmoji}</span>
      <span className="subtask-xp-hint" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
        +{XP_MAP[subtask.tier]}
      </span>
      <button onClick={() => onDelete(subtask.id)} style={{
        background: 'none', border: 'none', color: 'var(--rpg-hp-red)', cursor: 'pointer', fontSize: '0.9rem'
      }}>&#x2715;</button>
    </div>
  );
}
