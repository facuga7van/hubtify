/**
 * Botón «atrás» de Android (spec §7): primero cierra lo que esté abierto
 * (drawer o modal), si no hay nada vuelve en el historial, y en la raíz
 * minimiza la app. Es pura a propósito —se testea en Node—; el cableado con
 * @capacitor/app y el DOM vive en native-shell.ts.
 */
export interface BackContext {
  /** Hay un diálogo modal abierto (el drawer incluido). */
  openDialog: boolean;
  /** Cierra el diálogo de más arriba. */
  closeDialog(): void;
  /** `canGoBack` del evento backButton de Capacitor (historial del WebView). */
  canGoBack: boolean;
  goBack(): void;
  minimize(): void;
}

export type BackOutcome = 'dialog' | 'history' | 'minimize';

export function handleBackButton(ctx: BackContext): BackOutcome {
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
