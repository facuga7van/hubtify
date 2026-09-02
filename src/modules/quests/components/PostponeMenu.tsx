import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import { useMenuKeyboard } from './useMenuKeyboard';
import RpgDateTimePicker from '../../../shared/components/RpgDateTimePicker';

interface Props {
  /** Receives 'today' | 'tomorrow' | 'YYYY-MM-DDTHH:mm'. */
  onPick: (target: string) => void;
  /** Trigger content (an icon, a label…). */
  children: React.ReactNode;
  className?: string;
  title: string;
  disabled?: boolean;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function tomorrowAtNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

/**
 * The Today / Tomorrow / pick-a-date choices themselves, without a trigger.
 *
 * Split out so the hover shortcut, the row overflow menu and the batch bar all
 * offer literally the same three options instead of three drifting copies.
 */
export function PostponeOptions({ onPick }: { onPick: (target: string) => void }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState('');

  const choose = (target: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onPick(target);
  };

  if (picking) {
    return (
      <div className="quest-postpone-pick">
        <RpgDateTimePicker value={custom} onChange={setCustom} />
        <button
          type="button"
          className="qb-rune qb-rune--sage quest-rune-btn"
          onClick={choose(custom || tomorrowAtNine())}
        >
          {t('questify.postpone', 'Posponer')}
        </button>
      </div>
    );
  }

  return (
    <>
      <button type="button" role="menuitem" className="quest-row-menu-item" onClick={choose('today')}>
        {t('questify.postponeToday', 'Hoy')}
      </button>
      <button type="button" role="menuitem" className="quest-row-menu-item" onClick={choose('tomorrow')}>
        {t('questify.postponeTomorrow', 'Mañana')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="quest-row-menu-item"
        onClick={(e) => { e.stopPropagation(); setCustom(custom || tomorrowAtNine()); setPicking(true); }}
      >
        {t('questify.postponePick', 'Elegir fecha')}
      </button>
    </>
  );
}

/**
 * The one-click reschedule: Today / Tomorrow / pick a date.
 *
 * Rescheduling is deliberately a two-tap action with no confirmation and no
 * cost — the "Overdue" pile only ever grows while moving one item costs more
 * effort than ignoring the whole group.
 *
 * The trigger and the popup travel together so the same control can sit in a
 * hover row, in an overflow menu, or in the batch bar.
 */
export default function PostponeMenu({ onPick, children, className, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  // Portaled so a row with overflow hidden can never clip it.
  const closeMenu = useCallback(() => setOpen(false), []);
  const { anchorRef, popupRef, pos } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>(open, 4, { onClose: closeMenu });
  // Focus into the menu, arrow keys, Escape/Tab, focus back to the trigger.
  useMenuKeyboard({ open, popupRef, anchorRef, onClose: closeMenu });

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // The date picker renders its own calendar into a second portal; a click
      // in there is still a click "inside" this menu.
      if (target.closest?.('.rpg-anchored-popup')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, anchorRef, popupRef]);

  return (
    <>
      <div ref={anchorRef} style={{ display: 'inline-flex' }}>
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={title}
          title={title}
        >
          {children}
        </button>
      </div>

      {open && createPortal(
        <div
          ref={popupRef}
          role="menu"
          className="quest-row-menu quest-postpone-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <PostponeOptions onPick={(target) => { setOpen(false); onPick(target); }} />
        </div>,
        document.body,
      )}
    </>
  );
}
