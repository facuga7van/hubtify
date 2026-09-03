/**
 * El Caldero avisa con la app CERRADA (spec §12 Fase 6).
 *
 * En Android el Worker se congela en segundo plano, así que el aviso de «terminó
 * la poción» no puede salir del tick: tiene que estar YA en manos del SO como
 * alarma a `targetEndTime`. Y toda transición del reloj —pausar, reanudar,
 * saltar, detener— tiene que reconciliar esa alarma, o sonaría en medio de nada.
 *
 * Handlers REALES + DB inyectada + fake timers, igual que cauldron.suspend.test.ts.
 * El `PlatformPort` es el que decide si la plataforma programa: con
 * `applyNotificationPlan` (Android) se programa; sin él (Electron) no se calcula
 * ni se llama nada.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import type { NotificationPlan, PlatformPort } from '../../../shared-logic/platform';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => true,
}));

const { getHandler, runResume, runSuspend } = await import('../../../shared-logic/registry');
const { setEventSink } = await import('../../../shared-logic/events');
const { setPlatform } = await import('../../../shared-logic/platform');
const { CAULDRON_END_TAG, CAULDRON_ONGOING_TAG } = await import(
  '../../../shared-logic/modules/notification-schedule'
);
const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');

const plans: NotificationPlan[] = [];
const notified: Array<{ title: string; body: string }> = [];

const basePort: PlatformPort = {
  appVersion: () => '0.0.0-test',
  osInfo: () => 'test',
  notify: async (n) => { notified.push({ title: n.title, body: n.body }); },
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
};

/** Android: sabe programar. */
const schedulingPort: PlatformPort = {
  ...basePort,
  applyNotificationPlan: async (plan) => { plans.push(plan); },
};

setPlatform(schedulingPort);
setEventSink(() => {});
registerCauldronIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

/** El último plan del Caldero, que es el que vale: cada uno reemplaza al anterior. */
function lastPlan(): NotificationPlan {
  const plan = plans.filter((p) => p.scope === 'cauldron').at(-1);
  if (!plan) throw new Error('no se emitió ningún plan del caldero');
  return plan;
}

const scheduledTags = () => lastPlan().schedule.map((n) => n.tag);
const endAt = () => lastPlan().schedule.find((n) => n.tag === CAULDRON_END_TAG)?.at;

const MIN = 60_000;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) db.exec(m.up);
  return db;
}

async function makePreset(): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: `T-${Math.random()}`,
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLong: 4,
    extensionMinutes: 5,
    autoStartBreak: false,
    autoStartWork: false,
  });
}

beforeEach(async () => {
  harness.db = setupDb();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 2, 12, 0, 0));
  setPlatform(schedulingPort);
  await invoke('cauldron:stop'); // el estado del timer es de módulo
  plans.length = 0;
  notified.length = 0;
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

describe('el Caldero deja la alarma en manos del sistema', () => {
  it('iniciar una sesión programa el fin a targetEndTime', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 25 * MIN;
    await invoke('cauldron:start', presetId);

    expect(scheduledTags()).toEqual([CAULDRON_END_TAG, CAULDRON_ONGOING_TAG]);
    expect(endAt()).toBe(target);
    // El plan gobierna los dos tags SIEMPRE: así una transición posterior los cancela.
    expect(lastPlan().owned).toEqual([CAULDRON_END_TAG, CAULDRON_ONGOING_TAG]);
  });

  it('pausar cancela: sin esto la alarma sonaría con el reloj detenido', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    await invoke('cauldron:pause');
    expect(lastPlan().schedule).toEqual([]);
  });

  it('reanudar reprograma con el nuevo fin, no con el viejo', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    const original = endAt();

    vi.advanceTimersByTime(3 * MIN);
    await invoke('cauldron:pause');
    vi.setSystemTime(Date.now() + 10 * MIN); // diez minutos de pausa
    await invoke('cauldron:resume');

    expect(scheduledTags()).toContain(CAULDRON_END_TAG);
    expect(endAt()).toBe(Date.now() + 22 * MIN);
    expect(endAt()).not.toBe(original);
  });

  it('detener retira la alarma y el aviso persistente', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    await invoke('cauldron:stop');
    expect(lastPlan().schedule).toEqual([]);
    expect(lastPlan().ownedPersistent).toEqual([CAULDRON_ONGOING_TAG]);
  });

  it('prorrogar corre el fin del segmento', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(25 * MIN); // termina el enfoque → awaiting_next
    await invoke('cauldron:extend', 5);
    expect(endAt()).toBe(Date.now() + 5 * MIN);
  });

  it('saltar al siguiente segmento reprograma con su duración', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    await invoke('cauldron:skip');
    expect(endAt()).toBe(Date.now() + 5 * MIN); // el descanso
  });

  it('al terminar el segmento el aviso NO se emite dos veces', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(25 * MIN);

    // El texto ya viajó al SO dentro de la alarma; el tick no vuelve a emitirlo.
    expect(notified).toEqual([]);
    expect(lastPlan().schedule).toEqual([]);
  });

  it('volver del segundo plano reconcilia el plan', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    runSuspend();
    plans.length = 0;
    vi.setSystemTime(Date.now() + 5 * MIN);
    runResume();
    expect(scheduledTags()).toContain(CAULDRON_END_TAG);
  });
});

describe('escritorio: no se programa nada', () => {
  it('un port sin applyNotificationPlan no recibe planes y sigue avisando por notify()', async () => {
    setPlatform(basePort);
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(25 * MIN);

    expect(plans).toEqual([]);
    expect(notified).toHaveLength(1);
    expect(notified[0].body).toContain('Siguiente');
  });
});
