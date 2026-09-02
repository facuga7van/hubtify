/**
 * Pantalla terminal del binding Android (spec §3.5).
 *
 * Antes de `ready`: `main.tsx` la monta en lugar de <App/> con el `reason` del
 * mensaje `fatal` ('vfs' | 'open' | 'migration'). Después de `ready`: App.tsx
 * la muestra con reason 'crash' cuando llega `mobile:workerCrashed`.
 * «Reiniciar» recarga el WebView; no se recrea el worker en silencio.
 * «Exportar base de datos» (Fase 5, src/mobile/backup.ts) solo aparece tras un
 * fatal de migración: ahí el archivo existe y el worker sigue vivo.
 */
import { useEffect, useState } from 'react';
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

type ExportState = 'idle' | 'busy' | 'done' | 'failed';

export default function FatalScreen({ reason, message, namespace, version }: Props) {
  const { t } = useTranslation();

  // Un fatal de migración deja el archivo intacto en OPFS: se puede rescatar
  // antes de reiniciar. Con el VFS caído no hay nada que leer; con el worker
  // muerto (crash) no hay quien lo lea — canExportDb() lo sabe.
  // Solo `migration` (spec §12): el VFS y el archivo existen, los canales
  // mobile:* ya están registrados y el worker sigue vivo. En `vfs`/`open` no
  // hay archivo o no hay handler; en `crash` no hay worker.
  //
  // Los dos `import()` van detrás de la comparación LITERAL de
  // `__HUBTIFY_PLATFORM__` (misma forma que main.tsx), no del const
  // `IS_ANDROID_BUILD`: App.tsx carga FatalScreen con lazy() también en
  // desktop, y esbuild solo borra el import en el transform si la condición se
  // pliega ahí mismo. Con el const, Rollup igual resuelve `./backup` →
  // install-api → `new Worker(new URL('./worker.ts'))` y el plugin de workers
  // EMITE el bundle del worker (una copia de sqlite-wasm) aunque después el
  // código muerto se elimine.
  const [canExport, setCanExport] = useState(false);
  const [exportState, setExportState] = useState<ExportState>('idle');
  useEffect(() => {
    let alive = true;
    if (typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android' && reason === 'migration') {
      import('./backup')
        .then(({ canExportDb }) => { if (alive) setCanExport(canExportDb()); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [reason]);

  const handleExport = async () => {
    if (typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android') {
      setExportState('busy');
      try {
        const { mobileBackup } = await import('./backup');
        const result = await mobileBackup().exportDb();
        setExportState(result.success ? 'done' : result.canceled ? 'idle' : 'failed');
      } catch {
        setExportState('failed');
      }
    }
  };

  return (
    <div className="mobile-fatal" role="alert">
      <div className="mobile-fatal__card">
        <h1 className="mobile-fatal__title">{t('mobile.fatal.title', 'El grimorio no se pudo abrir')}</h1>
        <p className="mobile-fatal__reason">{t(`mobile.fatal.${reason}`, FALLBACK[reason])}</p>
        {reason === 'migration' && namespace && version !== undefined && (
          <p className="mobile-fatal__detail">
            {t('mobile.fatal.migrationDetail', 'Migración {{namespace}} v{{version}}', { namespace, version })}
          </p>
        )}
        <pre className="mobile-fatal__message">{message}</pre>
        {exportState === 'done' && (
          <p className="mobile-fatal__detail">{t('mobile.fatal.exportDbDone', 'Base de datos exportada. Guardala antes de reiniciar.')}</p>
        )}
        {exportState === 'failed' && (
          <p className="mobile-fatal__detail">{t('mobile.fatal.exportDbFailed', 'No se pudo exportar la base de datos.')}</p>
        )}
        <div className="mobile-fatal__actions">
          {canExport && (
            <button type="button" className="mobile-fatal__button" onClick={handleExport} disabled={exportState === 'busy'}>
              {t('mobile.fatal.exportDb', 'Exportar base de datos')}
            </button>
          )}
          <button type="button" className="mobile-fatal__button" onClick={() => window.location.reload()}>
            {t('mobile.fatal.restart', 'Reiniciar')}
          </button>
        </div>
      </div>
    </div>
  );
}
