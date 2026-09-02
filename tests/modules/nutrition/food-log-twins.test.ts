import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { getHandler, clearHandlers } from '../../../shared-logic/registry';

// ─────────────────────────────────────────────────────────────────────────────
// The bug, as found in the owner's database on 2026-09-02:
//
// The installed desktop app was still v0.7.5, whose merge keys food_log by the
// device-local AUTOINCREMENT id. A fresh 0.9 device (Android) pulled the whole
// history, minted ids 1..N in payload order and pushed them back — the export
// still shipped `id`. v0.7.5 inserted every id it did not have, verbatim,
// without sync_id (the column it does not know), and cross-applied remote id 1's
// stamp onto local id 1. Result: 16 live twins, every daily total doubled.
//
// Two real pairs from that database (ids as they were):
//   6  legacy-2026-09-01|16:16|298|una medialuna con jamon y queso   (twin)
//   64 43c06dd8-fa98-44f4-8e36-64ef76f9e260, protein_g 15.5           (original)
//   7  sync_id NULL                                                    (twin)
//   62 legacy-2026-05-01|20:22|850|asado con papa al horno             (original, v12 backfill)
// ─────────────────────────────────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerSyncIpcHandlers, mergeNutritionFoods } from '../../../shared-logic/modules/sync.ipc';

const REPAIR_VERSION = 16;

function migrateUpTo(db: Database.Database, maxVersion: number): void {
  for (const m of nutritionMigrations) {
    if (m.version > maxVersion) continue;
    db.exec(m.up);
  }
}

function repairMigration(): string {
  const m = nutritionMigrations.find(x => x.version === REPAIR_VERSION);
  if (!m) throw new Error(`nutrition v${REPAIR_VERSION} (food_log twin repair) is missing`);
  return m.up;
}

interface Row {
  date: string; time: string; description: string; calories: number;
  syncId: string | null; proteinG?: number | null; updatedAt?: string | null; deletedAt?: string | null;
}

function insert(db: Database.Database, r: Row): number {
  const info = db.prepare(`
    INSERT INTO food_log (sync_id, date, time, description, calories, source, protein_g, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, 'ai_estimate', ?, ?, ?)
  `).run(r.syncId, r.date, r.time, r.description, r.calories, r.proteinG ?? null, r.updatedAt ?? null, r.deletedAt ?? null);
  return Number(info.lastInsertRowid);
}

function live(db: Database.Database): Array<{ id: number; sync_id: string | null; description: string }> {
  return db.prepare('SELECT id, sync_id, description FROM food_log WHERE deleted_at IS NULL ORDER BY id').all() as never;
}

function dayKcal(db: Database.Database, date: string): number {
  return (db.prepare('SELECT COALESCE(SUM(calories), 0) AS k FROM food_log WHERE date = ? AND deleted_at IS NULL').get(date) as { k: number }).k;
}

/** The owner's database, reduced to the rows that matter. */
function seedOwnerDb(db: Database.Database): { medialunaTwin: number; medialuna: number; asadoTwin: number; asado: number } {
  // Pair A — original minted by 0.9 (uuid, protein), twin arrived through v0.7.5 and later adopted a legacy- id.
  const medialunaTwin = insert(db, { date: '2026-09-01', time: '16:16', description: 'una medialuna con jamon y queso', calories: 298,
    syncId: 'legacy-2026-09-01|16:16|298|una medialuna con jamon y queso', updatedAt: '2026-09-01T19:16:29.942Z' });
  const asadoTwin = insert(db, { date: '2026-05-01', time: '20:22', description: 'asado con papa al horno', calories: 850, syncId: null });
  const asado = insert(db, { date: '2026-05-01', time: '20:22', description: 'asado con papa al horno', calories: 850,
    syncId: 'legacy-2026-05-01|20:22|850|asado con papa al horno' });
  const medialuna = insert(db, { date: '2026-09-01', time: '16:16', description: 'una medialuna con jamon y queso', calories: 298,
    syncId: '43c06dd8-fa98-44f4-8e36-64ef76f9e260', proteinG: 15.5, updatedAt: '2026-09-01T19:16:29.942Z' });

  // Doubled summaries, exactly what the owner saw (05-01: 1850 real → 3700).
  db.prepare("INSERT INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance, updated_at) VALUES ('2026-05-01', 1700, 2021, 2779, 1079, '2026-09-02T14:16:45.700Z')").run();
  db.prepare("INSERT INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance, updated_at) VALUES ('2026-09-01', 596, 2021, 2779, 2183, '2026-09-02T14:16:45.699Z')").run();
  return { medialunaTwin, medialuna, asadoTwin, asado };
}

