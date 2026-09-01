import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import { processRpgEvent, setInnMode, restorePlayerStats } from '../../electron/ipc/rpg-handlers';
import { rolloverVigor, getPlayerStats } from '../../electron/ipc/rpg-stats';
import { PARDONS_PER_MONTH } from '../../shared/rpg-engine';

/**
 * RPG phase 1 — "stop the bleeding".
 *
 * Three mechanics, one shared goal: nothing in the RPG layer may punish the
 * player for a bad day, a missed day, or a holiday.
 */

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

const dateNDaysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};

const today = () => dateNDaysAgo(0);

const task = (db: Database.Database, id: string, xp = 10, hp = 0) =>
  processRpgEvent(db, { type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp, hp, taskId: id }, timestamp: Date.now() });

// ───────────────────────────── Vigor (task 1) ─────────────────────────────

describe('HP is daily Vigor, not accumulated debt (phase 1, task 1)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('starts a new day at 100 before applying the event delta', () => {
    // Yesterday ended battered.
    db.prepare("UPDATE player_stats SET hp = 12, hp_date = ? WHERE user_id = 'default'").run(dateNDaysAgo(1));

    processRpgEvent(db, { type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 0, hp: -20 }, timestamp: Date.now() });

    // Not 12 - 20 clamped to 0: the day reset to 100 first, then took the hit.
    expect(stats(db).hp).toBe(80);
    expect(stats(db).hp_date).toBe(today());
  });

  it('does NOT reduce XP when Vigor is 0 today', () => {
    db.prepare("UPDATE player_stats SET hp = 0, hp_date = ? WHERE user_id = 'default'").run(today());

    // Force a deterministic reward: first action of the day (combo x1.0) and a
    // bonus roll that can only be 1.0/1.5/2.0/3.0 — the old hp penalty would have
    // multiplied all of those by 0.5, so checking the floor is enough.
    const result = task(db, 't1', 10);

    expect(stats(db).hp).toBe(0); // still 0 — the delta of this event was 0
    // base 10 x combo 1.0 x one of the bonus rolls. Under the old rule every one
    // of these would have been halved (5 / 7.5 / 10 / 15).
    expect([10, 15, 20, 30]).toContain(result.xpGained);
  });

  it('refills tomorrow: a 0-HP day never carries over', () => {
    db.prepare("UPDATE player_stats SET hp = 0, hp_date = ? WHERE user_id = 'default'").run(dateNDaysAgo(1));
    task(db, 't1', 10);
    expect(stats(db).hp).toBe(100);
  });

  it('rolloverVigor normalises on READ, so the morning sidebar shows 100 with no events', () => {
    db.prepare("UPDATE player_stats SET hp = 40, hp_date = ? WHERE user_id = 'default'").run(dateNDaysAgo(1));

    rolloverVigor(db);
    const s = getPlayerStats(db);

    expect(s.hp).toBe(100);
    expect(s.hpDate).toBe(today());
  });

  it('leaves the same day alone — deltas inside a day still accumulate', () => {
    processRpgEvent(db, { type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 0, hp: -30 }, timestamp: Date.now() });
    processRpgEvent(db, { type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 0, hp: -25 }, timestamp: Date.now() });
    rolloverVigor(db);
    expect(stats(db).hp).toBe(45);
  });
});

// ─────────────────────────── Pardons (task 2) ────────────────────────────

/** Puts the player on `streak`, last active `daysAgo` days ago. */
function primeStreak(db: Database.Database, streak: number, daysAgo: number, extra: Record<string, unknown> = {}): void {
  db.prepare(`UPDATE player_stats SET streak = ?, streak_last_date = ?, last_milestone_streak = ?,
              best_streak = ?, pardons_month = ?, pardons_used = ? WHERE user_id = 'default'`)
    .run(
      streak, dateNDaysAgo(daysAgo), (extra.lastMilestone as number) ?? streak,
      (extra.bestStreak as number) ?? streak,
      (extra.pardonsMonth as string) ?? null, (extra.pardonsUsed as number) ?? 0,
    );
}

