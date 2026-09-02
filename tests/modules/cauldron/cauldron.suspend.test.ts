/**
 * Fase 2 mobile (spec §6 «Background» y §3.2 lifecycle).
 *
 * 1) `completed_at` es la hora en que la sesión REALMENTE terminó
 *    (`targetEndTime`), no la hora en que corrió el callback: en Android el
 *    worker se congela en segundo plano y el tick puede llegar 40 min tarde.
 * 2) `runSuspend()` limpia los intervals del caldero sin tocar el estado;
 *    `runResume()` los rearma y tickea de inmediato.
 *
 * Igual que cauldron.autostart.test.ts: handlers REALES + DB inyectada + fake
 * timers. `vi.setSystemTime` mueve el reloj de pared SIN disparar timers — es
 * exactamente lo que le pasa al worker congelado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

interface TimerState {
  status: string;
  autoStartAt: number | null;
}

const harness = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => false,
}));

const { getHandler, runSuspend, runResume } = await import('../../../shared-logic/registry');
const { setEventSink } = await import('../../../shared-logic/events');
const { setPlatform } = await import('../../../shared-logic/platform');
const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');

// `onTimeUp` llama `platform().notify(...)` (Fase 1 reemplazó `Notification`):
// un port inerte, equivalente al mock de `Notification` de cauldron.autostart.test.ts.
setPlatform({
  appVersion: () => '0.0.0-test',
  osInfo: () => 'test',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
});

registerCauldronIpcHandlers();

const events: Array<{ channel: string; payload: unknown }> = [];
setEventSink((channel, payload) => {
  events.push({ channel, payload });
});
const ticks = () => events.filter((e) => e.channel === 'cauldron:tick').length;

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const state = () => invoke<TimerState>('cauldron:getState');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) db.exec(m.up);
  return db;
}

/** Segmentos de un minuto para que la aritmética del reloj falso sea legible. */
const MIN = 60_000;

async function makePreset(opts: { autoStartBreak: boolean } = { autoStartBreak: false }): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: `T-${Math.random()}`,
    workMinutes: 1,
    breakMinutes: 1,
    longBreakMinutes: 1,
    cyclesBeforeLong: 2,
    extensionMinutes: 5,
    autoStartBreak: opts.autoStartBreak,
    autoStartWork: false,
  });
}

function completedRows(): Array<{ type: string; completedAt: string }> {
  return harness.db
    .prepare(
      `SELECT type, completed_at AS completedAt FROM cauldron_sessions
       WHERE completed = 1 AND deleted_at IS NULL ORDER BY created_at`,
    )
    .all() as Array<{ type: string; completedAt: string }>;
}

beforeEach(async () => {
  harness.db = setupDb();
  vi.useFakeTimers();
  // Mediodía: la suite mueve el reloj decenas de minutos y no debe cruzar el día.
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  await invoke('cauldron:stop'); // el estado del timer es de módulo: arrancar en idle
  events.length = 0;
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

describe('onTimeUp: completed_at es la hora en que la sesión terminó', () => {
  it('un tick que llega 40 min tarde registra targetEndTime, no la hora actual', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);

    // Worker congelado: el reloj de pared salta sin que corra ningún tick.
    vi.setSystemTime(target + 40 * MIN);
    vi.advanceTimersByTime(1000); // un solo tick al descongelar

    const rows = completedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('work');
    expect(rows[0].completedAt).toBe(new Date(target).toISOString());
    expect(rows[0].completedAt).not.toBe(new Date().toISOString());
  });

  it('a tiempo, completed_at coincide con el target', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(1 * MIN);
    expect(completedRows()[0].completedAt).toBe(new Date(target).toISOString());
  });
});

describe('lifecycle: runSuspend / runResume', () => {
  it('suspend frena los ticks; resume rearma el interval y tickea de inmediato', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(2000);
    const before = ticks();
    expect(before).toBeGreaterThanOrEqual(2);
    expect(vi.getTimerCount()).toBe(1);

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(ticks()).toBe(before);

    runResume();
    expect(ticks()).toBe(before + 1); // tick inmediato
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(ticks()).toBe(before + 2);
    expect((await state()).status).toBe('work');
  });

  it('una sesión vencida durante la suspensión se completa al reanudar, con completed_at = target', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);

    runSuspend();
    vi.setSystemTime(target + 5 * MIN);
    runResume();

    const rows = completedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].completedAt).toBe(new Date(target).toISOString());
    expect((await state()).status).toBe('awaiting_next');
  });

  it('en idle, suspend y resume no arman nada', () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resume durante la cuenta regresiva de auto-inicio la rearma y dispara el descanso', async () => {
    const presetId = await makePreset({ autoStartBreak: true });
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(1 * MIN); // termina el enfoque → awaiting_next con autoStartAt
    expect((await state()).status).toBe('awaiting_next');
    expect((await state()).autoStartAt).not.toBeNull();

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    expect((await state()).autoStartAt).not.toBeNull(); // el estado no se toca

    vi.setSystemTime(Date.now() + 10_000); // la gracia de 5 s ya pasó
    runResume();
    vi.advanceTimersByTime(1000);
    expect((await state()).status).toBe('on_break');
  });
});
