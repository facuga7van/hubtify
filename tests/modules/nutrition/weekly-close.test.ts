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

  it('sellar dos veces devuelve error Already closed y no escribe otra fila', () => {
    closeDay('2026-08-31', 1800);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    closeWeek(WEEK);

    const second = closeWeek(WEEK);
    expect(second.success).toBe(false);
    expect(second.error).toBe('Already closed');

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

  // Finding 1 de la revisión: buildWeekReport pedía el perfil antes de mirar
  // el sello, así que borrar el perfil hacía desaparecer en silencio una
  // semana YA sellada del archivo (getClosedWeeks filtra los null).
  it('una semana sellada sigue en el archivo aunque se borre el perfil', () => {
    sealAt('2026-08-31', '2026-08-31');
    testDb.prepare('DELETE FROM nutrition_profile').run();
    const rows = closed();
    expect(rows.map(r => r.weekStart)).toEqual(['2026-08-31']);
    expect(rows[0].sealed).toBe(true);
  });

  /**
   * Sella N semanas directo en `nutrition_weekly_closed`, sin pasar por
   * `closeWeek` (que exigiría día cerrado + pesaje + gate de 7 días por cada
   * una — 55 veces sería un test lentísimo). El handler bajo prueba sólo LEE
   * esta tabla, así que sembrarla a mano es fiel al contrato.
   */
  function sealDirect(n: number): void {
    const stmt = testDb.prepare(`
      INSERT INTO nutrition_weekly_closed (week_start, closed_at, updated_at)
      VALUES (?, ?, ?)
    `);
    testDb.transaction(() => {
      for (let i = 0; i < n; i++) {
        const week = shiftDays('2020-01-06', i * 7); // lunes base, hacia adelante
        stmt.run(week, week, week);
      }
    })();
  }

  // Finding 2 de la revisión: en SQLite un LIMIT negativo devuelve TODAS las
  // filas (unbounded), lo opuesto de un límite. getRecentLoggedDays y
  // searchHistory ya se defienden así; getClosedWeeks no lo hacía. Con sólo un
  // par de semanas selladas en el fixture, contar filas no distinguía "todo
  // el archivo" de "acotado a 52" (ambos dan el mismo número) — por eso la
  // versión anterior de este test espiaba el LIMIT que llegaba a SQLite,
  // acoplándose a la forma exacta de la query. Sembrando más semanas que el
  // clamp por defecto (52) y que el techo duro (200), un conteo de filas
  // discrimina los tres casos sin tocar el statement.
  it('acota el limit: negativo va al default 52, no a "todas"; el techo es 200', () => {
    sealDirect(205);
    expect(closed(-1)).toHaveLength(52);   // el default, no las 205 filas sembradas
    expect(closed(10)).toHaveLength(10);
    expect(closed(500)).toHaveLength(200); // el techo duro, no las 205 filas sembradas
  });

  // Finding 2: en SQLite un LIMIT no entero tira 'datatype mismatch'.
  it('un limit no entero no explota y devuelve un conteo sensato', () => {
    sealAt('2026-08-24', '2026-08-24');
    sealAt('2026-08-31', '2026-08-31');
    expect(() => closed(1.5)).not.toThrow();
    expect(closed(1.5).length).toBe(1);
  });
});