describe(`nutrition v${REPAIR_VERSION} — repairs food_log twins left by an id-keyed merge`, () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateUpTo(db, REPAIR_VERSION - 1);
  });

  it('keeps the identified row of each pair: uuid over legacy-, legacy- over NULL', () => {
    const ids = seedOwnerDb(db);
    db.exec(repairMigration());

    const survivors = live(db).map(r => r.id);
    expect(survivors).toEqual([ids.asado, ids.medialuna]);
    // Hard delete, not a tombstone: a tombstone with a foreign sync_id would be
    // applied by the natural-key fallback on every other device — and delete the
    // REAL meal there.
    expect((db.prepare('SELECT COUNT(*) AS c FROM food_log').get() as { c: number }).c).toBe(2);
  });

  it('recomputes the daily summaries of the affected days with a fresh ISO stamp', () => {
    seedOwnerDb(db);
    db.exec(repairMigration());

    const s = db.prepare('SELECT date, total_calories_in, balance, tdee, updated_at FROM nutrition_daily_summary ORDER BY date').all() as Array<{ date: string; total_calories_in: number; balance: number; tdee: number; updated_at: string }>;
    expect(s.map(r => [r.date, r.total_calories_in, r.balance])).toEqual([
      ['2026-05-01', 850, 2779 - 850],
      ['2026-09-01', 298, 2779 - 298],
    ]);
    for (const r of s) {
      expect(r.total_calories_in).toBe(dayKcal(db, r.date));
      // Newer than the doubled write, and in the ISO form every writer uses (' ' < 'T').
      expect(r.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(r.updated_at > '2026-09-02T14:16:45.700Z').toBe(true);
    }
  });

  it('carries the macros of the surviving row into the summary', () => {
    seedOwnerDb(db);
    db.exec(repairMigration());
    const s = db.prepare("SELECT protein_g FROM nutrition_daily_summary WHERE date = '2026-09-01'").get() as { protein_g: number | null };
    expect(s.protein_g).toBe(15.5);
  });

  it('is idempotent', () => {
    seedOwnerDb(db);
    db.exec(repairMigration());
    const first = db.prepare('SELECT id, sync_id, deleted_at FROM food_log ORDER BY id').all();
    const firstSummary = db.prepare('SELECT date, total_calories_in, balance FROM nutrition_daily_summary ORDER BY date').all();
    db.exec(repairMigration());
    expect(db.prepare('SELECT id, sync_id, deleted_at FROM food_log ORDER BY id').all()).toEqual(first);
    expect(db.prepare('SELECT date, total_calories_in, balance FROM nutrition_daily_summary ORDER BY date').all()).toEqual(firstSummary);
  });

  it('does not touch a pair the user already resolved by deleting one copy', () => {
    const kept = insert(db, { date: '2026-09-01', time: '21:22', description: 'hamburguesa', calories: 1750, syncId: null });
    insert(db, { date: '2026-09-01', time: '21:22', description: 'hamburguesa', calories: 1750,
      syncId: '2936dd3d-9d91-4426-9d06-6def93adc72f', deletedAt: '2026-09-02T00:22:34.597Z', updatedAt: '2026-09-02T00:22:34.597Z' });
    db.exec(repairMigration());
    expect(live(db).map(r => r.id)).toEqual([kept]);
  });

  it('leaves genuine repeats alone: two uuid rows, or the v12 "#id" disambiguation', () => {
    // Same snack twice in the same minute, both minted by this codebase.
    insert(db, { date: '2026-06-01', time: '17:00', description: 'paquete de m&m', calories: 230, syncId: 'u-1' });
    insert(db, { date: '2026-06-01', time: '17:00', description: 'paquete de m&m', calories: 230, syncId: 'u-2' });
    // Two pre-sync_id rows the v12 backfill told apart deterministically.
    insert(db, { date: '2026-04-01', time: '12:00', description: 'cafe', calories: 30, syncId: 'legacy-2026-04-01|12:00|30|cafe' });
    insert(db, { date: '2026-04-01', time: '12:00', description: 'cafe', calories: 30, syncId: 'legacy-2026-04-01|12:00|30|cafe#7' });
    db.exec(repairMigration());
    expect(live(db)).toHaveLength(4);
  });

  it('collapses two anonymous copies to the older one', () => {
    const older = insert(db, { date: '2026-06-02', time: '08:00', description: 'tostadas', calories: 300, syncId: null });
    insert(db, { date: '2026-06-02', time: '08:00', description: 'tostadas', calories: 300, syncId: null });
    db.exec(repairMigration());
    expect(live(db).map(r => r.id)).toEqual([older]);
  });
});

