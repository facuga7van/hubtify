import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { processRpgEvent } from '../../shared-logic/modules/rpg-handlers';
import { ACHIEVEMENT_XP } from '../../shared/achievements';
import { pinClockToNoon } from '../helpers/pin-clock';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  return db;
}

function stats(db: Database.Database) {
  return db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, number | string | null>;
}

/** Puts the player one day short of `streak`, as if yesterday's action happened. */
function primeStreak(db: Database.Database, streak: number): void {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  db.prepare('UPDATE player_stats SET streak = ?, streak_last_date = ?, last_milestone_streak = 0 WHERE user_id = ?')
    .run(streak - 1, yesterday.toLocaleDateString('en-CA'), 'default');
}

pinClockToNoon();

describe('streak milestone bonus (task 13)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('is awarded exactly once, not on every action of the day', () => {
    primeStreak(db, 3); // 3 days is a milestone (25 XP)

    const first = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    expect(first.milestoneXp).toBe(25);
    expect(stats(db).streak).toBe(3);

    // Nine more actions the same day — the streak is unchanged all day, so the old
    // code paid the full milestone bonus on every single one of them.
    for (let i = 2; i <= 10; i++) {
      const r = processRpgEvent(db, {
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: 10, hp: 0, taskId: `t${i}` }, timestamp: Date.now(),
      });
      expect(r.milestoneXp).toBe(0);
    }
    expect(stats(db).last_milestone_streak).toBe(3);
  });

  it('is not re-paid by a complete / uncomplete / re-complete loop', () => {
    primeStreak(db, 7); // 7 days is a milestone

    const first = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 'abc' }, timestamp: Date.now(),
    });
    expect(first.milestoneXp).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      processRpgEvent(db, {
        type: 'TASK_UNCOMPLETED', moduleId: 'quests',
        payload: { xp: -10, hp: 0, taskId: 'abc' }, timestamp: Date.now(),
      });
      const again = processRpgEvent(db, {
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: 10, hp: 0, taskId: 'abc' }, timestamp: Date.now(),
      });
      expect(again.milestoneXp).toBe(0);
    }
  });

  it('re-arms after the streak breaks', () => {
    primeStreak(db, 3);
    expect(processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp: 10, taskId: 't1' }, timestamp: Date.now(),
    }).milestoneXp).toBe(25);

    // Simulate a broken streak: last action was a week ago.
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 7);
    db.prepare('UPDATE player_stats SET streak = 2, streak_last_date = ? WHERE user_id = ?')
      .run(longAgo.toLocaleDateString('en-CA'), 'default');
    // Streak restarts at 1, which clears the milestone watermark.
    processRpgEvent(db, { type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp: 10, taskId: 't2' }, timestamp: Date.now() });
    expect(stats(db).streak).toBe(1);
    expect(stats(db).last_milestone_streak).toBe(0);
  });
});

describe('XP undo (task 14)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('does NOT reverse another task whose projectId happens to equal this task id', () => {
    // Task "other" lives in project "abc".
    processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 30, hp: 0, taskId: 'other', projectId: 'abc' }, timestamp: Date.now(),
    });
    // Task "abc" itself.
    processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 5, hp: 0, taskId: 'abc' }, timestamp: Date.now(),
    });

    const otherEvent = db.prepare("SELECT id, xp_gained FROM rpg_events WHERE ref_id = 'other'").get() as { id: number; xp_gained: number };
    const abcEvent = db.prepare("SELECT id, xp_gained FROM rpg_events WHERE ref_id = 'abc'").get() as { id: number; xp_gained: number };

    const undo = processRpgEvent(db, {
      type: 'TASK_UNCOMPLETED', moduleId: 'quests',
      payload: { xp: -5, hp: 0, taskId: 'abc' }, timestamp: Date.now(),
    });

    // It reversed "abc"'s XP, not the much larger "other" one.
    expect(undo.xpGained).toBeCloseTo(-abcEvent.xp_gained, 5);
    // And "other"'s event is still in the log — the old LIKE '%"abc"%' deleted it.
    expect(db.prepare('SELECT 1 FROM rpg_events WHERE id = ?').get(otherEvent.id)).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM rpg_events WHERE id = ?').get(abcEvent.id)).toBeFalsy();
  });

  it('deducts nothing when there is no original event to reverse', () => {
    const before = stats(db).xp as number;
    const undo = processRpgEvent(db, {
      type: 'TASK_UNCOMPLETED', moduleId: 'quests',
      payload: { xp: -25, hp: 0, taskId: 'never-completed' }, timestamp: Date.now(),
    });
    // Callers send an ALREADY-NEGATIVE xp; falling back to it deducted twice.
    expect(undo.xpGained).toBe(0);
    // The only XP that may have moved is the achievement shelf's flat +25 per
    // unlock, which rides on top of the event and is not part of the reversal.
    expect(stats(db).xp).toBe(before + ACHIEVEMENT_XP * undo.achievementIds.length);
  });
});

describe('zero-XP events and payload validation (task 15)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('does not advance the combo or keep the streak alive', () => {
    for (let i = 0; i < 4; i++) {
      processRpgEvent(db, {
        type: 'TASK_CREATED', moduleId: 'quests', payload: { xp: 0, hp: 0 }, timestamp: Date.now(),
      });
    }
    const s = stats(db);
    expect(s.daily_combo).toBe(0);
    expect(s.streak_last_date).toBeNull();
    expect(s.streak).toBe(0);
  });

  it('clamps an absurd negative xp instead of persisting it', () => {
    const result = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: -99999, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    // ACHIEVEMENT_UNLOCKED rows are excluded: they are the shelf's own flat
    // reward, not XP this event paid.
    const total = db.prepare(
      "SELECT COALESCE(SUM(xp_gained), 0) AS t FROM rpg_events WHERE event_type <> 'ACHIEVEMENT_UNLOCKED'"
    ).get() as { t: number };
    expect(total.t).toBe(0);
    expect(stats(db).xp).toBe(ACHIEVEMENT_XP * result.achievementIds.length);
  });

  it('still applies the HP delta of a zero-XP event', () => {
    processRpgEvent(db, {
      type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 0, hp: -20 }, timestamp: Date.now(),
    });
    expect(stats(db).hp).toBe(80);
  });
});
