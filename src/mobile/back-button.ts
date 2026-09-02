/**
 * Botón «atrás» de Android (spec §7): primero cierra lo que esté abierto
 * (popover, después drawer o modal), si no hay nada vuelve en el historial, y
 * en la raíz minimiza la app. Es pura a propósito —se testea en Node—; el
 * cableado con @capacitor/app y el DOM vive en native-shell.ts.
 */
export interface BackContext {
  /** Hay un popover abierto (menú de fila, dropdown de cuenta, picker): popover-registry.ts. */
  openPopover: boolean;
  /** Cierra el popover de más arriba. */
  closePopover(): void;
  /** Hay un diálogo modal abierto (el drawer incluido). */
  openDialog: boolean;
  /** Cierra el diálogo de más arriba. */
  closeDialog(): void;
  /** `canGoBack` del evento backButton de Capacitor (historial del WebView). */
  canGoBack: boolean;
  goBack(): void;
  minimize(): void;
}

export type BackOutcome = 'popover' | 'dialog' | 'history' | 'minimize';

export function handleBackButton(ctx: BackContext): BackOutcome {
  // Un menú abierto dentro de un modal se cierra solo él: el modal espera al
  // siguiente Atrás.
  if (ctx.openPopover) {
    ctx.closePopover();
    return 'popover';
  }
  if (ctx.openDialog) {
    ctx.closeDialog();
    return 'dialog';
  }
  if (ctx.canGoBack) {
    ctx.goBack();
    return 'history';
  }
  ctx.minimize();
  return 'minimize';
}
