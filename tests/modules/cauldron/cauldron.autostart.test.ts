/**
 * Fase 1 del Caldero — the break arrives on its own, and the cycle loops.
 *
 * Before this, `onTimeUp()` parked the timer in `awaiting_next` and waited for a
 * click: get up for water and the break never started. And after the long break
 * `getNextSegment()` returned null, so a working day meant four manual starts.
 *
 * These tests drive the REAL handlers (mocked `electron` + injected DB + fake
 * timers) rather than a hand-copied version of the state machine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

interface TimerState {
  status: string;
  remainingMs: number;
  totalMs: number;
  currentCycle: number;
  totalCycles: number;
  sessionType: string;
  autoStartAt: number | null;
  round: number;
}

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
  BrowserWindow: { getAllWindows: () => [] },
  // OS notifications are not what is under test — and they would need a display.
  Notification: Object.assign(
    class {
      show() { /* noop */ }
    },
    { isSupported: () => false },
  ),
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../electron/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => false,
}));

const { registerCauldronIpcHandlers } = await import('../../../electron/modules/cauldron.ipc');

registerCauldronIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = harness.handlers.get(channel);
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

/** One-minute segments keep the fake clock arithmetic readable. */
const MIN = 60_000;
/** Must match AUTO_START_GRACE_MS in cauldron.ipc.ts. */
const GRACE = 5_000;

async function makePreset(opts: {
  autoStartBreak: boolean;
  autoStartWork: boolean;
  cyclesBeforeLong?: number;
}): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: `T-${Math.random()}`,
    workMinutes: 1,
    breakMinutes: 1,
    longBreakMinutes: 1,
    cyclesBeforeLong: opts.cyclesBeforeLong ?? 2,
    extensionMinutes: 5,
    autoStartBreak: opts.autoStartBreak,
    autoStartWork: opts.autoStartWork,
  });
}

beforeEach(async () => {
  harness.db = setupDb();
  vi.useFakeTimers();
  // Anchored at noon: this suite advances the clock by tens of minutes, and
  // starting from the real time makes a run near midnight cross the day
  // mid-test. Its sibling phase2 suite failed in CI exactly that way.
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  // Module-level timer state survives between tests — start each one from idle.
  await invoke('cauldron:stop');
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

// ── 1. The break arrives on its own ──────────────────────────

describe('auto-start of the next segment', () => {
  it('starts the break by itself 5 s after the work segment ends, with no confirmNext', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false });
    await invoke('cauldron:start', id);

    vi.advanceTimersByTime(1 * MIN);
    const armed = await state();
    expect(armed.status).toBe('awaiting_next');
    expect(armed.autoStartAt).not.toBeNull();

    vi.advanceTimersByTime(GRACE);
    const running = await state();
    expect(running.status).toBe('on_break');
    expect(running.sessionType).toBe('break');
    expect(running.autoStartAt).toBeNull();
  });

  it('«Esperá» cancels the auto-start and falls back to the classic awaiting_next', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false });
    await invoke('cauldron:start', id);

    vi.advanceTimersByTime(1 * MIN);
    expect((await state()).autoStartAt).not.toBeNull();

    const waited = await invoke<TimerState>('cauldron:cancelAutoStart');
    expect(waited.status).toBe('awaiting_next');
    expect(waited.autoStartAt).toBeNull();

    // Long past the grace window: nothing starts without an explicit Continue.
    vi.advanceTimersByTime(10 * GRACE);
    expect((await state()).status).toBe('awaiting_next');

    const next = await invoke<TimerState>('cauldron:confirmNext');
    expect(next.status).toBe('on_break');
  });

  it('pause during the grace window means the same thing as «Esperá»', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false });
    await invoke('cauldron:start', id);

    vi.advanceTimersByTime(1 * MIN);
    const waited = await invoke<TimerState>('cauldron:pause');

    expect(waited.status).toBe('awaiting_next');
    expect(waited.autoStartAt).toBeNull();
    vi.advanceTimersByTime(10 * GRACE);
    expect((await state()).status).toBe('awaiting_next');
  });

  it('leaves awaiting_next with nothing armed when auto_start_work is off', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false });
    await invoke('cauldron:start', id);

    // work -> (auto) break
    vi.advanceTimersByTime(1 * MIN + GRACE);
    expect((await state()).status).toBe('on_break');

    // break ends: auto_start_work is off, so the focus waits for the user.
    vi.advanceTimersByTime(1 * MIN);
    const parked = await state();
    expect(parked.status).toBe('awaiting_next');
    expect(parked.autoStartAt).toBeNull();

    vi.advanceTimersByTime(10 * GRACE);
    expect((await state()).status).toBe('awaiting_next');
  });

  it('does not auto-chain out of an extension', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false });
    await invoke('cauldron:start', id);

    vi.advanceTimersByTime(1 * MIN);
    await invoke('cauldron:extend', 1);
    expect((await state()).autoStartAt).toBeNull();

    vi.advanceTimersByTime(1 * MIN);
    const afterExtension = await state();
    expect(afterExtension.status).toBe('awaiting_next');
    expect(afterExtension.autoStartAt).toBeNull();
  });
});

