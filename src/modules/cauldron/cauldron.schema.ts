import type { Migration } from '../../../shared/types';

export const cauldronMigrations: Migration[] = [
  {
    namespace: 'cauldron',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS cauldron_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_minutes INTEGER NOT NULL DEFAULT 25,
        break_minutes INTEGER NOT NULL DEFAULT 5,
        long_break_minutes INTEGER NOT NULL DEFAULT 15,
        cycles_before_long INTEGER NOT NULL DEFAULT 4,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS cauldron_sessions (
        id TEXT PRIMARY KEY,
        preset_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('work','break','long_break')),
        duration_minutes INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (preset_id) REFERENCES cauldron_presets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_cauldron_sessions_started ON cauldron_sessions(started_at);

      INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default)
      VALUES
        ('preset-classic', 'Classic', 25, 5, 15, 4, 1),
        ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 1),
        ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 1);
    `,
  },
  {
    namespace: 'cauldron',
    version: 2,
    up: `
      INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default)
      VALUES
        ('preset-classic', 'Classic', 25, 5, 15, 4, 1),
        ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 1),
        ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 1);
    `,
  },
  {
    namespace: 'cauldron',
    version: 3,
    up: `
      ALTER TABLE cauldron_presets ADD COLUMN extension_minutes INTEGER NOT NULL DEFAULT 5;
    `,
  },
  {
    namespace: 'cauldron',
    version: 4,
    up: `
      -- The running timer lived only in a module-level 'let'. Closing the app mid
      -- pomodoro lost it, and startup then marked EVERY incomplete session deleted —
      -- 20 minutes of a 25-minute cycle silently thrown away, no XP, no warning.
      -- target_end_time (epoch ms) makes the running session recoverable across a
      -- restart: cauldron:getInterruptedSession reads it to compute the time left.
      ALTER TABLE cauldron_sessions ADD COLUMN target_end_time INTEGER;

      -- cauldron:extend inserted a plain type='work' row, so finishing a 5-minute
      -- extension of an already-paid cycle counted as a WHOLE extra pomodoro:
      -- +8 XP, +1 in "Today", +5 min on the weekly chart. Extensions are now
      -- flagged and excluded from every stat.
      ALTER TABLE cauldron_sessions ADD COLUMN is_extension INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_cauldron_work_done
        ON cauldron_sessions(type, completed, deleted_at, started_at);
    `,
  },
];
