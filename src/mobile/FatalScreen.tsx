/**
 * Pantalla terminal del binding Android (spec §3.5).
 *
 * Antes de `ready`: `main.tsx` la monta en lugar de <App/> con el `reason` del
 * mensaje `fatal` ('vfs' | 'open' | 'migration'). Después de `ready`: App.tsx
 * la muestra con reason 'crash' cuando llega `mobile:workerCrashed`.
 * «Reiniciar» recarga el WebView; no se recrea el worker en silencio.
 * El botón «Exportar .db» llega en la Fase 5 (src/mobile/backup.ts).
 */
import { useTranslation } from 'react-i18next';
import type { FatalReason } from './protocol';
import './fatal-screen.css';

export type FatalScreenReason = FatalReason | 'crash';

interface Props {
  reason: FatalScreenReason;
  message: string;
  namespace?: string;
  version?: number;
}

const FALLBACK: Record<FatalScreenReason, string> = {
  vfs: 'El almacenamiento local no está disponible en este dispositivo.',
  open: 'No se pudo abrir la base de datos.',
  migration: 'No se pudo actualizar la base de datos.',
  crash: 'El motor de datos se detuvo de forma inesperada.',
};

export default function FatalScreen({ reason, message, namespace, version }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mobile-fatal" role="alert">
      <div className="mobile-fatal__card">
        <h1 className="mobile-fatal__title">{t('mobile.fatal.title', 'El grimorio no se pudo abrir')}</h1>
        <p className="mobile-fatal__reason">{t(`mobile.fatal.${reason}`, FALLBACK[reason])}</p>
        {reason === 'migration' && namespace && (
          <p className="mobile-fatal__detail">
            {t('mobile.fatal.migrationDetail', 'Migración {{namespace}} v{{version}}', { namespace, version })}
          </p>
        )}
        <pre className="mobile-fatal__message">{message}</pre>
        <button type="button" className="mobile-fatal__button" onClick={() => window.location.reload()}>
          {t('mobile.fatal.restart', 'Reiniciar')}
        </button>
      </div>
    </div>
  );
}
