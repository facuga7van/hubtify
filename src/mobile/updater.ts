/**
 * Updater de Android (spec §6, fila updater; §11 lo listaba en Fase 6). No hay
 * Squirrel: se consulta el último release público de hubtify-releases y se
 * compara con APP_VERSION. Desde el in-app update (AndroidUpdateBanner.tsx)
 * la descarga y la instalación ya no pasan por el navegador — `openApkDownload`
 * queda solo como fallback si el plugin nativo falla.
 *
 * API pública de GitHub: 60 req/h sin token; se consulta al montar y cada 6 h.
 * Ante 403/red caída se devuelve null en silencio.
 */
import { Browser } from '@capacitor/browser';
import { isNewerVersion } from '../shared/semver';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/facuga7van/hubtify-releases/releases/latest';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface LatestRelease {
  tag_name: string;
  assets?: ReleaseAsset[];
}

export interface ApkUpdate {
  version: string;
  apkUrl: string;
  size: number;
}

export function findApkUpdate(release: LatestRelease, currentVersion: string): ApkUpdate | null {
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, currentVersion)) return null;
  const apk = (release.assets ?? []).find((a) => a.name === `Hubtify-${version}.apk`);
  return apk ? { version, apkUrl: apk.browser_download_url, size: apk.size } : null;
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
): Promise<ApkUpdate | null> {
  try {
    const res = await fetchFn(releaseApiUrl(), { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return findApkUpdate((await res.json()) as LatestRelease, currentVersion);
  } catch {
    return null;
  }
}

export async function openApkDownload(url: string): Promise<void> {
  await Browser.open({ url });
}
