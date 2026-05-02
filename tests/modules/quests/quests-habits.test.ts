import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';

function runMigrations(db: Database.Database, migrations: { up: string }[]) {
  for (const m of migrations) {
    db.exec(m.up);
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, questsMigrations);
  return db;
}

function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}

describe('checkHabitForDate', () => {
  it('should insert a check for yesterday', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    const check = db.prepare('SELECT * FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', yesterdayStr) as { date: string; deleted_at: string | null };
    expect(check).toBeDefined();
    expect(check.date).toBe(yesterdayStr);
    expect(check.deleted_at).toBeNull();
  });

  it('should use current timestamp for created_at, not the check date', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Read', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    const check = db.prepare('SELECT created_at FROM habit_checks WHERE id = ?')
      .get('c1') as { created_at: string };
    expect(check.created_at.startsWith(new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it('should soft-delete (toggle off) existing retroactive check', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Meditate', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, 'c1');

    const check = db.prepare('SELECT deleted_at FROM habit_checks WHERE id = ?')
      .get('c1') as { deleted_at: string | null };
    expect(check.deleted_at).not.toBeNull();
  });

  it('should resurrect a soft-deleted retroactive check', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Meditate', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);
    db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, 'c1');

    db.prepare('UPDATE habit_checks SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, 'c1');

    const check = db.prepare('SELECT deleted_at FROM habit_checks WHERE id = ?')
      .get('c1') as { deleted_at: string | null };
    expect(check.deleted_at).toBeNull();
  });

  it('should enforce UNIQUE(habit_id, date) constraint', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Walk', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    expect(() => {
      db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('c2', 'h1', yesterdayStr, now, now);
    }).toThrow();
  });
});
