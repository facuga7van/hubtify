import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import { processRpgEvent, getDaySummary, sealDay, getSeals } from '../../electron/ipc/rpg-handlers';
import { sealXp, MAX_VIGOR } from '../../shared/rpg-engine';
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

function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

const TODAY = dateAgo(0);
const YESTERDAY = dateAgo(1);

/** Writes a raw event on an arbitrary local day, bypassing the engine. */
function seedEvent(db: Database.Database, moduleId: string, type: string, date: string, hhmm = '10:00', xp = 10): void {
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, 0, 1.0, 1.0, '{}', ?, NULL, ?)
  `).run(moduleId, type, xp, `${date} ${hhmm}:00`, `seed-${Math.random()}`);
}

function eventsOn(db: Database.Database, date: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM rpg_events WHERE substr(created_at, 1, 10) = ?"
  ).get(date) as { c: number };
  return row.c;
}

pinClockToNoon();

describe('rpg:getDaySummary', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('groups the day by module, with local times', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, '08:30', 15);
    seedEvent(db, 'quests', 'HABIT_CHECKED', TODAY, '09:00', 5);
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', TODAY, '13:15', 10);

    const summary = getDaySummary(db, TODAY, TODAY);
    expect(summary.eventsCount).toBe(3);
    expect(summary.totalXp).toBe(30);
    expect(summary.modules).toEqual(['quests', 'nutrition']); // richest first
    expect(summary.byModule[0]).toMatchObject({ moduleId: 'quests', count: 2, xp: 20 });
    expect(summary.events[0].time).toBe('08:30');
    expect(summary.events.map((e) => e.time)).toEqual(['08:30', '09:00', '13:15']);
  });

  it('reports the max combo reached that day', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    db.prepare('UPDATE rpg_events SET combo_multiplier = 1.75 WHERE id = (SELECT MAX(id) FROM rpg_events)').run();
    expect(getDaySummary(db, TODAY, TODAY).maxCombo).toBe(1.75);
  });

  it('refuses to offer a seal for a day nobody lived', () => {
    const summary = getDaySummary(db, TODAY, TODAY);
    expect(summary.eventsCount).toBe(0);
    expect(summary.canSeal).toBe(false);
    expect(summary.sealBlockedReason).toBe('empty_day');
  });

  it('reports too_old past the grace window', () => {
    const old = dateAgo(3);
    seedEvent(db, 'quests', 'TASK_COMPLETED', old);
    const summary = getDaySummary(db, old, TODAY);
    expect(summary.canSeal).toBe(false);
    expect(summary.sealBlockedReason).toBe('too_old');
  });

  it('reports already_sealed and carries the seal back', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    sealDay(db, TODAY, TODAY);
    const summary = getDaySummary(db, TODAY, TODAY);
    expect(summary.sealed).toBe(true);
    expect(summary.canSeal).toBe(false);
    expect(summary.sealBlockedReason).toBe('already_sealed');
    expect(summary.seal?.modules).toContain('quests');
  });
});

describe('rpg:sealDay', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('pays round((10 + 2 * min(events, 20)) * vigorBonus(vigor))', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', TODAY);
    const expectedCount = eventsOn(db, TODAY);

    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventsCount).toBe(expectedCount);
    expect(result.vigor).toBe(MAX_VIGOR);
    expect(result.xpAwarded).toBe(sealXp(expectedCount, MAX_VIGOR));
    expect(result.modules.sort()).toEqual(['nutrition', 'quests']);
  });

  it('writes the day_seals row the calendar reads', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);

    const row = db.prepare('SELECT * FROM day_seals WHERE date = ?').get(TODAY) as Record<string, unknown>;
    expect(row.xp_awarded).toBe((result as { xpAwarded: number }).xpAwarded);
    expect(row.vigor).toBe(MAX_VIGOR);
    expect(JSON.parse(row.modules as string)).toEqual(['quests']);
    expect(row.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('logs a FLAT DAY_SEALED event — no combo, no random bonus', () => {
    // Prime the combo so a non-flat event would have multiplied.
    for (let i = 0; i < 4; i++) {
      processRpgEvent(db, {
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: 10, hp: 0, taskId: `t${i}` }, timestamp: Date.now(),
      });
    }
    const comboBefore = stats(db).daily_combo as number;
    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);

    const row = db.prepare(
      "SELECT xp_gained AS xp, combo_multiplier AS combo, bonus_multiplier AS bonus, ref_id AS refId FROM rpg_events WHERE event_type = 'DAY_SEALED'"
    ).get() as { xp: number; combo: number; bonus: number; refId: string };
    expect(row.combo).toBe(1.0);
    expect(row.bonus).toBe(1.0);
    expect(row.xp).toBe((result as { xpAwarded: number }).xpAwarded);
    expect(row.refId).toBe(TODAY);
    // The ritual does not inflate the day's combo counter.
    expect(stats(db).daily_combo).toBe(comboBefore);
  });

  it('counts as showing up: the seal advances the global streak', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    db.prepare('UPDATE player_stats SET streak = 3, streak_last_date = ? WHERE user_id = ?')
      .run(YESTERDAY, 'default');

    sealDay(db, TODAY, TODAY);
    const s = stats(db);
    expect(s.streak).toBe(4);
    expect(s.streak_last_date).toBe(TODAY);
  });

  it('refuses a day with zero events — the seal certifies a day lived', () => {
    expect(sealDay(db, TODAY, TODAY)).toEqual({ ok: false, reason: 'empty_day' });
  });

  it('refuses to seal the same day twice', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    expect(sealDay(db, TODAY, TODAY).ok).toBe(true);
    expect(sealDay(db, TODAY, TODAY)).toEqual({ ok: false, reason: 'already_sealed' });
  });

  // Audit 2026-08 (#8): a retro seal used to assume vigor 100, so sealing
  // "yesterday" beat sealing "tonight" whenever the day closed battered. It now
  // uses the vigor that day really closed at (the live row while it still
  // belongs to that day, otherwise a replay of the day's hp deltas).
  it('allows the grace window (yesterday) at the vigor that day closed at', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    db.prepare('UPDATE player_stats SET hp = 40, hp_date = ? WHERE user_id = ?').run(YESTERDAY, 'default');

    const result = sealDay(db, YESTERDAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vigor).toBe(40);
    expect(result.xpAwarded).toBe(sealXp(result.eventsCount, 40));
  });

  it('a past day with no hp movement is sealed at full vigor', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    db.prepare('UPDATE player_stats SET hp = 100, hp_date = ? WHERE user_id = ?').run(TODAY, 'default');
    const result = sealDay(db, YESTERDAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vigor).toBe(MAX_VIGOR);
  });

  it('flags a retro seal in the payload', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    sealDay(db, YESTERDAY, TODAY);
    const row = db.prepare("SELECT payload FROM rpg_events WHERE event_type = 'DAY_SEALED'").get() as { payload: string };
    expect(JSON.parse(row.payload).retro).toBe(true);
  });

  it('refuses anything older than the grace window', () => {
    const old = dateAgo(2);
    seedEvent(db, 'quests', 'TASK_COMPLETED', old);
    expect(sealDay(db, old, TODAY)).toEqual({ ok: false, reason: 'too_old' });
  });

  it('refuses the future', () => {
    expect(sealDay(db, dateAgo(-1), TODAY)).toEqual({ ok: false, reason: 'future' });
  });

  it('reports the achievements the seal itself unlocked', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.achievementIds).toContain('first_seal');
  });

  it('not sealing costs nothing — no decay, no penalty, no seal streak', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(5));
    const before = stats(db);
    // Days went by unsealed; nothing in the engine reacts to that.
    expect(getSeals(db, dateAgo(30), TODAY)).toEqual([]);
    expect(stats(db)).toEqual(before);
  });
});

describe('rpg:getSeals', () => {
  it('returns the sealed days in the range, ascending, with parsed modules', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', YESTERDAY);
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', TODAY);
    sealDay(db, YESTERDAY, TODAY);
    sealDay(db, TODAY, TODAY);

    const seals = getSeals(db, dateAgo(7), TODAY);
    expect(seals.map((s) => s.date)).toEqual([YESTERDAY, TODAY]);
    expect(seals[0].modules).toEqual(['quests']);
    expect(seals[0].eventsCount).toBeGreaterThan(0);
    expect(getSeals(db, dateAgo(7), dateAgo(3))).toEqual([]);
    db.close();
  });
});