describe('automatic streak pardons (phase 1, task 2)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('keeps the streak alive across a single missed day and spends one pardon', () => {
    primeStreak(db, 12, 2); // acted the day before yesterday → exactly one day missed

    const result = task(db, 't1');

    expect(result.pardonUsed).toBe(true);
    expect(stats(db).streak).toBe(13); // continues as if the gap never happened
    expect(stats(db).pardons_used).toBe(1);
    expect(stats(db).pardons_month).toBe(today().slice(0, 7));
  });

  it('grants a second pardon in the same month, and no more', () => {
    const month = today().slice(0, 7);
    primeStreak(db, 12, 2, { pardonsMonth: month, pardonsUsed: 1 });
    expect(task(db, 't1').pardonUsed).toBe(true);
    expect(stats(db).streak).toBe(13);
    expect(stats(db).pardons_used).toBe(PARDONS_PER_MONTH);

    // Third gap of the month: no allowance left, the streak falls.
    primeStreak(db, 20, 2, { pardonsMonth: month, pardonsUsed: PARDONS_PER_MONTH, bestStreak: 20 });
    const third = task(db, 't2');
    expect(third.pardonUsed).toBe(false);
    expect(stats(db).streak).toBe(1);
  });

  it('does not pardon a gap of more than one day — pardons never stack', () => {
    primeStreak(db, 30, 4); // three days missed
    const result = task(db, 't1');
    expect(result.pardonUsed).toBe(false);
    expect(stats(db).streak).toBe(1);
    expect(stats(db).pardons_used).toBe(0);
  });

  it('recharges the allowance when the calendar month turns', () => {
    // Counter belongs to a previous month and is exhausted.
    primeStreak(db, 12, 2, { pardonsMonth: '1999-01', pardonsUsed: PARDONS_PER_MONTH });

    const result = task(db, 't1');

    expect(result.pardonUsed).toBe(true);
    expect(stats(db).streak).toBe(13);
    // The stale counter was replaced, not incremented on top of the old month.
    expect(stats(db).pardons_used).toBe(1);
    expect(stats(db).pardons_month).toBe(today().slice(0, 7));
  });

  it('treats a pardoned streak as unbroken for milestones', () => {
    // On 6, missed a day, comes back → 7 is a milestone and must be paid once.
    primeStreak(db, 6, 2, { lastMilestone: 3 });
    const result = task(db, 't1');
    expect(result.pardonUsed).toBe(true);
    expect(result.milestoneXp).toBe(50); // the 7-day milestone
    expect(stats(db).last_milestone_streak).toBe(7);
  });

  it('best_streak survives a fall and is never lowered', () => {
    primeStreak(db, 41, 9, { bestStreak: 41 }); // long gap, unrecoverable
    task(db, 't1');
    expect(stats(db).streak).toBe(1);
    expect(stats(db).best_streak).toBe(41);
    expect(getPlayerStats(db).bestStreak).toBe(41);
  });

  it('raises best_streak as the streak advances', () => {
    primeStreak(db, 5, 1, { bestStreak: 5 });
    task(db, 't1');
    expect(stats(db).best_streak).toBe(6);
  });

  it('exposes the remaining allowance, month-rolled, through getPlayerStats', () => {
    db.prepare("UPDATE player_stats SET pardons_month = ?, pardons_used = 1 WHERE user_id = 'default'")
      .run(today().slice(0, 7));
    expect(getPlayerStats(db).pardonsRemaining).toBe(PARDONS_PER_MONTH - 1);

    db.prepare("UPDATE player_stats SET pardons_month = '1999-01', pardons_used = 2 WHERE user_id = 'default'").run();
    expect(getPlayerStats(db).pardonsRemaining).toBe(PARDONS_PER_MONTH);
  });
});

// ────────────────────────── Inn mode (task 3) ────────────────────────────

