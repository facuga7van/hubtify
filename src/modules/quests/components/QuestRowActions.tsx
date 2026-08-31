import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import { getDueDateStatus } from '../utils';
import PostponeMenu, { PostponeOptions } from './PostponeMenu';
import type { Task } from '../types';

interface Props {
  task: Task;
  selected: boolean;
  drawingCount: number;
  onEdit: () => void;
  onOpenNotes: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
  /** Receives 'today' | 'tomorrow' | 'YYYY-MM-DDTHH:mm'. */
  onPostpone: (target: string) => void;
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8.5" r="6" />
      <path d="M8 5v3.5l2.2 1.5" />
      <path d="M5.5 1.6L3.4 3M10.5 1.6L12.6 3" />
    </svg>
  );
}

/**
 * Right-hand cluster of a quest row.
 *
 * The row used to carry four indistinguishable 12–14px icons. Edit / notes /
 * delete now live behind one overflow menu, the due-date badge stays visible,
 * and the batch-selection checkbox is pulled out on its own so it reads as a
 * different kind of control.
 */
export default function QuestRowActions({
  task, selected, drawingCount, onEdit, onOpenNotes, onDelete, onToggleSelect, onPostpone,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  // Portaled so the menu is never clipped by a row/column with overflow hidden.
  const { anchorRef, popupRef, pos } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // The postpone submenu's date picker lives in its own portal — a click on
      // a day is still a click inside this menu, not outside it.
      if (target.closest?.('.rpg-anchored-popup')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, popupRef]);

  useEffect(() => { if (!open) setPostponeOpen(false); }, [open]);

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  const dueStatus = task.dueDate ? getDueDateStatus(task.dueDate) : null;

  return (
    <div className="quest-row-actions" onPointerDown={(e) => e.stopPropagation()}>
      {/* Due date badge */}
      {task.dueDate && dueStatus && (
        <span className={`quest-due--${dueStatus}`}>
          {dueStatus === 'today'
            ? t('questify.dueToday')
            : dueStatus === 'overdue'
              ? t('questify.overdueLabel', 'vencida')
              : new Date(task.dueDate).toLocaleDateString()}
        </span>
      )}

      {/* Reschedule shortcut, right beside the date it changes. Revealed on
          hover/focus of the row (see .quest-row-postpone in quests.css) so the
          resting row stays quiet, but reachable in one click when it matters. */}
      {!task.status && (
        <PostponeMenu
          onPick={onPostpone}
          className="quest-icon-btn tap-target quest-row-postpone"
          title={t('questify.postpone', 'Posponer')}
        >
          <ClockIcon />
        </PostponeMenu>
      )}

      {/* Notes shortcut stays visible only when there is something to see */}
      {drawingCount > 0 && (
        <button
          type="button"
          className="quest-icon-btn tap-target quest-note-btn"
          onClick={run(onOpenNotes)}
          aria-label={t('questify.notes', 'Notes')}
          title={t('questify.notes', 'Notes')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
            fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 1h8l2 2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/>
            <path d="M10 1v3h3"/>
            <path d="M5 8h6M5 11h4"/>
          </svg>
          <span className="quest-note-badge">{drawingCount}</span>
        </button>
      )}

      {/* Overflow menu */}
      <div ref={anchorRef} style={{ display: 'inline-flex' }}>
        <button
          type="button"
          className="quest-icon-btn tap-target"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('questify.rowActions', 'Acciones de la misión')}
          title={t('questify.rowActions', 'Acciones de la misión')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--ink-faded)" aria-hidden="true">
            <circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
      </div>

      {open && createPortal(
        <div
          ref={popupRef}
          role="menu"
          className="quest-row-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="quest-row-menu-item" onClick={run(onEdit)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
            </svg>
            {t('questify.edit', 'Editar')}
          </button>
          <button type="button" role="menuitem" className="quest-row-menu-item" onClick={run(onOpenNotes)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 1h8l2 2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/>
              <path d="M10 1v3h3"/>
              <path d="M5 8h6M5 11h4"/>
            </svg>
            {t('questify.notes', 'Notas')}
            {drawingCount > 0 && <span className="quest-row-menu-count">{drawingCount}</span>}
          </button>
          {!task.status && (
            <>
              <button
                type="button"
                role="menuitem"
                className="quest-row-menu-item"
                aria-expanded={postponeOpen}
                onClick={(e) => { e.stopPropagation(); setPostponeOpen((v) => !v); }}
              >
                <ClockIcon />
                {t('questify.postpone', 'Posponer')}
                <span className="quest-row-menu-count" aria-hidden="true">{postponeOpen ? '−' : '+'}</span>
              </button>
              {postponeOpen && (
                <div className="quest-row-submenu">
                  <PostponeOptions onPick={(target) => { setOpen(false); onPostpone(target); }} />
                </div>
              )}
            </>
          )}
          <button type="button" role="menuitem" className="quest-row-menu-item quest-row-menu-item--danger" onClick={run(onDelete)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
            </svg>
            {t('questify.delete', 'Eliminar')}
          </button>
        </div>,
        document.body,
      )}

      {/* Batch selection — visually separated from the per-row actions */}
      <span className="quest-row-select-divider" aria-hidden="true" />
      <button
        type="button"
        className="quest-icon-btn tap-target quest-row-select"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        role="checkbox"
        aria-checked={selected}
        aria-label={t('questify.selectTask', 'Seleccionar misión')}
        title={t('questify.selectTask', 'Seleccionar misión')}
      >
        <svg width="20" height="20" viewBox="0 0 14 14" aria-hidden="true"
          fill="none" stroke={selected ? 'var(--rubric)' : 'var(--ink-faded)'} strokeWidth="1.3">
          <rect x="1" y="1" width="12" height="12" rx="1"/>
          {selected && <path d="M3.5 7l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round"/>}
        </svg>
      </button>
    </div>
  );
}
