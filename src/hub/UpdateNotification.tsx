import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { changelog } from '../shared/changelog';

export type UpdateState = 'idle' | 'downloading' | 'ready';

/**
 * El error del updater llegaba CRUDO a la pantalla: se leía
 * «ERR_INTERNET_DISCONNECTED» —una constante de Chromium, en inglés y en
 * mayúsculas— en medio de un diálogo en castellano, sin decir qué hacer.
 * Acá se traduce a una frase con una salida; el código original viaja en el
 * `title` para que siga sirviendo en un reporte de bug.
 */
export function humanUpdateError(raw: string, t: TFunction): string {
  const code = raw.toUpperCase();
  const offline = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|NET::|NETWORK|OFFLINE|DNS/.test(code);
  return offline
    ? t('settings.updateErrorNetwork', 'No pudimos conectarnos para bajar la actualización. Revisá tu conexión y probá de nuevo.')
    : t('settings.updateErrorGeneric', 'No pudimos bajar la actualización. Probá de nuevo más tarde.');
}

interface Props {
  version: string;
  state: UpdateState;
  percent: number;
  error: string | null;
  onDownload: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/**
 * Update prompt shown when a new version is available. Presentational:
 * Layout owns the updater state and IPC; this only renders it. Pulls the
 * matching changelog entry so the user sees WHAT'S new, not just a number.
 */
export default function UpdateNotification({ version, state, percent, error, onDownload, onRestart, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es';
  const whatsNew = lang === 'en' ? "What's new" : 'Qué hay de nuevo';
  const readyLabel = lang === 'en' ? 'Update ready to install' : 'Actualización lista para instalar';
  const restartNow = lang === 'en' ? 'Restart now' : 'Reiniciar ahora';
  const restartLater = lang === 'en' ? 'Later' : 'Después';

  const entry = changelog.find((e) => e.version === version);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--leather)',
        border: '2px solid var(--gold-dark)',
        borderRadius: '6px', padding: '24px', maxWidth: 380, width: '90%',
        textAlign: 'center', color: 'var(--parch-0)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      }}>
        <h3 style={{ fontFamily: "'UnifrakturCook', cursive", marginBottom: 12, color: 'var(--gold-light)' }}>
          {t('settings.updateAvailable', { version })}
        </h3>

        {/* What's new — pulled from the changelog */}
        {entry && entry.changes.length > 0 && (
          <div style={{
            textAlign: 'left', marginBottom: 16, maxHeight: 220, overflowY: 'auto',
            background: 'rgba(0,0,0,0.18)', borderRadius: 4, padding: '12px 14px',
          }}>
            <p className="qb-small-caps" style={{
              fontSize: 'var(--fs-label)', letterSpacing: '0.1em',
              color: 'var(--gold)', marginBottom: 8,
            }}>
              {whatsNew}
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entry.changes.map((c, i) => (
                <li key={i} style={{
                  fontSize: 'var(--fs-label)', lineHeight: 1.45,
                  color: 'var(--parch-1)', paddingLeft: 14, position: 'relative',
                }}>
                  <span style={{ position: 'absolute', left: 0, color: 'var(--gold-dark)' }}>•</span>
                  {c.text[lang]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state === 'downloading' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', background: 'var(--moss)', width: `${percent}%`, transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: 'var(--fs-label)' }}>{percent}%</span>
          </div>
        )}

        {error && (
          <p
            role="alert"
            title={error}
            style={{ color: '#f87171', fontSize: 'var(--fs-label)', marginBottom: 8, textAlign: 'left' }}
          >
            {humanUpdateError(error, t)}
          </p>
        )}

        {state === 'idle' && (
          <>
            <button className="rpg-button" onClick={onDownload} style={{ width: '100%', marginBottom: 8 }}>
              {t('settings.downloadUpdate')}
            </button>
            {/* Decía `nutrify.weightCheckin.later`: una clave del módulo de
                nutrición usada en el diálogo de actualización. */}
            <button onClick={onDismiss} className="rpg-button"
              style={{ width: '100%', padding: '4px 8px', fontSize: 'var(--fs-label)', background: 'transparent', border: '1px solid var(--gold-dark)', color: 'var(--gold-light)' }}>
              {t('common.later', 'Más tarde')}
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            {/* `--moss` sobre `--leather` son 1.69:1: el ÚNICO cartel que
                confirma que la actualización ya está lista era ilegible. El
                verde vive ahora en una tablilla de pergamino (8.1:1). */}
            <p style={{
              fontSize: 'var(--fs-label)', color: 'var(--moss)', marginBottom: 10,
              background: 'rgba(245, 231, 192, 0.92)', border: '1px solid var(--moss)',
              borderRadius: 4, padding: '6px 10px',
            }}>{readyLabel}</p>
            <button className="rpg-button" onClick={onRestart} style={{ width: '100%', marginBottom: 8 }}>
              {restartNow}
            </button>
            <button onClick={onDismiss} className="rpg-button"
              style={{ width: '100%', padding: '4px 8px', fontSize: 'var(--fs-label)', background: 'transparent', border: '1px solid var(--gold-dark)', color: 'var(--gold-light)' }}>
              {restartLater}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
