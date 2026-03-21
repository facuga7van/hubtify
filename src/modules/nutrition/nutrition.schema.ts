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

      CREATE TABLE IF NOT EXISTS food_database (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        keywords TEXT NOT NULL,
        calories INTEGER NOT NULL,
        serving_size TEXT NOT NULL DEFAULT 'porcion estandar',
        category TEXT NOT NULL DEFAULT 'general'
      );
      CREATE INDEX IF NOT EXISTS idx_food_database_keywords ON food_database(keywords);
    `,
  },
];
