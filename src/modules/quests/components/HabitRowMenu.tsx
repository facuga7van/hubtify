import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import { useMenuKeyboard } from './useMenuKeyboard';

interface Props {
  /** Today already carries a 'skip' row — the menu offers to undo it. */
  skipped: boolean;
  /** The per-habit history heatmap is currently expanded under the row. */
  historyOpen: boolean;
  onHistory: () => void;
  onEdit: () => void;
  onSkip: () => void;
  onDelete: () => void;
}

/**
 * Overflow menu for a habit row: history, edit, skip today, delete.
 *
 * "Skip today" needs a home that is not a fourth 14px icon competing with the
 * tick, so the existing icon buttons moved in here with it. Same portaled
 * pattern as QuestRowActions — a row with overflow hidden must not clip it.
 */
export default function HabitRowMenu({ skipped, historyOpen, onHistory, onEdit, onSkip, onDelete }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { anchorRef, popupRef, pos } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>(open);
  const closeMenu = useCallback(() => setOpen(false), []);
  // Focus into the menu, arrow keys, Escape/Tab, focus back to the trigger.
  useMenuKeyboard({ open, popupRef, anchorRef, onClose: closeMenu });

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, anchorRef, popupRef]);

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <>
      <div ref={anchorRef} style={{ display: 'inline-flex' }}>
        <button
          type="button"
          className="quest-icon-btn tap-target"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('questify.rowActions', 'Acciones')}
          title={t('questify.rowActions', 'Acciones')}
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
          <button
            type="button"
            role="menuitem"
            className="quest-row-menu-item"
            aria-pressed={historyOpen}
            onClick={run(onHistory)}
          >
            {/* Same nine-square glyph the standalone toggle used to carry. */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <rect x="0.5" y="0.5" width="3" height="3" rx="0.6"/>
              <rect x="5.5" y="0.5" width="3" height="3" rx="0.6"/>
              <rect x="10.5" y="0.5" width="3" height="3" rx="0.6"/>
              <rect x="0.5" y="5.5" width="3" height="3" rx="0.6"/>
              <rect x="5.5" y="5.5" width="3" height="3" rx="0.6"/>
              <rect x="10.5" y="5.5" width="3" height="3" rx="0.6"/>
              <rect x="0.5" y="10.5" width="3" height="3" rx="0.6"/>
              <rect x="5.5" y="10.5" width="3" height="3" rx="0.6"/>
              <rect x="10.5" y="10.5" width="3" height="3" rx="0.6"/>
            </svg>
            {historyOpen
              ? t('questify.habitHistoryHide', 'Ocultar historial')
              : t('questify.habitHistory', 'Ver historial')}
          </button>
          <button type="button" role="menuitem" className="quest-row-menu-item" onClick={run(onEdit)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
            </svg>
            {t('questify.edit', 'Editar')}
          </button>
          <button type="button" role="menuitem" className="quest-row-menu-item" onClick={run(onSkip)}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4l5 4-5 4V4z"/><path d="M11 3.5v9"/>
            </svg>
            {skipped
              ? t('questify.habitSkipUndo', 'No saltear hoy')
              : t('questify.habitSkipToday', 'Saltear hoy')}
          </button>
          <button type="button" role="menuitem" className="quest-row-menu-item quest-row-menu-item--danger" onClick={run(onDelete)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
            </svg>
            {t('questify.deleteHabit', 'Eliminar hábito')}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
