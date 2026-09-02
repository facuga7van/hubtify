import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

// In-memory DB shared with the mocked db module.
let testDb: Database.Database;

const handlers = new Map<string, (...args: unknown[]) => unknown>();

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

vi.mock('../../../shared-logic/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerSyncIpcHandlers } from '../../../shared-logic/modules/sync.ipc';

function runMigrations(db: Database.Database) {
  for (const m of nutritionMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function merge(data: Record<string, unknown>): Promise<any> {
  return await getHandler('sync:mergeNutritionData')!({}, data);
}

const OLD = '2026-05-01 08:00:00';
const NEW = '2026-05-01 20:00:00';
/*
 * El merge normaliza TODO stamp entrante a ISO antes de comparar: los clientes
 * viejos escriben `datetime('now')` con espacio y, como ' ' < 'T', un borrado
 * nunca le ganaba a su propia fila. Lo que queda guardado es la forma normalizada.
 */
const NEW_STORED = '2026-05-01T20:00:00.000Z';

beforeEach(() => {
  testDb = setupDb();
  clearHandlers();
  registerSyncIpcHandlers();
});

// ── nutrition_daily_closed (LWW + soft delete) ────────────────────────────

describe('mergeNutritionData — daily_closed LWW', () => {
  function insertLocalClosed(date: string, xpTotal: number, updatedAt: string, deletedAt: string | null = null) {
    testDb.prepare(`
      INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, updated_at, deleted_at)
      VALUES (?, 0, 0, 0, 0, 0, ?, 10, 1800, 2000, ?, ?)
    `).run(date, xpTotal, updatedAt, deletedAt);
  }
  const readClosed = (date: string) =>
    testDb.prepare('SELECT xp_total AS xpTotal, deleted_at AS deletedAt, updated_at AS updatedAt FROM nutrition_daily_closed WHERE date = ?').get(date) as { xpTotal: number; deletedAt: string | null; updatedAt: string };

  it('inserts a remote closed day that does not exist locally', async () => {
    const res = await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 40, updated_at: NEW }] });
    expect(res.changed).toBe(true);
    expect(readClosed('2026-05-01').xpTotal).toBe(40);
  });

  it('adopts the remote record when it is newer (LWW wins)', async () => {
    insertLocalClosed('2026-05-01', 30, OLD);
    await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 55, updated_at: NEW }] });
    expect(readClosed('2026-05-01').xpTotal).toBe(55);
  });

  it('keeps the local record when remote is older', async () => {
    insertLocalClosed('2026-05-01', 30, NEW);
    const res = await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 55, updated_at: OLD }] });
    expect(readClosed('2026-05-01').xpTotal).toBe(30);
    expect(res.changed).toBe(false);
  });

  it('does not overwrite on equal updated_at (strictly-greater LWW)', async () => {
    insertLocalClosed('2026-05-01', 30, NEW);
    await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 55, updated_at: NEW }] });
    expect(readClosed('2026-05-01').xpTotal).toBe(30);
  });

  it('replicates a remote reopen (newer record carrying deleted_at) as a soft delete', async () => {
    insertLocalClosed('2026-05-01', 30, OLD, null);
    await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 30, updated_at: NEW, deleted_at: NEW }] });
    const row = readClosed('2026-05-01');
    expect(row.deletedAt).toBe(NEW_STORED); // reopened across accounts
  });

  it('does not resurrect a locally reopened (soft-deleted) day from an older remote close', async () => {
    // Local day was reopened (soft-deleted) recently; remote still has an old live close.
    insertLocalClosed('2026-05-01', 30, NEW, NEW);
    await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 30, updated_at: OLD, deleted_at: null }] });
    const row = readClosed('2026-05-01');
    expect(row.deletedAt).toBe(NEW); // stays reopened, not revived
  });

  it('revives a soft-deleted day when remote re-closes it more recently (LWW)', async () => {
    insertLocalClosed('2026-05-01', 30, OLD, OLD); // locally reopened a while ago
    await merge({ dailyClosed: [{ date: '2026-05-01', xp_total: 42, updated_at: NEW, deleted_at: null }] });
    const row = readClosed('2026-05-01');
    expect(row.deletedAt).toBeNull(); // re-closed remotely, newer → revived
    expect(row.xpTotal).toBe(42);
  });
});

// ── nutrition_daily_metrics (LWW) ─────────────────────────────────────────

