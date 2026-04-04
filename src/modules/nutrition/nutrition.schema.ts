import type { Migration } from '../../../shared/types';

export const nutritionMigrations: Migration[] = [
  {
    namespace: 'nutrition',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS nutrition_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        age INTEGER NOT NULL,
        sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
        height_cm REAL NOT NULL,
        initial_weight_kg REAL NOT NULL,
        activity_level TEXT NOT NULL CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active')),
        deficit_target_kcal INTEGER NOT NULL DEFAULT 500,
        gym_calories INTEGER NOT NULL DEFAULT 300,
        step_calories_factor REAL NOT NULL DEFAULT 0.04
      );

      CREATE TABLE IF NOT EXISTS food_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        description TEXT NOT NULL,
        calories INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ai_estimate', 'frequent', 'manual')),
        frequent_food_id INTEGER,
        ai_breakdown TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date);

      CREATE TABLE IF NOT EXISTS frequent_foods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        calories INTEGER NOT NULL,
        ai_breakdown TEXT,
        times_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS nutrition_daily_metrics (
        date TEXT PRIMARY KEY,
        steps INTEGER,
        gym INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS nutrition_weekly_metrics (
        date TEXT PRIMARY KEY,
        weight_kg REAL,
        waist_cm REAL
      );

      CREATE TABLE IF NOT EXISTS nutrition_daily_summary (
        date TEXT PRIMARY KEY,
        total_calories_in INTEGER NOT NULL,
        bmr INTEGER NOT NULL,
        tdee INTEGER NOT NULL,
        balance INTEGER NOT NULL
      );

    `,
  },
  {
    namespace: 'nutrition',
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS nutrition_daily_closed (
        date TEXT PRIMARY KEY,
        xp_precision INTEGER NOT NULL DEFAULT 0,
        xp_steps INTEGER NOT NULL DEFAULT 0,
        xp_gym INTEGER NOT NULL DEFAULT 0,
        xp_weight INTEGER NOT NULL DEFAULT 0,
        xp_total INTEGER NOT NULL DEFAULT 0,
        hp_change INTEGER NOT NULL DEFAULT 0,
        consumed INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    namespace: 'nutrition',
    version: 3,
    up: `
      ALTER TABLE nutrition_profile ADD COLUMN date_of_birth TEXT DEFAULT NULL;
      ALTER TABLE nutrition_profile ADD COLUMN weight_check_day INTEGER NOT NULL DEFAULT 1;

      UPDATE nutrition_profile SET date_of_birth = (
        CAST(strftime('%Y', 'now') AS INTEGER) - age
      ) || '-01-01' WHERE date_of_birth IS NULL;
    `,
  },
  {
    namespace: 'nutrition',
    version: 4,
    up: `
      ALTER TABLE nutrition_daily_closed ADD COLUMN xp_bonus INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    namespace: 'nutrition',
    version: 5,
    up: `
      ALTER TABLE nutrition_profile ADD COLUMN weight_popup_enabled INTEGER NOT NULL DEFAULT 1;
    `,
  },
];
