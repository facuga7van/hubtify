/**
 * «Trabajé 90 minutos sin el caldero» — registrar una sesión PASADA.
 *
 * La regla dura: cuenta para el registro, NO para la recompensa (mismo
 * precedente que la prórroga). La fila entra completada y con `retroactive = 1`
 * para que el estante no mienta, pero el main no emite `cauldron:sessionEnd`
 * — la única puerta por la que el renderer paga XP de pomodoros — ni ningún
 * otro broadcast. Cero recompensa.
 *
 * Como en `cauldron.phase2.test.ts`, esto maneja los handlers REALES
 * (`electron` mockeado + DB inyectada + timers falsos).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

interface ShelfSession {
  id: string;
  durationMinutes: number;
  completed: boolean;
  startedAt: string;
  completedAt: string;
  abandoned: boolean;
  retroactive: boolean;
}

interface LoggedRow {
  id: string;
  minutes: number;
  startedAt: string;
  completedAt: string;
}

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
  broadcasts: [] as Array<{ channel: string; data: unknown }>,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, data: unknown) => {
            harness.broadcasts.push({ channel, data });
          },
        },
      },
    ],
  },
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

const logPast = (payload: Record<string, unknown>) =>
  invoke<LoggedRow>('cauldron:logPastSession', payload);
const shelf = () =>
  invoke<{ sessions: ShelfSession[]; hasMore: boolean }>('cauldron:getSessions', 0, 50);
const stats = () =>
  invoke<{ today: number; week: number; total: number; streak: number }>('cauldron:getStats');

const MIN = 60_000;

function rowFor(id: string): Record<string, unknown> {
  return harness.db
    .prepare('SELECT * FROM cauldron_sessions WHERE id = ?')
    .get(id) as Record<string, unknown>;
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) db.exec(m.up);
  return db;
}

beforeEach(async () => {
  harness.db = setupDb();
  harness.broadcasts = [];
  vi.useFakeTimers();
  // Mediodía LOCAL: ni un clamp de 600 min (10 h) cruza la medianoche, así las
  // aserciones de «hoy» en getStats son deterministas.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  vi.setSystemTime(noon);
  // El estado del timer es de módulo y sobrevive entre tests.
  await invoke('cauldron:stop');
  harness.broadcasts = [];
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

// ── 1. Inserta completada, retroactiva y SIN recompensa ─────────

describe('cauldron:logPastSession', () => {
  it('inserta una sesión de trabajo completada con retroactive = 1', async () => {
    const logged = await logPast({ minutes: 90 });

    const row = rowFor(logged.id);
    expect(row.type).toBe('work');
    expect(row.completed).toBe(1);
    expect(row.retroactive).toBe(1);
    expect(row.abandoned).toBe(0);
    expect(row.is_extension).toBe(0);
    expect(row.duration_minutes).toBe(90);
    expect(row.deleted_at).toBeNull();
    // Perfil que el cleanup jamás toca: completada y sin deadline pendiente.
    expect(row.target_end_time).toBeNull();

    // Default de `when`: ahora − minutos. Termina exactamente ahora.
    expect(new Date(logged.startedAt).getTime()).toBe(Date.now() - 90 * MIN);
    expect(new Date(logged.completedAt).getTime()).toBe(Date.now());
  });

  it('NO emite ningún broadcast: cero XP, cero sessionEnd', async () => {
    await logPast({ minutes: 90 });

    // `cauldron:sessionEnd` es la única puerta por la que el renderer paga XP
    // de pomodoros (POMODORO_COMPLETED sale de ahí). Silencio total = cero
    // recompensa. La página recarga sus datos por su cuenta tras el submit.
    expect(harness.broadcasts).toHaveLength(0);
  });

  it('cuenta para el registro: aparece en el estante y en las stats', async () => {
    const logged = await logPast({ minutes: 25 });

    const { sessions } = await shelf();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(logged.id);
    expect(sessions[0].completed).toBe(true);
    expect(sessions[0].abandoned).toBe(false);
    // La marca visible: el frasco sale con borde punteado gracias a esto.
    expect(sessions[0].retroactive).toBe(true);

    const s = await stats();
    expect(s.today).toBe(1);
    expect(s.total).toBe(1);
  });

  it('respeta un `when` explícito en el pasado', async () => {
    const start = new Date(Date.now() - 5 * 60 * MIN); // hace 5 horas
    const logged = await logPast({ minutes: 60, when: start.toISOString() });

    expect(new Date(logged.startedAt).getTime()).toBe(start.getTime());
    expect(new Date(logged.completedAt).getTime()).toBe(start.getTime() + 60 * MIN);
  });
});

// ── 2. Clamp de minutos ─────────────────────────────────────────

describe('clamp de minutos (1–600)', () => {
  it('recorta por arriba: 999 → 600', async () => {
    const logged = await logPast({ minutes: 999 });
    expect(logged.minutes).toBe(600);
    expect(rowFor(logged.id).duration_minutes).toBe(600);
  });

  it('recorta por abajo: 0 → 1', async () => {
    const logged = await logPast({ minutes: 0 });
    expect(logged.minutes).toBe(1);
    expect(rowFor(logged.id).duration_minutes).toBe(1);
  });

  it('rechaza minutos que no son un número', async () => {
    await expect(logPast({ minutes: 'muchos' })).rejects.toThrow('Invalid minutes');
    await expect(logPast({})).rejects.toThrow('Invalid minutes');
  });
});

// ── 3. El futuro no se registra ─────────────────────────────────

describe('rechazo del futuro', () => {
  it('rechaza un `when` que arranca en el futuro', async () => {
    const future = new Date(Date.now() + 10 * MIN).toISOString();
    await expect(logPast({ minutes: 25, when: future })).rejects.toThrow(
      'Cannot log a session in the future',
    );
  });

  it('rechaza un `when` pasado cuyo FINAL cae en el futuro', async () => {
    // Arrancó hace 10 minutos pero declara 90: los últimos 80 aún no pasaron.
    const start = new Date(Date.now() - 10 * MIN).toISOString();
    await expect(logPast({ minutes: 90, when: start })).rejects.toThrow(
      'Cannot log a session in the future',
    );
  });

  it('rechaza una fecha imposible de parsear', async () => {
    await expect(logPast({ minutes: 25, when: 'anteayer' })).rejects.toThrow('Invalid date');
  });
});

// ── 4. presetId: la FK dura no voltea el registro ───────────────

describe('presetId opcional', () => {
  it('un presetId colgado se degrada a null en vez de tirar la inserción', async () => {
    const logged = await logPast({ minutes: 30, presetId: 'no-existe' });
    expect(rowFor(logged.id).preset_id).toBeNull();
  });

  it('un presetId válido queda escrito', async () => {
    const logged = await logPast({ minutes: 30, presetId: 'preset-classic' });
    expect(rowFor(logged.id).preset_id).toBe('preset-classic');
  });

  it('taskId viaja tal cual (sin FK, a propósito: puede venir de sync)', async () => {
    const logged = await logPast({ minutes: 30, taskId: 'task-que-este-device-no-vio' });
    expect(rowFor(logged.id).task_id).toBe('task-que-este-device-no-vio');
  });
});

// ── 5. El cleanup de huérfanas no la barre ──────────────────────

describe('cleanupOrphanedSessions', () => {
  it('no toca una sesión retroactiva en el próximo arranque', async () => {
    const logged = await logPast({ minutes: 45 });

    // Re-registrar simula el próximo arranque del main: corre
    // cleanupOrphanedSessions() contra la MISMA base.
    registerCauldronIpcHandlers();

    const row = rowFor(logged.id);
    expect(row.deleted_at).toBeNull();
    expect(row.completed).toBe(1);
    expect(row.retroactive).toBe(1);
  });
});