describe('mergeNutritionData — daily_metrics LWW', () => {
  const readDM = (date: string) =>
    testDb.prepare('SELECT steps, gym FROM nutrition_daily_metrics WHERE date = ?').get(date) as { steps: number; gym: number };

  it('inserts new remote metrics', async () => {
    await merge({ dailyMetrics: [{ date: '2026-05-02', steps: 9000, gym: 1, updated_at: NEW }] });
    expect(readDM('2026-05-02')).toEqual({ steps: 9000, gym: 1 });
  });

  it('remote newer overwrites local', async () => {
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym, updated_at) VALUES (?, ?, ?, ?)').run('2026-05-02', 3000, 0, OLD);
    await merge({ dailyMetrics: [{ date: '2026-05-02', steps: 9000, gym: 1, updated_at: NEW }] });
    expect(readDM('2026-05-02')).toEqual({ steps: 9000, gym: 1 });
  });

  it('remote older is ignored', async () => {
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym, updated_at) VALUES (?, ?, ?, ?)').run('2026-05-02', 3000, 0, NEW);
    await merge({ dailyMetrics: [{ date: '2026-05-02', steps: 9000, gym: 1, updated_at: OLD }] });
    expect(readDM('2026-05-02')).toEqual({ steps: 3000, gym: 0 });
  });
});

// ── nutrition_weekly_metrics (LWW) ────────────────────────────────────────

describe('mergeNutritionData — weekly_metrics LWW', () => {
  const readWM = (date: string) =>
    testDb.prepare('SELECT weight_kg AS weightKg FROM nutrition_weekly_metrics WHERE date = ?').get(date) as { weightKg: number };

  it('remote newer weight overwrites local', async () => {
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg, updated_at) VALUES (?, ?, ?)').run('2026-04-27', 80, OLD);
    await merge({ weeklyMetrics: [{ date: '2026-04-27', weight_kg: 78.5, waist_cm: null, updated_at: NEW }] });
    expect(readWM('2026-04-27').weightKg).toBe(78.5);
  });

  it('remote older weight is ignored', async () => {
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg, updated_at) VALUES (?, ?, ?)').run('2026-04-27', 80, NEW);
    await merge({ weeklyMetrics: [{ date: '2026-04-27', weight_kg: 78.5, waist_cm: null, updated_at: OLD }] });
    expect(readWM('2026-04-27').weightKg).toBe(80);
  });
});

// ── food_log (INSERT OR IGNORE by id + full LWW for edits/soft-delete) ──────

/*
 * La identidad cross-device de food_log es `sync_id`, no el `id` entero: dos
 * dispositivos acuñan 1, 2, 3… para filas DISTINTAS, y keyear por ese número
 * fusionaba comidas ajenas (y aplicaba el deleted_at remoto a la fila local que
 * casualmente compartía el número). Estos casos siguen midiendo el mismo LWW,
 * pero con la identidad real.
 */
