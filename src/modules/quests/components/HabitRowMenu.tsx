import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';

interface Props {
  /** Today already carries a 'skip' row — the menu offers to undo it. */
  skipped: boolean;
  onEdit: () => void;
  onSkip: () => void;
  onDelete: () => void;
}

/**
 * Overflow menu for a habit row: edit, skip today, delete.
 *
 * "Skip today" needs a home that is not a fourth 14px icon competing with the
 * tick, so the two existing icon buttons moved in here with it. Same portaled
 * pattern as QuestRowActions — a row with overflow hidden must not clip it.
 */
export default function HabitRowMenu({ skipped, onEdit, onSkip, onDelete }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { anchorRef, popupRef, pos } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
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
