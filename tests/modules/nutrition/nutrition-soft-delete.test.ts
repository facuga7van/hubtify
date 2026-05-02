import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

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
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('nutrition migration V9 — soft deletes', () => {
  it('food_log has deleted_at and updated_at columns', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(food_log)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('deleted_at');
    expect(names).toContain('updated_at');
  });

  it('favorite_foods has deleted_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(favorite_foods)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('deleted_at');
  });

  it('frequent_foods has deleted_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(frequent_foods)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('deleted_at');
  });

  it('frequent_foods has case-insensitive unique index on name', () => {
    const db = setupDb();
    db.prepare("INSERT INTO frequent_foods (name, calories, times_used, created_at) VALUES ('Milanesa', 400, 1, datetime('now'))").run();
    expect(() => {
      db.prepare("INSERT INTO frequent_foods (name, calories, times_used, created_at) VALUES ('milanesa', 300, 1, datetime('now'))").run();
    }).toThrow();
  });

  it('soft-deleted food_log entries are excluded from calorie sum', () => {
    const db = setupDb();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source) VALUES ('2026-05-01', '12:00', 'Lunch', 500, 'manual')").run();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source, deleted_at) VALUES ('2026-05-01', '13:00', 'Deleted', 300, 'manual', datetime('now'))").run();
    const row = db.prepare("SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = '2026-05-01' AND deleted_at IS NULL").get() as { total: number };
    expect(row.total).toBe(500);
  });
});
