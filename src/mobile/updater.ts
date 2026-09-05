/**
 * Aviso de versión nueva en Android (spec §6, fila updater; §11 lo listaba en
 * Fase 6). No hay Squirrel: se consulta el último release público de
 * hubtify-releases y se compara con APP_VERSION.
 *
 * Acá terminaba el chequeo y arrancaba la descarga del APK + el instalador
 * nativo (apk-downloader.ts, apk-installer.ts, ApkInstallerPlugin.java: los
 * tres borrados). Instalar un APK desde la app exige
 * android.permission.REQUEST_INSTALL_PACKAGES, un permiso que la política de
 * Play reserva a las apps cuyo propósito CENTRAL es instalar paquetes —
 * declararlo sin calificar suspende la cuenta. Ahora la app solo abre la
 * PÁGINA del release en el navegador; quien quiera updates automáticos usa
 * Obtainium, que sigue estos mismos releases.
 *
 * API pública de GitHub: 60 req/h sin token; se consulta al montar y cada 6 h.
 * Ante 403/red caída se devuelve null en silencio.
 */
import { Browser } from '@capacitor/browser';
import { isNewerVersion } from '../shared/semver';

const RELEASES_REPO = 'facuga7van/hubtify-releases';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
/** Respaldo de `html_url` — el JSON falso del override de QA puede no traerlo. */
const RELEASE_PAGE_BASE = `https://github.com/${RELEASES_REPO}/releases/tag/`;

export interface ReleaseAsset {
  name: string;
}

export interface LatestRelease {
  tag_name: string;
  /** Página del release; es lo que abre el aviso. GitHub la manda en el JSON. */
  html_url?: string;
  assets?: ReleaseAsset[];
}

export interface MobileUpdate {
  version: string;
  /** La página del release, NO el asset: bajar el APK ya no es tarea de la app. */
  releaseUrl: string;
}

export function findMobileUpdate(release: LatestRelease, currentVersion: string): MobileUpdate | null {
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, currentVersion)) return null;
  // Un release sin APK (solo Windows) no es una actualización para un Android:
  // mandarlo a la página no le daría nada que bajar.
  const hasApk = (release.assets ?? []).some((a) => a.name === `Hubtify-${version}.apk`);
  if (!hasApk) return null;
  return { version, releaseUrl: release.html_url || `${RELEASE_PAGE_BASE}${release.tag_name}` };
}

/**
 * Override de QA (spec §5 de la feature de in-app update): si
 * `localStorage.hubtify_update_api` está seteado, se usa esa URL en vez de la
 * API real de GitHub — sirve para simular una versión nueva en el emulador
 * sirviendo un JSON de release falso desde `python -m http.server` +
 * `adb reverse`, sin depender de publicar un release real. Vacío/ausente →
 * comportamiento normal.
 */
function releaseApiUrl(): string {
  try {
    return localStorage.getItem('hubtify_update_api') || LATEST_RELEASE_URL;
  } catch {
    return LATEST_RELEASE_URL;
  }
}

export async function checkMobileUpdate(
  fetchFn: typeof fetch = fetch,
  currentVersion: string = APP_VERSION,
): Promise<MobileUpdate | null> {
  try {
    const res = await fetchFn(releaseApiUrl(), { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return findMobileUpdate((await res.json()) as LatestRelease, currentVersion);
  } catch {
    return null;
  }
}

/**
 * Abre la página del release en el navegador del sistema. Es exactamente lo
 * que hace `openExternal` del PlatformPort en Android (platform-host.ts), pero
 * el PlatformPort se instala en el worker (`setPlatform()` solo se llama en
 * worker.ts y en electron/main.ts): desde la UI, `platform()` tiraría
 * «PlatformPort not installed», así que se llama a @capacitor/browser directo,
 * como ya se hacía en este módulo.
 */
export async function openReleasePage(url: string): Promise<void> {
  await Browser.open({ url });
}
