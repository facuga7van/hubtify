import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { notificationsMigrations } from '../../electron/modules/notifications.schema';

/**
 * Boots a database exactly the way electron/main.ts does, then boots the SAME
 * database a second time. Catches a migration that is not idempotent — which now
 * matters more, since each one runs in a single all-or-nothing transaction.
 */
function boot(db: Database.Database): void {
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, questsMigrations);
  applyMigrations(db, nutritionMigrations);
  applyMigrations(db, financeMigrations);
  applyMigrations(db, notificationsMigrations);
  applyMigrations(db, cauldronMigrations);
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);

describe('clean install', () => {
  it('applies every migration in order, and re-running them is a no-op', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    expect(() => boot(db)).not.toThrow();
    const applied = (db.prepare('SELECT COUNT(*) AS c FROM migrations_applied').get() as { c: number }).c;
    expect(applied).toBeGreaterThan(0);

    expect(() => boot(db)).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) AS c FROM migrations_applied').get() as { c: number }).c).toBe(applied);
  });

  it('creates every column the new sync and RPG code depends on', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    boot(db);

    expect(columns(db, 'rpg_events')).toEqual(expect.arrayContaining(['ref_id', 'sync_id']));
    expect(columns(db, 'player_stats')).toContain('last_milestone_streak');
    expect(columns(db, 'food_log')).toContain('sync_id');
    expect(columns(db, 'frequent_foods')).toContain('sync_id');
    expect(columns(db, 'nutrition_daily_closed')).toEqual(expect.arrayContaining(['closed_at', 'updated_at', 'deleted_at']));
    expect(columns(db, 'cauldron_sessions')).toEqual(expect.arrayContaining(['target_end_time', 'is_extension']));
    expect(columns(db, 'tasks')).toContain('completed_at');
  });

  it('creates the indexes the hot queries rely on', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    boot(db);

    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
      .map(i => i.name);

    for (const expected of [
      'idx_tasks_due_open', 'idx_tasks_status_order', 'idx_tasks_updated',
      'idx_subtasks_completed', 'idx_habit_checks_live',
      'idx_food_log_live_date', 'idx_food_log_sync_id', 'idx_frequent_foods_sync_id',
      'idx_cauldron_work_done', 'idx_rpg_events_sync_id', 'idx_rpg_events_type_ref',
    ]) {
      expect(indexes).toContain(expected);
    }
  });

  it('every table listed in USER_DATA_TABLES actually exists', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    boot(db);

    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(t => t.name));
    // Kept in sync by hand with electron/modules/sync.ipc.ts — a table that leaks
    // between accounts is the exact bug this guards against.
    for (const t of ['finance_import_batches', 'finance_income_sources', 'app_state']) {
      expect(tables.has(t)).toBe(true);
    }
    expect(tables.has('sync_log')).toBe(false);
  });
});
