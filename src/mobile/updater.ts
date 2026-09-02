/**
 * Updater de Android (spec §6, fila updater; §11 lo listaba en Fase 6). No hay
 * Squirrel: se consulta el último release público de hubtify-releases, se
 * compara con APP_VERSION y, si hay `Hubtify-<version>.apk`, Layout muestra el
 * banner de siempre; «Descargar» abre la URL en el navegador del sistema y el
 * usuario instala el APK (misma firma + versionCode mayor → actualiza en el lugar).
 *
 * API pública de GitHub: 60 req/h sin token; Layout consulta al montar y cada
 * 6 h. Ante 403/red caída se devuelve null en silencio.
 */
import { Browser } from '@capacitor/browser';
import { isNewerVersion } from '../shared/semver';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/facuga7van/hubtify-releases/releases/latest';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface LatestRelease {
  tag_name: string;
  assets?: ReleaseAsset[];
}

export interface ApkUpdate {
  version: string;
  apkUrl: string;
}

export function findApkUpdate(release: LatestRelease, currentVersion: string): ApkUpdate | null {
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, currentVersion)) return null;
  const apk = (release.assets ?? []).find((a) => a.name === `Hubtify-${version}.apk`);
  return apk ? { version, apkUrl: apk.browser_download_url } : null;
}

export async function checkMobileUpdate(
  fetchFn: typeof fetch = fetch,
  currentVersion: string = APP_VERSION,
): Promise<ApkUpdate | null> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return findApkUpdate((await res.json()) as LatestRelease, currentVersion);
  } catch {
    return null;
  }
}

export async function openApkDownload(url: string): Promise<void> {
  await Browser.open({ url });
}
