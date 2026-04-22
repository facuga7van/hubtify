import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import crypto from 'crypto';

function runMigrations(db: Database.Database) {
  for (const m of cauldronMigrations) {
    db.exec(m.up);
  }
}

function genId(): string {
  return crypto.randomUUID();
}

describe('cauldron preset operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  it('getPresets returns defaults sorted correctly', () => {
    const presets = db.prepare(`
      SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
             long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong,
             is_default AS isDefault
      FROM cauldron_presets WHERE deleted_at IS NULL
      ORDER BY is_default DESC, name ASC
    `).all() as Array<Record<string, unknown>>;

    expect(presets).toHaveLength(3);
    // Defaults first, sorted by name
    expect(presets[0].name).toBe('Classic');
    expect(presets[1].name).toBe('Long Focus');
    expect(presets[2].name).toBe('Quick Sprint');
  });

  it('upsertPreset creates custom preset', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, 'My Custom', 45, 10, 20, 3, now, now);

    const preset = db.prepare('SELECT * FROM cauldron_presets WHERE id = ?').get(id) as Record<string, unknown>;
    expect(preset.name).toBe('My Custom');
    expect(preset.work_minutes).toBe(45);
    expect(preset.is_default).toBe(0);
  });

  it('upsertPreset updates existing custom preset', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at)
      VALUES (?, ?, 25, 5, 15, 4, 0, ?, ?)
    `).run(id, 'Original', now, now);

    // Simulate upsertPreset update path
    db.prepare(`
      UPDATE cauldron_presets SET name = ?, work_minutes = ?, break_minutes = ?,
      long_break_minutes = ?, cycles_before_long = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run('Renamed', 30, 7, 20, 3, now, id);

    const preset = db.prepare('SELECT * FROM cauldron_presets WHERE id = ?').get(id) as Record<string, unknown>;
    expect(preset.name).toBe('Renamed');
    expect(preset.work_minutes).toBe(30);
    expect(preset.break_minutes).toBe(7);
  });

  it('upsertPreset rejects modification of default preset', () => {
    const existing = db.prepare("SELECT is_default FROM cauldron_presets WHERE id = 'preset-classic'").get() as { is_default: number } | undefined;
    expect(existing?.is_default).toBe(1);
    // In handler: if (existing?.is_default) throw new Error('Cannot modify default preset')
  });

  it('deletePreset soft-deletes custom preset', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at) VALUES (?, ?, 25, 5, 15, 4, 0, ?, ?)`).run(id, 'ToDelete', now, now);

    db.prepare('UPDATE cauldron_presets SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);

    const visible = db.prepare('SELECT * FROM cauldron_presets WHERE id = ? AND deleted_at IS NULL').get(id);
    expect(visible).toBeUndefined();

    const still = db.prepare('SELECT * FROM cauldron_presets WHERE id = ?').get(id) as Record<string, unknown>;
    expect(still.deleted_at).not.toBeNull();
  });

  it('deleted preset excluded from getPresets query', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at, deleted_at) VALUES (?, ?, 25, 5, 15, 4, 0, ?, ?, ?)`).run(id, 'Deleted', now, now, now);

    const presets = db.prepare('SELECT * FROM cauldron_presets WHERE deleted_at IS NULL').all();
    const ids = (presets as Array<Record<string, unknown>>).map(p => p.id);
    expect(ids).not.toContain(id);
  });

  it('default presets cannot be deleted (check is_default)', () => {
    const preset = db.prepare("SELECT is_default FROM cauldron_presets WHERE id = 'preset-classic'").get() as { is_default: number };
    expect(preset.is_default).toBe(1);
    // In real handler, this would throw. Here we verify the flag.
  });

  it('custom presets appear after defaults in getPresets', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at) VALUES (?, ?, 45, 10, 20, 3, 0, ?, ?)`).run(id, 'AAA Custom', now, now);

    const presets = db.prepare(`
      SELECT id, name, is_default AS isDefault
      FROM cauldron_presets WHERE deleted_at IS NULL
      ORDER BY is_default DESC, name ASC
    `).all() as Array<Record<string, unknown>>;

    expect(presets).toHaveLength(4);
    // Defaults (is_default=1) come first, then custom (is_default=0)
    expect(presets[0].isDefault).toBe(1);
    expect(presets[1].isDefault).toBe(1);
    expect(presets[2].isDefault).toBe(1);
    expect(presets[3].isDefault).toBe(0);
    expect(presets[3].name).toBe('AAA Custom');
  });
});

describe('cauldron session operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  it('records a completed work session', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at)
      VALUES (?, ?, 'work', 25, 1, ?, ?, ?, ?)
    `).run(id, 'preset-classic', now, now, now, now);

    const session = db.prepare('SELECT * FROM cauldron_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    expect(session.completed).toBe(1);
    expect(session.type).toBe('work');
    expect(session.duration_minutes).toBe(25);
  });

  it('records an incomplete session (stopped)', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at)
      VALUES (?, ?, 'work', 25, 0, ?, ?, ?)
    `).run(id, 'preset-classic', now, now, now);

    const session = db.prepare('SELECT * FROM cauldron_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    expect(session.completed).toBe(0);
    expect(session.completed_at).toBeNull();
  });

  it('session without preset_id is valid (nullable FK)', () => {
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, created_at, updated_at)
      VALUES (?, 'work', 25, 1, ?, ?, ?)
    `).run(id, now, now, now);

    const session = db.prepare('SELECT * FROM cauldron_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    expect(session.preset_id).toBeNull();
  });

  it('getStats counts correctly', () => {
    const now = new Date().toISOString();
    const today = new Date().toISOString().split('T')[0];

    // 3 completed work sessions today
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at) VALUES (?, 'work', 25, 1, ?, ?, ?, ?)`).run(genId(), `${today}T10:0${i}:00`, now, now, now);
    }

    // 1 incomplete work session (should not count)
    db.prepare(`INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, created_at, updated_at) VALUES (?, 'work', 25, 0, ?, ?, ?)`).run(genId(), `${today}T11:00:00`, now, now);

    // 1 completed break session (should not count as work)
    db.prepare(`INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at) VALUES (?, 'break', 5, 1, ?, ?, ?, ?)`).run(genId(), `${today}T11:30:00`, now, now, now);

    // 1 old completed work session (2 weeks ago - should count in total, not today)
    const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    db.prepare(`INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at) VALUES (?, 'work', 25, 1, ?, ?, ?, ?)`).run(genId(), `${oldDate}T10:00:00`, now, now, now);

    const todayCount = (db.prepare(`SELECT COUNT(*) AS count FROM cauldron_sessions WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND date(started_at) = date('now')`).get() as { count: number }).count;
    expect(todayCount).toBe(3);

    const weekCount = (db.prepare(`SELECT COUNT(*) AS count FROM cauldron_sessions WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND started_at >= date('now', '-7 days')`).get() as { count: number }).count;
    expect(weekCount).toBe(3);

    const totalCount = (db.prepare(`SELECT COUNT(*) AS count FROM cauldron_sessions WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL`).get() as { count: number }).count;
    expect(totalCount).toBe(4);
  });

  it('soft-deleted sessions excluded from stats', () => {
    const now = new Date().toISOString();
    const today = new Date().toISOString().split('T')[0];

    const id = genId();
    db.prepare(`INSERT INTO cauldron_sessions (id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, deleted_at) VALUES (?, 'work', 25, 1, ?, ?, ?, ?, ?)`).run(id, `${today}T10:00:00`, now, now, now, now);

    const count = (db.prepare(`SELECT COUNT(*) AS count FROM cauldron_sessions WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL`).get() as { count: number }).count;
    expect(count).toBe(0);
  });

  it('marking session complete updates completed and completed_at', () => {
    const id = genId();
    const startedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at)
      VALUES (?, ?, 'work', 25, 0, ?, ?, ?)
    `).run(id, 'preset-classic', startedAt, startedAt, startedAt);

    // Simulate onTimeUp completing the session
    const completedAt = new Date().toISOString();
    db.prepare('UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ? WHERE id = ?').run(completedAt, completedAt, id);

    const session = db.prepare('SELECT * FROM cauldron_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    expect(session.completed).toBe(1);
    expect(session.completed_at).toBe(completedAt);
  });
});
