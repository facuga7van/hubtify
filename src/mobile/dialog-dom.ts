/**
 * Las dos consultas al DOM que usa el botón atrás de Android, separadas de
 * `native-shell.ts` porque ese archivo importa `@capacitor/app`: cargarlo
 * define `globalThis.Capacitor` con `isNativePlatform() === false`, y eso
 * volvería `false` a `isNativeMobile()` en todo el arnés browser-mobile. Acá
 * no hay import nativo, así que se pueden testear en el navegador.
 */

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
