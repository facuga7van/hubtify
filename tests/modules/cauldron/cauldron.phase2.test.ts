/**
 * Fase 2 del Caldero — el vínculo con Questify y el Estante de Pociones.
 *
 * Las dos reglas duras que estos tests protegen:
 *  1. La misión es OPCIONAL y POST-HOC. Nunca es un peaje antes del play: se
 *     puede encender sin elegir nada y etiquetar después, incluso cuando el
 *     enfoque YA terminó (que es cuando uno sabe qué hizo).
 *  2. La pérdida es SIMBÓLICA, jamás numérica. Cortar un enfoque pasado el
 *     umbral deja un frasco roto en el estante — se ve, no se cuenta —, y el
 *     estante NUNCA se vacía.
 *
 * Como en `cauldron.autostart.test.ts`, esto maneja los handlers REALES
 * (`electron` mockeado + DB inyectada + timers falsos), no una copia a mano de
 * la máquina de estados.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { questsMigrations } from '@modules/quests/quests.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

interface TimerState {
  status: string;
  sessionType: string;
  taskId: string | null;
  taskName: string | null;
  taskProjectId: string | null;
  taskProjectColor: string | null;
}

interface ShelfSession {
  id: string;
  durationMinutes: number;
  completed: boolean;
  startedAt: string;
  abandoned: boolean;
  elapsedMinutes: number | null;
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
}

interface WeekRow {
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  sessions: number;
  minutes: number;
}

interface Broadcast {
  channel: string;
  data: Record<string, unknown>;
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
  // Una ventana falsa que anota lo que se le manda: así se puede afirmar que el
  // evento de abandono sale UNA sola vez.
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

vi.mock('../../../electron/ipc/db', () => ({ getDb: () => harness.db }));
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
const shelf = () => invoke<{ sessions: ShelfSession[]; hasMore: boolean }>('cauldron:getSessions', 0, 50);
const week = () => invoke<WeekRow[]>('cauldron:getWeekByProject');
const stats = () => invoke<{ today: number; week: number; total: number }>('cauldron:getStats');

/** Los `sessionEnd` emitidos desde el último reset. */
function sessionEnds(): Broadcast[] {
  return harness.broadcasts
    .filter((b) => b.channel === 'cauldron:sessionEnd')
    .map((b) => ({ channel: b.channel, data: b.data as Record<string, unknown> }));
}

