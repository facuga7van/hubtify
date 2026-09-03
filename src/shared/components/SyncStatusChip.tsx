import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../AuthContext';
import { getSyncStatus, subscribeSyncStatus, type SyncState } from '../sync-status';
import { ArrowUp, Checkmark, Compass, Padlock, WarningTriangle } from './icons';
import '../styles/sync-status-chip.css';

/** Sin sesión no hay nube: decirlo, en vez de mostrar un check que sería mentira. */
type ChipKind = SyncState | 'local';

const ICONS: Record<ChipKind, (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  local: Padlock,
  idle: Compass,
  pending: ArrowUp,
  syncing: Compass,
  synced: Checkmark,
  error: WarningTriangle,
};

const LABELS: Record<ChipKind, [key: string, fallback: string]> = {
  local: ['auth.syncLocalOnly', 'Solo en este dispositivo'],
  idle: ['auth.syncIdle', 'Sin sincronizar todavía'],
  pending: ['auth.syncPending', 'Cambios sin subir'],
  syncing: ['auth.syncSyncing', 'Sincronizando…'],
  synced: ['auth.syncUpToDate', 'Todo sincronizado'],
  error: ['auth.syncTrouble', 'No pudimos sincronizar'],
};

/**
 * El estado de sync, a la vista y en palabras. Va en la cabecera de 56 px de
 * Android y arriba del contenido en escritorio, al lado del banner de error de
 * sync que hasta ahora era la única señal — y solo ante el fallo.
 *
 * `role="img"` + `aria-label` a propósito y no `role="status"`: un status es una
 * región viva y anunciaría «Sincronizando… / Todo sincronizado» en voz alta en
 * cada push diferido. Acá alcanza con que se pueda consultar.
 */
export default function SyncStatusChip({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { user } = useAuthContext();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

  const kind: ChipKind = user ? status.state : 'local';
  const Icon = ICONS[kind];
  const [key, fallback] = LABELS[kind];
  const label = t(key, fallback);

  return (
    <div
      className={`sync-chip ${className}`.trim()}
      data-sync-state={kind}
      data-testid="sync-chip"
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon className="sync-chip__ico" width={14} height={14} aria-hidden="true" focusable="false" />
      <span className="sync-chip__text">{label}</span>
    </div>
  );
}
