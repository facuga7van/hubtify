/**
 * El reloj DETENIDO sobrevive a que el sistema mate el proceso.
 *
 * En Android el aviso persistente del Caldero sigue publicado aunque la app deje
 * de existir, y con él su botón «Reanudar». La secuencia que rompía:
 *
 *   1. el usuario pausa — la fila perdía `target_end_time` y quedaba
 *      indistinguible de un huérfano;
 *   2. Android recicla el proceso durante la noche;
 *   3. a la mañana el usuario aprieta «Reanudar»: el arranque en frío veía
 *      `idle`, el plan vacío BAJABA el aviso, y el `cauldron:resume` encolado
 *      moría con «Timer not paused».
 *
 * Botón apretado, aviso desaparecido, sesión perdida, cero señales. Y tampoco se
 * recuperaba por el camino largo: una pausa nunca entró a la oferta de «retomar».
 *
 * Un arranque en frío de verdad se simula con `vi.resetModules()`: el estado de
 * módulo del temporizador se va (que es lo que el sistema mata) y la base queda
 * (que es lo que sobrevive). Nada de esto se puede ver con los módulos vivos.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import type { NotificationPlan, PlatformPort } from '../../../shared-logic/platform';

interface TimerState {
  status: string;
  remainingMs: number;
  totalMs: number;
  sessionType: string;
  presetId: string | null;
  presetName: string | null;
  taskId: string | null;
}

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => true,
}));

/** Los tags son strings públicos: sirven igual antes y después de un reset. */
const ONGOING_TAG = 'cauldron:ongoing';
const RESUME_ACTION = 'cauldron:resume';
const STOP_ACTION = 'cauldron:stop';

const plans: NotificationPlan[] = [];

/** Android: sabe programar, así que el plan se calcula y se puede inspeccionar. */
const schedulingPort: PlatformPort = {
  appVersion: () => '0.0.0-test',
  osInfo: () => 'test',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
  applyNotificationPlan: async (plan) => { plans.push(plan); },
};

type Invoke = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

/** El registro de la instancia anterior, para poder apagarle los relojes. */
let previous: { runSuspend: () => void } | null = null;

/**
 * Arranca el proceso de cero contra la MISMA base: módulos nuevos (registro,
 * eventos, plataforma y los handlers del Caldero), estado de módulo en cero.
 *
 * Apagar los `setInterval` de la instancia anterior es parte del simulacro y no
 * un detalle: un proceso que muere se los lleva, y sin esto el tick del módulo
 * viejo seguía escribiendo en la base con su propio estado. Se hace con
 * `runSuspend()` —el mismo lifecycle que usa Android al ir a segundo plano— y no
 * con `vi.clearAllTimers()`, que además REBOBINA el reloj falso a su valor
 * inicial y hacía que la pausa pareciera recién hecha.
 */
async function boot(): Promise<Invoke> {
  previous?.runSuspend();
  vi.resetModules();

  const registry = await import('../../../shared-logic/registry');
  previous = registry;
  const events = await import('../../../shared-logic/events');
  const platform = await import('../../../shared-logic/platform');
  platform.setPlatform(schedulingPort);
  events.setEventSink(() => {});

  const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');
  registerCauldronIpcHandlers();

  return async <T,>(channel: string, ...args: unknown[]): Promise<T> => {
    const fn = registry.getHandler(channel);
    if (!fn) throw new Error(`no handler registered for ${channel}`);
    return (await fn({}, ...args)) as T;
  };
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) db.exec(m.up);
  return db;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

interface SessionRow {
  id: string;
  completed: number;
  deleted_at: string | null;
  target_end_time: number | null;
  paused_at_ms: number | null;
}

const onlySession = (): SessionRow =>
  harness.db.prepare('SELECT * FROM cauldron_sessions ORDER BY started_at DESC LIMIT 1').get() as SessionRow;

const lastPlan = (): NotificationPlan => {
  const plan = plans.filter((p) => p.scope === 'cauldron').at(-1);
  if (!plan) throw new Error('no se emitió ningún plan del caldero');
  return plan;
};

async function makePreset(invoke: Invoke): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: 'Nocturna',
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLong: 4,
    extensionMinutes: 5,
    autoStartBreak: false,
    autoStartWork: false,
  });
}

/** Enfoque de 25 min arrancado a las 23:00 y pausado a los 3 min. */
async function startAndPause(): Promise<{ invoke: Invoke; presetId: string }> {
  const invoke = await boot();
  const presetId = await makePreset(invoke);
  await invoke('cauldron:start', presetId);
  vi.advanceTimersByTime(3 * MIN);
  await invoke('cauldron:pause');
  return { invoke, presetId };
}

beforeEach(() => {
  harness.db = setupDb();
  vi.useFakeTimers();
  // 23:00: se pausa a la noche y se vuelve a la mañana, que es el reporte.
  vi.setSystemTime(new Date(2026, 8, 2, 23, 0, 0));
  plans.length = 0;
});

afterEach(() => {
  previous?.runSuspend();
  previous = null;
  vi.useRealTimers();
});