const MIN = 60_000;
const PROJECT_ID = 'proj-work';
const PROJECT_COLOR = '#3b6ea5';
const TASK_ID = 'task-refactor';
const TASK_2_ID = 'task-invoices';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // Deliberadamente ON: si alguna vez se le pone una FK dura a
  // `cauldron_sessions.task_id`, este test se cae — y tiene que caerse, porque
  // sync puede traer sesiones de tareas que este dispositivo todavía no vio.
  db.pragma('foreign_keys = ON');
  // Ambos módulos viven en la MISMA base: el JOIN del estante es directo.
  for (const m of cauldronMigrations) db.exec(m.up);
  for (const m of questsMigrations) db.exec(m.up);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, color, project_order, created_at) VALUES (?, ?, ?, 0, ?)`,
  ).run(PROJECT_ID, 'Trabajo', PROJECT_COLOR, now);
  db.prepare(
    `INSERT INTO tasks (id, name, status, tier, project_id, created_at, updated_at)
     VALUES (?, ?, 0, 2, ?, ?, ?)`,
  ).run(TASK_ID, 'Refactor del login', PROJECT_ID, now, now);
  db.prepare(
    `INSERT INTO tasks (id, name, status, tier, project_id, created_at, updated_at)
     VALUES (?, ?, 0, 2, NULL, ?, ?)`,
  ).run(TASK_2_ID, 'Facturas sueltas', now, now);

  return db;
}

async function makePreset(workMinutes: number, autoStartBreak = false): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: `T-${Math.random()}`,
    workMinutes,
    breakMinutes: 1,
    longBreakMinutes: 1,
    cyclesBeforeLong: 4,
    extensionMinutes: 5,
    autoStartBreak,
    autoStartWork: false,
  });
}

function rowFor(id: string): Record<string, unknown> {
  return harness.db
    .prepare('SELECT * FROM cauldron_sessions WHERE id = ?')
    .get(id) as Record<string, unknown>;
}

function allRows(): Array<Record<string, unknown>> {
  return harness.db
    .prepare('SELECT * FROM cauldron_sessions ORDER BY started_at ASC')
    .all() as Array<Record<string, unknown>>;
}

beforeEach(async () => {
  harness.db = setupDb();
  harness.broadcasts = [];
  vi.useFakeTimers();
  /*
   * Reloj anclado al mediodía, no a la hora real.
   *
   * Los tests arrancan sesiones y adelantan el reloj decenas de minutos. Con la
   * hora real de arranque, correr la suite cerca de la medianoche cruzaba de
   * día en el medio: la sesión completada quedaba contada en el día anterior y
   * `stats().today` daba 0. Pasó en CI a las 23:29 y en la máquina de nadie,
   * que es la peor forma de fallar. El mediodía deja horas de margen para
   * adelantar sin cambiar de fecha.
   */
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  // El estado del timer es de módulo y sobrevive entre tests.
  await invoke('cauldron:stop');
  harness.broadcasts = [];
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

// ── 1. El vínculo: opcional y post-hoc ───────────────────────

describe('vínculo con la misión', () => {
  it('viaja por `start` y queda escrito en la fila de la sesión', async () => {
    const preset = await makePreset(25);
    const started = await invoke<TimerState>('cauldron:start', preset, TASK_ID);

    expect(started.taskId).toBe(TASK_ID);
    expect(started.taskName).toBe('Refactor del login');
    expect(started.taskProjectId).toBe(PROJECT_ID);
    // El color viaja EN EL ESTADO: ninguna superficie tiene que consultarlo.
    expect(started.taskProjectColor).toBe(PROJECT_COLOR);

    const rows = allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBe(TASK_ID);
  });

  it('encender SIN misión es un camino de primera clase, no un error', async () => {
    const preset = await makePreset(25);
    const started = await invoke<TimerState>('cauldron:start', preset);

    expect(started.status).toBe('work');
    expect(started.taskId).toBeNull();
    expect(allRows()[0].task_id).toBeNull();
  });

  it('`setSessionTask` etiqueta la sesión EN CURSO sin tocar el timer', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset);
    const id = allRows()[0].id as string;

    vi.advanceTimersByTime(3 * MIN);
    const linked = await invoke<TimerState>('cauldron:setSessionTask', TASK_ID);

    expect(linked.status).toBe('work');
    expect(linked.taskId).toBe(TASK_ID);
    expect(linked.taskName).toBe('Refactor del login');
    expect(rowFor(id).task_id).toBe(TASK_ID);
  });

  it('cambia de misión a mitad de camino', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset, TASK_ID);
    const id = allRows()[0].id as string;

    const changed = await invoke<TimerState>('cauldron:setSessionTask', TASK_2_ID);
    expect(changed.taskId).toBe(TASK_2_ID);
    expect(changed.taskName).toBe('Facturas sueltas');
    // Sin proyecto: el frasco queda gris-neutro.
    expect(changed.taskProjectColor).toBeNull();
    expect(rowFor(id).task_id).toBe(TASK_2_ID);
  });

  it('desvincula con null', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset, TASK_ID);
    const id = allRows()[0].id as string;

    const cleared = await invoke<TimerState>('cauldron:setSessionTask', null);
    expect(cleared.taskId).toBeNull();
    expect(cleared.taskName).toBeNull();
    expect(rowFor(id).task_id).toBeNull();
  });

  it('en `awaiting_next` tras un enfoque, etiqueta el frasco RECIÉN depositado', async () => {
    // Este es el corazón del "post-hoc": el enfoque ya terminó, no hay sesión
    // activa, y sin embargo la etiqueta tiene que llegar al frasco correcto.
    const preset = await makePreset(1);
    await invoke('cauldron:start', preset);
    const id = allRows()[0].id as string;

    vi.advanceTimersByTime(1 * MIN);
    expect((await state()).status).toBe('awaiting_next');
    expect(rowFor(id).completed).toBe(1);
    expect(rowFor(id).task_id).toBeNull();

    await invoke('cauldron:setSessionTask', TASK_ID);

    expect(rowFor(id).task_id).toBe(TASK_ID);
    const jars = (await shelf()).sessions;
    expect(jars[0].taskName).toBe('Refactor del login');
    expect(jars[0].projectColor).toBe(PROJECT_COLOR);
  });

  it('en `idle` no rompe: no hay frasco al que adjuntarla', async () => {
    const idle = await invoke<TimerState>('cauldron:setSessionTask', TASK_ID);
    expect(idle.status).toBe('idle');
    expect(idle.taskId).toBeNull();
  });

  it('una misión borrada entre medio conserva el vínculo y pierde el nombre', async () => {
    const preset = await makePreset(1);
    await invoke('cauldron:start', preset, TASK_ID);
    const id = allRows()[0].id as string;
    vi.advanceTimersByTime(1 * MIN);

    // La misión se borra en Questify mientras el pomodoro corría.
    harness.db
      .prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), TASK_ID);

    // Nada tira, y el frasco no desaparece: pasa a ser «sin etiqueta».
    const jars = (await shelf()).sessions;
    expect(jars).toHaveLength(1);
    expect(jars[0].taskId).toBe(TASK_ID);
    expect(jars[0].taskName).toBeNull();
    expect(rowFor(id).task_id).toBe(TASK_ID);

    const linked = await invoke<TimerState>('cauldron:setSessionTask', TASK_ID);
    expect(linked.taskId).toBe(TASK_ID);
    expect(linked.taskName).toBeNull();
  });
});

// ── 2. La cicatriz ───────────────────────────────────────────

describe('abandono de un enfoque', () => {
  it('pasados 5 minutos deja un frasco roto y emite el evento UNA sola vez', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset, TASK_ID);
    const id = allRows()[0].id as string;

    vi.advanceTimersByTime(6 * MIN);
    harness.broadcasts = [];
    await invoke('cauldron:stop');

    const row = rowFor(id);
    expect(row.abandoned).toBe(1);
    expect(row.completed).toBe(0);
    // La cicatriz NO se borra: la fila sigue viva.
    expect(row.deleted_at).toBeNull();

    const ends = sessionEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].data.abandoned).toBe(true);
    expect(ends[0].data.elapsedMinutes).toBe(6);
    expect(ends[0].data.taskId).toBe(TASK_ID);

    // Un segundo `stop` (doble click, otra superficie) no vuelve a emitir.
    await invoke('cauldron:stop');
    expect(sessionEnds()).toHaveLength(1);
  });

  it('antes de los 5 minutos no deja rastro — un arranque en falso no es una promesa rota', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset, TASK_ID);
    const id = allRows()[0].id as string;

    vi.advanceTimersByTime(2 * MIN);
    harness.broadcasts = [];
    await invoke('cauldron:stop');

    const row = rowFor(id);
    expect(row.abandoned).toBe(0);
    expect(row.deleted_at).not.toBeNull();
    expect(sessionEnds()).toHaveLength(0);
    expect((await shelf()).sessions).toHaveLength(0);
  });

  it('un frasco roto se VE en el estante pero NO se cuenta como pomodoro', async () => {
    const preset = await makePreset(25);

    // Un enfoque completo: ese sí cuenta.
    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(25 * MIN);
    await invoke('cauldron:stop');

    // Y uno abandonado a los 8 minutos.
    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(8 * MIN);
    await invoke('cauldron:stop');

    const counted = await stats();
    expect(counted.today).toBe(1);
    expect(counted.total).toBe(1);

    const jars = (await shelf()).sessions;
    expect(jars).toHaveLength(2);
    const broken = jars.find((j) => j.abandoned);
    expect(broken).toBeDefined();
    expect(broken?.completed).toBe(false);
    expect(broken?.elapsedMinutes).toBe(8);
    // El color del proyecto también pinta al roto: sigue siendo identificable.
    expect(broken?.projectColor).toBe(PROJECT_COLOR);
  });

  it('cortar una PRÓRROGA no deja cicatriz: el ciclo ya se había cobrado', async () => {
    const preset = await makePreset(1);
    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(1 * MIN);

    await invoke('cauldron:extend', 25);
    vi.advanceTimersByTime(8 * MIN);
    harness.broadcasts = [];
    await invoke('cauldron:stop');

    expect(sessionEnds()).toHaveLength(0);
    const rows = allRows();
    const extension = rows.find((r) => r.is_extension === 1);
    expect(extension?.abandoned).toBe(0);
    expect(extension?.deleted_at).not.toBeNull();
  });

  it('cortar un DESCANSO no deja cicatriz', async () => {
    const preset = await makePreset(1);
    await invoke('cauldron:start', preset);
    vi.advanceTimersByTime(1 * MIN);
    await invoke('cauldron:confirmNext');
    expect((await state()).sessionType).toBe('break');

    vi.advanceTimersByTime(30_000);
    harness.broadcasts = [];
    await invoke('cauldron:stop');

    expect(sessionEnds()).toHaveLength(0);
  });

  it('el estante NUNCA se vacía: la limpieza de arranque no toca los frascos rotos', async () => {
    const preset = await makePreset(25);
    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(9 * MIN);
    await invoke('cauldron:stop');

    expect((await shelf()).sessions).toHaveLength(1);

    // Volver a registrar los handlers dispara `cleanupOrphanedSessions()`,
    // exactamente como el arranque de la app. Un frasco roto es una fila
    // incompleta sin `target_end_time` — justo el perfil que esa limpieza borra.
    registerCauldronIpcHandlers();

    const jars = (await shelf()).sessions;
    expect(jars).toHaveLength(1);
    expect(jars[0].abandoned).toBe(true);
  });
});

// ── 3. La respuesta semanal ──────────────────────────────────

describe('getWeekByProject', () => {
  it('agrupa por misión, con y sin tarea vinculada', async () => {
    const preset = await makePreset(10);

    // Dos enfoques sobre la misma misión con proyecto.
    for (let i = 0; i < 2; i++) {
      await invoke('cauldron:start', preset, TASK_ID);
      vi.advanceTimersByTime(10 * MIN);
      await invoke('cauldron:stop');
    }
    // Uno sobre una misión sin proyecto.
    await invoke('cauldron:start', preset, TASK_2_ID);
    vi.advanceTimersByTime(10 * MIN);
    await invoke('cauldron:stop');
    // Y uno suelto, sin misión: el caso que NUNCA puede romper el agrupado.
    await invoke('cauldron:start', preset);
    vi.advanceTimersByTime(10 * MIN);
    await invoke('cauldron:stop');

    const rows = await week();
    expect(rows).toHaveLength(3);

    const withProject = rows.find((r) => r.taskId === TASK_ID);
    expect(withProject).toMatchObject({
      taskName: 'Refactor del login',
      projectId: PROJECT_ID,
      projectName: 'Trabajo',
      projectColor: PROJECT_COLOR,
      sessions: 2,
      minutes: 20,
    });

    const noProject = rows.find((r) => r.taskId === TASK_2_ID);
    expect(noProject).toMatchObject({ projectId: null, sessions: 1, minutes: 10 });

    const loose = rows.find((r) => r.taskId === null);
    expect(loose).toMatchObject({ taskName: null, sessions: 1, minutes: 10 });
  });

  it('excluye prórrogas y abandonos: es el resumen de lo que se logró', async () => {
    const preset = await makePreset(10);

    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(10 * MIN);
    await invoke('cauldron:extend', 5);
    vi.advanceTimersByTime(5 * MIN);
    await invoke('cauldron:stop');

    await invoke('cauldron:start', preset, TASK_ID);
    vi.advanceTimersByTime(7 * MIN);
    await invoke('cauldron:stop');

    const rows = await week();
    expect(rows).toHaveLength(1);
    // Un solo pomodoro de 10 min: ni la prórroga ni el abandono suman.
    expect(rows[0]).toMatchObject({ taskId: TASK_ID, sessions: 1, minutes: 10 });
  });

  it('sin sesiones devuelve una lista vacía, no un error', async () => {
    expect(await week()).toEqual([]);
  });
});
