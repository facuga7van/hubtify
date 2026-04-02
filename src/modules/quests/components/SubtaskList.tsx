import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SubtaskInlineForm from './SubtaskInlineForm';
import Checkbox from '../../../shared/components/Checkbox';
import type { XpToastData } from '../types';
import { type TaskTier, type Subtask, XP_MAP, MAX_SUBTASKS } from '../types';
import { TierBadge, tierXp, calculateXpForAction } from '../utils';
import { todayDateString } from '../../../../shared/date-utils';
import { completeTask } from '../../../shared/animations/feedback';

interface Props {
  taskId: string;
  subtasks: Subtask[];
  countCompletedToday: number;
  onShowToast: (data: XpToastData) => void;
  onSubtaskChanged: () => void;
}

// Duration of the QuillCheckbox draw animation (ms) — must match QuillCheckbox.tsx
const QUILL_DRAW_MS = 300;

export default function SubtaskList({ taskId, subtasks, countCompletedToday, onShowToast, onSubtaskChanged }: Props) {
  const { t } = useTranslation();
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

  const handleComplete = async (
    subtask: Subtask,
    rowEl?: HTMLElement | null,
    textEl?: HTMLElement | null,
  ) => {
    const tier = subtask.tier as TaskTier;
    if (!subtask.status) {
      const today = todayDateString();
      const { xp, bonus, comboMult } = calculateXpForAction(tier, countCompletedToday);

      await window.api.questsSetSubtaskStatus(subtask.id, true, today);
      const result = await window.api.processRpgEvent({
        type: 'SUBTASK_COMPLETED', moduleId: 'quests',
        payload: { xp, hp: 0, subtaskId: subtask.id, tier },
        timestamp: Date.now(),
      });

      const toastData: XpToastData = { xp, bonusTier: bonus.tier, comboMultiplier: comboMult, streakMilestone: result.milestoneXp || null };

      // Chain: quill animation (300ms) → strikethrough → toast
      if (rowEl && textEl) {
        setTimeout(() => {
          const tl = completeTask(rowEl, textEl);
          tl.eventCallback('onComplete', () => onShowToast(toastData));
        }, QUILL_DRAW_MS);
      } else {
        onShowToast(toastData);
      }
    } else {
      await window.api.questsSetSubtaskStatus(subtask.id, false);
      await window.api.processRpgEvent({
        type: 'SUBTASK_UNCOMPLETED', moduleId: 'quests',
        payload: { xp: -XP_MAP[tier], hp: 0, subtaskId: subtask.id },
        timestamp: Date.now(),
      });
    }
    onSubtaskChanged();
    window.dispatchEvent(new Event('rpg:statsChanged'));
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

      {showForm || editingSubtask ? (
        <SubtaskInlineForm
          editing={editingSubtask}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingSubtask(null); }}
        />
      ) : (
        <button className="rpg-button" disabled={atLimit} title={atLimit ? 'Max 30 subtasks reached' : undefined} onClick={() => setShowForm(true)}
          style={{ fontSize: '0.8rem', padding: '4px 10px', marginTop: 6 }}>
          {t('questify.addSubtask')}
        </button>
      )}

      {completed.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button className="subtask-toggle-completed" onClick={() => setShowCompleted(!showCompleted)}>
            {showCompleted ? t('questify.hideCompleted') : t('questify.showCompleted')} ({completed.length})
          </button>
          {showCompleted && completed.map((subtask) => (
            <div key={subtask.id} className="subtask-item subtask-item--completed">
              <Checkbox checked onChange={() => handleComplete(subtask)} />
              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{subtask.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableSubtaskItem({ subtask, onComplete, onEdit, onDelete }: {
  subtask: Subtask; onComplete: (s: Subtask, rowEl?: HTMLElement | null, textEl?: HTMLElement | null) => void;
  onEdit: (s: Subtask) => void; onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [animatingComplete, setAnimatingComplete] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const handleCheckboxComplete = useCallback(() => {
    if (animatingComplete) return;
    setAnimatingComplete(true);
    setTimeout(() => {
      onComplete(subtask, rowRef.current, textRef.current);
    }, 500);
  }, [animatingComplete, onComplete, subtask]);

  return (
    <div ref={(el) => { setNodeRef(el); rowRef.current = el; }} style={style} {...attributes} className="subtask-item">
      <div onPointerDown={(e) => e.stopPropagation()}>
        <Checkbox checked={animatingComplete} onChange={handleCheckboxComplete} />
      </div>
      <div {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0 4px', opacity: 0.3 }}>
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg>
      </div>
      <span ref={textRef} className="subtask-name" onClick={() => onEdit(subtask)} style={{ cursor: 'pointer', flex: 1 }}>
        {subtask.name}
      </span>
      <TierBadge tier={subtask.tier} />
      <span className="subtask-xp-hint" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
        +{tierXp(subtask.tier)}
      </span>
      {confirmDelete ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px', background: 'rgba(139,32,32,0.1)',
          border: '1px solid var(--rpg-hp-red)', borderRadius: 'var(--rpg-radius)',
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--rpg-hp-red)', whiteSpace: 'nowrap' }}>
            {t('questify.subtaskDeleteConfirm')}
          </span>
          <button className="rpg-button" onClick={() => onDelete(subtask.id)}
            style={{ background: 'var(--rpg-hp-red)', padding: '3px 10px', fontSize: '0.8rem' }}>
            {t('questify.delete')}
          </button>
          <button className="rpg-button" onClick={() => setConfirmDelete(false)}
            style={{ padding: '3px 10px', fontSize: '0.8rem', opacity: 0.7 }}>
            {t('questify.cancel')}
          </button>
        </div>
      ) : (
        <svg onClick={() => setConfirmDelete(true)} width="12" height="12" viewBox="0 0 12 12"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}
          stroke="var(--rpg-hp-red)" strokeWidth="1.8" strokeLinecap="round">
          <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
        </svg>
      )}
    </div>
  );
}
