/**
 * Fase 2 mobile (spec §3.2): el polling de notificaciones (30 min, toca la DB)
 * se detiene cuando el worker suspende y se rearma al reanudar — solo si
 * estaba corriendo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const harness = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { runSuspend, runResume } = await import('../../../shared-logic/registry');
const { registerNotificationIpcHandlers, startNotificationEngine, stopNotificationEngine } =
  await import('../../../shared-logic/modules/notifications.ipc');

registerNotificationIpcHandlers();

beforeEach(() => {
  harness.db = new Database(':memory:');
  vi.useFakeTimers();
});

afterEach(() => {
  stopNotificationEngine();
  vi.useRealTimers();
});

describe('notification engine lifecycle', () => {
  it('startNotificationEngine es idempotente', () => {
    startNotificationEngine();
    startNotificationEngine();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('suspend detiene el polling y resume lo rearma', () => {
    startNotificationEngine();
    expect(vi.getTimerCount()).toBe(1);
    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    runResume();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('si el motor no estaba corriendo, resume no lo arranca', () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop explícito después de un ciclo suspend/resume deja todo limpio', () => {
    startNotificationEngine();
    runSuspend();
    runResume();
    stopNotificationEngine();
    expect(vi.getTimerCount()).toBe(0);
  });
});
