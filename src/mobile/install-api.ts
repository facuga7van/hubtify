/**
 * Arranque del binding Android (spec §3.5): crea el worker, espera `ready`
 * (VFS instalado, DB abierta, migraciones aplicadas) y recién ahí asigna
 * `window.api`. `src/main.tsx` lo espera antes de `createRoot`.
 */
import { App } from '@capacitor/app';
import { buildApi } from '../../shared/build-api';
import { createWorkerClient } from './worker-client';
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

  // El WebView se descarta: soltar los handles del VFS para que la próxima
  // instancia no encuentre el pool "in use".
  window.addEventListener('pagehide', () => worker.terminate());
}
