/**
 * Aviso de versión nueva en Android. NO actualiza nada: abre la página del
 * release en el navegador y ahí el usuario baja el APK.
 *
 * Antes bajaba el APK con progreso y lanzaba el instalador del sistema
 * (apk-downloader.ts + apk-installer.ts + ApkInstallerPlugin.java, los tres
 * borrados). Eso exigía android.permission.REQUEST_INSTALL_PACKAGES, un
 * permiso que la política de Play reserva a las apps cuyo propósito CENTRAL es
 * instalar paquetes: declararlo sin calificar suspende la cuenta. La
 * actualización automática la hace Obtainium — app aparte del usuario, sigue
 * los mismos releases de GitHub — y por eso acá no se explica: eso vive en la
 * landing, no adentro de la app.
 *
 * Solo se monta en build Android (ver el `lazy(() => import(...))` gateado por
 * el literal `__HUBTIFY_PLATFORM__ === 'android'` en Layout.tsx).
 *
 * No escucha `account:switched`: no carga datos de usuario, solo consulta el
 * último release público — nada que recargar al cambiar de cuenta.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkMobileUpdate, openReleasePage, type MobileUpdate } from './updater';

const DISMISSED_KEY = 'hubtify_update_dismissed_version';
const MODE_KEY = 'hubtify_update_mode';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function AndroidUpdateBanner() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<MobileUpdate | null>(null);

  const check = useCallback(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === 'off') return;
    } catch { /* localStorage inaccesible: seguimos igual, sin snooze persistido */ }
    checkMobileUpdate()
      .then((found) => {
        if (!found) return;
        try {
          if (localStorage.getItem(DISMISSED_KEY) === found.version) return;
        } catch { /* sin snooze persistido, se muestra igual */ }
        // El chequeo de las 6 h no pisa el aviso que ya está en pantalla.
        setUpdate((current) => current ?? found);
      })
      .catch(() => { /* sin red o rate limit: silencio */ });
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [check]);

  // El aviso NO se cierra al abrir la página: abrirla no instala nada, y la
  // app no tiene forma de saber si el usuario llegó a actualizar. Deja de
  // aparecer solo cuando arranca ya en la versión nueva (o si lo descarta).
  const handleOpen = useCallback(() => {
    if (!update) return;
    openReleasePage(update.releaseUrl).catch(() => { /* sin navegador: nada que hacer */ });
  }, [update]);

  const handleDismiss = useCallback(() => {
    if (!update) return;
    try { localStorage.setItem(DISMISSED_KEY, update.version); } catch { /* sin snooze persistido */ }
    setUpdate(null);
  }, [update]);

  if (!update) return null;

  return (
    <div className="update-chip update-chip--android" role="status">
      <div className="update-chip__row">
        <span className="update-chip__dot" />
        <span className="update-chip__text">
          {t('settings.updateAvailable', { version: update.version, defaultValue: `Nueva versión disponible: v${update.version}` })}
        </span>
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
      </div>

      <button type="button" className="rpg-button" onClick={handleOpen}>
        {t('settings.updateOpenRelease', 'Ver la actualización')}
      </button>
    </div>
  );
}
