import path from 'path';

/**
 * Squirrel.Windows no expone el directorio de instalación: instala en lo que
 * .NET resuelva como `LocalApplicationData` para el proceso que corre el
 * Setup.exe. Cuando ese proceso tiene un token sin perfil de usuario cargado
 * (elevación, servicio, lanzador que despoja el token), .NET devuelve
 * `C:\ProgramData\<usuario>` y queda una SEGUNDA instalación completa, con su
 * propio árbol y peleando por la misma clave de desinstalación en HKCU.
 * Es un bug conocido de upstream (Squirrel.Windows #1192, #1497) y no hay
 * opción de configuración que lo prevenga — ver
 * docs/superpowers/plans/2026-09-03-windows-shortcut-icon.md.
 *
 * Lo único que podemos hacer es DETECTARLO en runtime y decírselo al usuario,
 * que si no ve el desinstalador apuntando a una copia y el acceso directo a la
 * otra sin entender por qué. Esta función es pura a propósito: recibe todo por
 * parámetro (`process.execPath`, `app.getPath('localAppData')`, plataforma,
 * `app.isPackaged`) para poder testear las rutas de Windows desde cualquier SO.
 */
export interface InstallLocationInput {
  /** `process.execPath`. */
  execPath: string;
  /** `app.getPath('localAppData')`. Vacío = desconocido. */
  localAppData: string;
  /** `process.platform`. */
  platform: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
}

export interface InstallLocationCheck {
  /** true = la app corre desde una raíz que Squirrel no debería haber usado. */
  suspicious: boolean;
  /** Raíz de la instalación, para mostrársela al usuario. '' si no aplica. */
  root: string;
}

/** `app-0.9.4`, `app-1.0.0-beta.1`… la carpeta versionada que escribe Squirrel. */
const VERSIONED_DIR = /^app-\d+\.\d+\.\d+/i;

/** Comparación de rutas de Windows: normalizada, sin barra final, case-insensitive. */
function norm(p: string): string {
  return path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Raíz de la instalación a partir del ejecutable. Squirrel arranca la app
 * indistintamente desde el stub (`<raíz>\Hubtify.exe`) o desde el exe versionado
 * (`<raíz>\app-0.9.4\Hubtify.exe`); las dos deben dar la misma raíz.
 */
export function installRootOf(execPath: string): string {
  const dir = path.win32.dirname(path.win32.normalize(execPath));
  return VERSIONED_DIR.test(path.win32.basename(dir)) ? path.win32.dirname(dir) : dir;
}

/** `child` es `parent` o cuelga de él. Compara por segmentos, no por prefijo de string. */
function isInside(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + '\\');
}

/**
 * Árboles de desarrollo: `npm start` corre `node_modules/electron/dist/electron.exe`
 * y `npm run package` deja el bundle en `out/` con `app.isPackaged === true`.
 * Ninguno de los dos vive bajo LocalAppData y ninguno es un problema.
 */
function isDevTree(execPath: string): boolean {
  const segments = norm(execPath).split('\\');
  return segments.includes('node_modules') || segments.includes('out');
}

export function checkInstallLocation(input: InstallLocationInput): InstallLocationCheck {
  // El bug es exclusivo de Squirrel.Windows.
  if (input.platform !== 'win32') return { suspicious: false, root: '' };

  const root = installRootOf(input.execPath);

  if (!input.isPackaged) return { suspicious: false, root };
  if (isDevTree(input.execPath)) return { suspicious: false, root };
  // Sin LocalAppData no hay con qué comparar. Callarse antes que asustar de más.
  if (!input.localAppData.trim()) return { suspicious: false, root };

  return { suspicious: !isInside(root, input.localAppData), root };
}
