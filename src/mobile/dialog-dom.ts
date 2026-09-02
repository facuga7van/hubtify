/**
 * Las consultas que usa el botón atrás de Android para saber qué hay abierto,
 * separadas de `native-shell.ts` porque ese archivo importa `@capacitor/app`:
 * cargarlo define `globalThis.Capacitor` con `isNativePlatform() === false`, y
 * eso volvería `false` a `isNativeMobile()` en todo el arnés browser-mobile.
 * Acá no hay import nativo, así que se pueden testear en el navegador.
 *
 * Dos capas, en este orden:
 *  1. Popovers (menús de fila, dropdown de cuenta, pickers, sugerencias): no
 *     tienen contrato de DOM común, así que se anotan en popover-registry.ts
 *     (useAnchoredPopup lo hace solo) y se cierran por callback.
 *  2. Diálogos modales: todos pasan por useModalA11y (role + aria-modal) y se
 *     cierran con un Escape en window, que solo atiende el de más arriba.
 */
export { hasOpenPopover, closeTopPopover } from '../shared/popover-registry';

/** Un modal abierto: todos pasan por useModalA11y (role + aria-modal); el drawer cerrado lleva `inert`. */
const OPEN_DIALOG =
  '[role="dialog"][aria-modal="true"]:not([inert]), [role="alertdialog"][aria-modal="true"]:not([inert])';

export function hasOpenDialog(root: ParentNode = document): boolean {
  return root.querySelector(OPEN_DIALOG) !== null;
}

/** useModalA11y escucha keydown en window y solo reacciona el diálogo de más arriba. */
export function closeTopDialog(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
