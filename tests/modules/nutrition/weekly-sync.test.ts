import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerSyncIpcHandlers } from '../../../shared-logic/modules/sync.ipc';
import { initCoreTables, coreMigrations, applyMigrations } from '../../../shared-logic/db';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, nutritionMigrations);
  // clearUserDataInto unconditionally re-seeds cauldron_presets after a clear.
  applyMigrations(db, cauldronMigrations);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level)
    VALUES (1, 30, 'M', 175, 80, 'moderate')
  `).run();
  return db;
}

function insertLocalWeek(weekStart: string, daysCompliant: number, updatedAt: string): void {
  testDb.prepare(`
    INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, avg_consumed, avg_target, weight_start,
       weight_end, days_steps, days_gym, streak_end, xp_total, closed_at, updated_at)
    VALUES (?, 7, ?, 2000, 2200, 80, 79.5, 5, 3, 6, 120, ?, ?)
  `).run(weekStart, daysCompliant, weekStart, updatedAt);
}

const readWeek = (weekStart: string) =>
  testDb.prepare('SELECT days_compliant AS daysCompliant, updated_at AS updatedAt FROM nutrition_weekly_closed WHERE week_start = ?')
    .get(weekStart) as { daysCompliant: number; updatedAt: string } | undefined;

const OLD = '2026-08-31T08:00:00.000Z';
const NEW = '2026-08-31T20:00:00.000Z';

async function merge(data: Record<string, unknown>): Promise<any> {
  return await getHandler('sync:mergeNutritionData')!({}, data);
}

beforeEach(() => {
  testDb = setupDb();
  clearHandlers();
  registerSyncIpcHandlers();
});

describe('nutrition_weekly_closed — multi-account sync wiring', () => {
  it('is in USER_DATA_TABLES: sync:clearUserData empties the table', async () => {
    insertLocalWeek('2026-08-31', 5, NEW);
    expect((testDb.prepare('SELECT COUNT(*) AS c FROM nutrition_weekly_closed').get() as { c: number }).c).toBe(1);

    await getHandler('sync:clearUserData')!({});

    expect((testDb.prepare('SELECT COUNT(*) AS c FROM nutrition_weekly_closed').get() as { c: number }).c).toBe(0);
  });

  it('sync:getAllNutritionData returns weeklyClosed with snake_case keys', async () => {
    insertLocalWeek('2026-08-31', 5, NEW);
    const data = await getHandler('sync:getAllNutritionData')!({}) as { weeklyClosed: Array<Record<string, unknown>> };
    expect(data.weeklyClosed).toHaveLength(1);
    expect(data.weeklyClosed[0].week_start).toBe('2026-08-31');
    // camelCase would be undefined — this is the exact trap the brief warns about.
    expect((data.weeklyClosed[0] as Record<string, unknown>).weekStart).toBeUndefined();
  });

  it('sync:mergeNutritionData inserts a week that was not there locally', async () => {
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: NEW, updated_at: NEW,
      }],
    });
    expect(res.changed).toBe(true);
    expect(readWeek('2026-08-31')).toMatchObject({ daysCompliant: 5 });
  });

  it('last-write-wins: a newer incoming row overwrites the local one', async () => {
    insertLocalWeek('2026-08-31', 2, OLD);
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: NEW, updated_at: NEW,
      }],
    });
    expect(res.changed).toBe(true);
    expect(readWeek('2026-08-31')?.daysCompliant).toBe(5);
  });

  it('an older incoming row does NOT overwrite the local one', async () => {
    insertLocalWeek('2026-08-31', 2, NEW);
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: OLD, updated_at: OLD,
      }],
    });
    expect(res.changed).toBe(false);
    expect(readWeek('2026-08-31')?.daysCompliant).toBe(2);
  });
});
