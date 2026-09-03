/**
 * Eventos de window con el ciclo de vida de la app nativa.
 *
 * `native-shell.ts` (Android) los emite desde `App.addListener('appStateChange')`
 * y el resto de la app los escucha. Viven acá, y no en `src/mobile/`, a
 * propósito: `native-shell.ts` importa `@capacitor/app`, y que Layout importara
 * de ahí metería el plugin nativo en el bundle de escritorio.
 *
 * Por qué existen: en el WebView de Android, tapar la app con otra Activity NO
 * dispara `blur` en window ni `visibilitychange` en document (ver el comentario
 * de `src/mobile/AndroidUpdateBanner.tsx`). Sin estos dos eventos, la sync
 * diferida se pierde entera cuando el sistema mata el proceso.
 */

/** La app volvió al frente (equivalente nativo de `focus`). */
export const APP_FOREGROUND_EVENT = 'hubtify:appForeground';

/** La app se fue a segundo plano (equivalente nativo de `blur`). */
export const APP_BACKGROUND_EVENT = 'hubtify:appBackground';
