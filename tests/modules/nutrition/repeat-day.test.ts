import { describe, it, expect, vi } from 'vitest';

// nutrition.ipc.ts pulls in electron (ipcMain via ipc-handle, app via db).
// We only exercise the pure-ish repeatDayMeals helper against an in-memory DB,
// so a thin electron mock is enough — getDb() is never called.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));

import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { repeatDayMeals } from '../../../electron/modules/nutrition.ipc';

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
  // A profile is required for recalcSummary to write a summary row.
  db.prepare(
    "INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level) VALUES (1, 30, 'M', 180, 80, 'moderate')"
  ).run();
  return db;
}

interface FoodOver {
  time?: string; description?: string; calories?: number; source?: string;
  meal?: string | null; protein_g?: number | null; carbs_g?: number | null;
  fat_g?: number | null; deleted_at?: string | null;
}

function insertFood(db: Database.Database, date: string, over: FoodOver = {}) {
  const f = {
    time: '12:00', description: 'Lunch', calories: 500, source: 'manual',
    meal: 'lunch', protein_g: 30, carbs_g: 40, fat_g: 10, deleted_at: null, ...over,
  };
  db.prepare(`
    INSERT INTO food_log (date, time, description, calories, source, meal, protein_g, carbs_g, fat_g, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, f.time, f.description, f.calories, f.source, f.meal, f.protein_g, f.carbs_g, f.fat_g, f.deleted_at);
}

const liveRows = (db: Database.Database, date: string) =>
  db.prepare('SELECT * FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC').all(date) as Array<Record<string, unknown>>;

describe('repeatDayMeals — copy a day onto another', () => {
  it('copies every non-deleted meal to the destination with fresh ids, preserving fields and time', () => {
    const db = setupDb();
    insertFood(db, '2026-05-01', { time: '08:00', description: 'Eggs', calories: 200, meal: 'breakfast', protein_g: 12, carbs_g: 1, fat_g: 15 });
    insertFood(db, '2026-05-01', { time: '13:00', description: 'Rice', calories: 300, meal: 'lunch', protein_g: 6, carbs_g: 60, fat_g: 2 });

    const srcIds = liveRows(db, '2026-05-01').map(r => r.id);
    const copied = repeatDayMeals(db, '2026-05-01', '2026-05-02');
    expect(copied).toBe(2);

    const dst = liveRows(db, '2026-05-02');
    expect(dst).toHaveLength(2);
    // Fresh ids — no overlap with the source rows.
    expect(dst.map(r => r.id).some(id => srcIds.includes(id))).toBe(false);
    // Fields + original time preserved.
    expect(dst.map(r => r.description)).toEqual(['Eggs', 'Rice']);
    expect(dst.map(r => r.time)).toEqual(['08:00', '13:00']);
    expect(dst.map(r => r.meal)).toEqual(['breakfast', 'lunch']);
    expect(dst.map(r => r.calories)).toEqual([200, 300]);
    expect(dst.map(r => r.protein_g)).toEqual([12, 6]);
  });

  it('does not copy soft-deleted meals', () => {
    const db = setupDb();
    insertFood(db, '2026-05-01', { description: 'Kept', calories: 400 });
    insertFood(db, '2026-05-01', { description: 'Deleted', calories: 999, deleted_at: '2026-05-01 10:00:00' });

    const copied = repeatDayMeals(db, '2026-05-01', '2026-05-02');
    expect(copied).toBe(1);
    const dst = liveRows(db, '2026-05-02');
    expect(dst).toHaveLength(1);
    expect(dst[0].description).toBe('Kept');
    expect(dst.some(r => r.description === 'Deleted')).toBe(false);
  });

  it('recalculates the destination summary from the copied calories', () => {
    const db = setupDb();
    insertFood(db, '2026-05-01', { calories: 500, protein_g: 30, carbs_g: 40, fat_g: 10 });
    insertFood(db, '2026-05-01', { time: '19:00', calories: 250, protein_g: 10, carbs_g: 20, fat_g: 5 });

    repeatDayMeals(db, '2026-05-01', '2026-05-02');
    const summary = db.prepare('SELECT total_calories_in, protein_g FROM nutrition_daily_summary WHERE date = ?').get('2026-05-02') as { total_calories_in: number; protein_g: number };
    expect(summary.total_calories_in).toBe(750);
    expect(summary.protein_g).toBe(40);
  });

  it('adds on top of existing destination meals (never replaces)', () => {
    const db = setupDb();
    insertFood(db, '2026-05-02', { description: 'Already here', calories: 300 });
    insertFood(db, '2026-05-01', { description: 'From source', calories: 500 });

    const copied = repeatDayMeals(db, '2026-05-01', '2026-05-02');
    expect(copied).toBe(1);
    const dst = liveRows(db, '2026-05-02');
    expect(dst).toHaveLength(2);
    const summary = db.prepare('SELECT total_calories_in FROM nutrition_daily_summary WHERE date = ?').get('2026-05-02') as { total_calories_in: number };
    expect(summary.total_calories_in).toBe(800);
  });

  it('returns 0 and copies nothing when the source day is empty', () => {
    const db = setupDb();
    insertFood(db, '2026-05-02', { description: 'Untouched', calories: 300 });

    const copied = repeatDayMeals(db, '2026-01-01', '2026-05-02');
    expect(copied).toBe(0);
    expect(liveRows(db, '2026-05-02')).toHaveLength(1);
  });
});