describe('Inn mode (phase 1, task 3)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('resumes the streak where it was after a long holiday', () => {
    // Last acted ten days ago — the day the player checked in and left.
    primeStreak(db, 25, 10, { lastMilestone: 14, bestStreak: 25 });

    setInnMode(db, true, dateNDaysAgo(10));
    expect(getPlayerStats(db).innSince).toBe(dateNDaysAgo(10));

    // Ten silent days later the player checks out and acts the next day.
    setInnMode(db, false);
    expect(stats(db).streak_last_date).toBe(dateNDaysAgo(1));

    const result = task(db, 't1');

    expect(stats(db).streak).toBe(26); // continues, does not restart at 1
    expect(stats(db).inn_since).toBeNull();
    expect(result.pardonUsed).toBe(false);  // rest days consume no pardon
    expect(stats(db).pardons_used).toBe(0);
    expect(result.milestoneXp).toBe(0);     // no milestone re-paid
    expect(stats(db).last_milestone_streak).toBe(14);
  });

  it('pays XP but freezes the streak while resting', () => {
    // Audit 2026-08 (#2): the Inn freezes a LIVING streak. This used to check
    // in with a three-day gap — a streak that was already dead — and expect it
    // frozen at 25; now check-in with a dead streak resets it, so the fixture
    // acts the day before check-in.
    primeStreak(db, 25, 1, { bestStreak: 25 });
    setInnMode(db, true);

    const result = task(db, 't1', 10);

    expect(result.xpGained).toBeGreaterThanOrEqual(10); // XP flows normally
    expect(stats(db).streak).toBe(25);                  // frozen, neither +1 nor reset
    expect(stats(db).streak_last_date).toBe(dateNDaysAgo(1));
    expect(result.pardonUsed).toBe(false);
    expect(stats(db).pardons_used).toBe(0);
  });

  it('still advances the DAILY combo while resting — the combo belongs to the day', () => {
    setInnMode(db, true);
    task(db, 't1');
    task(db, 't2');
    const s = stats(db);
    expect(s.daily_combo).toBe(2);
    expect(s.combo_date).toBe(today());
  });

  it('keeps the original check-in date when switched on twice', () => {
    setInnMode(db, true, dateNDaysAgo(5));
    setInnMode(db, true, today());
    expect(stats(db).inn_since).toBe(dateNDaysAgo(5));
  });

  it('does not rewind streak_last_date when the player already acted today', () => {
    task(db, 't1');
    expect(stats(db).streak_last_date).toBe(today());

    setInnMode(db, true);
    setInnMode(db, false);

    // Rewinding to yesterday here would let the same day tick the streak twice.
    expect(stats(db).streak_last_date).toBe(today());
  });

  it('checking out while not resting is a no-op', () => {
    db.prepare("UPDATE player_stats SET streak = 4, streak_last_date = ? WHERE user_id = 'default'").run(dateNDaysAgo(3));
    setInnMode(db, false);
    expect(stats(db).streak_last_date).toBe(dateNDaysAgo(3));
    expect(stats(db).inn_since).toBeNull();
  });
});

// ─────────────────── Restore / sync compatibility (task 4) ────────────────

describe('sync:restoreStats with the phase-1 columns (phase 1, task 4)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('accepts a legacy payload that carries none of the new fields', () => {
    db.prepare("UPDATE player_stats SET best_streak = 30 WHERE user_id = 'default'").run();

    const result = restorePlayerStats(db, {
      level: 5, xp: 1200, hp: 60, maxHp: 100, title: 'Escudero',
      streak: 4, dailyCombo: 2, totalTasks: 10, totalMeals: 3, totalExpenses: 1,
    });

    expect(result.success).toBe(true);
    const s = stats(db);
    expect(s.hp).toBe(60);
    expect(s.hp_date).toBe(today());   // treated as today's Vigor
    expect(s.pardons_used).toBe(0);
    expect(s.pardons_month).toBeNull();
    expect(s.inn_since).toBeNull();
    expect(s.best_streak).toBe(30);    // the local record is NOT lowered
  });

  it('transports the new fields when the remote has them', () => {
    const result = restorePlayerStats(db, {
      xp: 500, hp: 45, hpDate: '2026-08-30', streak: 9,
      pardonsMonth: '2026-08', pardonsUsed: 1, bestStreak: 77, innSince: '2026-08-20',
    });

    expect(result.success).toBe(true);
    const s = stats(db);
    expect(s.hp_date).toBe('2026-08-30');
    expect(s.pardons_month).toBe('2026-08');
    expect(s.pardons_used).toBe(1);
    expect(s.best_streak).toBe(77);
    expect(s.inn_since).toBe('2026-08-20');
  });

  it('rejects garbage dates instead of persisting them', () => {
    restorePlayerStats(db, { xp: 10, hpDate: 'not-a-date', innSince: 42, pardonsMonth: 'nope', pardonsUsed: -5 });
    const s = stats(db);
    expect(s.hp_date).toBe(today());
    expect(s.inn_since).toBeNull();
    expect(s.pardons_month).toBeNull();
    expect(s.pardons_used).toBe(0);
  });
});
