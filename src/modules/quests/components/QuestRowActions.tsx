import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../shared/format-date';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import { useMenuKeyboard } from './useMenuKeyboard';
import { useToast } from '../../../shared/components/useToast';
import { isTaskLinkWired, startBrew, setSessionTask } from '../../cauldron/api';
import { quickStartPresetId } from '../../cauldron/hooks';
import { getDueDateStatus } from '../utils';
import { parseRepeatRule, describeRepeatRule } from '../repeat';
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

function CauldronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h10M4 6c0 4 1.5 7 4 7s4-3 4-7" />
      <path d="M2.5 7.5L1.5 9M13.5 7.5l1 1.5" />
      <path d="M6 3.5c0-.8.7-1 .7-1.8M9.3 3.5c0-.8.7-1 .7-1.8" />
    </svg>
  );
}

/** Two chasing arrows in a circle — the medieval "this quest returns" seal. */
function RepeatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.8 5.2A5.4 5.4 0 003.4 6.6" />
      <path d="M3.2 10.8a5.4 5.4 0 009.4-1.4" />
      <path d="M3.2 3.4v3.2h3.2" />
      <path d="M12.8 12.6V9.4H9.6" />
    </svg>
  );
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
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  // Portaled so the menu is never clipped by a row/column with overflow hidden.
  const { anchorRef, popupRef, pos, reposition } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>(open);
  const closeMenu = useCallback(() => setOpen(false), []);
  // Focus into the menu, arrow keys, Escape/Tab, focus back to the trigger.
  useMenuKeyboard({ open, popupRef, anchorRef, onClose: closeMenu });

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
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, anchorRef, popupRef]);

  // Vinculo Caldero <-> Questify: enciende el caldero sobre ESTA mision sin
  // sacarte de la lista (navegar seria perder el contexto de trabajo). Si ya
  // hay una sesion hirviendo, no la pisa: le adjunta la mision.
  const handleBrew = async () => {
    try {
      const presets = await window.api.cauldronGetPresets();
      const presetId = quickStartPresetId(presets);
      if (!presetId) return;
      try {
        await startBrew(presetId, task.id);
        toast({ type: 'info', message: t('questify.brewStarted', 'El caldero hierve con esta misión') });
      } catch {
        // Timer ya activo: adjuntar en vez de reiniciar.
        const attached = await setSessionTask(task.id);
        if (attached) {
          toast({ type: 'info', message: t('questify.brewAttached', 'Misión enlazada a la sesión activa') });
        }
      }
    } catch (err) {
      console.warn('[QuestRowActions] brew failed:', err);
    }
  };

  useEffect(() => { if (!open) setPostponeOpen(false); }, [open]);

  // Abrir «Posponer» agrega tres renglones (o el calendario entero) DESPUÉS de
  // que el popup se midió. En la última fila de la lista eso lo mandaba abajo
  // del borde de la ventana, con las opciones fuera de la pantalla. El hook
  // sabe re-anclarlo hacia arriba; hay que avisarle que creció.
  useEffect(() => { if (open) reposition(); }, [postponeOpen, open, reposition]);

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  const dueStatus = task.dueDate ? getDueDateStatus(task.dueDate) : null;
  const repeatRule = parseRepeatRule(task.repeatRule);

  return (
    <div className="quest-row-actions" onPointerDown={(e) => e.stopPropagation()}>
      {/* Recurrence seal: quiet mark + tooltip with the concrete rule. */}
      {repeatRule && (
        <span
          className="quest-repeat-badge"
          title={describeRepeatRule(repeatRule, t)}
          aria-label={describeRepeatRule(repeatRule, t)}
          role="img"
        >
          <RepeatIcon />
        </span>
      )}

      {/* Due date badge */}
      {task.dueDate && dueStatus && (
        <span className={`quest-due--${dueStatus}`}>
          {dueStatus === 'today'
            ? t('questify.dueToday')
            : dueStatus === 'overdue'
              ? t('questify.overdueLabel', 'vencida')
              : formatDate(task.dueDate, i18n.language)}
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
          aria-label={t('questify.notes', 'Notas')}
          title={t('questify.notes', 'Notas')}
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
          {!task.status && isTaskLinkWired() && (
            <button type="button" role="menuitem" className="quest-row-menu-item" onClick={run(handleBrew)}>
              <CauldronIcon />
              {t('questify.brewThis', 'Enfocar en el Caldero')}
            </button>
          )}
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
