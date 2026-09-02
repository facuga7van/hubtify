/**
 * Descarga del APK con progreso, lado Capacitor (Filesystem). Confirmado
 * contra la versión instalada (`@capacitor/filesystem@8.1.3`, ver
 * node_modules/@capacitor/filesystem/dist/esm/definitions.d.ts):
 *   - `downloadFile({ url, path, directory, progress: true, recursive })`
 *     existe y funciona en esta versión, aunque está marcado @deprecated
 *     desde 7.1.0 en favor de `@capacitor/file-transfer` (paquete NO
 *     instalado — no se agrega una dependencia nueva para esto).
 *   - El progreso llega por `Filesystem.addListener('progress', cb)` con
 *     `{ url, bytes, contentLength }`, no por un callback de `downloadFile`.
 *
 * LÍMITE CONOCIDO: esta API no expone ningún abort/cancel — una vez lanzado
 * el `downloadFile`, la descarga HTTP sigue en curso pase lo que pase del
 * lado JS. `downloadApk` soporta cancelación "de app": si se llama
 * `cancel()`, la promesa que ve AndroidUpdateBanner se rechaza YA (la UI
 * vuelve a idle al toque), pero el archivo se sigue bajando en segundo plano
 * y se borra solo cuando `downloadFile` finalmente resuelve. No hay forma de
 * cortar la conexión sin `@capacitor/file-transfer` (que sí expone un
 * `AbortController`-like via `pause()`/`removeAllListeners`, pero implica
 * sumar una dependencia nueva fuera del alcance de este cambio).
 */
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { PluginListenerHandle } from '@capacitor/core';

export const UPDATES_DIR = 'updates';

function apkPath(version: string): string {
  return `${UPDATES_DIR}/Hubtify-${version}.apk`;
}

/** Borra todo lo que haya en `updates/` (APKs de intentos previos) antes de
 * bajar uno nuevo — evita acumular varios GB en el cache con el tiempo. */
export async function clearOldApks(): Promise<void> {
  let files: { name: string }[];
  try {
    ({ files } = await Filesystem.readdir({ path: UPDATES_DIR, directory: Directory.Cache }));
  } catch {
    return; // el directorio todavía no existe — nada que borrar
  }
  await Promise.all(files.map((f) =>
    Filesystem.deleteFile({ path: `${UPDATES_DIR}/${f.name}`, directory: Directory.Cache })
      .catch(() => { /* best-effort: un archivo que no se pudo borrar no bloquea la descarga nueva */ }),
  ));
}

export interface DownloadHandle {
  /** Resuelve con la `file://` uri del APK ya verificado contra `expectedSize`. */
  result: Promise<string>;
  /** Cancelación "de app" — ver límite conocido en el comentario de arriba. */
  cancel: () => void;
}

/**
 * Descarga `url` a `updates/Hubtify-<version>.apk` en el cache, reportando
 * bytes descargados por `onProgress(bytes)` — el porcentaje lo calcula el
 * caller contra `expectedSize` (`progressPercent` de update-flow.ts), para
 * que la barra y la verificación de tamaño final usen el mismo total. Verifica
 * el tamaño final contra `expectedSize` (viene de `assets[].size` del release
 * de GitHub) y borra el archivo si no coincide.
 */
export function downloadApk(url: string, version: string, expectedSize: number, onProgress: (bytes: number) => void): DownloadHandle {
  let cancelled = false;
  let progressHandle: PluginListenerHandle | null = null;
  const path = apkPath(version);

  async function run(): Promise<string> {
    await clearOldApks();
    if (cancelled) throw new Error('cancelled');

    progressHandle = await Filesystem.addListener('progress', (status) => {
      if (cancelled) return;
      onProgress(status.bytes);
    });

    try {
      await Filesystem.downloadFile({ url, path, directory: Directory.Cache, progress: true, recursive: true });
    } finally {
      await progressHandle?.remove();
      progressHandle = null;
    }

    if (cancelled) {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
      throw new Error('cancelled');
    }

    const { size } = await Filesystem.stat({ path, directory: Directory.Cache });
    if (size !== expectedSize) {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
      throw new Error(`size_mismatch:${size}:${expectedSize}`);
    }

    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    return uri;
  }

  return {
    result: run(),
    cancel: () => { cancelled = true; },
  };
}