describe('mergeNutritionFoods — a foreign copy of a meal we already identify', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateUpTo(db, Infinity);
  });

  const meal = { date: '2026-09-01', time: '16:17', description: 'moccalatte', calories: 300, source: 'manual' };

  it('does not insert a row whose sync_id differs from the natural-key match, nor applies its tombstone', () => {
    insert(db, { ...meal, syncId: '6f0ae5b2-d703-4806-b479-508d81e5e671', updatedAt: '2026-09-01T19:17:10.588Z' });

    // The twin, as another device would push it after the owner's cleanup — or
    // as the owner's own desktop pushed it for a day: same meal, other identity,
    // newer stamp, deleted.
    const r = mergeNutritionFoods(db, { foodLog: [{
      ...meal, sync_id: 'legacy-2026-09-01|16:17|300|moccalatte',
      updated_at: '2026-09-03T10:00:00.000Z', deleted_at: '2026-09-03T10:00:00.000Z',
    }] });

    const rows = db.prepare('SELECT sync_id, deleted_at FROM food_log').all() as Array<{ sync_id: string; deleted_at: string | null }>;
    expect(rows).toEqual([{ sync_id: '6f0ae5b2-d703-4806-b479-508d81e5e671', deleted_at: null }]);
    expect(r.changed).toBe(false);
  });

  it('still lets a client without sync_id (pre-0.8) edit or delete by natural key', () => {
    insert(db, { ...meal, syncId: 'u-1', updatedAt: '2026-09-01T19:17:10.588Z' });
    mergeNutritionFoods(db, { foodLog: [{ ...meal, updated_at: '2026-09-03T10:00:00.000Z', deleted_at: '2026-09-03T10:00:00.000Z' }] });
    const rows = db.prepare('SELECT sync_id, deleted_at FROM food_log').all() as Array<{ sync_id: string; deleted_at: string | null }>;
    expect(rows).toEqual([{ sync_id: 'u-1', deleted_at: '2026-09-03T10:00:00.000Z' }]);
  });

  it('adopts the identified row, not an anonymous twin, when a sync_id-less payload matches both', () => {
    const twin = insert(db, { ...meal, syncId: null });
    const original = insert(db, { ...meal, syncId: 'u-1', updatedAt: '2026-09-01T19:17:10.588Z' });
    mergeNutritionFoods(db, { foodLog: [{ ...meal, updated_at: '2026-09-03T10:00:00.000Z', deleted_at: '2026-09-03T10:00:00.000Z' }] });
    const byId = (id: number) => db.prepare('SELECT sync_id, deleted_at FROM food_log WHERE id = ?').get(id) as { sync_id: string | null; deleted_at: string | null } | undefined;
    expect(byId(original)?.deleted_at).not.toBeNull();
    expect(byId(twin)).toBeUndefined(); // swept, see below
  });

  it('sweeps twins that an old client left behind, and reports their dates for the recalc', () => {
    const original = insert(db, { ...meal, syncId: 'u-1', updatedAt: '2026-09-01T19:17:10.588Z' });
    insert(db, { ...meal, syncId: null });
    insert(db, { date: '2026-05-01', time: '20:22', description: 'asado', calories: 850, syncId: 'legacy-2026-05-01|20:22|850|asado' });
    insert(db, { date: '2026-05-01', time: '20:22', description: 'asado', calories: 850, syncId: null });

    const r = mergeNutritionFoods(db, { foodLog: [] });
    expect(live(db).map(x => x.id)).toEqual([original, 3]);
    expect([...r.affectedDates].sort()).toEqual(['2026-05-01', '2026-09-01']);
    expect(r.changed).toBe(true);
  });
});

describe('sync:getAllNutritionData — the export no longer hands an id-keyed client a loaded gun', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    migrateUpTo(testDb, Infinity);
    clearHandlers();
    registerSyncIpcHandlers();
  });

  it('ships food_log and frequent_foods rows without the device-local id', async () => {
    testDb.prepare("INSERT INTO frequent_foods (sync_id, name, calories, times_used, created_at, updated_at) VALUES ('ff-a', 'Yogur', 120, 3, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')").run();
    const ff = (testDb.prepare("SELECT id FROM frequent_foods WHERE sync_id = 'ff-a'").get() as { id: number }).id;
    testDb.prepare("INSERT INTO food_log (sync_id, date, time, description, calories, source, frequent_food_id, updated_at) VALUES ('meal-a', '2026-06-05', '10:00', 'Yogur', 120, 'frequent', ?, '2026-06-05T10:00:00.000Z')").run(ff);

    const data = await getHandler('sync:getAllNutritionData')!({}) as { foodLog: Array<Record<string, unknown>>; frequentFoods: Array<Record<string, unknown>> };
    expect(data.foodLog).toHaveLength(1);
    expect(data.foodLog[0]).not.toHaveProperty('id');
    expect(data.foodLog[0].sync_id).toBe('meal-a');
    expect(data.foodLog[0].frequent_food_sync_id).toBe('ff-a');
    expect(data.frequentFoods[0]).not.toHaveProperty('id');
    expect(data.frequentFoods[0].sync_id).toBe('ff-a');
  });
});
