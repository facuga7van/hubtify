import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

const WEEK = '2026-08-31';    // lunes

/** Fija el reloj a las 12:00 del día pedido para que `nutritionToday` sea estable. */
function atNoon(dateStr: string): void {
  vi.setSystemTime(new Date(dateStr + 'T12:00:00'));
}

function setupDb(checkDay = 1): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg,
      activity_level, deficit_target_kcal, weight_check_day, day_cutoff_hour)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, ?, 4)
  `).run(checkDay);
  return db;
}

function closeDay(date: string, consumed = 1800): void {
  testDb.prepare(`
    INSERT INTO nutrition_daily_closed (date, xp_total, hp_change, consumed, target, closed_at, updated_at)
    VALUES (?, 0, 0, ?, 1900, ?, ?)
  `).run(date, consumed, date, date);
}

function weighIn(date: string): void {
  testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, 80)').run(date);
}

const closeWeek = (week: string) => getHandler('nutrition:closeWeek')!({}, week) as any;

describe('nutrition:closeWeek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sella la semana y archiva el veredicto', () => {
    closeDay('2026-08-31', 1800);
    closeDay('2026-09-01', 1850);
    weighIn('2026-09-07');
    atNoon('2026-09-07');

    const res = closeWeek(WEEK);
    expect(res.success).toBe(true);
    expect(res.report.daysCompliant).toBe(2);
    expect(res.report.xpTotal).toBe(11);
    expect(res.report.sealed).toBe(true);

    const row = testDb.prepare('SELECT * FROM nutrition_weekly_closed WHERE week_start = ?')
      .get(WEEK) as any;
    expect(row.days_compliant).toBe(2);
    expect(row.xp_total).toBe(11);
    expect(row.closed_at).toBeTruthy();
  });

  it('sellar dos veces devuelve alreadyClosed y no escribe otra fila', () => {
    closeDay('2026-08-31', 1800);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    closeWeek(WEEK);

    const second = closeWeek(WEEK);
    expect(second.success).toBe(false);
    expect(second.alreadyClosed).toBe(true);

    const count = testDb.prepare('SELECT COUNT(*) AS n FROM nutrition_weekly_closed').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('revalida el gate de peso: sellar directo una semana bloqueada falla', () => {
    closeDay('2026-08-31', 1800);
    atNoon('2026-09-08');   // terminó, pero sin pesaje y antes de +14
    const res = closeWeek(WEEK);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Waiting for weigh-in');
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM nutrition_weekly_closed').get()).toEqual({ n: 0 });
  });

  it('sin perfil devuelve No profile', () => {
    closeDay('2026-08-31', 1800);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    testDb.prepare('DELETE FROM nutrition_profile').run();
    expect(closeWeek(WEEK).error).toBe('No profile');
  });

  it('sin cierres diarios devuelve No closed days', () => {
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    expect(closeWeek(WEEK).error).toBe('No closed days');
  });

  it('una semana que todavía no terminó devuelve Week not finished', () => {
    closeDay('2026-08-31', 1800);
    atNoon('2026-09-03');   // jueves de la misma semana
    expect(closeWeek(WEEK).error).toBe('Week not finished');
  });

  it('reabrir un día de una semana sellada no altera el pergamino', () => {
    closeDay('2026-08-31', 1800);
    closeDay('2026-09-01', 1850);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    closeWeek(WEEK);

    testDb.prepare("UPDATE nutrition_daily_closed SET deleted_at = 'x' WHERE date = ?")
      .run('2026-09-01');

    const r = getHandler('nutrition:getWeekReport')!({}, WEEK) as any;
    expect(r.daysCompliant).toBe(2);   // congelado, no 1
    expect(r.sealed).toBe(true);
  });
});

describe('nutrition:getClosedWeeks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  const closed = (limit?: number) =>
    getHandler('nutrition:getClosedWeeks')!({}, limit) as any[];

  /** Helper local: no importar de shared/ para no acoplar el test al helper. */
  function shiftDays(d: string, n: number): string {
    const x = new Date(d + 'T12:00:00');
    x.setDate(x.getDate() + n);
    return x.toLocaleDateString('en-CA');
  }

  function sealAt(week: string, day: string): void {
    closeDay(day, 1800);
    weighIn(shiftDays(week, 7));
    atNoon(shiftDays(week, 7));
    closeWeek(week);
  }

  it('devuelve las semanas selladas, más reciente primero', () => {
    sealAt('2026-08-24', '2026-08-24');
    sealAt('2026-08-31', '2026-08-31');
    const rows = closed();
    expect(rows.map(r => r.weekStart)).toEqual(['2026-08-31', '2026-08-24']);
    expect(rows.every(r => r.sealed)).toBe(true);
  });

  it('respeta el límite pedido', () => {
    sealAt('2026-08-24', '2026-08-24');
    sealAt('2026-08-31', '2026-08-31');
    expect(closed(1)).toHaveLength(1);
  });

  it('sin semanas selladas devuelve una lista vacía', () => {
    expect(closed()).toEqual([]);
  });
});