describe('el aviso pausado sigue cumpliendo lo que promete después de un arranque en frío', () => {
  it('reconstruye la pausa: mismo segmento, mismo tiempo restante, misma receta', async () => {
    const { presetId } = await startAndPause();

    // El sistema recicla el proceso durante la noche.
    vi.setSystemTime(Date.now() + 9 * HOUR);
    plans.length = 0;
    const invoke = await boot();

    const restored = await invoke<TimerState>('cauldron:getState');
    expect(restored.status).toBe('work_paused');
    expect(restored.sessionType).toBe('work');
    expect(restored.remainingMs).toBe(22 * MIN);
    expect(restored.totalMs).toBe(25 * MIN);
    expect(restored.presetId).toBe(presetId);
    expect(restored.presetName).toBe('Nocturna');
  });

  it('el barrido de arranque ya no se lleva la sesión pausada', async () => {
    await startAndPause();

    vi.setSystemTime(Date.now() + 9 * HOUR);
    await boot();

    const row = onlySession();
    expect(row.deleted_at).toBeNull();
    expect(row.completed).toBe(0);
    expect(row.paused_at_ms).not.toBeNull();
  });

  it('el aviso persistente NO se baja: sigue publicado con Reanudar y Detener', async () => {
    await startAndPause();

    vi.setSystemTime(Date.now() + 9 * HOUR);
    plans.length = 0;
    await boot();

    // El plan de un `idle` no programa nada y eso es lo que retiraba el aviso.
    expect(lastPlan().schedule.map((n) => n.tag)).toEqual([ONGOING_TAG]);
    const ongoing = lastPlan().schedule[0];
    expect(ongoing.ongoing).toBe(true);
    expect(ongoing.actions?.map((a) => a.id)).toEqual([RESUME_ACTION, STOP_ACTION]);
    expect(ongoing.body).toContain('22'); // «Quedan 22 min»
  });

  it('el cauldron:resume encolado corre de verdad en vez de tirar «Timer not paused»', async () => {
    await startAndPause();

    vi.setSystemTime(Date.now() + 9 * HOUR);
    const invoke = await boot();

    // Esto es exactamente lo que Android entrega cuando se aprieta el botón.
    const resumed = await invoke<TimerState>('cauldron:resume');
    expect(resumed.status).toBe('work');
    expect(resumed.remainingMs).toBe(22 * MIN);

    const row = onlySession();
    expect(row.paused_at_ms).toBeNull();
    expect(row.target_end_time).toBe(Date.now() + 22 * MIN);
    expect(row.deleted_at).toBeNull();

    // Y el reloj vuelve a correr: no queda un estado «reanudado» que no avanza.
    vi.advanceTimersByTime(2 * MIN);
    expect((await invoke<TimerState>('cauldron:getState')).remainingMs).toBe(20 * MIN);
  });

  it('la misión vinculada vuelve con la pausa', async () => {
    const invoke0 = await boot();
    const presetId = await makePreset(invoke0);
    await invoke0('cauldron:start', presetId, 'task-42');
    vi.advanceTimersByTime(3 * MIN);
    await invoke0('cauldron:pause');

    vi.setSystemTime(Date.now() + 9 * HOUR);
    const invoke = await boot();
    expect((await invoke<TimerState>('cauldron:getState')).taskId).toBe('task-42');
  });

  it('una pausa vencida no se resucita, se barre, y ahí sí el aviso se retira', async () => {
    await startAndPause();

    // Diez minutos más allá de la ventana de recuperación (12 h). El margen es
    // chico A PROPÓSITO: es la franja donde el barrido y la restauración pueden
    // discrepar. Medido contra el fin CONGELADO (T + 22 min) esta fila todavía
    // parece fresca y no se barre; medido contra el instante de la pausa está
    // vencida y no se restaura — y una fila que no se restaura, no se ofrece y
    // no se barre es un zombi que se queda para siempre. Por eso el barrido mide
    // las pausas por `paused_at_ms`.
    vi.setSystemTime(Date.now() + 12 * HOUR + 10 * MIN);
    plans.length = 0;
    const invoke = await boot();

    expect((await invoke<TimerState>('cauldron:getState')).status).toBe('idle');
    expect(onlySession().deleted_at).not.toBeNull();
    expect(lastPlan().schedule).toEqual([]);
  });
});

describe('lo que ya andaba sigue andando', () => {
  it('una sesión que CORRÍA cuando murió el proceso se sigue ofreciendo como interrumpida', async () => {
    const invoke0 = await boot();
    const presetId = await makePreset(invoke0);
    await invoke0('cauldron:start', presetId);
    vi.advanceTimersByTime(3 * MIN);

    const invoke = await boot();
    expect((await invoke<TimerState>('cauldron:getState')).status).toBe('idle');

    const offer = await invoke<{ id: string; remainingMs: number } | null>('cauldron:getInterruptedSession');
    expect(offer).not.toBeNull();
    expect(offer!.remainingMs).toBe(22 * MIN);
  });

  it('una sesión PAUSADA no se ofrece además como interrumpida: ya está viva', async () => {
    await startAndPause();
    vi.setSystemTime(Date.now() + 9 * HOUR);
    const invoke = await boot();

    // El reloj no está en `idle`, así que no hay nada «interrumpido» que ofrecer:
    // sería la misma sesión pidiendo permiso dos veces.
    expect(await invoke('cauldron:getInterruptedSession')).toBeNull();
  });

  it('detener con el reloj pausado limpia la marca: nada que resucitar después', async () => {
    const { invoke } = await startAndPause();
    await invoke('cauldron:stop');

    const row = onlySession();
    expect(row.paused_at_ms).toBeNull();

    const after = await boot();
    expect((await after<TimerState>('cauldron:getState')).status).toBe('idle');
  });

  it('saltear con el reloj pausado tampoco deja una pausa huérfana', async () => {
    const { invoke } = await startAndPause();
    await invoke('cauldron:skip');

    const skipped = harness.db
      .prepare("SELECT paused_at_ms FROM cauldron_sessions WHERE type = 'work'")
      .get() as { paused_at_ms: number | null };
    expect(skipped.paused_at_ms).toBeNull();
  });
});
