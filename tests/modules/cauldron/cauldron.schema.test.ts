import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

function runMigrations(db: Database.Database) {
  for (const m of cauldronMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite — skip if column already exists
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name) as { name: string } | undefined;
  return !!row;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

describe('cauldron schema migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  it('creates cauldron_presets table', () => {
    runMigrations(db);
    expect(tableExists(db, 'cauldron_presets')).toBe(true);
    const requiredCols = ['id', 'name', 'work_minutes', 'break_minutes', 'long_break_minutes', 'cycles_before_long', 'is_default', 'created_at', 'updated_at', 'deleted_at'];
    for (const col of requiredCols) {
      expect(columnExists(db, 'cauldron_presets', col), `column ${col}`).toBe(true);
    }
  });

  it('creates cauldron_sessions table', () => {
    runMigrations(db);
    expect(tableExists(db, 'cauldron_sessions')).toBe(true);
    const requiredCols = ['id', 'preset_id', 'type', 'duration_minutes', 'completed', 'started_at', 'completed_at', 'created_at', 'updated_at', 'deleted_at'];
    for (const col of requiredCols) {
      expect(columnExists(db, 'cauldron_sessions', col), `column ${col}`).toBe(true);
    }
  });

  it('creates index on cauldron_sessions.started_at', () => {
    runMigrations(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cauldron_sessions'").all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_cauldron_sessions_started');
  });

  it('seeds 3 default presets', () => {
    runMigrations(db);
    const presets = db.prepare('SELECT * FROM cauldron_presets WHERE is_default = 1').all() as Array<Record<string, unknown>>;
    expect(presets).toHaveLength(3);

    const names = presets.map(p => p.name);
    expect(names).toContain('Classic');
    expect(names).toContain('Long Focus');
    expect(names).toContain('Quick Sprint');
  });

  it('Classic preset has correct values', () => {
    runMigrations(db);
    const classic = db.prepare("SELECT * FROM cauldron_presets WHERE id = 'preset-classic'").get() as Record<string, unknown>;
    expect(classic.work_minutes).toBe(25);
    expect(classic.break_minutes).toBe(5);
    expect(classic.long_break_minutes).toBe(15);
    expect(classic.cycles_before_long).toBe(4);
  });

  it('Long Focus preset has correct values', () => {
    runMigrations(db);
    const lf = db.prepare("SELECT * FROM cauldron_presets WHERE id = 'preset-long-focus'").get() as Record<string, unknown>;
    expect(lf.work_minutes).toBe(50);
    expect(lf.break_minutes).toBe(10);
    expect(lf.long_break_minutes).toBe(30);
    expect(lf.cycles_before_long).toBe(3);
  });

  it('Quick Sprint preset has correct values', () => {
    runMigrations(db);
    const qs = db.prepare("SELECT * FROM cauldron_presets WHERE id = 'preset-quick-sprint'").get() as Record<string, unknown>;
    expect(qs.work_minutes).toBe(15);
    expect(qs.break_minutes).toBe(3);
    expect(qs.long_break_minutes).toBe(10);
    expect(qs.cycles_before_long).toBe(4);
  });

  it('default presets use INSERT OR IGNORE (idempotent)', () => {
    runMigrations(db);
    runMigrations(db); // run twice
    const presets = db.prepare('SELECT * FROM cauldron_presets WHERE is_default = 1').all();
    expect(presets).toHaveLength(3);
  });

  it('cauldron_sessions type CHECK constraint works', () => {
    runMigrations(db);
    // Valid types should work
    db.prepare("INSERT INTO cauldron_sessions (id, type, duration_minutes, started_at) VALUES ('s1', 'work', 25, '2026-01-01')").run();
    db.prepare("INSERT INTO cauldron_sessions (id, type, duration_minutes, started_at) VALUES ('s2', 'break', 5, '2026-01-01')").run();
    db.prepare("INSERT INTO cauldron_sessions (id, type, duration_minutes, started_at) VALUES ('s3', 'long_break', 15, '2026-01-01')").run();

    // Invalid type should fail
    expect(() => {
      db.prepare("INSERT INTO cauldron_sessions (id, type, duration_minutes, started_at) VALUES ('s4', 'invalid', 25, '2026-01-01')").run();
    }).toThrow();
  });

  it('cauldron_sessions foreign key to presets works', () => {
    runMigrations(db);
    // Valid FK
    db.prepare("INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, started_at) VALUES ('s1', 'preset-classic', 'work', 25, '2026-01-01')").run();
    const row = db.prepare("SELECT preset_id FROM cauldron_sessions WHERE id = 's1'").get() as Record<string, unknown>;
    expect(row.preset_id).toBe('preset-classic');
  });
});
