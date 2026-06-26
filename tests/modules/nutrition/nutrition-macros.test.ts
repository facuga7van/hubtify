import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { calcAutoMacroTargets, goalFromDeficit, KCAL_PER_GRAM } from '../../../shared/macro-utils';

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

function colNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(c => c.name);
}

describe('nutrition migration V10 — macros', () => {
  it('food_log has protein_g, carbs_g, fat_g columns', () => {
    const names = colNames(setupDb(), 'food_log');
    expect(names).toContain('protein_g');
    expect(names).toContain('carbs_g');
    expect(names).toContain('fat_g');
  });

  it('favorite_foods has macro columns', () => {
    const names = colNames(setupDb(), 'favorite_foods');
    expect(names).toEqual(expect.arrayContaining(['protein_g', 'carbs_g', 'fat_g']));
  });

  it('frequent_foods has macro columns', () => {
    const names = colNames(setupDb(), 'frequent_foods');
    expect(names).toEqual(expect.arrayContaining(['protein_g', 'carbs_g', 'fat_g']));
  });

  it('nutrition_daily_summary has macro total columns', () => {
    const names = colNames(setupDb(), 'nutrition_daily_summary');
    expect(names).toEqual(expect.arrayContaining(['protein_g', 'carbs_g', 'fat_g']));
  });

  it('nutrition_profile has macro target override columns', () => {
    const names = colNames(setupDb(), 'nutrition_profile');
    expect(names).toEqual(expect.arrayContaining(['protein_target_g', 'carbs_target_g', 'fat_target_g']));
  });

  it('macro columns default to NULL', () => {
    const db = setupDb();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source) VALUES ('2026-05-01', '12:00', 'Plain', 100, 'manual')").run();
    const row = db.prepare("SELECT protein_g, carbs_g, fat_g FROM food_log WHERE date = '2026-05-01'").get() as { protein_g: number | null; carbs_g: number | null; fat_g: number | null };
    expect(row.protein_g).toBeNull();
    expect(row.carbs_g).toBeNull();
    expect(row.fat_g).toBeNull();
  });
});

describe('daily macro sum (recalcSummary semantics)', () => {
  // Mirrors the SUM query used by recalcSummary in nutrition.ipc.ts.
  const sumMacros = (db: Database.Database, date: string) =>
    db.prepare(`
      SELECT SUM(protein_g) AS protein, SUM(carbs_g) AS carbs, SUM(fat_g) AS fat
      FROM food_log WHERE date = ? AND deleted_at IS NULL
    `).get(date) as { protein: number | null; carbs: number | null; fat: number | null };

  it('sums macros of live rows and excludes soft-deleted rows', () => {
    const db = setupDb();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source, protein_g, carbs_g, fat_g) VALUES ('2026-05-01', '08:00', 'Eggs', 200, 'manual', 12, 1, 15)").run();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source, protein_g, carbs_g, fat_g) VALUES ('2026-05-01', '13:00', 'Rice', 300, 'manual', 6, 60, 2)").run();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source, protein_g, carbs_g, fat_g, deleted_at) VALUES ('2026-05-01', '20:00', 'Deleted', 500, 'manual', 40, 40, 40, datetime('now'))").run();

    const totals = sumMacros(db, '2026-05-01');
    expect(totals.protein).toBe(18);
    expect(totals.carbs).toBe(61);
    expect(totals.fat).toBe(17);
  });

  it('returns NULL totals when no live row reports macros', () => {
    const db = setupDb();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source) VALUES ('2026-05-02', '08:00', 'NoMacros', 200, 'manual')").run();
    const totals = sumMacros(db, '2026-05-02');
    expect(totals.protein).toBeNull();
    expect(totals.carbs).toBeNull();
    expect(totals.fat).toBeNull();
  });
});

describe('calcAutoMacroTargets helper', () => {
  it('classifies goal from deficit sign', () => {
    expect(goalFromDeficit(500)).toBe('deficit');
    expect(goalFromDeficit(0)).toBe('maintenance');
    expect(goalFromDeficit(-300)).toBe('surplus');
  });

  it('prioritizes protein more in a deficit than in a surplus (same weight)', () => {
    const weight = 80;
    const calories = 2000;
    const deficit = calcAutoMacroTargets(calories, weight, 500);
    const surplus = calcAutoMacroTargets(calories, weight, -500);
    expect(deficit.proteinG).toBeGreaterThan(surplus.proteinG);
  });

  it('macro grams close against the calorie target (4/4/9)', () => {
    const calories = 2000;
    const t = calcAutoMacroTargets(calories, 80, 500);
    const reconstructed =
      t.proteinG * KCAL_PER_GRAM.protein +
      t.carbsG * KCAL_PER_GRAM.carbs +
      t.fatG * KCAL_PER_GRAM.fat;
    // Allow a few kcal of integer rounding drift.
    expect(Math.abs(reconstructed - calories)).toBeLessThanOrEqual(4);
  });

  it('produces positive macro grams for a realistic profile', () => {
    const t = calcAutoMacroTargets(2200, 75, 0);
    expect(t.proteinG).toBeGreaterThan(0);
    expect(t.carbsG).toBeGreaterThan(0);
    expect(t.fatG).toBeGreaterThan(0);
  });

  it('never returns negative carbs when protein+fat would exceed the target', () => {
    // Very low calorie target with a heavy person → protein alone is large.
    const t = calcAutoMacroTargets(600, 120, 500);
    expect(t.carbsG).toBeGreaterThanOrEqual(0);
    expect(t.proteinG).toBeGreaterThanOrEqual(0);
    expect(t.fatG).toBeGreaterThanOrEqual(0);
  });
});
