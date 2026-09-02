import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerOpenPopover } from '../popover-registry';

export interface AnchoredPopupPos {
  top: number;
  left: number;
}

export interface AnchoredPopupOptions<A extends HTMLElement = HTMLElement> {
  /**
   * Cierra el popup. Lo llama el botón atrás de Android (popover-registry.ts)
   * cuando este popup es el abierto de más arriba. Sin él se despacha un
   * Escape desde el propio popup (burbujea a document y window), que es lo
   * que todos los consumidores ya escuchan.
   */
  onClose?: () => void;
  /** Ancla externa, para un disparador que vive en otro componente (AccountDropdown). */
  anchorRef?: React.RefObject<A | null>;
  /**
   * Borde del ancla al que se alinea el popup: `start` = borde izquierdo (por
   * defecto), `end` = borde derecho, para un disparador pegado al margen
   * derecho de su contenedor. En los dos casos se sujeta al viewport.
   */
  align?: 'start' | 'end';
}

/**
 * Positions a popup that is rendered into a portal (`document.body`) against a
 * trigger element, using the trigger's bounding rect.
 *
 * Why a portal: several forms are `overflow: hidden` (quest form, Coinify quick
 * add), so an `position: absolute` popup rendered inside them is clipped away
 * entirely — the user toggles "due date" and simply sees nothing.
 *
 * Same pattern already used by HelpBubble and Tooltip.
 *
 * While open, the popup is also registered as an open popover
 * (popover-registry.ts) and its root carries `data-popover-open`: that is what
 * lets the Android back button close it instead of navigating away.
 *
 * Usage:
 *   const { anchorRef, popupRef, pos } = useAnchoredPopup(open, 4, { onClose });
 *   <div ref={anchorRef}>…trigger…</div>
 *   {open && createPortal(
 *      <div ref={popupRef} style={{ position:'fixed', top: pos.top, left: pos.left }}/>,
 *      document.body)}
 */
export function useAnchoredPopup<A extends HTMLElement = HTMLDivElement, P extends HTMLElement = HTMLDivElement>(
  open: boolean,
  gap = 4,
  options: AnchoredPopupOptions<A> = {},
) {
  const { onClose, anchorRef: externalAnchorRef, align = 'start' } = options;
  const ownAnchorRef = useRef<A>(null);
  const anchorRef = externalAnchorRef ?? ownAnchorRef;
  const popupRef = useRef<P>(null);
  // Off-screen until measured, so the first paint never flashes at 0,0.
  const [pos, setPos] = useState<AnchoredPopupPos>({ top: -9999, left: -9999 });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;
    const r = anchor.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const edge = 8;

    let top = r.bottom + gap;
    if (top + ph > vh - edge) {
      /*
       * Voltear hacia arriba SÓLO si arriba entra entero.
       *
       * Antes se miraba únicamente el borde superior (`above >= edge`): con un
       * disparador por debajo del pliegue el popup se colocaba arriba y se
       * salía por abajo. Medido con el picker de misión del Caldero: ancla en
       * y=755 con ventana de 640 lo dejaba terminando en 731, y como es
       * `position: fixed` no scrollea — las últimas opciones quedaban
       * literalmente inalcanzables. Si no entra ni abajo ni arriba, se sujeta
       * al viewport, que al menos deja ver el principio.
       */
      const above = r.top - ph - gap;
      const fitsAbove = above >= edge && above + ph <= vh - edge;
      top = fitsAbove ? above : Math.max(edge, vh - ph - edge);
    }

    let left = align === 'end' ? r.right - pw : r.left;
    if (left + pw > vw - edge) left = vw - pw - edge;
    if (left < edge) left = edge;

    setPos({ top, left });
  }, [gap, align, anchorRef]);

  useLayoutEffect(() => {
    if (open) reposition();
    else setPos({ top: -9999, left: -9999 });
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const handler = () => requestAnimationFrame(reposition);
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, reposition]);

  // Anotado como popover abierto mientras dure `open` (botón atrás de Android).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    popup?.setAttribute('data-popover-open', '');
    const off = registerOpenPopover(() => {
      const close = onCloseRef.current;
      if (close) { close(); return; }
      (popupRef.current ?? window).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    return () => {
      off();
      popup?.removeAttribute('data-popover-open');
    };
  }, [open]);

  return { anchorRef, popupRef, pos, reposition };
}

export default useAnchoredPopup;
