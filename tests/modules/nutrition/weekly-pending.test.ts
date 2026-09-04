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

const pending = () => getHandler('nutrition:getPendingWeeks')!({}) as string[];

describe('nutrition:getPendingWeeks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
    closeDay('2026-08-31');
  });

  // Los fake timers también apagan setTimeout/setInterval: dejarlos puestos
  // contamina los archivos que corren después en la misma suite.
  afterEach(() => { vi.useRealTimers(); });

  it('la semana EN CURSO nunca aparece', () => {
    atNoon('2026-09-03');   // jueves de la misma semana
    expect(pending()).not.toContain(WEEK);
  });

  it('aparece apenas existe el pesaje de la semana siguiente', () => {
    weighIn('2026-09-07');   // lunes siguiente
    atNoon('2026-09-07');
    expect(pending()).toContain(WEEK);
  });

  it('sin pesaje, NO aparece antes de weekStart+14', () => {
    atNoon('2026-09-13');    // weekStart+13
    expect(pending()).not.toContain(WEEK);
  });

  it('sin pesaje, aparece en weekStart+14 por el escape', () => {
    atNoon('2026-09-14');
    expect(pending()).toContain(WEEK);
  });

  it('con weight_check_day = 7 el pesaje cae en +13 y el escape NO gana', () => {
    testDb.prepare('UPDATE nutrition_profile SET weight_check_day = 7').run();
    weighIn('2026-09-13');   // domingo de la semana siguiente = weekStart+13
    atNoon('2026-09-13');
    expect(pending()).toContain(WEEK);
  });

  it('una semana ya sellada no vuelve a aparecer', () => {
    testDb.prepare(`
      INSERT INTO nutrition_weekly_closed (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES (?, 1, 1, 6, 'x', 'x')
    `).run(WEEK);
    atNoon('2026-09-14');
    expect(pending()).not.toContain(WEEK);
  });

  it('una semana sin ningún cierre vivo no califica', () => {
    testDb.prepare('DELETE FROM nutrition_daily_closed').run();
    atNoon('2026-09-14');
    expect(pending()).not.toContain(WEEK);
  });

  it('la ventana de 4 semanas corta lo viejo', () => {
    atNoon('2026-10-05');   // el lunes actual está a 5 semanas de WEEK
    expect(pending()).not.toContain(WEEK);
  });

  it('a la 01:00 del lunes con corte 4 AM la semana en curso sigue siendo la anterior', () => {
    vi.setSystemTime(new Date('2026-09-07T01:00:00'));
    // El día nutricional es el domingo 2026-09-06, así que WEEK todavía corre.
    expect(pending()).not.toContain(WEEK);
  });

  it('el borde inferior de la ventana es INCLUSIVO: -28 días todavía entra', () => {
    atNoon('2026-09-28');   // el lunes actual está a exactamente 4 semanas
    expect(pending()).toContain(WEEK);
  });
});

/**
 * GUARDA de comportamiento EXISTENTE — describe cómo se comporta el escritor HOY
 * y debe pasar antes de que la feature aterrice.
 *
 * `saveWeeklyMetrics` keyea por el reloj de PARED a propósito: un pesaje no es
 * un evento de consumo, y tu peso a la 01:00 del lunes es el peso del lunes.
 * Si alguien "arregla" el escritor para usar el lunes nutricional, el pesaje
 * cae en `vStart` y el `INSERT OR REPLACE` PISA el weight_start de la semana:
 * el delta de todos los pergaminos se rompe en silencio. Este test es lo único
 * que lo impide.
 */
describe('GUARDA: el pesaje usa el reloj de pared', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('un pesaje a la 01:00 del lunes alimenta weight_end de la semana que termina', () => {
    // Lunes 2026-09-07 a la 01:00. Día nutricional: domingo 2026-09-06 (semana WEEK).
    vi.setSystemTime(new Date('2026-09-07T01:00:00'));
    getHandler('nutrition:saveWeeklyMetrics')!({}, { weightKg: 80 });

    const row = testDb.prepare('SELECT date FROM nutrition_weekly_metrics').get() as { date: string };
    // El lunes de PARED, que es el slot [WEEK+7, WEEK+13] = weight_end(WEEK).
    expect(row.date).toBe('2026-09-07');
    expect(row.date).not.toBe('2026-08-31');   // NO el lunes nutricional
  });
});
