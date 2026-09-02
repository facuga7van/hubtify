/**
 * Lado UI del `PlatformPort` (spec §6, columna «Mobile»). El worker manda
 * `{ type:'platform', method, args }` (worker-client.ts lo despacha acá) y
 * esto lo resuelve con plugins de Capacitor:
 *
 *   notify          → @capacitor/local-notifications (schedule inmediato)
 *   openExternal    → @capacitor/browser
 *   saveTextFile /
 *   saveBinaryFile  → @capacitor/filesystem (Directory.Cache) + @capacitor/share
 *   pickTextFile /
 *   pickBinaryFile  → <input type="file"> (file-picker.ts)
 *   pickPdfText     → { unsupported: true } (sin pdf-parse; spec §1)
 *
 * `appVersion()` y `osInfo()` son síncronos en la interfaz y no pueden hacer
 * round-trip: la UI los manda una vez con `{ type:'init' }` (install-api.ts).
 */
import { Browser } from '@capacitor/browser';
import { Device } from '@capacitor/device';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import type { FileFilter } from '@logic/platform';
import { pickFile } from './file-picker';
import { acceptFor, bytesToBase64, notificationIdFor } from './host-utils';
import type { PlatformHostFns } from './worker-client';

export const NOTIFICATION_CHANNEL_ID = 'hubtify';
/** Subcarpeta de Directory.Cache; el FileProvider del template permite todo el cache. */
const SHARE_DIR = 'share';

/** Lo importa install-api.ts (Fase 2) para el timeout de `readOsInfo`. */
export const OS_INFO_FALLBACK = 'android';

export async function readOsInfo(): Promise<string> {
  try {
    const info = await Device.getInfo();
    return `${info.platform} ${info.osVersion}`;
  } catch (err) {
    console.warn('[mobile] Device.getInfo falló:', err);
    return OS_INFO_FALLBACK;
  }
}

/** El plugin rechaza con "Share canceled" cuando el usuario cierra el share sheet. */
export function isShareCanceled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(message);
}

export interface PlatformHostDeps {
  pickFile: (accept: string) => Promise<File | null>;
}

export function createPlatformHost(deps: PlatformHostDeps = { pickFile }): PlatformHostFns {
  // Android 13+ pide POST_NOTIFICATIONS en runtime. Se pregunta una vez por
  // sesión; si el usuario dice que no, no se insiste hasta el próximo arranque.
  let permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  let channelReady = false;

  async function notificationsReady(): Promise<boolean> {
    if (permission === 'unknown') {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
      permission = status.display === 'granted' ? 'granted' : 'denied';
    }
    if (permission !== 'granted') return false;
    if (!channelReady) {
      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Hubtify',
        description: 'Recordatorios, rachas y Cauldron',
        importance: 4,
      });
      channelReady = true;
    }
    return true;
  }

  async function writeAndShare(name: string, data: string, encoding?: Encoding): Promise<boolean> {
    const { uri } = await Filesystem.writeFile({
      path: `${SHARE_DIR}/${name}`,
      data,
      directory: Directory.Cache,
      recursive: true,
      ...(encoding ? { encoding } : {}),
    });
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: name });
      return true;
    } catch (err) {
      if (isShareCanceled(err)) return false;
      throw err;
    } finally {
      // Cache/share es solo el staging del share sheet: para cuando `share`
      // vuelve, el destino ya copió el archivo. Sin este borrado quedaría un
      // .db entero por cada export acumulándose en el cache de la app.
      await Filesystem.deleteFile({ path: `${SHARE_DIR}/${name}`, directory: Directory.Cache })
        .catch(() => { /* el archivo es descartable: si no se pudo borrar, no cambia nada */ });
    }
  }

  return {
    // Nunca rechaza: los callers son fire-and-forget (`void platform().notify(…)`
    // en notifications.ipc.ts y cauldron.ipc.ts), así que un reject sería un
    // unhandled rejection en el worker. Una notificación no vale ese precio.
    async notify(n: { title: string; body: string; tag?: string }) {
      try {
        if (!(await notificationsReady())) return;
        await LocalNotifications.schedule({
          // `isExactNotification: false` NO es cosmético: el plugin lo asume
          // `true` y entonces, en Android 12+ sin SCHEDULE_EXACT_ALARM, en vez de
          // notificar abre la pantalla de sistema «Alarmas y recordatorios» y deja
          // la promesa colgada hasta que el usuario vuelve. Ninguna notificación
          // de Hubtify lleva `schedule`: todas son inmediatas y no usan alarma.
          notifications: [{ id: notificationIdFor(n.tag), title: n.title, body: n.body, channelId: NOTIFICATION_CHANNEL_ID, isExactNotification: false }],
        });
      } catch (err) {
        console.warn('[platform-host] notify failed', err);
      }
    },

    async openExternal(url: string) {
      await Browser.open({ url });
    },

    async pickTextFile(filters: FileFilter[]) {
      const file = await deps.pickFile(acceptFor(filters));
      if (!file) return null;
      return { name: file.name, content: await file.text() };
    },

    // Import de resúmenes PDF: fuera de alcance en mobile (spec §1). El handler
    // de finance-import responde { ok:false, reason:'unsupported_platform' }.
    async pickPdfText() {
      return { unsupported: true as const };
    },

    async pickBinaryFile(filters: FileFilter[]) {
      const file = await deps.pickFile(acceptFor(filters));
      if (!file) return null;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },

    async saveTextFile(name: string, content: string) {
      return writeAndShare(name, content, Encoding.UTF8);
    },

    async saveBinaryFile(name: string, bytes: Uint8Array) {
      return writeAndShare(name, bytesToBase64(bytes));
    },
  };
}
