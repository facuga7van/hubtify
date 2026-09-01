import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import {
  processRpgEvent,
  setInnMode,
  sealDay,
  sealVigorFor,
  getDaySummary,
  evaluateAchievements,
  bumpMasteryXp,
  backfillMasteryXp,
  buildAchievementContext,
  backfillAchievements,
} from '../../electron/ipc/rpg-handlers';
import { sealXp, MAX_VIGOR, isMeaningfulEvent } from '../../shared/rpg-engine';
import { pinClockToNoon } from '../helpers/pin-clock';

/** Every broadcast the engine sends, so a test can count them. */
const broadcasts: Array<{ channel: string; data: unknown }> = [];
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: { send: (channel: string, data: unknown) => { broadcasts.push({ channel, data }); } },
    }],
  },
}));

/**
 * Auditoría adversarial de la economía RPG (2026-08) — un test por hallazgo.
 *
 * Cada `describe` reproduce el escenario exacto del reporte: todos eran ROJOS
 * antes del fix. Los helpers escriben filas crudas en rpg_events cuando el
 * escenario necesita un día distinto de hoy (el engine siempre sella con la
 * hora real).
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

function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

const TODAY = dateAgo(0);
const YESTERDAY = dateAgo(1);
const TOMORROW = dateAgo(-1);

interface SeedOpts { xp?: number; hp?: number; hhmm?: string; payload?: Record<string, unknown>; refId?: string | null }

/** Writes a raw event on an arbitrary local day, bypassing the engine. */
function seedEvent(db: Database.Database, moduleId: string, type: string, date: string, opts: SeedOpts = {}): void {
  const { xp = 10, hp = 0, hhmm = '10:00', payload = {}, refId = null } = opts;
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, ?, 1.0, 1.0, ?, ?, ?, ?)
  `).run(moduleId, type, xp, hp, JSON.stringify(payload), `${date} ${hhmm}:00`, refId, `seed-${Math.random()}`);
}

const task = (db: Database.Database, id: string, xp = 10) =>
  processRpgEvent(db, { type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp, hp: 0, taskId: id }, timestamp: Date.now() });

const untask = (db: Database.Database, id: string) =>
  processRpgEvent(db, { type: 'TASK_UNCOMPLETED', moduleId: 'quests', payload: { xp: -10, hp: 0, taskId: id }, timestamp: Date.now() });

function masteryRow(db: Database.Database, moduleId: string): number {
  const row = db.prepare('SELECT xp FROM mastery_xp WHERE module_id = ?').get(moduleId) as { xp: number } | undefined;
  return row?.xp ?? 0;
}

function primeStreak(db: Database.Database, streak: number, lastDate: string, extra: Record<string, unknown> = {}): void {
  db.prepare(`UPDATE player_stats SET streak = ?, streak_last_date = ?, last_milestone_streak = ?, best_streak = ?,
              pardons_month = ?, pardons_used = ? WHERE user_id = 'default'`)
    .run(streak, lastDate, (extra.lastMilestone as number) ?? streak, (extra.bestStreak as number) ?? streak,
      (extra.pardonsMonth as string) ?? null, (extra.pardonsUsed as number) ?? 0);
}

// ─────────────────────── #1 crítico: cadena de sellos retroactivos ───────────────────────

pinClockToNoon();

describe('[crítico #1] retro-seal chain: a seal is not a day lived', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('the retro DAY_SEALED written today does not make today sealable', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    expect(sealDay(db, YESTERDAY, TODAY).ok).toBe(true);
    // The DAY_SEALED row now sits in TODAY (created_at = now)…
    const rpgRowsToday = db.prepare(
      "SELECT COUNT(*) AS c FROM rpg_events WHERE module_id = 'rpg' AND created_at >= ?"
    ).get(TODAY) as { c: number };
    expect(rpgRowsToday.c).toBeGreaterThan(0);
    // …and yet today is still an empty day for the ritual.
    expect(sealDay(db, TODAY, TODAY)).toEqual({ ok: false, reason: 'empty_day' });
    const summary = getDaySummary(db, TODAY, TODAY);
    expect(summary.eventsCount).toBe(0);
    expect(summary.canSeal).toBe(false);
    expect(summary.sealBlockedReason).toBe('empty_day');
  });

  it('a day whose only rows are engine rows (seal / achievement) cannot be sealed', () => {
    // Day N-1 was "sealed" the day before: the only trace on YESTERDAY is engine output.
    seedEvent(db, 'rpg', 'DAY_SEALED', YESTERDAY, { xp: 13, payload: { date: dateAgo(2), retro: true } });
    seedEvent(db, 'rpg', 'ACHIEVEMENT_UNLOCKED', YESTERDAY, { xp: 25, payload: { id: 'late_memory' } });
    expect(sealDay(db, YESTERDAY, TODAY)).toEqual({ ok: false, reason: 'empty_day' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM day_seals').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM obolos_ledger').get()).toEqual({ c: 0 });
  });

  it('a retro seal (yesterday) pays but does NOT move the streak', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    primeStreak(db, 3, dateAgo(4)); // long dead — a retro seal must not resurrect nor extend it
    const before = stats(db);

    const result = sealDay(db, YESTERDAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xpAwarded).toBeGreaterThan(0);

    const after = stats(db);
    expect(after.streak).toBe(before.streak);
    expect(after.streak_last_date).toBe(before.streak_last_date);
    expect(after.last_milestone_streak).toBe(before.last_milestone_streak);
    expect((after.xp as number)).toBeGreaterThan(before.xp as number);
  });

  it('sealing TODAY still counts as showing up', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    primeStreak(db, 3, YESTERDAY);
    sealDay(db, TODAY, TODAY);
    expect(stats(db).streak).toBe(4);
    expect(stats(db).streak_last_date).toBe(TODAY);
  });

  it('N days of "seal yesterday" with zero activity pay nothing and advance nothing', () => {
    // Day 1: one real action, retro-sealed on day 2 (simulated: the DAY_SEALED
    // row landed on YESTERDAY with created_at of that day).
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(2));
    seedEvent(db, 'rpg', 'DAY_SEALED', YESTERDAY, { xp: 13, payload: { date: dateAgo(2), retro: true } });
    primeStreak(db, 1, dateAgo(2));
    const xpBefore = stats(db).xp as number;

    // Day 3 (today): try to seal day 2, whose only row is the previous seal.
    expect(sealDay(db, YESTERDAY, TODAY)).toEqual({ ok: false, reason: 'empty_day' });
    expect(stats(db).streak).toBe(1);
    expect(stats(db).xp).toBe(xpBefore);
  });
});

// ─────────────────────── #2 crítico: la Posada resucita rachas ───────────────────────

describe('[crítico #2] the Inn cannot resurrect a dead streak', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('10 silent days → check in → check out → task: the streak restarts at 1', () => {
    primeStreak(db, 30, dateAgo(10), { bestStreak: 30 });

    setInnMode(db, true, TODAY);
    setInnMode(db, false, TODAY);

    // The rewind must not have moved the last activity date forward.
    expect(stats(db).streak_last_date).toBe(dateAgo(10));
    const result = task(db, 't1');
    expect(result.pardonUsed).toBe(false);
    expect(stats(db).streak).toBe(1);
    expect(stats(db).best_streak).toBe(30); // the record survives, as always
    expect(stats(db).inn_since).toBeNull();
  });

  it('checking in with an already-dead streak makes the state honest (streak 0)', () => {
    primeStreak(db, 30, dateAgo(10), { bestStreak: 30 });
    setInnMode(db, true, TODAY);
    expect(stats(db).streak).toBe(0);
    expect(stats(db).last_milestone_streak).toBe(0);
    expect(stats(db).best_streak).toBe(30);
  });

  it('a gap of 2 with a pardon available is still alive: the Inn preserves it, the return spends it', () => {
    // Last acted 7 days ago, checked in 5 days ago (gap of 2 at check-in).
    primeStreak(db, 12, dateAgo(7), { bestStreak: 12 });
    setInnMode(db, true, dateAgo(5));
    expect(stats(db).streak).toBe(12);

    setInnMode(db, false, TODAY);
    // The frozen gap (2) is restored relative to today, not collapsed to 1.
    expect(stats(db).streak_last_date).toBe(dateAgo(2));

    const result = task(db, 't1');
    expect(result.pardonUsed).toBe(true);
    expect(stats(db).streak).toBe(13);
  });

  it('a gap of 3 before check-in was already fatal — the Inn does not undo it', () => {
    primeStreak(db, 12, dateAgo(8), { bestStreak: 12 });
    setInnMode(db, true, dateAgo(5));
    setInnMode(db, false, TODAY);
    task(db, 't1');
    expect(stats(db).streak).toBe(1);
  });

  it('the legitimate holiday still resumes exactly where it was', () => {
    // Acted the day before checking in; a fortnight away; back today.
    primeStreak(db, 25, dateAgo(15), { lastMilestone: 14, bestStreak: 25 });
    setInnMode(db, true, dateAgo(14));
    setInnMode(db, false, TODAY);
    expect(stats(db).streak_last_date).toBe(YESTERDAY);
    const result = task(db, 't1');
    expect(stats(db).streak).toBe(26);
    expect(result.pardonUsed).toBe(false);
    expect(result.milestoneXp).toBe(0);
  });
});

// ─────────────────────── #6 alto: maestría bombeable con undo ───────────────────────

describe('[alto #6] mastery is not pumpable through complete / uncomplete', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('an undo takes back from mastery exactly what the original event added', () => {
    const first = task(db, 'epic');
    expect(masteryRow(db, 'quests')).toBe(Math.round(first.xpGained));
    untask(db, 'epic');
    expect(masteryRow(db, 'quests')).toBe(0);
  });

  it('100 complete/uncomplete cycles leave the accumulator where one completion would', () => {
    for (let i = 0; i < 100; i++) {
      task(db, 'epic');
      untask(db, 'epic');
    }
    expect(masteryRow(db, 'quests')).toBe(0);
    const last = task(db, 'epic');
    expect(masteryRow(db, 'quests')).toBe(Math.round(last.xpGained));
  });

  it('never goes below zero, and an undo with nothing to reverse changes nothing', () => {
    bumpMasteryXp(db, 'quests', 30);
    bumpMasteryXp(db, 'quests', -500);
    expect(masteryRow(db, 'quests')).toBe(0);
    untask(db, 'never-completed');
    expect(masteryRow(db, 'quests')).toBe(0);
  });

  it('a negative bump on a module with no row creates nothing', () => {
    bumpMasteryXp(db, 'finance', -10);
    expect(db.prepare('SELECT COUNT(*) AS c FROM mastery_xp').get()).toEqual({ c: 0 });
  });
});

// ─────────────────────── #7 / #10 medio: eventos que "cuentan" ───────────────────────

describe('[medio #7] the seal only pays for meaningful events', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('20 empty QuickAdds do not seal — and do not raise the cap', () => {
    for (let i = 0; i < 20; i++) seedEvent(db, 'quests', 'TASK_CREATED', TODAY, { xp: 0 });
    expect(sealDay(db, TODAY, TODAY)).toEqual({ ok: false, reason: 'empty_day' });

    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, { xp: 15 });
    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventsCount).toBe(1);
    expect(result.xpAwarded).toBe(sealXp(1, result.vigor));
  });

  it('undo rows, skips, reopens, imports and abandoned flasks are not "living the day"', () => {
    seedEvent(db, 'quests', 'TASK_UNCOMPLETED', TODAY, { xp: 0 });
    seedEvent(db, 'quests', 'HABIT_UNCHECKED', TODAY, { xp: 0 });
    seedEvent(db, 'quests', 'HABIT_SKIPPED', TODAY, { xp: 0 });
    seedEvent(db, 'nutrition', 'DAY_REOPENED', TODAY, { xp: 0 });
    seedEvent(db, 'finance', 'STATEMENT_IMPORTED', TODAY, { xp: 0 });
    seedEvent(db, 'cauldron', 'POMODORO_ABANDONED', TODAY, { xp: 0 });
    const summary = getDaySummary(db, TODAY, TODAY);
    // The timeline still shows everything — only the count/seal ignore them.
    expect(summary.events).toHaveLength(6);
    expect(summary.eventsCount).toBe(0);
    expect(summary.modules).toEqual([]);
    expect(summary.canSeal).toBe(false);
  });

  it('the sealed modules are the modules that actually scored', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, { xp: 10 });
    seedEvent(db, 'finance', 'STATEMENT_IMPORTED', TODAY, { xp: 0 });
    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modules).toEqual(['quests']);
  });

  it('isMeaningfulEvent is the single rule', () => {
    expect(isMeaningfulEvent({ moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 10 })).toBe(true);
    expect(isMeaningfulEvent({ moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 0 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'rpg', eventType: 'DAY_SEALED', xpGained: 30 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'rpg', eventType: 'ACHIEVEMENT_UNLOCKED', xpGained: 25 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'quests', eventType: 'TASK_UNCOMPLETED', xpGained: 10 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'quests', eventType: 'TASK_CREATED', xpGained: 10 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'nutrition', eventType: 'DAY_SUMMARY', xpGained: -20 })).toBe(false);
    expect(isMeaningfulEvent({ moduleId: 'nutrition', eventType: 'DAY_SUMMARY', xpGained: 20 })).toBe(true);
  });
});

describe('[medio #10] polymath / sunday_guardian / chronicler count real actions only', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('QuickAdd → complete → uncomplete → habit is not five kinds of variety', () => {
    const results = [
      processRpgEvent(db, { type: 'TASK_CREATED', moduleId: 'quests', payload: { xp: 0, hp: 0 }, timestamp: Date.now() }),
      task(db, 't1'),          // fires first_step + first_quest → 2 ACHIEVEMENT_UNLOCKED rows
      untask(db, 't1'),
      processRpgEvent(db, { type: 'HABIT_CHECKED', moduleId: 'quests', payload: { xp: 5, hp: 0, habitId: 'h1' }, timestamp: Date.now() }),
    ];
    // The raw log still holds TASK_CREATED, ACHIEVEMENT_UNLOCKED, TASK_UNCOMPLETED
    // and HABIT_CHECKED — four "kinds" out of one real action.
    const raw = db.prepare("SELECT COUNT(DISTINCT event_type) AS c FROM rpg_events WHERE created_at >= ?").get(TODAY) as { c: number };
    expect(raw.c).toBeGreaterThanOrEqual(4);
    for (const r of results) expect(r.achievementIds).not.toContain('polymath');
    expect(buildAchievementContext(db, null, TODAY).typesToday).toEqual(['HABIT_CHECKED']);
  });

  it('five zero-impact rows on a Sunday are not a guarded Sunday', () => {
    for (let i = 0; i < 5; i++) seedEvent(db, 'quests', 'TASK_CREATED', TODAY, { xp: 0 });
    const sunday = {
      type: 'TASK_CREATED', moduleId: 'quests', payload: {},
      hour: 12, date: TODAY, weekday: 0, comboMultiplier: 1, bonusMultiplier: 1, xpGained: 0, pardonUsed: false,
    };
    expect(evaluateAchievements(db, sunday, TODAY)).not.toContain('sunday_guardian');

    for (let i = 0; i < 5; i++) seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, { xp: 10 });
    expect(evaluateAchievements(db, { ...sunday, type: 'TASK_COMPLETED', xpGained: 10 }, TODAY)).toContain('sunday_guardian');
  });

  it('100 QuickAdds are not a chronicle', () => {
    for (let i = 0; i < 100; i++) seedEvent(db, 'quests', 'TASK_CREATED', dateAgo(i % 30), { xp: 0 });
    expect(evaluateAchievements(db, null, TODAY)).not.toContain('chronicler_i');
    expect(buildAchievementContext(db, null, TODAY).totalEvents).toBe(0);
  });

  it('countByType stays raw so first_* / day_off / second_chance keep firing', () => {
    seedEvent(db, 'quests', 'HABIT_SKIPPED', TODAY, { xp: 0 });
    seedEvent(db, 'nutrition', 'DAY_REOPENED', TODAY, { xp: 0 });
    const unlocked = evaluateAchievements(db, null, TODAY);
    expect(unlocked).toContain('day_off');
    expect(unlocked).toContain('second_chance');
  });
});

// ─────────────────────── #8 medio: vigor del retro-sello ───────────────────────

describe('[medio #8] retro-seal vigor is the vigor that day really closed at', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('replays yesterday\'s hp deltas instead of assuming 100', () => {
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', YESTERDAY, { xp: 10, hhmm: '13:00' });
    seedEvent(db, 'nutrition', 'DAY_SUMMARY', YESTERDAY, { xp: 0, hp: -40, hhmm: '22:00' });
    // Today already rolled over: the live row knows nothing about yesterday.
    db.prepare("UPDATE player_stats SET hp = 100, hp_date = ? WHERE user_id = 'default'").run(TODAY);

    expect(sealVigorFor(db, YESTERDAY, TODAY)).toBe(60);
    const result = sealDay(db, YESTERDAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vigor).toBe(60);
    expect(result.xpAwarded).toBe(sealXp(result.eventsCount, 60));
  });

  it('uses the exact live value when the row still belongs to that day', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    db.prepare("UPDATE player_stats SET hp = 40, hp_date = ? WHERE user_id = 'default'").run(YESTERDAY);
    expect(sealVigorFor(db, YESTERDAY, TODAY)).toBe(40);
  });

  it('sealing tomorrow can never beat sealing today', () => {
    seedEvent(db, 'nutrition', 'DAY_SUMMARY', TODAY, { xp: 0, hp: -60, hhmm: '21:00' });
    db.prepare("UPDATE player_stats SET hp = 40, hp_date = ? WHERE user_id = 'default'").run(TODAY);
    const sealedTonight = sealVigorFor(db, TODAY, TODAY);
    // Tomorrow, after the rollover fired…
    db.prepare("UPDATE player_stats SET hp = 100, hp_date = ? WHERE user_id = 'default'").run(TOMORROW);
    const sealedTomorrow = sealVigorFor(db, TODAY, TOMORROW);
    expect(sealedTonight).toBe(40);
    expect(sealedTomorrow).toBe(sealedTonight);
  });

  it('replays with the same clamping the live path applied', () => {
    seedEvent(db, 'nutrition', 'DAY_SUMMARY', YESTERDAY, { xp: 0, hp: -80, hhmm: '12:00' });
    seedEvent(db, 'nutrition', 'DAY_SUMMARY', YESTERDAY, { xp: 0, hp: -50, hhmm: '13:00' }); // floors at 0
    seedEvent(db, 'nutrition', 'DAY_SUMMARY', YESTERDAY, { xp: 0, hp: 30, hhmm: '14:00' });
    db.prepare("UPDATE player_stats SET hp = 100, hp_date = ? WHERE user_id = 'default'").run(TODAY);
    expect(sealVigorFor(db, YESTERDAY, TODAY)).toBe(30);
  });

  it('a day with no hp movement really did close at full vigor', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    db.prepare("UPDATE player_stats SET hp = 100, hp_date = ? WHERE user_id = 'default'").run(TODAY);
    expect(sealVigorFor(db, YESTERDAY, TODAY)).toBe(MAX_VIGOR);
  });
});

// ─────────────────────── bajos ───────────────────────

describe('[bajo] the post-commit reward layer never writes a duplicate 0-XP row', () => {
  it('a matcher failure after the commit keeps the paid event intact', () => {
    const db = setupDb();
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      // The un-guarded stats read at the top of buildAchievementContext.
      if (sql.includes('best_streak AS bestStreak')) throw new Error('boom');
      return original(sql);
    }) as typeof db.prepare);

    const result = task(db, 't1', 20);
    spy.mockRestore();

    expect(result.xpGained).toBeGreaterThanOrEqual(20);
    expect(result.achievementIds).toEqual([]);
    const rows = db.prepare("SELECT xp_gained AS xp FROM rpg_events WHERE ref_id = 't1'").all() as Array<{ xp: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].xp).toBe(result.xpGained);
    expect(stats(db).xp).toBe(result.xpGained);

    // And the undo now reverses the real row, not a phantom.
    const undo = untask(db, 't1');
    expect(undo.xpGained).toBe(-result.xpGained);
    expect(stats(db).xp).toBe(0);
  });
});

describe('[bajo] sealDay is atomic', () => {
  it('a failing DAY_SEALED event rolls the seal row and the óbolos back', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('INSERT INTO rpg_events')) throw new Error('disk full');
      return original(sql);
    }) as typeof db.prepare);

    expect(() => sealDay(db, TODAY, TODAY)).toThrow();
    spy.mockRestore();

    expect(db.prepare('SELECT COUNT(*) AS c FROM day_seals').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM obolos_ledger').get()).toEqual({ c: 0 });
    expect(stats(db).xp).toBe(0);
    // Nothing is stuck: the same day seals fine afterwards.
    expect(sealDay(db, TODAY, TODAY).ok).toBe(true);
  });
});

describe('[bajo] the rpg pseudo-module never gets a mastery row', () => {
  it('neither the seal nor a direct bump nor the backfill create mastery_xp(rpg)', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    sealDay(db, TODAY, TODAY);
    bumpMasteryXp(db, 'rpg', 999);
    seedEvent(db, 'rpg', 'ACHIEVEMENT_UNLOCKED', YESTERDAY, { xp: 25 });
    backfillMasteryXp(db);
    expect(db.prepare("SELECT COUNT(*) AS c FROM mastery_xp WHERE module_id = 'rpg'").get()).toEqual({ c: 0 });
    expect(masteryRow(db, 'quests')).toBeGreaterThan(0);
  });
});

describe('[medio UI #9] the backfill unlocks history without paying for it', () => {
  it('10 historical achievements → 0 XP, 0 óbolos, 0 event rows, ONE aggregated broadcast', () => {
    const db = setupDb();
    broadcasts.length = 0;

    // A rich history written by an older build: 10 entries become true at once.
    db.prepare('UPDATE player_stats SET streak = 40, best_streak = 40, level = 6 WHERE user_id = ?').run('default');
    for (let i = 0; i < 10; i++) seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(i + 1), { refId: `t${i}` });
    for (let i = 0; i < 5; i++) seedEvent(db, 'quests', 'HABIT_CHECKED', dateAgo(i + 1), { refId: `h${i}` });
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', YESTERDAY);
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', YESTERDAY);
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', YESTERDAY);
    seedEvent(db, 'quests', 'HABIT_SKIPPED', YESTERDAY, { xp: 0 });
    const xpBefore = stats(db).xp as number;

    const result = backfillAchievements(db, TODAY);

    expect(result.unlocked.length).toBeGreaterThanOrEqual(10);
    expect(stats(db).xp).toBe(xpBefore);
    expect(db.prepare("SELECT COUNT(*) AS c FROM obolos_ledger").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'").get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM achievements_unlocked').get()).toEqual({ c: result.unlocked.length });

    const achievementChannels = broadcasts.filter((b) => b.channel.startsWith('rpg:achievement'));
    expect(achievementChannels).toHaveLength(1);
    expect(achievementChannels[0].channel).toBe('rpg:achievementsBackfilled');
    expect((achievementChannels[0].data as { ids: string[] }).ids.sort()).toEqual([...result.unlocked].sort());
  });

  it('a live unlock still pays the flat XP and óbolos and broadcasts per id', () => {
    const db = setupDb();
    broadcasts.length = 0;
    const result = task(db, 't1');
    expect(result.achievementIds.length).toBeGreaterThan(0);
    expect(broadcasts.filter((b) => b.channel === 'rpg:achievementUnlocked')).toHaveLength(result.achievementIds.length);
    expect(db.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'").get())
      .toEqual({ c: result.achievementIds.length });
    expect(db.prepare("SELECT COUNT(*) AS c FROM obolos_ledger WHERE reason = 'achievement'").get())
      .toEqual({ c: result.achievementIds.length });
  });
});

describe('[bajo] HABIT_UNCHECKED reverses the check of the SAME date when told which', () => {
  it('unchecking today refunds today\'s 15 XP, not the retro 5 XP', () => {
    const db = setupDb();
    const todayCheck = processRpgEvent(db, {
      type: 'HABIT_CHECKED', moduleId: 'quests', payload: { xp: 15, hp: 0, habitId: 'h1' }, timestamp: Date.now(),
    });
    const retroCheck = processRpgEvent(db, {
      type: 'HABIT_CHECKED', moduleId: 'quests', payload: { xp: 5, hp: 0, habitId: 'h1', date: YESTERDAY }, timestamp: Date.now(),
    });
    const undo = processRpgEvent(db, {
      type: 'HABIT_UNCHECKED', moduleId: 'quests', payload: { xp: -15, hp: 0, habitId: 'h1', date: TODAY }, timestamp: Date.now(),
    });
    expect(undo.xpGained).toBe(-todayCheck.xpGained);
    const remaining = db.prepare(
      "SELECT xp_gained AS xp, payload FROM rpg_events WHERE event_type = 'HABIT_CHECKED' AND ref_id = 'h1'"
    ).all() as Array<{ xp: number; payload: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].xp).toBe(retroCheck.xpGained);
    expect(JSON.parse(remaining[0].payload).date).toBe(YESTERDAY);
  });

  it('without a date it keeps the legacy "most recent" behaviour', () => {
    const db = setupDb();
    processRpgEvent(db, { type: 'HABIT_CHECKED', moduleId: 'quests', payload: { xp: 15, hp: 0, habitId: 'h1' }, timestamp: Date.now() });
    const second = processRpgEvent(db, { type: 'HABIT_CHECKED', moduleId: 'quests', payload: { xp: 5, hp: 0, habitId: 'h1' }, timestamp: Date.now() });
    const undo = processRpgEvent(db, { type: 'HABIT_UNCHECKED', moduleId: 'quests', payload: { xp: -5, hp: 0, habitId: 'h1' }, timestamp: Date.now() });
    expect(undo.xpGained).toBe(-second.xpGained);
  });
});
