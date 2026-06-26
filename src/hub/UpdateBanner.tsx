import { useTranslation } from 'react-i18next';
import type { UpdateState } from './UpdateNotification';

interface Props {
  version: string;
  state: UpdateState;
  percent: number;
  error: string | null;
  onViewDetails: () => void;
  onDismiss: () => void;
}

/**
 * Discreet bottom-right banner that announces an update without interrupting.
 * "View what's new" opens the full changelog modal (UpdateNotification).
 * While downloading it shows compact progress in place.
 */
export default function UpdateBanner({ version, state, percent, error, onViewDetails, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es';
  const viewLabel = lang === 'en' ? 'View what\'s new' : 'Ver novedades';
  const retryLabel = lang === 'en' ? 'Retry' : 'Reintentar';
  const downloadingLabel = lang === 'en' ? 'Downloading' : 'Descargando';
  const failedLabel = lang === 'en' ? 'Update failed' : 'Error al actualizar';

  return (
    <div role="status" style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 900,
      width: 300, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--leather)', border: '1px solid var(--gold-dark)',
      borderRadius: 6, padding: '12px 14px', color: 'var(--parch-0)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {/* Upgrade glyph */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-light)"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        {error ? (
          <span style={{ color: '#f87171', fontSize: 'var(--fs-label)' }}>{failedLabel}</span>
        ) : state === 'downloading' ? (
          <>
            <div style={{ fontSize: 'var(--fs-label)', marginBottom: 5 }}>
              {downloadingLabel} v{version} · {percent}%
            </div>
            <div style={{ height: 4, background: 'rgba(0,0,0,0.3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: 'var(--moss)', transition: 'width 0.3s ease' }} />
            </div>
          </>
        ) : (
          <span style={{ fontSize: 'var(--fs-label)', color: 'var(--gold-light)' }}>
            {t('settings.updateAvailable', { version })}
          </span>
        )}
      </div>

      {state === 'idle' && (
        <>
          <button onClick={onViewDetails} className="rpg-button"
            style={{ fontSize: 'var(--fs-label)', padding: '4px 10px', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {error ? retryLabel : viewLabel}
          </button>
          <button onClick={onDismiss} aria-label={t('nutrify.weightCheckin.later', 'Más tarde')}
            style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', flexShrink: 0, padding: 2, display: 'flex' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
