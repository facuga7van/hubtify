import { useEffect } from 'react';

interface Options {
  open: boolean;
  /** The portaled `role="menu"` element. */
  popupRef: React.RefObject<HTMLElement | null>;
  /** The wrapper around the trigger button — focus goes back there on close. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const TEXT_FIELD = 'input, select, textarea, [contenteditable="true"]';

function itemsOf(popup: HTMLElement): HTMLElement[] {
  return Array.from(popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/**
 * Keyboard contract for the portaled `role="menu"` popups (row actions,
 * postpone, habit row).
 *
 * The menus used to open with focus still on the trigger: Tab went to the next
 * control in the row and the items were only reachable by tabbing to the very
 * end of the document. Now, on open, focus lands on the first item; Up / Down
 * cycle, Home / End jump, Escape and Tab close; and when the menu goes away the
 * trigger gets focus back — unless the user clicked somewhere else, in which
 * case stealing focus from what they clicked would be worse.
 *
 * Arrow keys inside a text field (the postpone date picker lives in the menu)
 * are left to the field.
 */
export function useMenuKeyboard({ open, popupRef, anchorRef, onClose }: Options): void {
  useEffect(() => {
    if (!open) return;

    // Captured now: by cleanup time the popup is unmounted and the ref is null.
    const popupAtOpen = popupRef.current;
    const anchorAtOpen = anchorRef.current;

    // Runs after useAnchoredPopup's layout effect positioned the popup, so the
    // browser has nothing off-screen to scroll to; preventScroll is belt and braces.
    const first = popupAtOpen ? itemsOf(popupAtOpen)[0] : undefined;
    first?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const popup = popupRef.current;
      if (!popup) return;
      const target = e.target as HTMLElement | null;
      const inside = !!target && popup.contains(target);

      if (e.key === 'Tab') {
        // Closing first puts focus back on the trigger; the default Tab then
        // moves on from there, which is exactly where the user expects to land.
        if (inside) onClose();
        return;
      }
      if (!inside || target?.closest(TEXT_FIELD)) return;

      const items = itemsOf(popup);
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      switch (e.key) {
        case 'ArrowDown': next = index < 0 ? 0 : (index + 1) % items.length; break;
        case 'ArrowUp': next = index <= 0 ? items.length - 1 : index - 1; break;
        case 'Home': next = 0; break;
        case 'End': next = items.length - 1; break;
        default: return;
      }
      e.preventDefault();
      items[next].focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // The popup is unmounting (or gone already): if focus was inside it, it
      // has fallen back to <body>. Only then does the trigger reclaim it.
      const active = document.activeElement;
      const lost = !active || active === document.body || !!popupAtOpen?.contains(active);
      if (lost) anchorAtOpen?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    };
  }, [open, popupRef, anchorRef, onClose]);
}

export default useMenuKeyboard;
