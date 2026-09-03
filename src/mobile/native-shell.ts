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
import { hasOpenDialog, closeTopDialog, hasOpenPopover, closeTopPopover } from './dialog-dom';
import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../shared/app-lifecycle-events';

export { hasOpenDialog, closeTopDialog, hasOpenPopover, closeTopPopover };

/** Devuelve la función que suelta los listeners (MobileShell la llama al desmontar). */
export async function bindNativeShell(): Promise<() => void> {
  const back = await App.addListener('backButton', ({ canGoBack }) => {
    handleBackButton({
      openPopover: hasOpenPopover(),
      closePopover: () => { closeTopPopover(); },
      openDialog: hasOpenDialog(),
      closeDialog: closeTopDialog,
      canGoBack,
      goBack: () => window.history.back(),
      minimize: () => { void App.minimizeApp(); },
    });
  });

  /* Ciclo de vida → sync. `blur`/`focus` de window NO llegan cuando otra
     Activity tapa el WebView (mismo hallazgo que AndroidUpdateBanner.tsx:70-75),
     así que el push diferido moría con el proceso y el pull al volver no
     ocurría nunca: con las dos apps abiertas y quietas, el dato no cruzaba.
     Acá no hay lógica de sync a propósito — se emiten dos eventos de window y
     Layout decide, para no importar `src/shared/sync` desde el shell nativo. */
  const state = await App.addListener('appStateChange', ({ isActive }) => {
    window.dispatchEvent(new Event(isActive ? APP_FOREGROUND_EVENT : APP_BACKGROUND_EVENT));
  });

  return () => {
    void back.remove();
    void state.remove();
  };
}
