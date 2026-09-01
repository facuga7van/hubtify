import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import {
  processRpgEvent,
  getMasteries,
  backfillMasteryXp,
  bumpMasteryXp,
  MASTERY_MODULES,
} from '../../electron/ipc/rpg-handlers';
import {
  MASTERY_MAX_LEVEL,
  MASTERY_THRESHOLDS,
  masteryInfo,
  masteryLevel,
  masteryRankKey,
  masteryRankName,
} from '../../shared/rpg-engine';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  return db;
}

function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

/** Writes a raw event on an arbitrary local day, bypassing the engine. */
function seedEvent(db: Database.Database, moduleId: string, type: string, date: string, xp = 10): void {
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, 0, 1.0, 1.0, '{}', ?, NULL, ?)
  `).run(moduleId, type, xp, `${date} 10:00:00`, `seed-${Math.random()}`);
}

function masteryRow(db: Database.Database, moduleId: string): number {
  const row = db.prepare('SELECT xp FROM mastery_xp WHERE module_id = ?').get(moduleId) as
    { xp: number } | undefined;
  return row?.xp ?? 0;
}

describe('masteryLevel curve', () => {
  it('is monotonic, non-decreasing, bounded 1..10', () => {
    let previous = masteryLevel(0);
    expect(previous).toBe(1);
    for (let xp = 0; xp <= 12_000; xp += 25) {
      const level = masteryLevel(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(MASTERY_MAX_LEVEL);
      previous = level;
    }
    expect(masteryLevel(Number.MAX_SAFE_INTEGER)).toBe(MASTERY_MAX_LEVEL);
    expect(masteryLevel(-50)).toBe(1);
    expect(masteryLevel(Number.NaN)).toBe(1);
  });

  it('flips exactly at each threshold', () => {
    for (let level = 2; level <= MASTERY_MAX_LEVEL; level++) {
      const threshold = MASTERY_THRESHOLDS[level - 1];
      expect(masteryLevel(threshold - 1)).toBe(level - 1);
      expect(masteryLevel(threshold)).toBe(level);
    }
  });

  it('is deliberately slower than the global curve: level 10 ≈ six months of real use', () => {
    // ~50 XP/day of serious module use → 9.500 XP lands at ~190 days.
    const days = MASTERY_THRESHOLDS[MASTERY_MAX_LEVEL - 1] / 50;
    expect(days).toBeGreaterThan(150);
    expect(days).toBeLessThan(240);
  });

  it('names every rank and reports progress within the level', () => {
    for (let level = 1; level <= MASTERY_MAX_LEVEL; level++) {
      expect(masteryRankKey(level)).toMatch(/^rpg\.mastery\.ranks\./);
      expect(masteryRankName(level).length).toBeGreaterThan(0);
    }
    expect(masteryInfo(0)).toMatchObject({ level: 1, nextLevelXp: 100, progress: 0 });
    expect(masteryInfo(50).progress).toBeCloseTo(0.5);
    // The cap: progress pinned to 1, nothing left to climb.
    expect(masteryInfo(20_000)).toMatchObject({ level: 10, nextLevelXp: null, progress: 1 });
  });
});

describe('mastery accumulator', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('adds each event to its module, inside the same processing pass', () => {
    const first = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    // The event pays achievement XP separately ('rpg' module); the QUESTS
    // accumulator carries exactly what the quests event itself paid.
    expect(masteryRow(db, 'quests')).toBe(Math.round(first.xpGained));

    const second = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't2' }, timestamp: Date.now(),
    });
    expect(masteryRow(db, 'quests')).toBe(Math.round(first.xpGained) + Math.round(second.xpGained));
  });

  it('never decreases: an undo refunds the XP but keeps the mastery', () => {
    processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    const before = masteryRow(db, 'quests');
    expect(before).toBeGreaterThan(0);

    processRpgEvent(db, {
      type: 'TASK_UNCOMPLETED', moduleId: 'quests',
      payload: { xp: -10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    expect(masteryRow(db, 'quests')).toBe(before);
  });

  it('ignores zero, negative and garbage deltas', () => {
    bumpMasteryXp(db, 'quests', 0);
    bumpMasteryXp(db, 'quests', -50);
    bumpMasteryXp(db, 'quests', Number.NaN);
    bumpMasteryXp(db, '', 100);
    expect(masteryRow(db, 'quests')).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM mastery_xp').get()).toEqual({ c: 0 });
  });
});

describe('mastery backfill', () => {
  it('the v6 migration seeds the accumulator from surviving events, positives only', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initCoreTables(db);
    // History exists BEFORE the migration runs — the upgrade path.
    db.prepare(`
      INSERT INTO rpg_events (module_id, event_type, xp_gained, created_at)
      VALUES ('quests', 'TASK_COMPLETED', 60, '2026-05-01 10:00:00'),
             ('quests', 'TASK_COMPLETED', 40, '2026-05-02 10:00:00'),
             ('nutrition', 'DAY_SUMMARY', -20, '2026-05-02 21:00:00'),
             ('nutrition', 'MEAL_LOGGED', 12, '2026-05-03 12:00:00')
    `).run();
    applyMigrations(db, coreMigrations);

    expect(masteryRow(db, 'quests')).toBe(100);
    // The negative close never erodes the accumulator: MAX(xp, 0) per row.
    expect(masteryRow(db, 'nutrition')).toBe(12);
  });

  it('is idempotent: running it again adds nothing', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(3), 30);
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(2), 20);

    backfillMasteryXp(db);
    expect(masteryRow(db, 'quests')).toBe(50);
    backfillMasteryXp(db);
    backfillMasteryXp(db);
    expect(masteryRow(db, 'quests')).toBe(50);
  });

  it('never touches a module that already has an accumulator row', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(3), 30);
    backfillMasteryXp(db);
    // Live play moves the accumulator ahead of the (later pruned) log…
    bumpMasteryXp(db, 'quests', 500);
    // …and a re-sweep must not clobber it back down to the log's sum.
    backfillMasteryXp(db);
    expect(masteryRow(db, 'quests')).toBe(530);
  });
});

describe('rpg:getMasteries', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('always answers the four event modules, zeroes included', () => {
    const masteries = getMasteries(db);
    expect(masteries.map((m) => m.moduleId)).toEqual([...MASTERY_MODULES]);
    for (const m of masteries) {
      expect(m).toMatchObject({ xp: 0, level: 1, nextLevelXp: 100, progress: 0 });
      expect(m.levelKey).toBe('rpg.mastery.ranks.apprentice');
    }
  });

  it('derives level, rank and progress from the accumulator', () => {
    bumpMasteryXp(db, 'quests', 350);
    const quests = getMasteries(db).find((m) => m.moduleId === 'quests')!;
    expect(quests.xp).toBe(350);
    expect(quests.level).toBe(3);
    expect(quests.levelKey).toBe('rpg.mastery.ranks.journeyman');
    expect(quests.nextLevelXp).toBe(700);
    expect(quests.progress).toBeCloseTo((350 - 300) / (700 - 300));
    // The 'rpg' pseudo-module (seals, achievements) accumulates but is not a bar.
    bumpMasteryXp(db, 'rpg', 999);
    expect(getMasteries(db).map((m) => m.moduleId)).toEqual([...MASTERY_MODULES]);
  });
});
