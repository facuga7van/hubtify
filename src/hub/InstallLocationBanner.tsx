import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Se descarta por sesión: cerrar y reabrir la app lo vuelve a mostrar. */
const DISMISSED_KEY = 'hubtify_install_warning_dismissed';

/**
 * Aviso de instalación duplicada de Squirrel (`C:\ProgramData\<usuario>\Hubtify`
 * conviviendo con `%LOCALAPPDATA%\Hubtify`). El síntoma que ve el usuario es
 * desconcertante — el desinstalador apunta a una copia, el acceso directo a la
 * otra, y desinstalar deja la sobrante huérfana — así que lo nombramos y le
 * damos la salida en vez de dejarlo adivinar.
 *
 * Se sondea con `getInstallWarning` (invoke) en lugar de escuchar un evento:
 * el main termina de arrancar mucho antes de que React monte, y un `emit()` en
 * `whenReady` no tendría a nadie del otro lado. En Android `getInstallWarning`
 * ni existe en `window.api` (`platforms: 'desktop'`), así que el `?.` deja el
 * componente en un no-op y nunca se muestra nada.
 *
 * El descarte vive en `sessionStorage` a propósito: la instalación duplicada NO
 * se arregla sola, y silenciarla para siempre es enterrar el problema. Se calla
 * mientras dure la sesión y vuelve a preguntar en el próximo arranque, hasta
 * que el usuario efectivamente desinstale la copia sobrante.
 */
export default function InstallLocationBanner() {
  const { t } = useTranslation();
  const [root, setRoot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      if (sessionStorage.getItem(DISMISSED_KEY) === '1') return;
    } catch { /* sessionStorage bloqueado — mostramos igual */ }

    window.api.getInstallWarning?.()
      .then((res) => {
        if (cancelled || !res?.suspicious) return;
        setRoot(res.root);
      })
      .catch(() => { /* el aviso es un extra: si falla, silencio */ });

    return () => { cancelled = true; };
  }, []);

  if (!root) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch { /* da igual */ }
    setRoot(null);
  };

  return (
    <div role="status" style={{
      // Abajo a la izquierda: UpdateBanner ocupa la esquina derecha y los toasts
      // la franja de arriba. Mismo z-index que el banner de actualización.
      position: 'fixed', bottom: 16, left: 16, zIndex: 900,
      width: 340, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--leather)', border: '1px solid var(--rubric)',
      borderRadius: 6, padding: '12px 14px', color: 'var(--parch-0)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      {/* Escudo con exclamación */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--rubric-light)"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
        <path d="M12 3l7 3v5c0 4.4-2.9 8.4-7 10-4.1-1.6-7-5.6-7-10V6z" />
        <path d="M12 9v4" />
        <path d="M12 16h.01" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--gold-light)', marginBottom: 4 }}>
          {t('settings.installDuplicateTitle', 'Hubtify parece estar instalado dos veces')}
        </div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--parch-0)', wordBreak: 'break-all' }}>
          {t('settings.installDuplicateBody', { root, defaultValue: 'Estás usando la copia de {{root}}.' })}
        </div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--parch-1)', marginTop: 4 }}>
          {t('settings.installDuplicateFix', 'Para dejar una sola, desinstalá desde Agregar o quitar programas y reinstalá sin «Ejecutar como administrador».')}
        </div>
      </div>

      <button onClick={dismiss}
        aria-label={t('settings.installDuplicateDismiss', 'Descartar el aviso de instalación duplicada')}
        style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', flexShrink: 0, padding: 2, display: 'flex' }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
