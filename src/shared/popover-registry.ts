/**
 * Pila de popovers abiertos (menús de fila, dropdown de cuenta, pickers de
 * fecha, sugerencias): lo que NO es un diálogo modal pero igual «está abierto»
 * y tiene que cerrarse antes de que el botón atrás de Android navegue.
 *
 * Los modales ya se descubren solos por el DOM (`[role="dialog"][aria-modal]`,
 * dialog-dom.ts); los popovers no tienen un contrato de DOM común y cada uno
 * cierra distinto (Escape en window, Escape en document, blur), así que acá
 * se anota un callback de cierre por popover abierto. Cerrar el de más arriba
 * es llamar a UN callback: un Escape sintético cerraría también al modal que
 * lo contiene (los dos escuchan keydown en window).
 *
 * Sin DOM ni React a propósito: se testea en Node (tests/mobile).
 */
type CloseFn = () => void;

const stack: CloseFn[] = [];

/** Anota un popover abierto. Devuelve la función que lo desanota (al cerrar/desmontar). */
export function registerOpenPopover(close: CloseFn): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i !== -1) stack.splice(i, 1);
  };
}

export function hasOpenPopover(): boolean {
  return stack.length > 0;
}

/**
 * Cierra el popover abierto más reciente. `false` si no había ninguno.
 * Se desanota ANTES de llamarlo: el cierre real es un setState y su cleanup
 * llega en el próximo render; si el callback no cerrara nada, un Atrás
 * repetido navega en vez de quedarse trabado en una entrada muerta.
 */
export function closeTopPopover(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/** Solo para tests: vacía la pila. */
export function resetPopoverRegistry(): void {
  stack.length = 0;
}
