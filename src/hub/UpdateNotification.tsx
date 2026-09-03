import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { changelog } from '../shared/changelog';
import useModalA11y from '../shared/hooks/useModalA11y';
import './styles/shell.css';

const TITLE_ID = 'update-dialog-title';

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
 *
 * Es un modal de verdad —tapa la app entera y pide reiniciar— y era el único
 * que no lo decía: sin `role`, sin `aria-modal`, sin trampa de foco y sin
 * Escape. Pasa por el mismo `useModalA11y` que los otros 21 (ítem 18 de la
 * rúbrica). De paso deja los estilos en línea y usa `.update-dialog*`, que
 * estaba escrito en `shell.css` desde siempre y no lo usaba nadie.
 */
export default function UpdateNotification({ version, state, percent, error, onDownload, onRestart, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const { dialogProps } = useModalA11y<HTMLDivElement>({ onClose: onDismiss });
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es';
  const whatsNew = lang === 'en' ? "What's new" : 'Qué hay de nuevo';
  const readyLabel = lang === 'en' ? 'Update ready to install' : 'Actualización lista para instalar';
  const restartNow = lang === 'en' ? 'Restart now' : 'Reiniciar ahora';
  const restartLater = lang === 'en' ? 'Later' : 'Después';

  const entry = changelog.find((e) => e.version === version);

  return (
    <div className="update-dialog-overlay">
      <div className="update-dialog" {...dialogProps} aria-labelledby={TITLE_ID}>
        <h3 id={TITLE_ID} className="update-dialog__title">
          {t('settings.updateAvailable', { version })}
        </h3>

        {/* What's new — pulled from the changelog */}
        {entry && entry.changes.length > 0 && (
          <div className="update-dialog__news">
            <p className="qb-small-caps update-dialog__news-title">{whatsNew}</p>
            <ul className="update-dialog__news-list">
              {entry.changes.map((c, i) => (
                <li key={i} className="update-dialog__news-item">{c.text[lang]}</li>
              ))}
            </ul>
          </div>
        )}

        {state === 'downloading' && (
          <div className="update-dialog__progress">
            <div className="update-dialog__track">
              <div className="update-dialog__fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="update-dialog__percent">{percent}%</span>
          </div>
        )}

        {error && (
          <p role="alert" title={error} className="update-dialog__error">
            {humanUpdateError(error, t)}
          </p>
        )}

        {state === 'idle' && (
          <>
            <button className="rpg-button update-dialog__primary" onClick={onDownload}>
              {t('settings.downloadUpdate')}
            </button>
            {/* Decía `nutrify.weightCheckin.later`: una clave del módulo de
                nutrición usada en el diálogo de actualización. */}
            <button onClick={onDismiss} className="rpg-button update-dialog__secondary">
              {t('common.later', 'Más tarde')}
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            {/* `--moss` sobre `--leather` son 1.69:1: el ÚNICO cartel que
                confirma que la actualización ya está lista era ilegible. El
                verde vive ahora en una tablilla de pergamino (8.1:1). */}
            <p className="update-dialog__ready">{readyLabel}</p>
            <button className="rpg-button update-dialog__primary" onClick={onRestart}>
              {restartNow}
            </button>
            <button onClick={onDismiss} className="rpg-button update-dialog__secondary">
              {restartLater}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
