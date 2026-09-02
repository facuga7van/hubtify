import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SubtaskInlineForm from './SubtaskInlineForm';
import Checkbox from '../../../shared/components/Checkbox';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/useToast';
import type { XpToastData } from '../types';
import { type TaskTier, type Subtask, XP_MAP, MAX_SUBTASKS } from '../types';
import { TierBadge, tierXp, bonusMultiplierToTier, notifyStreakSaved } from '../utils';
import { todayDateString } from '../../../../shared/date-utils';
import { completeTask } from '../../../shared/animations/feedback';
import { playTaskComplete } from '../../../shared/audio';

interface Props {
  taskId: string;
  subtasks: Subtask[];
  onShowToast: (data: XpToastData) => void;
  onSubtaskChanged: () => void;
}

export default function SubtaskList({ taskId, subtasks, onShowToast, onSubtaskChanged }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();
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

      const [, result] = await Promise.all([
        window.api.questsSetSubtaskStatus(subtask.id, true, today),
        window.api.processRpgEvent({
          type: 'SUBTASK_COMPLETED', moduleId: 'quests',
          payload: { xp: XP_MAP[tier], hp: 0, subtaskId: subtask.id, tier },
          timestamp: Date.now(),
        }),
      ]);

      const toastData: XpToastData = { xp: result.xpGained, bonusTier: bonusMultiplierToTier(result.bonusMultiplier), comboMultiplier: result.comboMultiplier, streakMilestone: result.milestoneXp || null };

      if (rowEl && textEl) {
        const tl = completeTask(rowEl, textEl);
        tl.eventCallback('onComplete', () => onShowToast(toastData));
      } else {
        onShowToast(toastData);
      }
      notifyStreakSaved(result, { toast, t });
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

  const handleDelete = useCallback(async (subtaskId: string) => {
    const ok = await confirm({
      message: t('questify.subtaskDeleteConfirm'),
      danger: true,
      confirmText: t('questify.delete'),
    });
    if (!ok) return;
    await window.api.questsDeleteSubtask(subtaskId);
    onSubtaskChanged();
  }, [confirm, t, onSubtaskChanged]);

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

  const cancelForm = () => { setShowForm(false); setEditingSubtask(null); };

  return (
    <div className="subtask-list">
      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pending.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {pending.map((subtask) => (
            /* The edit form replaces the row it belongs to, so the field never
               appears hundreds of pixels away from the subtask being edited. */
            editingSubtask?.id === subtask.id ? (
              <SubtaskInlineForm
                key={subtask.id}
                editing={editingSubtask}
                onSave={handleSave}
                onCancel={cancelForm}
              />
            ) : (
              <SortableSubtaskItem
                key={subtask.id}
                subtask={subtask}
                onComplete={handleComplete}
                onEdit={(s) => { setEditingSubtask(s); setShowForm(false); }}
                onDelete={handleDelete}
              />
            )
          ))}
        </SortableContext>
      </DndContext>

      {showForm && !editingSubtask ? (
        <SubtaskInlineForm
          editing={null}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      ) : !editingSubtask ? (
        <button className="rpg-button" disabled={atLimit} title={atLimit ? t('questify.subtaskLimit', 'Max 30 subtasks reached') : undefined} onClick={() => setShowForm(true)}
          style={{ fontSize: 'var(--fs-label)', padding: '4px 10px', marginTop: 6 }}>
          {t('questify.addSubtask')}
          {subtasks.length > 0 && (
            <span style={{
              marginLeft: 6,
              opacity: subtasks.length >= 25 ? 1 : 0.55,
              color: subtasks.length >= 25 ? 'var(--rubric)' : 'inherit',
              fontWeight: subtasks.length >= 25 ? 600 : 'normal',
            }}>
              ({subtasks.length}/{MAX_SUBTASKS})
            </span>
          )}
        </button>
      ) : null}

      {completed.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button className="subtask-toggle-completed" onClick={() => setShowCompleted(!showCompleted)}>
            {showCompleted ? t('questify.hideCompleted') : t('questify.showCompleted')} ({completed.length})
          </button>
          {/* Same cell sequence as a pending row (with empty placeholders) so the
              columns line up when the completed list is revealed. */}
          {showCompleted && completed.map((subtask) => (
            <div key={subtask.id} className="subtask-item subtask-item--completed">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox checked onChange={() => handleComplete(subtask)} />
              </div>
              <span className="subtask-cell--drag" aria-hidden="true" />
              <span className="subtask-name" style={{ textDecoration: 'line-through', flex: 1, minWidth: 0 }} title={subtask.name}>
                {subtask.name}
              </span>
              <TierBadge tier={subtask.tier} />
              <span className="subtask-xp-hint" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                +{tierXp(subtask.tier)}
              </span>
              <span className="subtask-cell--action" aria-hidden="true" />
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
  const [animatingComplete, setAnimatingComplete] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  const rowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLButtonElement>(null);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const handleCheckboxComplete = useCallback(() => {
    if (animatingComplete) return;
    setAnimatingComplete(true);
    playTaskComplete();
  }, [animatingComplete]);

  const handleDrawComplete = useCallback(() => {
    onComplete(subtask, rowRef.current, textRef.current);
  }, [onComplete, subtask]);

  return (
    <div ref={(el) => { setNodeRef(el); rowRef.current = el; }} style={style} {...attributes} className="subtask-item">
      <div onPointerDown={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
        <Checkbox checked={animatingComplete} onChange={handleCheckboxComplete} onDrawComplete={handleDrawComplete} />
      </div>
      <div {...listeners} className="subtask-cell--drag" style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg>
      </div>
      <button
        type="button"
        ref={textRef}
        className="subtask-name subtask-name-btn"
        onClick={() => onEdit(subtask)}
        title={subtask.name}
      >
        {subtask.name}
      </button>
      <TierBadge tier={subtask.tier} />
      <span className="subtask-xp-hint" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
        +{tierXp(subtask.tier)}
      </span>
      <button
        type="button"
        className="subtask-cell--action quest-icon-btn"
        onClick={() => onDelete(subtask.id)}
        aria-label={t('questify.delete', 'Delete')}
        title={t('questify.delete', 'Delete')}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"
          stroke="var(--rubric)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
        </svg>
      </button>
    </div>
  );
}
