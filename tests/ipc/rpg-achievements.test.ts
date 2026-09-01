import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import {
  processRpgEvent,
  backfillAchievements,
  getAchievements,
  evaluateAchievements,
} from '../../electron/ipc/rpg-handlers';
import { ACHIEVEMENTS, ACHIEVEMENT_XP, ACHIEVEMENTS_TOTAL } from '../../shared/achievements';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  // user_profile.character_name is added by the 'character' module migration,
  // which core-only handles never run.
  db.exec('ALTER TABLE user_profile ADD COLUMN character_name TEXT');
  return db;
}

function stats(db: Database.Database) {
  return db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, number | string | null>;
}

/** A local YYYY-MM-DD `offset` days before today. */
function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

/** Writes a raw historical event, bypassing the engine (no achievements fired). */
function seedEvent(db: Database.Database, moduleId: string, type: string, daysAgo: number, xp = 10): void {
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, 0, 1.0, 1.0, '{}', ?, NULL, ?)
  `).run(moduleId, type, xp, `${dateAgo(daysAgo)} 10:00:00`, `seed-${Math.random()}`);
}

function task(db: Database.Database, id: string) {
  return processRpgEvent(db, {
    type: 'TASK_COMPLETED', moduleId: 'quests',
    payload: { xp: 10, hp: 0, taskId: id }, timestamp: Date.now(),
  });
}

describe('achievement backfill', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('starts an existing account at 2 / 40, not 0', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 3);
    db.prepare("UPDATE user_profile SET character_name = 'Aldric'").run();

    const result = backfillAchievements(db);
    expect(result.total).toBe(ACHIEVEMENTS_TOTAL);
    expect(result.unlocked.sort()).toEqual(['awakening', 'first_quest', 'first_step']);
  });

  it('unlocks nothing at all on a truly empty install', () => {
    expect(backfillAchievements(db).unlocked).toEqual([]);
  });

  it('is idempotent — a second sweep pays nothing and unlocks nothing', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 1);
    backfillAchievements(db);
    const xpAfterFirst = stats(db).xp as number;

    expect(backfillAchievements(db).unlocked).toEqual([]);
    expect(stats(db).xp).toBe(xpAfterFirst);
  });

  // Audit 2026-08 (UI #9): the sweep used to pay +25 XP and +15 óbolos per
  // historical unlock, so the first boot after an update minted a level-up out
  // of years-old rows. The backfill now RECORDS without paying; only a live
  // unlock pays.
  it('records historical unlocks without paying for them', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 1);
    const unlocked = backfillAchievements(db).unlocked;
    expect(unlocked.length).toBeGreaterThan(0);

    expect(stats(db).xp).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'").get())
      .toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM achievements_unlocked').get()).toEqual({ c: unlocked.length });
  });

  it('a live unlock pays a flat +25 XP, with no combo and no bonus', () => {
    const result = task(db, 't1');
    const unlocked = result.achievementIds;
    expect(unlocked.length).toBeGreaterThan(0);

    expect(stats(db).xp as number).toBeCloseTo(result.xpGained + ACHIEVEMENT_XP * unlocked.length, 5);
    const rows = db.prepare(
      "SELECT xp_gained AS xp, combo_multiplier AS combo, bonus_multiplier AS bonus, ref_id AS refId, hp_change AS hp FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'"
    ).all() as Array<{ xp: number; combo: number; bonus: number; refId: string; hp: number }>;
    expect(rows).toHaveLength(unlocked.length);
    for (const r of rows) {
      expect(r.xp).toBe(ACHIEVEMENT_XP);
      expect(r.combo).toBe(1.0);
      expect(r.bonus).toBe(1.0);
      expect(r.hp).toBe(0);
      expect(unlocked).toContain(r.refId);
    }
  });

  it('never advances the streak — an achievement is derived, not showing up', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 1);
    backfillAchievements(db);
    const s = stats(db);
    expect(s.streak).toBe(0);
    expect(s.streak_last_date).toBeNull();
    expect(s.daily_combo).toBe(0);
  });
});

describe('achievement evaluation on events', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('unlocks first_step on the very first event of a brand new account', () => {
    const result = task(db, 't1');
    expect(result.achievementIds).toContain('first_step');
    expect(result.achievementIds).toContain('first_quest');
    // ...but NOT the returning-hero one: a new account is not a homecoming.
    expect(result.achievementIds).not.toContain('hero_return');
  });

  it('never re-unlocks nor re-pays an achievement it already granted', () => {
    task(db, 't1');
    const xpBefore = stats(db).xp as number;
    const second = task(db, 't2');
    expect(second.achievementIds).not.toContain('first_step');
    // The XP that moved is exactly the task's own gain plus 25 per NEW unlock —
    // nothing is paid twice for an achievement already on the shelf.
    expect(stats(db).xp as number).toBeCloseTo(
      xpBefore + second.xpGained + ACHIEVEMENT_XP * second.achievementIds.length, 5,
    );
    const rows = db.prepare(
      "SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED' AND ref_id = 'first_step'"
    ).get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('rewards coming back after 14 days of silence', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 20);
    const result = task(db, 'welcome-back');
    expect(result.achievementIds).toContain('hero_return');
  });

  it('does not fire the homecoming for a one-day gap', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', 1);
    expect(task(db, 't1').achievementIds).not.toContain('hero_return');
  });

  it('unlocks Día Perfecto only once all four modules moved the same day', () => {
    expect(task(db, 't1').achievementIds).not.toContain('perfect_day');
    processRpgEvent(db, { type: 'MEAL_LOGGED', moduleId: 'nutrition', payload: { xp: 10, hp: 0 }, timestamp: Date.now() });
    processRpgEvent(db, { type: 'EXPENSE_LOGGED', moduleId: 'finance', payload: { xp: 5, hp: 0 }, timestamp: Date.now() });
    const last = processRpgEvent(db, {
      type: 'POMODORO_COMPLETED', moduleId: 'cauldron', payload: { xp: 8, hp: 0 }, timestamp: Date.now(),
    });
    expect(last.achievementIds).toContain('perfect_day');
  });

  it('unlocks Tres Épicas on the third 3.0x roll of the same day', () => {
    for (let i = 0; i < 2; i++) {
      seedEvent(db, 'quests', 'TASK_COMPLETED', 0);
      db.prepare("UPDATE rpg_events SET bonus_multiplier = 3.0 WHERE id = (SELECT MAX(id) FROM rpg_events)").run();
    }
    // The third epic has to be the event under evaluation.
    db.prepare(`
      INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
      VALUES ('quests', 'TASK_COMPLETED', 30, 0, 1.0, 3.0, '{}', ?, NULL, 'epic-3')
    `).run(`${dateAgo(0)} 11:00:00`);

    const unlocked = evaluateAchievements(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests', payload: {},
      hour: 11, date: dateAgo(0), weekday: new Date().getDay(),
      comboMultiplier: 1.0, bonusMultiplier: 3.0, xpGained: 30, pardonUsed: false,
    });
    expect(unlocked).toContain('three_epics');
    expect(unlocked).toContain('lucky_strike');
  });

  it('an achievement never fails the event that earned it', () => {
    // The shelf is a reward LAYER: with no achievements_unlocked table at all,
    // the XP event must still land intact.
    db.exec('DROP TABLE achievements_unlocked');
    const result = task(db, 't1');
    expect(result.xpGained).toBeGreaterThan(0);
    expect(result.achievementIds).toEqual([]);
    expect(stats(db).xp as number).toBeGreaterThan(0);
  });
});

describe('rpg:getAchievements shape', () => {
  it('returns the whole catalogue, hidden-and-locked entries included', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', 1);
    backfillAchievements(db);

    const list = getAchievements(db);
    expect(list).toHaveLength(ACHIEVEMENTS_TOTAL);
    expect(list.filter((a) => a.hidden)).toHaveLength(8);

    const firstStep = list.find((a) => a.id === 'first_step')!;
    expect(firstStep.unlocked).toBe(true);
    expect(firstStep.unlockedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const locked = list.find((a) => a.id === 'cauldron_master')!;
    expect(locked.unlocked).toBe(false);
    expect(locked.unlockedAt).toBeUndefined();
    db.close();
  });
});

describe('achievement i18n coverage', () => {
  for (const lang of ['es', 'en'] as const) {
    it(`${lang}.json carries a title and a desc for every catalogue entry`, () => {
      const raw = readFileSync(resolve(__dirname, `../../src/i18n/${lang}.json`), 'utf-8');
      const section = (JSON.parse(raw) as { rpg: { achievements: Record<string, unknown> } }).rpg.achievements;
      expect(section).toBeTruthy();
      for (const a of ACHIEVEMENTS) {
        const entry = section[a.id] as { title?: string; desc?: string } | undefined;
        expect(entry, `${lang}: missing rpg.achievements.${a.id}`).toBeTruthy();
        expect(entry!.title, `${lang}: ${a.id}.title`).toBeTruthy();
        expect(entry!.desc, `${lang}: ${a.id}.desc`).toBeTruthy();
      }
      // The placeholders the UI shows in place of a locked hidden entry.
      expect(section.hiddenTitle).toBeTruthy();
      expect(section.hiddenDesc).toBeTruthy();
    });
  }
});

describe('phase-2 event matcher', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('pays BUDGET_MONTH_MET 100 XP once, and 0 for a repeat of the same month', () => {
    const first = processRpgEvent(db, {
      type: 'BUDGET_MONTH_MET', moduleId: 'finance',
      payload: { month: '2026-03' }, timestamp: Date.now(),
    });
    // 100 base, then combo and the random bonus on top — never less than 100.
    expect(first.xpGained).toBeGreaterThanOrEqual(100);

    const repeat = processRpgEvent(db, {
      type: 'BUDGET_MONTH_MET', moduleId: 'finance',
      payload: { month: '2026-03' }, timestamp: Date.now(),
    });
    expect(repeat.xpGained).toBe(0);

    const nextMonth = processRpgEvent(db, {
      type: 'BUDGET_MONTH_MET', moduleId: 'finance',
      payload: { month: '2026-04' }, timestamp: Date.now(),
    });
    expect(nextMonth.xpGained).toBeGreaterThanOrEqual(100);
  });

  it('stores the month as ref_id so the guard is a single indexed probe', () => {
    processRpgEvent(db, {
      type: 'BUDGET_MONTH_MET', moduleId: 'finance',
      payload: { month: '2026-03' }, timestamp: Date.now(),
    });
    const row = db.prepare("SELECT ref_id AS refId FROM rpg_events WHERE event_type = 'BUDGET_MONTH_MET'").get() as { refId: string };
    expect(row.refId).toBe('2026-03');
  });

  it('unlocks Libro Mayor Cerrado from BUDGET_MONTH_MET', () => {
    const result = processRpgEvent(db, {
      type: 'BUDGET_MONTH_MET', moduleId: 'finance',
      payload: { month: '2026-03' }, timestamp: Date.now(),
    });
    expect(result.achievementIds).toContain('ledger_closed');
  });

  it('charges nothing at all for an abandoned pomodoro — the loss is symbolic', () => {
    const before = stats(db);
    const result = processRpgEvent(db, {
      type: 'POMODORO_ABANDONED', moduleId: 'cauldron',
      // Even a payload demanding damage is refused.
      payload: { xp: 20, hp: -30 }, timestamp: Date.now(),
    });
    expect(result.xpGained).toBe(0);
    expect(result.hpChange).toBe(0);
    const after = stats(db);
    expect(after.hp).toBe(before.hp);
    expect(after.streak).toBe(0);
    expect(after.daily_combo).toBe(0);
  });

  it('still logs the abandoned pomodoro, so the shelf and the Códice can see it', () => {
    processRpgEvent(db, {
      type: 'POMODORO_ABANDONED', moduleId: 'cauldron', payload: {}, timestamp: Date.now(),
    });
    const row = db.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'POMODORO_ABANDONED'").get() as { c: number };
    expect(row.c).toBe(1);
  });

  it('respects an explicit payload.xp for the finance movements', () => {
    const result = processRpgEvent(db, {
      type: 'EXPENSE_LOGGED', moduleId: 'finance',
      payload: { xp: 5, hp: 0 }, timestamp: Date.now(),
    });
    expect(result.xpGained).toBeGreaterThanOrEqual(5);
    expect(stats(db).total_expenses).toBe(1);
  });
});
