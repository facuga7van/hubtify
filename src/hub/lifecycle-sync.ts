import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../shared/app-lifecycle-events';

export interface LifecycleSyncHandlers {
  /** La app deja de estar al frente: subir YA lo que esté pendiente. */
  onEnterBackground: () => void;
  /** La app vuelve al frente: bajar lo que haya escrito el otro dispositivo. */
  onEnterForeground: () => void;
}

/**
 * Las dos vías por las que la app «se va» y «vuelve», unificadas:
 *
 *  - escritorio: `blur` / `focus` de window
 *  - Android: `appStateChange` de @capacitor/app, que native-shell.ts traduce a
 *    APP_BACKGROUND_EVENT / APP_FOREGROUND_EVENT (ver app-lifecycle-events.ts)
 *
 * Es el MISMO handler para las dos: el throttle, la generación de sync y el
 * orden pull→push viven una sola vez, en Layout. Puro y con el target
 * inyectado para poder testearlo en Node.
 */
export function bindLifecycleSync(target: EventTarget, handlers: LifecycleSyncHandlers): () => void {
  const onBackground = () => handlers.onEnterBackground();
  const onForeground = () => handlers.onEnterForeground();

  target.addEventListener('blur', onBackground);
  target.addEventListener(APP_BACKGROUND_EVENT, onBackground);
  target.addEventListener('focus', onForeground);
  target.addEventListener(APP_FOREGROUND_EVENT, onForeground);

  return () => {
    target.removeEventListener('blur', onBackground);
    target.removeEventListener(APP_BACKGROUND_EVENT, onBackground);
    target.removeEventListener('focus', onForeground);
    target.removeEventListener(APP_FOREGROUND_EVENT, onForeground);
  };
}
