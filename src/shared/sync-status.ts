/**
 * Estado de sincronización, para poder MOSTRARLO.
 *
 * Antes la única señal de sync en toda la app era «solo ante el fallo»: un
 * banner rojo si el pull inicial reventaba y un toast si el push fallaba. En el
 * flujo normal el usuario nunca veía si sus datos ya habían subido, y
 * confirmarlo costaba tres taps hasta Ajustes — donde además el sello que se
 * muestra es el del último *pull*, no el del *push*. Eso es exactamente lo que
 * rompe la confianza al cambiar de dispositivo.
 *
 * Lógica pura, sin DOM ni React: `src/shared/sync.ts` la alimenta y
 * `SyncStatusChip.tsx` la lee con `useSyncExternalStore`.
 */

export type SyncState =
  /** Todavía no pasó nada en esta sesión. */
  | 'idle'
  /** Hay cambios locales esperando el push diferido. */
  | 'pending'
  /** Push o pull en vuelo. */
  | 'syncing'
  /** Lo último que había local ya viajó. */
  | 'synced'
  /** El último intento falló. */
  | 'error';

export interface SyncStatus {
  readonly state: SyncState;
  /** ISO del último push exitoso, o null. */
  readonly lastPushAt: string | null;
  /** ISO del último pull exitoso, o null. */
  readonly lastPullAt: string | null;
  readonly error: string | null;
}

const INITIAL: SyncStatus = { state: 'idle', lastPushAt: null, lastPullAt: null, error: null };

let current: SyncStatus = INITIAL;

/**
 * Llegó un cambio local MIENTRAS había un sync en vuelo. Ese cambio no viajó,
 * así que al terminar el sync el estado tiene que volver a «pendiente» y no
 * decir «sincronizado», que sería mentira.
 */
let dirtyDuringSync = false;

const listeners = new Set<() => void>();

/** Reemplaza el snapshot solo si algo cambió de verdad (useSyncExternalStore compara por referencia). */
function set(next: SyncStatus): void {
  if (
    next.state === current.state
    && next.lastPushAt === current.lastPushAt
    && next.lastPullAt === current.lastPullAt
    && next.error === current.error
  ) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function getSyncStatus(): SyncStatus {
  return current;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Vuelve a cero: cambio de cuenta, logout y tests. */
export function resetSyncStatus(): void {
  dirtyDuringSync = false;
  set(INITIAL);
}

/** Hay trabajo local esperando el push diferido. */
export function markSyncPending(): void {
  if (current.state === 'syncing') {
    dirtyDuringSync = true;
    return;
  }
  set({ ...current, state: 'pending' });
}

export function markSyncStarted(): void {
  dirtyDuringSync = false;
  set({ ...current, state: 'syncing', error: null });
}

export function markSyncPushed(at: string = new Date().toISOString()): void {
  set({ ...current, state: dirtyDuringSync ? 'pending' : 'synced', lastPushAt: at, error: null });
}

export function markSyncPulled(at: string = new Date().toISOString()): void {
  set({ ...current, state: dirtyDuringSync ? 'pending' : 'synced', lastPullAt: at, error: null });
}

export function markSyncError(message: string): void {
  set({ ...current, state: 'error', error: message });
}
