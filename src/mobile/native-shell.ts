/**
 * Cableado nativo del shell Android (spec §7). Lo importa MobileShell de
 * forma dinámica y SOLO con el bridge de Capacitor presente: ni el bundle
 * desktop ni el arnés browser-mobile cargan @capacitor/app.
 *
 * Barra de estado: no hay llamadas en runtime. Con targetSdk 36 (template de
 * Capacitor 8) `StatusBar.setBackgroundColor` / `setOverlaysWebView` no
 * hacen nada (README de @capacitor/status-bar, «Android 16+ behavior
 * change»). El plugin core SystemBars decide: con WebView >= 140 la barra
 * superpone al WebView e inyecta --safe-area-inset-top (la cabecera pinta
 * cuero debajo con --safe-top); con WebView < 140 el contenido arranca bajo
 * la barra y la franja muestra windowBackground (styles.xml, cuero). El
 * estilo de los iconos (claros) va en capacitor.config.ts.
 */
import { App } from '@capacitor/app';
import { handleBackButton } from './back-button';

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

/** Devuelve la función que suelta el listener (MobileShell la llama al desmontar). */
export async function bindNativeShell(): Promise<() => void> {
  const handle = await App.addListener('backButton', ({ canGoBack }) => {
    handleBackButton({
      openDialog: hasOpenDialog(),
      closeDialog: closeTopDialog,
      canGoBack,
      goBack: () => window.history.back(),
      minimize: () => { void App.minimizeApp(); },
    });
  });
  return () => { void handle.remove(); };
}
