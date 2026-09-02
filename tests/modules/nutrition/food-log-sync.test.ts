import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { mergeNutritionFoods } from '../../../shared-logic/modules/sync.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  // recalcSummary needs a profile to do anything; without one it returns early,
  // which is fine — these tests are about row identity.
  return db;
}

let uid = 0;
function addMeal(db: Database.Database, date: string, time: string, description: string, calories: number): void {
  db.prepare(
    "INSERT INTO food_log (sync_id, date, time, description, calories, source, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', ?)"
  ).run(`u-${++uid}`, date, time, description, calories, `${date}T${time}:00.000Z`);
}

/** The shape sync:getAllNutritionData exports. */
function exportFoodLog(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT f.id, f.sync_id, f.date, f.time, f.description, f.calories, f.source,
           f.frequent_food_id, ff.sync_id AS frequent_food_sync_id,
           f.ai_breakdown, f.meal, f.updated_at, f.deleted_at
    FROM food_log f
    LEFT JOIN frequent_foods ff ON ff.id = f.frequent_food_id
  `).all() as Array<Record<string, unknown>>;
}

function exportFrequent(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare('SELECT id, sync_id, name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at FROM frequent_foods').all() as Array<Record<string, unknown>>;
}

function liveCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM food_log WHERE deleted_at IS NULL').get() as { c: number }).c;
}

describe('food_log merge between two devices (task 6)', () => {
  it('keeps all four meals when each device logged two of its own', () => {
    // Both devices independently mint food_log.id = 1, 2 for DIFFERENT meals.
    const dbA = setupDb();
    addMeal(dbA, '2026-06-01', '08:00', 'Cafe A', 100);
    addMeal(dbA, '2026-06-01', '13:00', 'Almuerzo A', 700);

    const dbB = setupDb();
    addMeal(dbB, '2026-06-01', '09:00', 'Cafe B', 150);
    addMeal(dbB, '2026-06-01', '14:00', 'Almuerzo B', 800);

    expect(dbA.prepare('SELECT id FROM food_log ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(dbB.prepare('SELECT id FROM food_log ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);

    // Merge A's export into B. The old id-keyed merge saw ids 1 and 2 "already
    // present" and dropped both — 2 rows instead of 4.
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });
    expect(liveCount(dbB)).toBe(4);

    // And back the other way, for symmetry.
    mergeNutritionFoods(dbA, { foodLog: exportFoodLog(dbB) });
    expect(liveCount(dbA)).toBe(4);
  });

  it('is idempotent — re-merging the same payload adds nothing', () => {
    const dbA = setupDb();
    addMeal(dbA, '2026-06-02', '08:00', 'Tostadas', 300);
    const dbB = setupDb();

    const payload = exportFoodLog(dbA);
    mergeNutritionFoods(dbB, { foodLog: payload });
    mergeNutritionFoods(dbB, { foodLog: payload });
    mergeNutritionFoods(dbB, { foodLog: payload });
    expect(liveCount(dbB)).toBe(1);
  });

  it('applies a remote soft-delete to the right row, not to whatever shares its id', () => {
    const dbA = setupDb();
    addMeal(dbA, '2026-06-03', '08:00', 'Cafe A', 100);
    const dbB = setupDb();
    addMeal(dbB, '2026-06-03', '20:00', 'Cena B', 900);

    // Both rows are local id = 1 but are completely different meals.
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });
    expect(liveCount(dbB)).toBe(2);

    // A deletes its own meal.
    dbA.prepare("UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE description = 'Cafe A'")
      .run('2026-06-04T10:00:00.000Z', '2026-06-04T10:00:00.000Z');
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });

    const rows = dbB.prepare('SELECT description, deleted_at FROM food_log ORDER BY description').all() as Array<{ description: string; deleted_at: string | null }>;
    expect(rows.find(r => r.description === 'Cafe A')?.deleted_at).not.toBeNull();
    // B's own dinner is untouched — the old LWW pass wrote the tombstone onto it.
    expect(rows.find(r => r.description === 'Cena B')?.deleted_at).toBeNull();
  });

  it('re-resolves food_log.frequent_food_id through the frequent food sync_id', () => {
    const dbA = setupDb();
    dbA.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-a', 'Yogur', 120, 3, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')").run();
    const ffA = (dbA.prepare("SELECT id FROM frequent_foods WHERE sync_id = 'ff-a'").get() as { id: number }).id;
    dbA.prepare("INSERT INTO food_log (sync_id, date, time, description, calories, source, frequent_food_id, updated_at) VALUES ('meal-a', '2026-06-05', '10:00', 'Yogur', 120, 'frequent', ?, '2026-06-05T10:00:00.000Z')")
      .run(ffA);

    // Device B already has two OTHER frequent foods, so ids do not line up.
    const dbB = setupDb();
    dbB.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-x', 'Manzana', 80, 1, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')").run();
    dbB.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-y', 'Banana', 90, 1, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')").run();

    mergeNutritionFoods(dbB, { frequentFoods: exportFrequent(dbA), foodLog: exportFoodLog(dbA) });

    const merged = dbB.prepare("SELECT frequent_food_id FROM food_log WHERE sync_id = 'meal-a'").get() as { frequent_food_id: number };
    const yogurId = (dbB.prepare("SELECT id FROM frequent_foods WHERE sync_id = 'ff-a'").get() as { id: number }).id;
    expect(merged.frequent_food_id).toBe(yogurId);
    // The raw id from device A (1) points at "Manzana" here — the un-resolved value.
    expect(merged.frequent_food_id).not.toBe(ffA);
  });

  it('reports the dates of rows that only changed deleted_at, so summaries recalc (task 12)', () => {
    const dbA = setupDb();
    addMeal(dbA, '2026-06-06', '08:00', 'Cafe', 100);
    const dbB = setupDb();
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });

    dbA.prepare("UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE description = 'Cafe'")
      .run('2026-06-07T10:00:00.000Z', '2026-06-07T10:00:00.000Z');

    const result = mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });
    // Only freshly INSERTED rows used to land in affectedDates, so a synced delete
    // left the two devices showing different totals for that day.
    expect(result.affectedDates.has('2026-06-06')).toBe(true);
    expect(result.changed).toBe(true);
  });
});

describe('frequent_foods merge (task 6)', () => {
  it('does not collide on the UNIQUE name index when ids differ', () => {
    const dbA = setupDb();
    dbA.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-a', 'Yogur', 120, 3, '2026-06-01T10:00:00.000Z', '2026-06-02T10:00:00.000Z')").run();

    const dbB = setupDb();
    dbB.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-b', 'Yogur', 130, 1, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')").run();

    expect(() => mergeNutritionFoods(dbB, { frequentFoods: exportFrequent(dbA) })).not.toThrow();
    const rows = dbB.prepare("SELECT COUNT(*) AS c FROM frequent_foods WHERE name = 'Yogur'").get() as { c: number };
    expect(rows.c).toBe(1);
  });
});
