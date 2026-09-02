/**
 * Lado UI del `PlatformPort` (spec §6, columna «Mobile»). El worker manda
 * `{ type:'platform', method, args }` y esto lo atiende con plugins de
 * Capacitor. Fase 2 solo necesita `notify` (no-op) y `pickPdfText`
 * (`{ unsupported:true }`); el resto es no-op / `null` / `false` hasta la
 * Fase 5 (`@capacitor/browser`, `@capacitor/filesystem`, `@capacitor/share`).
 *
 * `appVersion()` y `osInfo()` son síncronos en la interfaz y no pueden hacer
 * round-trip: la UI los manda una vez con `{ type:'init' }` (ver install-api).
 */
import { Device } from '@capacitor/device';
import type { PlatformHostFns } from './worker-client';

/** Lo que reporta `osInfo()` si el plugin falla o no contesta a tiempo. */
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

export function createPlatformHost(): PlatformHostFns {
  return {
    // Fase 5: @capacitor/local-notifications con schedule inmediato.
    notify: async () => undefined,
    // Fase 5: @capacitor/browser (`window.open` en el WebView de Capacitor no
    // garantiza abrir el navegador del sistema). Hasta entonces, no-op (spec §6).
    openExternal: async (url: string) => {
      console.warn('[mobile] openExternal no implementado hasta Fase 5:', url);
    },
    pickTextFile: async () => null,
    // Import de resúmenes PDF: fuera de alcance en mobile (spec §1). El handler
    // de finance-import responde { ok:false, reason:'unsupported_platform' }.
    pickPdfText: async () => ({ unsupported: true as const }),
    pickBinaryFile: async () => null,
    saveTextFile: async () => false,
    saveBinaryFile: async () => false,
  };
}
