/**
 * El recordatorio de hábitos con la app CERRADA (spec §12 Fase 6).
 *
 * Hasta ahora el motor evaluaba cada 30 min con la app abierta: si a las 21:00
 * la app no estaba en primer plano, el aviso no existía. Ahora se PROGRAMA —
 * hoy y los próximos días— y se reconcilia con el estado real cada vez que algo
 * puede cambiar la respuesta.
 *
 * Todo pasa por los handlers REALES de Questify y de notificaciones: lo que se
 * prueba es el cableado, no el planificador (eso es
 * tests/shared-logic/notification-schedule.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { notificationsMigrations } from '../../../shared-logic/modules/notifications.schema';
import type { NotificationPlan, PlatformPort } from '../../../shared-logic/platform';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { getHandler, clearHandlers } = await import('../../../shared-logic/registry');
const { setEventSink } = await import('../../../shared-logic/events');
const { setPlatform } = await import('../../../shared-logic/platform');
const { habitTagFor, resetHabitReminderConfig } = await import(
  '../../../shared-logic/modules/notification-schedule'
);
const { registerNotificationIpcHandlers } = await import('../../../shared-logic/modules/notifications.ipc');
const { registerQuestsIpcHandlers } = await import('../../../shared-logic/modules/quests.ipc');

const plans: NotificationPlan[] = [];

const basePort: PlatformPort = {
  appVersion: () => '0.0.0-test',
  osInfo: () => 'test',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
};

const schedulingPort: PlatformPort = {
  ...basePort,
  applyNotificationPlan: async (plan) => { plans.push(plan); },
};

/** Miércoles 2 de septiembre de 2026, mediodía: el recordatorio de las 21:00 no pasó. */
const TODAY = '2026-09-02';
const TOMORROW = '2026-09-03';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  for (const m of notificationsMigrations) db.exec(m.up);
  return db;
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): T {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return fn({}, ...args) as T;
}

function lastHabitPlan(): NotificationPlan {
  const plan = plans.filter((p) => p.scope === 'habits').at(-1);
  if (!plan) throw new Error('no se emitió ningún plan de hábitos');
  return plan;
}

const scheduledTags = () => lastHabitPlan().schedule.map((n) => n.tag);

function addDailyHabit(): string {
  const id = 'h1';
  harness.db.prepare(
    `INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at)
     VALUES (?, 'Leer', 'daily', 1, '2026-04-29T21:50:47.097Z', '2026-04-29T21:50:47.097Z')`,
  ).run(id);
  return id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 2, 12, 0, 0));
  harness.db = setupDb();
  clearHandlers();
  resetHabitReminderConfig();
  setEventSink(() => {});
  setPlatform(schedulingPort);
  registerNotificationIpcHandlers();
  registerQuestsIpcHandlers();
  // `enabledModules` es estado de módulo y sobrevive entre casos; además esta DB
  // solo tiene las tablas de Questify y de notificaciones.
  invoke('notifications:setModuleEnabled', 'quests', true);
  invoke('notifications:setModuleEnabled', 'nutrition', false);
  invoke('notifications:setModuleEnabled', 'finance', false);
  plans.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recordatorios de hábitos programados', () => {
  it('configurar la hora deja armados hoy y los días siguientes', () => {
    addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');

    expect(scheduledTags()).toContain(habitTagFor(TODAY));
    expect(scheduledTags()).toContain(habitTagFor(TOMORROW));
    const today = lastHabitPlan().schedule.find((n) => n.tag === habitTagFor(TODAY))!;
    expect(today.at).toBe(new Date(2026, 8, 2, 21, 0, 0).getTime());
  });

  it('marcar el hábito CANCELA el recordatorio de hoy en el acto', () => {
    const id = addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    expect(scheduledTags()).toContain(habitTagFor(TODAY));

    invoke('quests:checkHabit', id);

    expect(scheduledTags()).not.toContain(habitTagFor(TODAY));
    // El tag sigue GOBERNADO: es así como el host sabe que hay que cancelarlo.
    expect(lastHabitPlan().owned).toContain(habitTagFor(TODAY));
    // Y mañana sigue en pie: el hábito es diario.
    expect(scheduledTags()).toContain(habitTagFor(TOMORROW));
  });

  it('desmarcarlo lo vuelve a armar', () => {
    const id = addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    invoke('quests:checkHabit', id);
    invoke('quests:checkHabit', id); // toggle
    expect(scheduledTags()).toContain(habitTagFor(TODAY));
  });

  it('saltear el hábito también lo apaga', () => {
    const id = addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    invoke('quests:skipHabit', id);
    expect(scheduledTags()).not.toContain(habitTagFor(TODAY));
  });

  it('borrar el hábito deja el plan vacío', () => {
    const id = addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    invoke('quests:deleteHabit', id);
    expect(lastHabitPlan().schedule).toEqual([]);
  });

  it('crear un hábito arma el recordatorio sin esperar al próximo chequeo', () => {
    invoke('notifications:setHabitReminder', true, '21:00');
    expect(lastHabitPlan().schedule).toEqual([]);
    invoke('quests:addHabit', { name: 'Gimnasio', frequency: 'daily', timesPerWeek: 1 });
    expect(scheduledTags()).toContain(habitTagFor(TODAY));
  });

  it('apagar el recordatorio, o Questify entero, cancela todo', () => {
    addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    invoke('notifications:setHabitReminder', false, '21:00');
    expect(lastHabitPlan().schedule).toEqual([]);

    invoke('notifications:setHabitReminder', true, '21:00');
    expect(lastHabitPlan().schedule.length).toBeGreaterThan(0);
    invoke('notifications:setModuleEnabled', 'quests', false);
    expect(lastHabitPlan().schedule).toEqual([]);
  });

  it('reabrir la app no duplica: el mismo estado produce el mismo plan, y nunca en el pasado', () => {
    addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    const first = lastHabitPlan();

    invoke('notifications:runCheck');
    const second = lastHabitPlan();

    expect(second).toEqual(first);
    // Reprogramar el mismo id REEMPLAZA la alarma pendiente (el plugin usa el id
    // como requestId), así que un plan idéntico es idempotente. Lo que sí sería
    // un duplicado es un `at` vencido: el plugin lo dispara al instante.
    for (const n of second.schedule) expect(n.at!).toBeGreaterThan(Date.now());
  });

  it('a las 21:30, con el aviso de hoy ya disparado, hoy NO se reprograma', () => {
    addDailyHabit();
    vi.setSystemTime(new Date(2026, 8, 2, 21, 30, 0));
    invoke('notifications:setHabitReminder', true, '21:00');
    expect(scheduledTags()).not.toContain(habitTagFor(TODAY));
    expect(scheduledTags()).toContain(habitTagFor(TOMORROW));
  });
});

describe('escritorio: no se programa nada', () => {
  it('un port sin applyNotificationPlan nunca recibe un plan de hábitos', () => {
    setPlatform(basePort);
    const id = addDailyHabit();
    invoke('notifications:setHabitReminder', true, '21:00');
    invoke('quests:checkHabit', id);
    invoke('notifications:runCheck');
    expect(plans).toEqual([]);
  });
});
