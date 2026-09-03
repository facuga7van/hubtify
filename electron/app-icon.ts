import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { installRootOf } from './install-location';

/**
 * Squirrel.Windows baja el `iconUrl` del `.nuspec` a `<raíz>\app.ico` y registra
 * esa ruta como `DisplayIcon` en Agregar o quitar programas. Lo hace UNA sola vez:
 * durante `--install`. En una ACTUALIZACIÓN (`Update.exe --update`) el log
 * (`Squirrel-Update.log`) muestra `Writing files to app directory`,
 * `Rigging execution stub`, `fixPinnedExecutables`, `Fixing up tray icons` y
 * `cleanDeadVersions` — y ninguna escritura de `app.ico`.
 *
 * Consecuencia verificada: todo usuario que instaló ANTES de que
 * `forge.config.ts` definiera `iconUrl` se quedó con el default de
 * electron-winstaller (`electron.ico`, el átomo, sha256 `b5d81c93…`) para
 * siempre, porque actualizar nunca lo pisa. Ver
 * `docs/superpowers/plans/2026-09-03-windows-shortcut-icon.md`.
 *
 * El arreglo es de la app, no del instalador: al arrancar comparamos el
 * `app.ico` instalado contra el `.ico` que ya venimos empaquetando como
 * `extraResource` y, si no coinciden, lo sobrescribimos. Barato (dos sha256 de
 * ~60 KB), idempotente (la segunda vez los hashes coinciden y no se escribe) y
 * sin dependencias nuevas.
 *
 * Lo que este módulo NO hace, a propósito:
 * - **No toca el registro.** `DisplayIcon` ya apunta a este mismo `app.ico`
 *   (`HKCU\…\Uninstall\Hubtify`), así que reescribirlo no cambiaría nada y
 *   requeriría spawnear `reg.exe`. Si la instalación está duplicada
 *   (ver `install-location.ts`) la clave puede apuntar a la OTRA raíz; curamos
 *   la copia que se está ejecutando y el aviso de instalación duplicada ya
 *   cubre ese caso.
 * - **No refresca el caché de íconos del shell.** `SHChangeNotify` /
 *   `SHCNE_ASSOCCHANGED` es una llamada a `shell32.dll` y no hay forma de
 *   invocarla sin un módulo nativo nuevo (koffi/ffi-napi) o sin spawnear
 *   PowerShell con `Add-Type` en cada arranque. No vale el costo: el panel de
 *   control relee `app.ico` por ruta, y en el peor caso el ícono nuevo se ve
 *   recién tras reiniciar el Explorador o la sesión. Aceptable para algo que
 *   se cura una sola vez por usuario.
 */

export interface IconHealInput {
  /** `process.platform`. */
  platform: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** sha256 hex del `app.ico` instalado. `null` = no existe o no se pudo leer. */
  installedHash: string | null;
  /** sha256 hex del `.ico` que traemos empaquetado. `null` = no está. */
  bundledHash: string | null;
}

export type IconHealReason =
  /** Squirrel es exclusivo de Windows. */
  | 'not-windows'
  /** En dev `resourcesPath` es el de Electron y no hay instalación que curar. */
  | 'not-packaged'
  /** Sin ícono empaquetado no hay con qué reemplazar: mejor dejar lo que haya. */
  | 'no-bundled-icon'
  /** Ya es nuestro ícono. */
  | 'up-to-date'
  /** No hay `app.ico` en la raíz. */
  | 'missing'
  /** Hay uno, pero no es el nuestro (el caso del átomo). */
  | 'stale';

export interface IconHealDecision {
  replace: boolean;
  reason: IconHealReason;
}

export interface HealAppIconInput {
  /** `process.execPath`. */
  execPath: string;
  /** `process.resourcesPath`. */
  resourcesPath: string;
  /** `process.platform`. */
  platform: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
}

export interface HealAppIconResult extends IconHealDecision {
  /** Ruta del `app.ico` evaluado. */
  target: string;
  /** true solo si el archivo terminó efectivamente escrito. */
  replaced: boolean;
  /** Mensaje del fallo si la escritura no pudo completarse. */
  error?: string;
}

/** El `app.ico` vive en la raíz de la instalación, hermano de `Update.exe`. */
export function appIcoPathFor(execPath: string): string {
  return path.win32.join(installRootOf(execPath), 'app.ico');
}

/** `extraResource: ['./assets/icon.ico']` aterriza plano en `resources/`. */
export function bundledIconPathFor(resourcesPath: string): string {
  return path.win32.join(resourcesPath, 'icon.ico');
}

/** Windows + empaquetado: fuera de ahí no hay `app.ico` de Squirrel que curar. */
export function isSelfHealSupported(platform: string, isPackaged: boolean): boolean {
  return platform === 'win32' && isPackaged;
}

/**
 * Decisión pura. Todo lo que puede fallar (leer archivos) ya ocurrió afuera y
 * llega acá como hash o `null`.
 */
export function shouldReplaceIcon(input: IconHealInput): IconHealDecision {
  if (input.platform !== 'win32') return { replace: false, reason: 'not-windows' };
  if (!input.isPackaged) return { replace: false, reason: 'not-packaged' };
  if (!input.bundledHash) return { replace: false, reason: 'no-bundled-icon' };
  if (!input.installedHash) return { replace: true, reason: 'missing' };
  if (input.installedHash.toLowerCase() === input.bundledHash.toLowerCase()) {
    return { replace: false, reason: 'up-to-date' };
  }
  return { replace: true, reason: 'stale' };
}

/** sha256 hex, o `null` si el archivo no existe / no se puede leer. */
async function hashFile(file: string): Promise<string | null> {
  try {
    return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * El efecto. Nunca lanza: si el `app.ico` está tomado por el Explorador o el
 * usuario no tiene permisos, devolvemos el error y seguimos. Como la decisión
 * se recalcula en cada arranque, un fallo (o incluso una copia a medias) se
 * corrige solo la próxima vez que la app abra.
 */
export async function healAppIcon(input: HealAppIconInput): Promise<HealAppIconResult> {
  const target = appIcoPathFor(input.execPath);

  if (!isSelfHealSupported(input.platform, input.isPackaged)) {
    const decision = shouldReplaceIcon({ ...input, installedHash: null, bundledHash: null });
    return { ...decision, target, replaced: false };
  }

  const source = bundledIconPathFor(input.resourcesPath);
  const [installedHash, bundledHash] = await Promise.all([hashFile(target), hashFile(source)]);
  const decision = shouldReplaceIcon({ ...input, installedHash, bundledHash });

  if (!decision.replace) return { ...decision, target, replaced: false };

  try {
    await fs.copyFile(source, target);
    return { ...decision, target, replaced: true };
  } catch (err) {
    return { ...decision, target, replaced: false, error: (err as Error).message };
  }
}
