import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

const WEEK = '2026-08-31';        // lunes
const SUNDAY = '2026-09-06';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg,
      activity_level, deficit_target_kcal)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500)
  `).run();
  return db;
}

function closeDay(date: string, consumed: number, target = 1900): void {
  testDb.prepare(`
    INSERT INTO nutrition_daily_closed (date, xp_total, hp_change, consumed, target, closed_at, updated_at)
    VALUES (?, 0, 0, ?, ?, ?, ?)
  `).run(date, consumed, target, date + 'T12:00:00Z', date + 'T12:00:00Z');
}

const report = (week: string) => getHandler('nutrition:getWeekReport')!({}, week) as any;

describe('nutrition:getWeekReport', () => {
  beforeEach(() => {
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });

  it('agrega los días cerrados de la semana y calcula el XP', () => {
    closeDay('2026-08-31', 1800);   // cumple
    closeDay('2026-09-01', 1850);   // cumple
    closeDay('2026-09-02', 2600);   // no cumple
    const r = report(WEEK);

    expect(r.weekStart).toBe(WEEK);
    expect(r.weekEnd).toBe(SUNDAY);
    expect(r.daysClosed).toBe(3);
    expect(r.daysCompliant).toBe(2);
    expect(r.xpTotal).toBe(11);     // round(40 * 2/7)
    expect(r.sealed).toBe(false);
  });

  it('ignora los cierres de otras semanas', () => {
    closeDay('2026-08-30', 1800);   // domingo anterior
    closeDay('2026-09-07', 1800);   // lunes siguiente
    closeDay('2026-08-31', 1800);
    expect(report(WEEK).daysClosed).toBe(1);
  });

  it('ignora los cierres con lápida', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare("UPDATE nutrition_daily_closed SET deleted_at = 'x' WHERE date = ?")
      .run('2026-08-31');
    expect(report(WEEK).daysClosed).toBe(0);
  });

  it('devuelve null sin perfil, en vez de re-puntuar en banda de mantenimiento', () => {
    testDb.prepare('DELETE FROM nutrition_profile').run();
    expect(report(WEEK)).toBeNull();
  });

  it('toma weight_start de la semana y weight_end de la siguiente', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, ?)')
      .run('2026-08-31', 80.4);
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, ?)')
      .run('2026-09-07', 80.0);
    const r = report(WEEK);
    expect(r.weightStart).toBe(80.4);
    expect(r.weightEnd).toBe(80.0);
  });

  it('deja el peso en null cuando falta, sin inventar un delta', () => {
    closeDay('2026-08-31', 1800);
    const r = report(WEEK);
    expect(r.weightStart).toBeNull();
    expect(r.weightEnd).toBeNull();
  });

  it('cuenta días con pasos y días de gimnasio', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
      .run('2026-08-31', 8000, 1);
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
      .run('2026-09-01', 0, 0);
    const r = report(WEEK);
    expect(r.daysSteps).toBe(1);
    expect(r.daysGym).toBe(1);
  });

  it('promedia consumo y objetivo sobre los días cerrados', () => {
    closeDay('2026-08-31', 1700);
    closeDay('2026-09-01', 1900);
    const r = report(WEEK);
    expect(r.avgConsumed).toBe(1800);
    expect(r.avgTarget).toBe(1900);
  });

  // Spec test 16: la racha se mide al DOMINGO de esa semana, no al sellar.
  //
  // El fixture DEBE ser contiguo. `computeNutritionStreak` arranca en el domingo
  // de la semana y camina hacia atrás; en el primer hueco se niega a gastar el
  // día de gracia si el día anterior tampoco cumple (`meal-utils.ts:364`), así
  // que dos lunes sueltos dan racha 0 en ambas semanas y el test no probaría nada.
  it('streakEnd describe la semana, no el momento de sellar', () => {
    // 14 días compliant seguidos: lun 08-31 → dom 09-13.
    for (let i = 0; i < 14; i++) {
      const d = new Date('2026-08-31T12:00:00');
      d.setDate(d.getDate() + i);
      const date = d.toLocaleDateString('en-CA');
      closeDay(date, 1800);
      testDb.prepare(`INSERT INTO nutrition_daily_summary
        (date, total_calories_in, bmr, tdee, balance) VALUES (?, 1800, 1600, 2400, 0)`)
        .run(date);
    }

    // Semana 1 camina 09-06 → 08-31 y muere en el hueco del 08-30.
    expect(report('2026-08-31').streakEnd).toBe(7);
    // Semana 2 camina 09-13 → 08-31: la MISMA historia, otro punto de corte.
    expect(report('2026-09-07').streakEnd).toBe(14);
  });

  // Spec test 12: guarda del BORDE de la banda. Con déficit > 0 la banda es
  // `consumed <= target`, así que consumido == objetivo CUMPLE.
  it('el borde exacto de la banda cumple', () => {
    closeDay('2026-08-31', 1900, 1900);   // consumido == objetivo, borde exacto
    expect(report(WEEK).daysCompliant).toBe(1);
  });

  // Spec test 20, GUARDA del denominador: el XP no depende de food_log.
  it('borrar comidas viejas no cambia el XP de la semana', () => {
    closeDay('2026-08-31', 1800);
    const before = report(WEEK).xpTotal;
    testDb.prepare(`INSERT INTO food_log (date, time, description, calories, source)
      VALUES ('2026-08-31', '12:00', 'x', 500, 'manual')`).run();
    testDb.prepare("UPDATE food_log SET deleted_at = 'x'").run();
    expect(report(WEEK).xpTotal).toBe(before);
  });
});
