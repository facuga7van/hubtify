import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import type { Migration } from '../../shared/types';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  return db;
}

const tableExists = (db: Database.Database, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

const isApplied = (db: Database.Database, ns: string, v: number) =>
  !!db.prepare('SELECT 1 FROM migrations_applied WHERE namespace = ? AND version = ?').get(ns, v);

describe('runModuleMigrations atomicity (task 2)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('rolls the whole migration back when a statement fails halfway', () => {
    const broken: Migration = {
      namespace: 'demo', version: 1,
      up: `
        CREATE TABLE demo_kept (id TEXT PRIMARY KEY);
        INSERT INTO demo_kept (id) VALUES ('a');
        SELECT this_is_not_valid_sql FROM nowhere;
      `,
    };

    expect(() => applyMigrations(db, [broken])).toThrow();
    // Nothing partially applied…
    expect(tableExists(db, 'demo_kept')).toBe(false);
    // …and it is NOT recorded, so it will be retried cleanly on the next boot.
    expect(isApplied(db, 'demo', 1)).toBe(false);
  });

  it('never leaves a destructive DROP + RENAME pair half-done', () => {
    // The shape of quests v9 / nutrition v8: the exact pair that, interrupted,
    // used to destroy the original table with nothing to rename in its place.
    db.exec("CREATE TABLE thing (id TEXT PRIMARY KEY, name TEXT); INSERT INTO thing VALUES ('1','one');");

    const destructive: Migration = {
      namespace: 'demo', version: 2,
      up: `
        CREATE TABLE thing_new (id TEXT PRIMARY KEY, name TEXT, extra TEXT);
        INSERT INTO thing_new (id, name) SELECT id, name FROM thing;
        DROP TABLE thing;
        BOOM;
        ALTER TABLE thing_new RENAME TO thing;
      `,
    };

    expect(() => applyMigrations(db, [destructive])).toThrow();
    expect(tableExists(db, 'thing')).toBe(true);
    expect(tableExists(db, 'thing_new')).toBe(false);
    expect(db.prepare('SELECT name FROM thing WHERE id = ?').get('1')).toEqual({ name: 'one' });
  });

  it('records the migration inside the same transaction as its statements', () => {
    const ok: Migration = {
      namespace: 'demo', version: 3,
      up: `CREATE TABLE demo_ok (id TEXT PRIMARY KEY);`,
    };
    applyMigrations(db, [ok]);
    expect(tableExists(db, 'demo_ok')).toBe(true);
    expect(isApplied(db, 'demo', 3)).toBe(true);

    // Re-running is a no-op — the applied check short-circuits before exec.
    expect(() => applyMigrations(db, [ok])).not.toThrow();
  });

  it('executes the migration whole, so a semicolon inside a literal is preserved', () => {
    const withSemicolon: Migration = {
      namespace: 'demo', version: 4,
      up: `
        CREATE TABLE demo_literal (id TEXT PRIMARY KEY, note TEXT);
        INSERT INTO demo_literal (id, note) VALUES ('1', 'first; second; third');
      `,
    };
    applyMigrations(db, [withSemicolon]);
    const row = db.prepare('SELECT note FROM demo_literal WHERE id = ?').get('1') as { note: string };
    // Splitting on ';' would have shredded this value (or thrown).
    expect(row.note).toBe('first; second; third');
  });

  it('still tolerates a duplicate column left behind by the old non-atomic runner', () => {
    db.exec('CREATE TABLE demo_alter (id TEXT PRIMARY KEY);');
    // Simulate a half-applied migration: col_a already exists, col_b does not.
    db.exec('ALTER TABLE demo_alter ADD COLUMN col_a TEXT;');

    applyMigrations(db, [{
      namespace: 'demo', version: 5,
      up: `
        ALTER TABLE demo_alter ADD COLUMN col_a TEXT;
        ALTER TABLE demo_alter ADD COLUMN col_b TEXT;
      `,
    }]);

    const cols = (db.prepare('PRAGMA table_info(demo_alter)').all() as Array<{ name: string }>).map(c => c.name);
    expect(cols).toContain('col_a');
    expect(cols).toContain('col_b');
    expect(isApplied(db, 'demo', 5)).toBe(true);
  });
});

describe('core migrations', () => {
  it('add ref_id / sync_id to rpg_events and last_milestone_streak to player_stats', () => {
    const db = setupDb();
    applyMigrations(db, coreMigrations);

    const eventCols = (db.prepare('PRAGMA table_info(rpg_events)').all() as Array<{ name: string }>).map(c => c.name);
    expect(eventCols).toContain('ref_id');
    expect(eventCols).toContain('sync_id');

    const statCols = (db.prepare('PRAGMA table_info(player_stats)').all() as Array<{ name: string }>).map(c => c.name);
    expect(statCols).toContain('last_milestone_streak');
  });

  it('backfills rpg_events.sync_id deterministically so replicated rows converge', () => {
    // Two devices holding the SAME logical event under the same created_at/payload
    // must derive the same sync_id, or the first merge duplicates all of history.
    const make = () => {
      const db = setupDb();
      db.prepare("INSERT INTO rpg_events (module_id, event_type, xp_gained, payload, created_at) VALUES ('quests','TASK_COMPLETED', 12, '{\"taskId\":\"abc\"}', '2026-06-01 10:00:00')").run();
      applyMigrations(db, coreMigrations);
      return db.prepare('SELECT sync_id, ref_id FROM rpg_events').get() as { sync_id: string; ref_id: string };
    };
    const a = make();
    const b = make();
    expect(a.sync_id).toBe(b.sync_id);
    expect(a.ref_id).toBe('abc');
  });

  it('drops the unused sync_log table and creates app_state', () => {
    const db = setupDb();
    expect(tableExists(db, 'sync_log')).toBe(false);
    expect(tableExists(db, 'app_state')).toBe(true);
  });
});