// ── 2. Continuous loop ───────────────────────────────────────

describe('continuous loop after the long break', () => {
  it('opens a new lap at cycle 1 when auto_start_work is on', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: true, cyclesBeforeLong: 2 });
    await invoke('cauldron:start', id);

    // work 1 -> break -> work 2 -> long_break
    vi.advanceTimersByTime(1 * MIN + GRACE);
    expect((await state()).sessionType).toBe('break');

    vi.advanceTimersByTime(1 * MIN + GRACE);
    const secondWork = await state();
    expect(secondWork.sessionType).toBe('work');
    expect(secondWork.currentCycle).toBe(2);

    vi.advanceTimersByTime(1 * MIN + GRACE);
    const long = await state();
    expect(long.sessionType).toBe('long_break');
    expect(long.status).toBe('on_break');

    // The long break used to drop the timer to idle. Now it opens a new lap.
    vi.advanceTimersByTime(1 * MIN + GRACE);
    const newLap = await state();
    expect(newLap.status).toBe('work');
    expect(newLap.sessionType).toBe('work');
    expect(newLap.currentCycle).toBe(1);
    expect(newLap.totalCycles).toBe(2);
    expect(newLap.round).toBe(2);
  });

  it('offers the new lap in awaiting_next when auto_start_work is off', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false, cyclesBeforeLong: 1 });
    await invoke('cauldron:start', id);

    // Single-cycle recipe: the first work already leads into the long break.
    vi.advanceTimersByTime(1 * MIN + GRACE);
    expect((await state()).sessionType).toBe('long_break');

    vi.advanceTimersByTime(1 * MIN);
    const parked = await state();
    expect(parked.status).toBe('awaiting_next');
    expect(parked.autoStartAt).toBeNull();
    // Still alive: the recipe is loaded and a segment is queued, not idle.
    expect(parked.status).not.toBe('idle');

    const newLap = await invoke<TimerState>('cauldron:confirmNext');
    expect(newLap.status).toBe('work');
    expect(newLap.currentCycle).toBe(1);
    expect(newLap.round).toBe(2);
  });

  it('reports cycleComplete on the segment end that closes a lap', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: false, cyclesBeforeLong: 1 });
    await invoke('cauldron:start', id);

    vi.advanceTimersByTime(1 * MIN + GRACE);
    expect((await state()).sessionType).toBe('long_break');

    // The long break ending is the milestone; the loop keeps going regardless.
    vi.advanceTimersByTime(1 * MIN);
    const sessions = harness.db
      .prepare("SELECT type, completed FROM cauldron_sessions WHERE type = 'long_break'")
      .all() as Array<{ completed: number }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].completed).toBe(1);
  });

  it('stop ends the loop from any point', async () => {
    const id = await makePreset({ autoStartBreak: true, autoStartWork: true, cyclesBeforeLong: 2 });

    // ... while a segment is running
    await invoke('cauldron:start', id);
    vi.advanceTimersByTime(30_000);
    await invoke('cauldron:stop');
    expect((await state()).status).toBe('idle');

    // ... while the auto-start countdown is armed
    await invoke('cauldron:start', id);
    vi.advanceTimersByTime(1 * MIN);
    expect((await state()).autoStartAt).not.toBeNull();
    await invoke('cauldron:stop');
    const stopped = await state();
    expect(stopped.status).toBe('idle');
    expect(stopped.autoStartAt).toBeNull();
    expect(stopped.round).toBe(1);

    // Nothing starts behind the user's back after a stop.
    vi.advanceTimersByTime(10 * GRACE);
    expect((await state()).status).toBe('idle');
  });
});

// ── 3. Preset flags round-trip ───────────────────────────────

describe('auto-start preset flags', () => {
  it('defaults to break on / work off and round-trips explicit values', async () => {
    const defaulted = await invoke<string>('cauldron:upsertPreset', {
      name: 'Defaults',
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLong: 4,
      extensionMinutes: 5,
    });
    const explicit = await makePreset({ autoStartBreak: false, autoStartWork: true });

    const presets = await invoke<Array<Record<string, unknown>>>('cauldron:getPresets');
    const byId = new Map(presets.map((p) => [p.id as string, p]));

    expect(byId.get(defaulted)?.autoStartBreak).toBe(1);
    expect(byId.get(defaulted)?.autoStartWork).toBe(0);
    expect(byId.get(explicit)?.autoStartBreak).toBe(0);
    expect(byId.get(explicit)?.autoStartWork).toBe(1);

    // Seeded recipes keep the migration defaults.
    expect(byId.get('preset-classic')?.autoStartBreak).toBe(1);
    expect(byId.get('preset-classic')?.autoStartWork).toBe(0);
  });
});
