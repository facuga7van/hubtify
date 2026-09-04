import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  return db;
}

describe('nutrition migration v19 — nutrition_weekly_closed', () => {
  it('crea la tabla con week_start como PRIMARY KEY', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_weekly_closed)') as
      Array<{ name: string; pk: number }>;
    const names = cols.map(c => c.name);

    expect(names).toEqual([
      'week_start', 'days_closed', 'days_compliant', 'avg_consumed', 'avg_target',
      'weight_start', 'weight_end', 'days_steps', 'days_gym', 'streak_end',
      'xp_total', 'closed_at', 'updated_at',
    ]);
    expect(cols.find(c => c.name === 'week_start')!.pk).toBe(1);
  });

  it('NO tiene deleted_at: nada en la app puede producir una lápida', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_weekly_closed)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).not.toContain('deleted_at');
  });

  it('corre sobre una base que venía en v18', () => {
    const db = new Database(':memory:');
    for (const m of nutritionMigrations.filter(m => m.version <= 18)) db.exec(m.up);
    expect(() => db.exec(nutritionMigrations.find(m => m.version === 19)!.up)).not.toThrow();
  });
});
