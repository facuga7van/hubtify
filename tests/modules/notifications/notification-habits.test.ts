import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { notificationsMigrations } from '../../../shared-logic/modules/notifications.schema';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  evaluateHabitNotifications,
  deduplicateAndInsert,
  autoResolve,
} from '../../../shared-logic/modules/notification-engine';

function runMigrations(db: Database.Database, migrations: { up: string }[]) {
  for (const m of migrations) {
    db.exec(m.up);
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, notificationsMigrations);
  runMigrations(db, questsMigrations);
  return db;
}

describe('evaluateHabitNotifications', () => {
  it('should return empty when before reminder time', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const result = evaluateHabitNotifications(db, '23:59');
    const hour = new Date().getHours();
    if (hour < 23) {
      expect(result).toHaveLength(0);
    }
  });

  it('should generate candidate when habits are unchecked after reminder time', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('habit_reminder');
    expect(result[0].module).toBe('quests');
    expect(result[0].actionRoute).toBe('/quests');
  });

  it('should return empty when all daily habits are checked', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare("INSERT INTO habit_checks (id, habit_id, date, updated_at) VALUES ('c1', 'h1', ?, '')")
      .run(today);
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(0);
  });

  it('should ignore soft-deleted habits', () => {
    const db = setupDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO habits (id, name, updated_at, deleted_at) VALUES ('h1', 'Deleted', '', ?)")
      .run(now);
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(0);
  });
});

describe('habit_reminder auto-resolve', () => {
  it('should resolve habit_reminder when all habits are checked', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const today = new Date().toLocaleDateString('en-CA');

    const candidates = evaluateHabitNotifications(db, '00:00');
    expect(candidates).toHaveLength(1);
    deduplicateAndInsert(db, candidates);

    const before = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE type = 'habit_reminder' AND status = 'active'")
      .get() as { cnt: number };
    expect(before.cnt).toBe(1);

    db.prepare("INSERT INTO habit_checks (id, habit_id, date, updated_at) VALUES ('c1', 'h1', ?, '')")
      .run(today);

    const resolved = autoResolve(db);
    expect(resolved).toBeGreaterThanOrEqual(1);

    const after = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE type = 'habit_reminder' AND status = 'active'")
      .get() as { cnt: number };
    expect(after.cnt).toBe(0);
  });
});
