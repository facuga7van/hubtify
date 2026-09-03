/**
 * «Fui al gimnasio el lunes, lo marqué, y a la noche me vuelve a avisar».
 *
 * El motor de notificaciones tenía su propia copia de la pregunta "¿este hábito
 * quiere un check HOY?": contaba los checks de la semana contra `times_per_week`
 * y avisaba mientras la cuota no estuviera llena, sin mirar el check de HOY.
 * `habit_checks` tiene UNIQUE(habit_id, date): si ya marcaste hoy, hoy no te
 * debe nada, vaya la semana 1/3 o 2/3.
 *
 * Esa copia además no conocía `specific_days`, así que un Lun/Mie/Vie
 * (times_per_week = 3) sonaba también los martes y los jueves.
 *
 * Todo pasa por el handler real `notifications:runCheck`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { notificationsMigrations } from '../../../shared-logic/modules/notifications.schema';
import { questsMigrations } from '@modules/quests/quests.schema';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { getHandler, clearHandlers } = await import('../../../shared-logic/registry');
const { setPlatform } = await import('../../../shared-logic/platform');
const { registerNotificationIpcHandlers } = await import('../../../shared-logic/modules/notifications.ipc');

/** Jueves. El lunes de esa semana es 2026-08-31. */
const MONDAY = '2026-08-31';
const TUESDAY = '2026-09-01';
const WEDNESDAY = '2026-09-02';
const TODAY = '2026-09-03';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  for (const m of notificationsMigrations) db.exec(m.up);
  return db;
}

let seq = 0;

interface HabitSpec {
  frequency: 'daily' | 'weekly' | 'monthly';
  timesPerWeek?: number;
  /** Días ISO elegidos (1 = lunes … 7 = domingo). */
  specificDays?: number[];
  checks?: string[];
}

function addHabit(db: Database.Database, spec: HabitSpec): string {
  const id = `h${++seq}`;
  db.prepare(`
    INSERT INTO habits (id, name, frequency, times_per_week, specific_days, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-04-29T21:50:47.097Z', '2026-04-29T21:50:47.097Z')
  `).run(id, id, spec.frequency, spec.timesPerWeek ?? 1, spec.specificDays?.join(',') ?? null);
  for (const date of spec.checks ?? []) {
    db.prepare(`
      INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at)
      VALUES (?, ?, ?, 'check', ?, ?)
    `).run(`c${++seq}`, id, date, `${date}T20:35:15.521Z`, `${date}T20:35:15.521Z`);
  }
  return id;
}

function activeReminders(db: Database.Database): number {
  return (db.prepare(
    "SELECT COUNT(*) AS cnt FROM notifications WHERE type = 'habit_reminder' AND status = 'active'"
  ).get() as { cnt: number }).cnt;
}

/** Corre el chequeo real y responde si quedó un recordatorio de hábitos encendido. */
function runCheck(db: Database.Database): boolean {
  getHandler('notifications:runCheck')!({});
  return activeReminders(db) > 0;
}

beforeEach(() => {
  // Reloj de pared congelado: `computeHabits` y `habit_checks.date` son locales.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 3, 21, 30, 0));

  harness.db = setupDb();
  clearHandlers();
  setPlatform({ notify: vi.fn() } as never);
  registerNotificationIpcHandlers();
  getHandler('notifications:setModuleEnabled')!({}, 'nutrition', false);
  getHandler('notifications:setModuleEnabled')!({}, 'finance', false);
  getHandler('notifications:setHabitReminder')!({}, true, '21:00');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recordatorio de hábitos — N veces por semana', () => {
  it('un 3x/semana marcado HOY no vuelve a avisar hoy, aunque la semana vaya 2/3', () => {
    addHabit(harness.db, { frequency: 'weekly', timesPerWeek: 3, checks: [WEDNESDAY, TODAY] });
    expect(runCheck(harness.db)).toBe(false);
  });

  it('un 3x/semana sin marcar hoy y con la semana en 1/3 sí avisa', () => {
    addHabit(harness.db, { frequency: 'weekly', timesPerWeek: 3, checks: [WEDNESDAY] });
    expect(runCheck(harness.db)).toBe(true);
  });

  it('un 3x/semana con la cuota cumplida (3/3) no avisa ningún día', () => {
    addHabit(harness.db, { frequency: 'weekly', timesPerWeek: 3, checks: [MONDAY, TUESDAY, WEDNESDAY] });
    expect(runCheck(harness.db)).toBe(false);
  });

  it('marcar el hábito apaga un recordatorio ya encendido', () => {
    const id = addHabit(harness.db, { frequency: 'weekly', timesPerWeek: 3, checks: [WEDNESDAY] });
    expect(runCheck(harness.db)).toBe(true);

    harness.db.prepare(`
      INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at)
      VALUES ('late', ?, ?, 'check', '', '')
    `).run(id, TODAY);

    expect(runCheck(harness.db)).toBe(false);
  });
});

describe('recordatorio de hábitos — diario', () => {
  it('un diario marcado hoy no avisa', () => {
    addHabit(harness.db, { frequency: 'daily', checks: [TODAY] });
    expect(runCheck(harness.db)).toBe(false);
  });

  it('un diario sin marcar avisa', () => {
    addHabit(harness.db, { frequency: 'daily', checks: [WEDNESDAY] });
    expect(runCheck(harness.db)).toBe(true);
  });
});

describe('recordatorio de hábitos — días elegidos', () => {
  it('un Lun/Mie/Vie no avisa un jueves', () => {
    addHabit(harness.db, {
      frequency: 'weekly', timesPerWeek: 3, specificDays: [1, 3, 5], checks: [MONDAY, WEDNESDAY],
    });
    expect(runCheck(harness.db)).toBe(false);
  });

  it('un Mar/Jue ya marcado hoy no avisa, aunque el martes se haya perdido', () => {
    addHabit(harness.db, {
      frequency: 'weekly', timesPerWeek: 2, specificDays: [2, 4], checks: [TODAY],
    });
    expect(runCheck(harness.db)).toBe(false);
  });

  it('un Mar/Jue sin marcar el jueves sí avisa', () => {
    addHabit(harness.db, {
      frequency: 'weekly', timesPerWeek: 2, specificDays: [2, 4], checks: [TUESDAY],
    });
    expect(runCheck(harness.db)).toBe(true);
  });
});
