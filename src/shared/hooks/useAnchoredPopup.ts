import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface AnchoredPopupPos {
  top: number;
  left: number;
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
 * Usage:
 *   const { anchorRef, popupRef, pos } = useAnchoredPopup(open);
 *   <div ref={anchorRef}>…trigger…</div>
 *   {open && createPortal(
 *      <div ref={popupRef} style={{ position:'fixed', top: pos.top, left: pos.left }}/>,
 *      document.body)}
 */
export function useAnchoredPopup<A extends HTMLElement = HTMLDivElement, P extends HTMLElement = HTMLDivElement>(
  open: boolean,
  gap = 4,
) {
  const anchorRef = useRef<A>(null);
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

    let left = r.left;
    if (left + pw > vw - edge) left = vw - pw - edge;
    if (left < edge) left = edge;

    setPos({ top, left });
  }, [gap]);

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

  return { anchorRef, popupRef, pos, reposition };
}

export default useAnchoredPopup;
