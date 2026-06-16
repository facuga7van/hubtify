import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { mergeHabitChecks } from '../../../electron/modules/sync.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Walk', '')").run();
  return db;
}

describe('mergeHabitChecks — UNIQUE(habit_id, date) reconciliation', () => {
  it('does NOT throw when the same (habit_id, date) arrives under a different id', () => {
    const db = setupDb();
    // Local check: id c1, h1 / 2026-06-15
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-15', '2026-06-15T10:00:00.000Z', '2026-06-15T10:00:00.000Z');

    // Remote: SAME (h1, 2026-06-15) but a different id (c2) — the cross-device collision
    const remote = [{
      id: 'c2', habitId: 'h1', date: '2026-06-15',
      createdAt: '2026-06-15T11:00:00.000Z', updatedAt: '2026-06-15T11:00:00.000Z', deletedAt: null,
    }];

    expect(() => mergeHabitChecks(db, remote)).not.toThrow();

    // Still exactly one row for that natural key — no duplicate, no crash
    const rows = db.prepare('SELECT COUNT(*) AS c FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', '2026-06-15') as { c: number };
    expect(rows.c).toBe(1);
  });

  it('propagates a soft-delete (un-check) arriving under a different id via LWW', () => {
    const db = setupDb();
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-15', '2026-06-15T10:00:00.000Z', '2026-06-15T10:00:00.000Z');

    // Remote is newer AND deleted (user un-checked on another device), different id
    mergeHabitChecks(db, [{
      id: 'c2', habitId: 'h1', date: '2026-06-15',
      createdAt: '2026-06-15T11:00:00.000Z', updatedAt: '2026-06-15T12:00:00.000Z',
      deletedAt: '2026-06-15T12:00:00.000Z',
    }]);

    const check = db.prepare('SELECT deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', '2026-06-15') as { deleted_at: string | null };
    expect(check.deleted_at).not.toBeNull();
  });

  it('does NOT let a stale remote clobber a newer local (LWW guard on upsert)', () => {
    const db = setupDb();
    // Local is newer (12:00) and active
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-15', '2026-06-15T10:00:00.000Z', '2026-06-15T12:00:00.000Z');

    // Stale remote (11:00) tries to delete — must be ignored
    const changed = mergeHabitChecks(db, [{
      id: 'c2', habitId: 'h1', date: '2026-06-15',
      createdAt: '2026-06-15T09:00:00.000Z', updatedAt: '2026-06-15T11:00:00.000Z',
      deletedAt: '2026-06-15T11:00:00.000Z',
    }]);

    expect(changed).toBe(false);
    const check = db.prepare('SELECT updated_at, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', '2026-06-15') as { updated_at: string; deleted_at: string | null };
    expect(check.deleted_at).toBeNull();
    expect(check.updated_at).toBe('2026-06-15T12:00:00.000Z');
  });

  it('inserts a genuinely new (habit_id, date) check', () => {
    const db = setupDb();
    const changed = mergeHabitChecks(db, [{
      id: 'c9', habitId: 'h1', date: '2026-06-20',
      createdAt: '2026-06-20T10:00:00.000Z', updatedAt: '2026-06-20T10:00:00.000Z', deletedAt: null,
    }]);
    expect(changed).toBe(true);
    const row = db.prepare('SELECT id FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', '2026-06-20') as { id: string } | undefined;
    expect(row?.id).toBe('c9');
  });
});
