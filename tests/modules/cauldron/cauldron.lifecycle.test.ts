/**
 * Fase 1 mobile: while the app is in background the worker closes the DB, so
 * the Cauldron must stop its 1 s tick on suspend() and re-arm it on resume().
 * The deadline (targetEndTime) is wall-clock, so nothing else needs saving.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { getHandler, runSuspend, runResume } from '../../../shared-logic/registry';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => false,
}));

const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');
registerCauldronIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const MIN = 60_000;

beforeEach(async () => {
  harness.db = new Database(':memory:');
  harness.db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) harness.db.exec(m.up);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  await invoke('cauldron:stop');
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

describe('cauldron lifecycle', () => {
  it('suspend() stops the tick; resume() re-arms it and the segment still ends on its wall-clock deadline', async () => {
    const id = await invoke<string>('cauldron:upsertPreset', {
      name: 'L', workMinutes: 1, breakMinutes: 1, longBreakMinutes: 1,
      cyclesBeforeLong: 2, extensionMinutes: 5, autoStartBreak: false, autoStartWork: false,
    });
    await invoke('cauldron:start', id);
    expect(vi.getTimerCount()).toBe(1);

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);

    runResume();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1 * MIN);
    const state = await invoke<{ status: string }>('cauldron:getState');
    expect(state.status).toBe('awaiting_next');
  });

  it('resume() with the timer idle arms nothing', async () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });
});
