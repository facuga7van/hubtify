/**
 * Update in-app de Android (reemplaza el flujo viejo de Layout.tsx que abría
 * `browser_download_url` en Chrome — ver el comentario de `openApkDownload`
 * en updater.ts). Autocontenido a propósito: chequea el release, baja el APK
 * con progreso y dispara el instalador nativo, sin tocar el estado de
 * updater de escritorio en Layout.tsx. Solo se monta en build Android (ver
 * el `lazy(() => import(...))` gateado por el literal
 * `__HUBTIFY_PLATFORM__ === 'android'` en Layout.tsx).
 *
 * No escucha `account:switched`: no carga datos de usuario, solo consulta el
 * último release público — nada que recargar al cambiar de cuenta.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkMobileUpdate, openApkDownload } from './updater';
import { downloadApk, type DownloadHandle } from './apk-downloader';
import ApkInstaller from './apk-installer';
import { initialUpdateFlowState, updateFlowReducer } from './update-flow';

const DISMISSED_KEY = 'hubtify_update_dismissed_version';
const MODE_KEY = 'hubtify_update_mode';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function humanizeError(reason: string, t: (key: string, fallback: string) => string): string {
  if (reason.startsWith('size_mismatch')) return t('settings.updateErrorSizeMismatch', 'La descarga no coincidió con el tamaño esperado. Probá de nuevo.');
  if (/network|fetch|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(reason)) {
    return t('settings.updateErrorNetwork', 'No pudimos conectarnos para bajar la actualización. Revisá tu conexión y probá de nuevo.');
  }
  return t('settings.updateErrorGeneric', 'No pudimos bajar la actualización. Probá de nuevo más tarde.');
}

export default function AndroidUpdateBanner() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(updateFlowReducer, initialUpdateFlowState);
  const [needsPermission, setNeedsPermission] = useState(false);
  const downloadRef = useRef<DownloadHandle | null>(null);
  const genRef = useRef(0);
  // Fallback de `handleInstall`: la url original del APK, guardada aparte
  // porque el estado 'downloaded'/'installing' de la máquina ya no la trae
  // (solo lleva `path`, el archivo local).
  const lastUrlRef = useRef<string | null>(null);

  const check = useCallback(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === 'off') return;
    } catch { /* localStorage inaccesible: seguimos igual, sin snooze persistido */ }
    checkMobileUpdate()
      .then((update) => {
        if (!update) return;
        try {
          if (localStorage.getItem(DISMISSED_KEY) === update.version) return;
        } catch { /* sin snooze persistido, se muestra igual */ }
        lastUrlRef.current = update.apkUrl;
        dispatch({ kind: 'AVAILABLE', version: update.version, size: update.size, url: update.apkUrl });
      })
      .catch(() => { /* sin red o rate limit: silencio */ });
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [check]);

  // Si la app vuelve a foreground mientras estábamos "installing" (el
  // usuario cerró la hoja del instalador del sistema sin confirmar, o
  // Android simplemente nos pausó), se puede reintentar sin re-descargar.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') dispatch({ kind: 'INSTALL_CANCELLED' });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleStartDownload = useCallback(() => {
    if (state.status !== 'available') return;
    const { version, size, url } = state;
    const gen = ++genRef.current;
    dispatch({ kind: 'START_DOWNLOAD' });
    const handle = downloadApk(url, version, size, (bytes) => {
      if (genRef.current !== gen) return;
      dispatch({ kind: 'PROGRESS', bytes });
    });
    downloadRef.current = handle;
    handle.result
      .then((path) => {
        if (genRef.current !== gen) return;
        dispatch({ kind: 'DOWNLOADED', path, actualSize: size });
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'cancelled') return; // el propio CANCEL ya movió el estado a idle
        dispatch({ kind: 'ERROR', reason: message });
      });
  }, [state]);

  const handleCancelDownload = useCallback(() => {
    genRef.current += 1; // ignora progreso/resultado tardío del fetch que sigue en curso
    downloadRef.current?.cancel();
    downloadRef.current = null;
    dispatch({ kind: 'CANCEL' });
  }, []);

  const handleInstall = useCallback(async () => {
    if (state.status !== 'downloaded') return;
    const { path } = state;
    dispatch({ kind: 'INSTALL' });
    try {
      const { needsPermission: pending } = await ApkInstaller.install({ path });
      setNeedsPermission(pending);
      if (pending) dispatch({ kind: 'INSTALL_CANCELLED' }); // vuelve a "downloaded" con el aviso puesto
    } catch (err) {
      // El plugin nativo no respondió (build sin el plugin registrado, IPC
      // caído, etc.) — fallback documentado: abrir el navegador del sistema
      // con la URL original, igual que el flujo viejo (Chrome descarga el
      // APK de nuevo y el usuario lo instala desde ahí).
      console.warn('[AndroidUpdateBanner] ApkInstaller falló, cayendo a Browser.open como fallback:', err);
      dispatch({ kind: 'INSTALL_CANCELLED' });
      if (lastUrlRef.current) await openApkDownload(lastUrlRef.current).catch(() => {});
    }
  }, [state]);

  const handleDismiss = useCallback(() => {
    if (state.status === 'downloading') handleCancelDownload();
    if (state.status === 'available' || state.status === 'error') {
      const version = state.version;
      if (version) {
        try { localStorage.setItem(DISMISSED_KEY, version); } catch { /* sin snooze persistido */ }
      }
    }
    dispatch({ kind: 'DISMISS' });
  }, [state, handleCancelDownload]);

  const handleRetry = useCallback(() => dispatch({ kind: 'RETRY' }), []);

  if (state.status === 'idle') return null;

  return (
    <div className="update-chip update-chip--android" role="status">
      <div className="update-chip__row">
        <span className="update-chip__dot" />
        <span className="update-chip__text">
          {state.status === 'available' && t('settings.updateAvailable', { version: state.version, defaultValue: `Nueva versión disponible: v${state.version}` })}
          {state.status === 'downloading' && t('settings.downloading', { percent: state.pct, defaultValue: `Descargando... ${state.pct}%` })}
          {state.status === 'downloaded' && !needsPermission && t('settings.updateReady', 'Actualización lista')}
          {state.status === 'downloaded' && needsPermission && t('settings.updateNeedsPermission', 'Permití instalar desde Hubtify y volvé a tocar «Instalar»')}
          {state.status === 'installing' && t('settings.updateInstalling', 'Abriendo el instalador…')}
          {state.status === 'error' && (
            <span className="update-chip__error">{humanizeError(state.reason, t)}</span>
          )}
        </span>
        {state.status !== 'installing' && (
          <button
            type="button"
            aria-label={t('settings.updateDismiss', 'Descartar el aviso de actualización')}
            onClick={handleDismiss}
            style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', flexShrink: 0, padding: 2, display: 'flex' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        )}
      </div>

      {state.status === 'downloading' && (
        <div className="update-chip__bar">
          <div className="update-chip__bar-fill" style={{ width: `${state.pct}%` }} />
        </div>
      )}

      {state.status === 'available' && (
        <button type="button" className="rpg-button" onClick={handleStartDownload}>
          {t('settings.update', 'Actualizar')}
        </button>
      )}

      {state.status === 'downloading' && (
        <button type="button" className="rpg-button" onClick={handleCancelDownload}>
          {t('settings.updateCancel', 'Cancelar')}
        </button>
      )}

      {state.status === 'downloaded' && (
        <button type="button" className="rpg-button" onClick={handleInstall}>
          {t('settings.updateInstall', 'Instalar')}
        </button>
      )}

      {state.status === 'error' && (
        <button type="button" className="rpg-button" onClick={handleRetry}>
          {t('settings.updateRetry', 'Reintentar')}
        </button>
      )}
    </div>
  );
}
