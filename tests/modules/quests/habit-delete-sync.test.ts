import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { mergeHabitChecks } from '../../../shared-logic/modules/sync.ipc';
import { computeHabits, weeklyTarget } from '../../../shared-logic/modules/quests.habits';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

/** The soft delete performed by the `quests:deleteHabit` handler. */
function deleteHabit(db: Database.Database, id: string, now: string): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE habit_id = ?').run(now, now, id);
  });
  tx();
}

describe('deleting a habit (task 4)', () => {
  it('bumps updated_at on the habit AND on every one of its checks', () => {
    const db = setupDb();
    const created = '2026-06-01T10:00:00.000Z';
    db.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('h1', 'Walk', 'daily', 1, created, created);
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-01', created, created);

    const deletedAt = '2026-06-10T10:00:00.000Z';
    deleteHabit(db, 'h1', deletedAt);

    const habit = db.prepare('SELECT deleted_at, updated_at FROM habits WHERE id = ?').get('h1') as { deleted_at: string; updated_at: string };
    const check = db.prepare('SELECT deleted_at, updated_at FROM habit_checks WHERE id = ?').get('c1') as { deleted_at: string; updated_at: string };

    expect(habit.deleted_at).toBe(deletedAt);
    // Without this the merge is last-write-wins on a STALE updated_at, so the
    // tombstone loses and the habit resurrects on the other device.
    expect(habit.updated_at).toBe(deletedAt);
    expect(check.deleted_at).toBe(deletedAt);
    expect(check.updated_at).toBe(deletedAt);
  });

  it('the tombstone survives a merge round-trip onto a device with the live habit', () => {
    // ── Device A: creates the habit + a check, then deletes it ──
    const dbA = setupDb();
    const created = '2026-06-01T10:00:00.000Z';
    dbA.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('h1', 'Walk', 'daily', 1, created, created);
    dbA.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-01', created, created);
    deleteHabit(dbA, 'h1', '2026-06-10T10:00:00.000Z');

    // ── Device B: still has the habit alive ──
    const dbB = setupDb();
    dbB.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('h1', 'Walk', 'daily', 1, created, created);
    dbB.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-01', created, created);

    // Push A → pull into B (LWW on updated_at, exactly as sync:mergeQuestData does).
    const remoteHabit = dbA.prepare('SELECT id, name, frequency, times_per_week AS timesPerWeek, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM habits WHERE id = ?').get('h1') as Record<string, string>;
    const localHabit = dbB.prepare('SELECT updated_at FROM habits WHERE id = ?').get('h1') as { updated_at: string };
    if (remoteHabit.updatedAt > localHabit.updated_at) {
      dbB.prepare('UPDATE habits SET name = ?, frequency = ?, times_per_week = ?, updated_at = ?, deleted_at = ? WHERE id = ?')
        .run(remoteHabit.name, remoteHabit.frequency, remoteHabit.timesPerWeek, remoteHabit.updatedAt, remoteHabit.deletedAt, 'h1');
    }
    mergeHabitChecks(dbB, dbA.prepare('SELECT id, habit_id AS habitId, date, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM habit_checks').all() as never);

    const mergedHabit = dbB.prepare('SELECT deleted_at FROM habits WHERE id = ?').get('h1') as { deleted_at: string | null };
    const mergedCheck = dbB.prepare('SELECT deleted_at FROM habit_checks WHERE id = ?').get('c1') as { deleted_at: string | null };
    expect(mergedHabit.deleted_at).not.toBeNull();
    expect(mergedCheck.deleted_at).not.toBeNull();
    expect(computeHabits(dbB, new Date('2026-06-11T12:00:00'))).toHaveLength(0);
  });
});

describe('computeHabits with a corrupt times_per_week (task 18)', () => {
  it('terminates instead of hanging the main process on times_per_week = 0', () => {
    const db = setupDb();
    // Only reachable through the sync path / an external writer such as Syl.
    db.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('h1', 'Broken', 'weekly', 0, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z');
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', '2026-06-08', '2026-06-08T10:00:00.000Z', '2026-06-08T10:00:00.000Z');

    // The old `while (true) { ... if (count < 0) break }` never exited.
    const result = computeHabits(db, new Date('2026-06-10T12:00:00'));
    expect(result).toHaveLength(1);
    expect(result[0].targetThisPeriod).toBe(1);
    expect(Number.isFinite(result[0].streak)).toBe(true);
  });

  it('clamps every out-of-range value to 1..7', () => {
    expect(weeklyTarget(0)).toBe(1);
    expect(weeklyTarget(-3)).toBe(1);
    expect(weeklyTarget(99)).toBe(7);
    expect(weeklyTarget(undefined)).toBe(1);
    expect(weeklyTarget(NaN)).toBe(1);
    expect(weeklyTarget(4)).toBe(4);
  });
});
