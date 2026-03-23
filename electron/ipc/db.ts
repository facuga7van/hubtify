import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { Migration } from '../../shared/types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'hubtify.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 10000');
    db.pragma('temp_store = MEMORY');
    initCoreTables(db);
  }
  return db;
}

function initCoreTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_applied (
      namespace TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, version)
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY DEFAULT 'default',
      email TEXT,
      username TEXT,
      firebase_uid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      user_id TEXT PRIMARY KEY DEFAULT 'default',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      hp INTEGER NOT NULL DEFAULT 100,
      max_hp INTEGER NOT NULL DEFAULT 100,
      title TEXT NOT NULL DEFAULT 'Campesino',
      streak INTEGER NOT NULL DEFAULT 0,
      daily_combo INTEGER NOT NULL DEFAULT 0,
      combo_date TEXT,
      streak_last_date TEXT,
      total_tasks INTEGER NOT NULL DEFAULT 0,
      total_meals INTEGER NOT NULL DEFAULT 0,
      total_expenses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rpg_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      xp_gained REAL NOT NULL DEFAULT 0,
      hp_change REAL NOT NULL DEFAULT 0,
      combo_multiplier REAL NOT NULL DEFAULT 1.0,
      bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rpg_events_created_at ON rpg_events(created_at);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default');
    INSERT OR IGNORE INTO user_profile (id) VALUES ('default');
  `);
}

export function runModuleMigrations(migrations: Migration[]): void {
  const database = getDb();
  for (const migration of migrations) {
    const applied = database.prepare(
      'SELECT 1 FROM migrations_applied WHERE namespace = ? AND version = ?'
    ).get(migration.namespace, migration.version);
    if (!applied) {
      database.exec(migration.up);
      database.prepare(
        'INSERT INTO migrations_applied (namespace, version) VALUES (?, ?)'
      ).run(migration.namespace, migration.version);
    }
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
