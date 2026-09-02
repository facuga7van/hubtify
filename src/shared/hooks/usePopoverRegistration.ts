import { useEffect, useRef } from 'react';
import { registerOpenPopover } from '../popover-registry';

/**
 * Anota el popover en la pila de popovers abiertos (popover-registry.ts)
 * mientras `open` sea true. `useAnchoredPopup` lo hace solo; este hook es para
 * los popovers que no se posicionan con él (el menú del registro de Nutrify).
 *
 * `onClose` va por ref: cambiar de identidad no re-anota el popover.
 */
export function usePopoverRegistration(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    return registerOpenPopover(() => onCloseRef.current());
  }, [open]);
}

export default usePopoverRegistration;
