/**
 * Arranque del binding Android (spec §3.5): crea el worker, espera `ready`
 * (VFS instalado, DB abierta, migraciones aplicadas) y recién ahí asigna
 * `window.api`. `src/main.tsx` lo espera antes de `createRoot`.
 */
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { buildApi } from '../../shared/build-api';
import { createWorkerClient, type WorkerClient } from './worker-client';
import { createPlatformHost, readOsInfo, OS_INFO_FALLBACK } from './platform-host';

/** Techo para el bridge nativo: `osInfo` es cosmético, el arranque no lo es. */
const OS_INFO_TIMEOUT_MS = 2000;

/**
 * `Device.getInfo()` cruza el bridge de Capacitor: si el plugin no contesta,
 * la promesa nunca resuelve y `installMobileApi()` cuelga ANTES de `ready`, con
 * lo cual `main.tsx` no monta ni <App/> ni <FatalScreen/> (spec §3.5 exige
 * pantalla terminal ante cualquier fallo de arranque). Se corta a los 2 s con
 * el mismo fallback que usa `readOsInfo()` ante un error.
 */
async function readOsInfoOrFallback(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readOsInfo(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[mobile] Device.getInfo no respondió en ${OS_INFO_TIMEOUT_MS}ms`);
          resolve(OS_INFO_FALLBACK);
        }, OS_INFO_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Los únicos canales que un botón de notificación puede disparar.
 *
 * El id de cada acción ES su canal IPC (lo arma
 * `shared-logic/modules/notification-schedule.ts`, CAULDRON_ACTION_*), así que
 * no hace falta tabla de mapeo. Pero `actionId` llega del SISTEMA, y un string
 * arbitrario no entra al transport sin pasar por esta lista.
 *
 * Se declara acá y no se importa de shared-logic a propósito: ese módulo arrastra
 * `../db` y el motor de hábitos, que no tienen nada que hacer en el bundle del
 * hilo UI. El contrato que las mantiene atadas son los nombres de canal, que ya
 * son públicos y estables.
 */
const NOTIFICATION_ACTION_CHANNELS = new Set(['cauldron:pause', 'cauldron:resume', 'cauldron:stop']);

/**
 * Un botón del aviso que no pudo cumplir NO puede terminar en un `console.warn`.
 *
 * El caso que lo motiva: «Reanudar» sobre una pausa que ya venció la ventana de
 * recuperación. El aviso desaparece —el plan del arranque en frío lo retira— y
 * hasta acá no pasaba nada más: ni se reanudaba, ni se avisaba. El usuario
 * apretó un botón y el mundo no se movió.
 *
 * El shell (`src/hub/Layout.tsx`) levanta este evento y lo convierte en algo
 * visible. Es un `CustomEvent` y no una llamada directa porque este módulo corre
 * antes de que React monte: el listener del shell ya está puesto cuando el
 * sistema entrega la acción de un arranque en frío, que es cuando importa.
 */
export const CAULDRON_ACTION_FAILED_EVENT = 'cauldron:actionFailed';

function reportActionFailure(actionId: string, err: unknown): void {
  console.warn(`[mobile] acción de notificación ${actionId} falló`, err);
  try {
    window.dispatchEvent(
      new CustomEvent(CAULDRON_ACTION_FAILED_EVENT, { detail: { actionId } }),
    );
  } catch {
    /* sin CustomEvent no hay nada mejor que el warn de arriba */
  }
}

let currentClient: WorkerClient | null = null;

/**
 * El cliente del worker desde que se crea — también si `ready` falló (fatal de
 * migración): FatalScreen lo usa para exportar el .db antes de reiniciar.
 */
export function getWorkerClient(): WorkerClient | null {
  return currentClient;
}

export async function installMobileApi(): Promise<void> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'hubtify-logic',
  });

  const client = createWorkerClient(worker, createPlatformHost(), {
    onCrash: (err) => {
      console.error('[mobile] worker crashed:', err.message);
      // App.tsx lo escucha y muestra FatalScreen (sin recrear el worker).
      window.dispatchEvent(new CustomEvent('mobile:workerCrashed', { detail: err.message }));
    },
  });
  currentClient = client;

  // `init` sale ANTES de esperar ready: el orden de mensajes garantiza que el
  // worker lo tenga antes de cualquier invoke.
  client.init({ appVersion: APP_VERSION, osInfo: await readOsInfoOrFallback() });
  await client.ready;

  // `buildApi(transport, 'mobile')` ya omite los canales desktop-only de
  // API_CHANNELS (spec §3.1): quedan `undefined` en `window.api`, y HubtifyApi
  // los declara opcionales.
  window.api = buildApi(client.transport, 'mobile');

  // Segundo plano: runSuspend → closeDb → pauseVfs en el worker; al volver,
  // unpauseVfs → getDb → runResume. Los invokes del medio quedan en cola.
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) client.resume();
    else client.suspend();
  });

  // Botones de la notificación persistente del Caldero (Pausar/Reanudar/Detener).
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId }) => {
      // 'tap' en Android es el CUERPO de la notificación, no un botón: el default
      // es abrir la app y nada más. Invocar algo acá sería detener el caldero por
      // tocar el aviso para mirarlo.
      if (!NOTIFICATION_ACTION_CHANNELS.has(actionId)) return;
      try {
        // No se espera nada antes de invocar, y no hace falta: si el botón se
        // apretó con la app en segundo plano, el cliente todavía está suspendido
        // y `transport.invoke` DEJA EL MENSAJE EN COLA (worker-client.ts). Android
        // despierta la app, `appStateChange(isActive:true)` llama a
        // `client.resume()` y ahí se drena. Este listener puede correr ANTES de
        // ese resume — la cola es exactamente lo que cubre esa carrera.
        void client.transport.invoke(actionId).catch((err) => {
          reportActionFailure(actionId, err);
        });
      } catch (err) {
        reportActionFailure(actionId, err);
      }
    });
  } catch (err) {
    // Sin este listener los botones no hacen nada, pero la app arranca igual.
    console.warn('[mobile] no se pudo escuchar las acciones de notificación', err);
  }

  // El WebView se descarta: soltar los handles del VFS para que la próxima
  // instancia no encuentre el pool "in use".
  window.addEventListener('pagehide', () => worker.terminate());
}
