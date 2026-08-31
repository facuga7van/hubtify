import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Stack of currently-active modals, innermost last.
 *
 * Without this, every mounted instance attaches its own window-level keydown
 * listener, so a `useConfirm()` opened on top of a modal fights the modal
 * underneath for Escape and for the Tab trap — the focus ends up bouncing back
 * to the lower dialog and you cannot Tab between Cancel and Confirm.
 * Only the topmost entry reacts.
 */
const modalStack: symbol[] = [];

function isTopmost(id: symbol): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id;
}

export interface ModalA11yOptions {
  /** Called on Escape. Keep it stable (useCallback) or just inline — it is ref-tracked. */
  onClose?: () => void;
  /** Set false while the modal is not shown (for providers that stay mounted). */
  active?: boolean;
  /** ARIA role; use 'alertdialog' for confirmations. */
  role?: 'dialog' | 'alertdialog';
}

/**
 * Accessibility plumbing every modal in the app needs:
 *  - Tab / Shift+Tab focus trap (no tabbing out to the page behind)
 *  - Escape closes (window-level listener)
 *  - focus moves into the dialog on open
 *  - focus returns to whatever opened the modal on close/unmount
 *
 * Usage:
 *   const { dialogProps } = useModalA11y({ onClose });
 *   <div className="overlay" onClick={onClose}>
 *     <div {...dialogProps} aria-labelledby="my-title" onClick={e => e.stopPropagation()}>…</div>
 *   </div>
 *
 * For a provider that renders its dialog conditionally while staying mounted,
 * pass `active`:  useModalA11y({ onClose, active: state?.visible ?? false })
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>({
  onClose,
  active = true,
  role = 'dialog',
}: ModalA11yOptions = {}) {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const restoreRef = useRef<HTMLElement | null>(null);
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('modal');
  useEffect(() => { onCloseRef.current = onClose; });

  // Register in the stack while active, so only the innermost modal reacts.
  useEffect(() => {
    if (!active) return;
    const id = idRef.current as symbol;
    modalStack.push(id);
    return () => {
      const i = modalStack.lastIndexOf(id);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, [active]);

  // Remember the opener and give it focus back when the modal goes away.
  useEffect(() => {
    if (!active) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const el = restoreRef.current;
      restoreRef.current = null;
      if (el && document.contains(el)) el.focus?.();
    };
  }, [active]);

  // Move focus into the dialog on open.
  useEffect(() => {
    if (!active) return;
    const root = containerRef.current;
    if (!root) return;
    const first = focusableIn(root)[0];
    (first ?? root).focus();
  }, [active]);

  // Escape to close + Tab trap.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal below the topmost one must stay out of the way entirely.
      if (!isTopmost(idRef.current as symbol)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      const inside = root.contains(activeEl);
      if (e.shiftKey) {
        if (!inside || activeEl === first) { e.preventDefault(); last.focus(); }
      } else if (!inside || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  /** Stops a click inside the dialog from reaching a backdrop onClick. */
  const stopPropagation = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  return {
    containerRef,
    stopPropagation,
    /** Spread onto the dialog element. */
    dialogProps: {
      ref: containerRef,
      role,
      'aria-modal': true as const,
      tabIndex: -1,
    },
  };
}

export default useModalA11y;
