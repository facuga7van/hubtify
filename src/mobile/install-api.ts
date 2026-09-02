/**
 * Arranque del binding Android (spec §3.5): crea el worker, espera `ready`
 * (VFS instalado, DB abierta, migraciones aplicadas) y recién ahí asigna
 * `window.api`. `src/main.tsx` lo espera antes de `createRoot`.
 */
import { App } from '@capacitor/app';
import { buildApi } from '../../shared/build-api';
import { createWorkerClient } from './worker-client';
import { createPlatformHost, readOsInfo } from './platform-host';

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
  client.init({ appVersion: APP_VERSION, osInfo: await readOsInfo() });
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
