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
import type { FileFilter, NotificationPlan } from '@logic/platform';
import { markVirtualDevice } from '../shared/platform-detect';
import { pickFile } from './file-picker';
import { acceptFor, bytesToBase64, notificationIdFor } from './host-utils';
import type { PlatformHostFns } from './worker-client';

export const NOTIFICATION_CHANNEL_ID = 'hubtify';
/**
 * Canal aparte para el aviso persistente del Caldero: importancia baja (2 =
 * IMPORTANCE_LOW), sin sonido ni heads-up. Con el canal normal (4), cada vez que
 * se reprograma el aviso «hay una poción al fuego» saltaría un cartel encima de
 * lo que estés haciendo.
 */
export const ONGOING_CHANNEL_ID = 'hubtify-ongoing';
/** Subcarpeta de Directory.Cache; el FileProvider del template permite todo el cache. */
const SHARE_DIR = 'share';

/** Lo importa install-api.ts (Fase 2) para el timeout de `readOsInfo`. */
export const OS_INFO_FALLBACK = 'android';

export async function readOsInfo(): Promise<string> {
  try {
    const info = await Device.getInfo();
    // De paso: el emulador rasteriza por software y no aguanta las animaciones
    // continuas del Caldero (CAU-03). Este es el único lugar donde ya cruzamos
    // el bridge al arrancar, así que el flag sale gratis.
    markVirtualDevice(info.isVirtual === true);
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
      await LocalNotifications.createChannel({
        id: ONGOING_CHANNEL_ID,
        name: 'Caldero en curso',
        description: 'Aviso persistente mientras hay una sesión al fuego',
        importance: 2,
      });
      channelReady = true;
    }
    return true;
  }

  /**
   * ¿Puede la app usar alarmas EXACTAS ahora mismo (`SCHEDULE_EXACT_ALARM`)?
   *
   * No se cachea: `checkExactNotificationSetting()` es una consulta barata al
   * sistema y el permiso se puede revocar desde Ajustes en cualquier momento.
   * Cachearlo en `true` y equivocarse tiene un castigo desproporcionado: el
   * plugin, ante `isExactNotification: true` sin permiso, ABRE la pantalla de
   * sistema «Alarmas y recordatorios» en medio de un `schedule()` y deja la
   * promesa colgada hasta que el usuario vuelva.
   */
  async function exactAlarmsAllowed(): Promise<boolean> {
    try {
      const status = await LocalNotifications.checkExactNotificationSetting();
      return status.exact_alarm === 'granted';
    } catch {
      // Android < 12 no tiene el ajuste (y el plugin resuelve 'granted'); si la
      // consulta falla, inexacto es la opción que nunca abre una pantalla.
      return false;
    }
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

    /**
     * Reconcilia un ámbito de avisos programados (spec §12 Fase 6).
     *
     * El plan es el estado COMPLETO del ámbito: se cancela todo lo que gobierna
     * y ya no quiere, y se (re)programa lo que sí. Reprogramar un id que ya
     * estaba pendiente REEMPLAZA la alarma (el plugin usa
     * `PendingIntent.FLAG_CANCEL_CURRENT` con el id como requestId), no la
     * duplica — por eso reconciliar entero en cada cambio es seguro.
     *
     * `cancel()` no baja una notificación YA publicada (LocalNotificationManager.kt
     * solo la marca en su storage), así que los `ongoing` se retiran además con
     * `removeDeliveredNotificationsById`.
     *
     * Nunca rechaza: los callers son fire-and-forget desde el worker.
     */
    async applyNotificationPlan(plan: NotificationPlan) {
      try {
        const desired = new Map(plan.schedule.map((n) => [notificationIdFor(n.tag), n]));
        const stale = plan.owned.map(notificationIdFor).filter((id) => !desired.has(id));

        if (stale.length > 0) {
          // Cancelar no necesita permiso: se hace ANTES de `notificationsReady()`
          // para que un plan que solo retira avisos no dispare el diálogo de
          // permisos de Android 13 sin motivo.
          await LocalNotifications.cancel({ notifications: stale.map((id) => ({ id })) });
          const persistent = new Set((plan.ownedPersistent ?? []).map(notificationIdFor));
          const delivered = stale.filter((id) => persistent.has(id));
          if (delivered.length > 0) {
            await LocalNotifications.removeDeliveredNotificationsById({ ids: delivered });
          }
        }

        if (desired.size === 0) return;
        if (!(await notificationsReady())) return;

        // La exactitud se decide UNA vez por lote y solo importa si hay alarmas.
        const exact = [...desired.values()].some((n) => n.at !== undefined)
          ? await exactAlarmsAllowed()
          : false;

        await LocalNotifications.schedule({
          notifications: [...desired].map(([id, n]) => ({
            id,
            title: n.title,
            body: n.body,
            channelId: n.ongoing ? ONGOING_CHANNEL_ID : NOTIFICATION_CHANNEL_ID,
            ...(n.ongoing ? { ongoing: true, autoCancel: false } : {}),
            ...(n.at !== undefined
              ? {
                  // `allowWhileIdle` NO es opcional acá: sin él el plugin usa
                  // `AlarmManager.set(RTC, …)`, que no despierta el dispositivo y
                  // en Doze puede quedarse esperando la próxima ventana de
                  // mantenimiento (horas). Con él usa `setAndAllowWhileIdle`
                  // (RTC_WAKEUP), que dispara aun dormido — limitado por Android
                  // a una vez cada 9 minutos por app.
                  schedule: { at: new Date(n.at), allowWhileIdle: true },
                }
              : {}),
            // Exacta solo si el permiso YA está dado: pedirlo implícitamente abre
            // la pantalla de sistema y cuelga esta promesa (Ajustes tiene el
            // botón para concederlo con un gesto explícito).
            isExactNotification: n.at !== undefined && exact,
          })),
        });
      } catch (err) {
        console.warn('[platform-host] applyNotificationPlan failed', err);
      }
    },

    async exactAlarmState() {
      try {
        return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm;
      } catch {
        return 'denied';
      }
    },

    /** Abre «Alarmas y recordatorios». SOLO desde un gesto explícito del usuario. */
    async requestExactAlarms() {
      try {
        return (await LocalNotifications.changeExactNotificationSetting()).exact_alarm;
      } catch {
        return 'denied';
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

    /**
     * Import de resúmenes PDF **en Android**.
     *
     * Estaba trabado sólo porque la implementación de escritorio usa
     * `pdf-parse` (node-only): la investigación midió que `pdfjs-dist` corre en
     * el WebView y que `getTextContent()` no necesita canvas. Era una decisión,
     * no un límite.
     *
     * Red de contención: cualquier falla —el worker que no resuelve, una CSP
     * que lo bloquea, un PDF con contraseña— vuelve a `{ unsupported: true }`,
     * que es exactamente el comportamiento anterior. El peor caso cuesta cero.
     */
    async pickPdfText() {
      const file = await deps.pickFile('application/pdf,.pdf');
      if (!file) return null;
      try {
        const { extractPdfText } = await import('./pdf-text');
        const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
        // Un PDF escaneado (imagen pura) no tiene capa de texto: no es un
        // error, pero tampoco hay nada que parsear. Se responde lo mismo que
        // una plataforma sin soporte en vez de un resumen vacío.
        if (text.trim() === '') return { unsupported: true as const };
        return { name: file.name, text };
      } catch (err) {
        console.warn('[platform-host] pickPdfText failed, falling back to unsupported', err);
        return { unsupported: true as const };
      }
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
