import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSyncStatus,
  subscribeSyncStatus,
  resetSyncStatus,
  markSyncPending,
  markSyncStarted,
  markSyncPushed,
  markSyncPulled,
  markSyncError,
} from '../../src/shared/sync-status';

beforeEach(() => {
  resetSyncStatus();
});

describe('sync-status', () => {
  it('arranca en idle, sin sellos ni error', () => {
    expect(getSyncStatus()).toEqual({ state: 'idle', lastPushAt: null, lastPullAt: null, error: null });
  });

  it('un cambio local queda «pendiente»: hay trabajo esperando el debounce', () => {
    markSyncPending();
    expect(getSyncStatus().state).toBe('pending');
  });

  it('empezar a sincronizar se ve mientras dura', () => {
    markSyncPending();
    markSyncStarted();
    expect(getSyncStatus().state).toBe('syncing');
  });

  it('un push exitoso sella la hora de subida', () => {
    markSyncStarted();
    markSyncPushed('2026-09-03T10:00:00.000Z');
    expect(getSyncStatus()).toMatchObject({ state: 'synced', lastPushAt: '2026-09-03T10:00:00.000Z' });
  });

  it('un pull exitoso sella la hora de bajada sin tocar la de subida', () => {
    markSyncStarted();
    markSyncPushed('2026-09-03T10:00:00.000Z');
    markSyncStarted();
    markSyncPulled('2026-09-03T10:05:00.000Z');
    expect(getSyncStatus()).toMatchObject({
      state: 'synced',
      lastPushAt: '2026-09-03T10:00:00.000Z',
      lastPullAt: '2026-09-03T10:05:00.000Z',
    });
  });

  /* Lo que hace honesto al chip: si mientras subía llegó otro cambio, ese
     cambio NO viajó — decir «sincronizado» sería mentir. */
  it('un cambio llegado DURANTE el sync deja el estado en pendiente, no en sincronizado', () => {
    markSyncStarted();
    markSyncPending();
    expect(getSyncStatus().state).toBe('syncing');
    markSyncPushed('2026-09-03T10:00:00.000Z');
    expect(getSyncStatus()).toMatchObject({ state: 'pending', lastPushAt: '2026-09-03T10:00:00.000Z' });
  });

  it('el siguiente sync limpia la marca de sucio y ahí sí queda sincronizado', () => {
    markSyncStarted();
    markSyncPending();
    markSyncPushed('2026-09-03T10:00:00.000Z');
    markSyncStarted();
    markSyncPushed('2026-09-03T10:01:00.000Z');
    expect(getSyncStatus().state).toBe('synced');
  });

  it('un fallo se ve y guarda el motivo', () => {
    markSyncStarted();
    markSyncError('offline');
    expect(getSyncStatus()).toMatchObject({ state: 'error', error: 'offline' });
  });

  it('un sync exitoso posterior borra el error', () => {
    markSyncError('offline');
    markSyncStarted();
    expect(getSyncStatus().error).toBeNull();
    markSyncPushed('2026-09-03T10:00:00.000Z');
    expect(getSyncStatus()).toMatchObject({ state: 'synced', error: null });
  });

  it('notifica a los suscriptos y deja desuscribirse', () => {
    const fn = vi.fn();
    const off = subscribeSyncStatus(fn);
    markSyncPending();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    markSyncStarted();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /* useSyncExternalStore vuelve a renderizar en cada notificación y compara la
     referencia del snapshot: notificar sin cambio real es un render de más y,
     si además devolviera un objeto nuevo, un bucle infinito. */
  it('no notifica ni cambia la referencia cuando el estado no cambió', () => {
    const fn = vi.fn();
    subscribeSyncStatus(fn);
    markSyncPending();
    const snapshot = getSyncStatus();
    markSyncPending();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSyncStatus()).toBe(snapshot);
  });

  it('reset vuelve todo a cero (cambio de cuenta)', () => {
    markSyncStarted();
    markSyncPushed('2026-09-03T10:00:00.000Z');
    resetSyncStatus();
    expect(getSyncStatus()).toEqual({ state: 'idle', lastPushAt: null, lastPullAt: null, error: null });
  });
});