describe('mergeNutritionData — food_log merge by sync_id', () => {
  function insertLocalFood(
    id: number,
    calories: number,
    updatedAt: string | null = null,
    deletedAt: string | null = null,
    extra: { description?: string; meal?: string | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; time?: string; date?: string } = {},
  ) {
    testDb.prepare(`
      INSERT INTO food_log (id, sync_id, date, time, description, calories, source, meal, protein_g, carbs_g, fat_g, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)
    `).run(
      id, 'sync-' + id, extra.date ?? '2026-05-01', extra.time ?? '12:00', extra.description ?? 'Lunch', calories,
      extra.meal ?? null, extra.proteinG ?? null, extra.carbsG ?? null, extra.fatG ?? null, updatedAt, deletedAt,
    );
  }
  const readFood = (id: number) =>
    testDb.prepare(
      'SELECT calories, description, meal, time, date, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG, deleted_at AS deletedAt FROM food_log WHERE sync_id = ?',
    ).get('sync-' + id) as {
      calories: number; description: string; meal: string | null; time: string; date: string;
      proteinG: number | null; carbsG: number | null; fatG: number | null; deletedAt: string | null;
    };

  it('inserts a new remote food row by id', async () => {
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 600, source: 'manual', updated_at: NEW }] });
    expect(readFood(100).calories).toBe(600);
  });

  it('replicates a remote-newer edit: calories/meal/description', async () => {
    insertLocalFood(100, 500, OLD);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '13:30', description: 'Big lunch', calories: 999, source: 'manual', meal: 'lunch', updated_at: NEW }] });
    const row = readFood(100);
    expect(row.calories).toBe(999);
    expect(row.description).toBe('Big lunch');
    expect(row.meal).toBe('lunch');
    expect(row.time).toBe('13:30');
  });

  it('replicates a remote-newer edit of macros (protein/carbs/fat)', async () => {
    insertLocalFood(100, 500, OLD, null, { proteinG: 10, carbsG: 20, fatG: 5 });
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 500, source: 'manual', protein_g: 40, carbs_g: 60, fat_g: 15, updated_at: NEW }] });
    const row = readFood(100);
    expect(row.proteinG).toBe(40);
    expect(row.carbsG).toBe(60);
    expect(row.fatG).toBe(15);
  });

  it('does NOT overwrite when the local row is newer than the remote edit', async () => {
    insertLocalFood(100, 500, NEW);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 999, source: 'manual', updated_at: OLD }] });
    expect(readFood(100).calories).toBe(500); // local edit wins over older remote
  });

  it('does NOT overwrite on equal updated_at (strictly-greater LWW)', async () => {
    insertLocalFood(100, 500, NEW);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 999, source: 'manual', updated_at: NEW }] });
    expect(readFood(100).calories).toBe(500);
  });

  it('INSERT OR IGNORE: a remote row missing updated_at never clobbers a local row', async () => {
    insertLocalFood(100, 500);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 999, source: 'manual' }] });
    // remote has no updated_at → '' is not strictly greater than local '' → no-op.
    expect(readFood(100).calories).toBe(500);
  });

  it('soft-deletes a local row when remote carries a newer deleted_at', async () => {
    insertLocalFood(100, 500, OLD, null);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 500, source: 'manual', updated_at: NEW, deleted_at: NEW }] });
    expect(readFood(100).deletedAt).toBe(NEW_STORED);
  });

  it('does not soft-delete when the local row is already newer than the remote delete', async () => {
    insertLocalFood(100, 500, NEW, null);
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 500, source: 'manual', updated_at: OLD, deleted_at: OLD }] });
    expect(readFood(100).deletedAt).toBeNull(); // local edit wins over older remote delete
  });

  it('does not resurrect a locally-deleted row from an older remote (LWW)', async () => {
    insertLocalFood(100, 500, NEW, NEW); // locally deleted, recent
    await merge({ foodLog: [{ id: 100, sync_id: 'sync-100', date: '2026-05-01', time: '12:00', description: 'Lunch', calories: 500, source: 'manual', updated_at: OLD }] });
    expect(readFood(100).deletedAt).toBe(NEW); // stays deleted
  });
});

// ── profile (LWW) ─────────────────────────────────────────────────────────

describe('mergeNutritionData — profile LWW', () => {
  function insertLocalProfile(deficit: number, updatedAt: string | null) {
    testDb.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, updated_at)
      VALUES (1, 30, 'M', 180, 80, 'moderate', ?, ?)
    `).run(deficit, updatedAt);
  }
  const readProfile = () =>
    testDb.prepare('SELECT deficit_target_kcal AS deficit FROM nutrition_profile WHERE id = 1').get() as { deficit: number };

  it('adopts a newer remote profile', async () => {
    insertLocalProfile(500, OLD);
    await merge({ profile: { age: 30, sex: 'M', height_cm: 180, initial_weight_kg: 80, activity_level: 'moderate', deficit_target_kcal: 750, updated_at: NEW } });
    expect(readProfile().deficit).toBe(750);
  });

  it('keeps the local profile when remote is older', async () => {
    insertLocalProfile(500, NEW);
    const res = await merge({ profile: { age: 30, sex: 'M', height_cm: 180, initial_weight_kg: 80, activity_level: 'moderate', deficit_target_kcal: 750, updated_at: OLD } });
    expect(readProfile().deficit).toBe(500);
    expect(res.changed).toBe(false);
  });

  it('inserts a remote profile when none exists locally', async () => {
    await merge({ profile: { age: 28, sex: 'F', height_cm: 165, initial_weight_kg: 60, activity_level: 'light', deficit_target_kcal: 400, updated_at: NEW } });
    expect(readProfile().deficit).toBe(400);
  });
});
