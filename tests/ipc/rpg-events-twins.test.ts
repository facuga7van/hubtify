import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { notificationsMigrations } from '../../shared-logic/modules/notifications.schema';
import { mergeQuestDataInto } from '../../shared-logic/modules/sync.ipc';

// ─────────────────────────────────────────────────────────────────────────────
// The bug, as found in the owner's database on 2026-09-02 (136 rows, 51 with
// sync_id NULL, ids 245–295):
//
// The installed desktop app was still v0.7.5, whose merge keys rpg_events by
// the device-local AUTOINCREMENT id. The ≥ 0.8 export does not ship `id`, so
// v0.7.5 ran `SELECT id FROM rpg_events WHERE id = NULL` — never a hit — and
// inserted EVERY event of the 90-day push window as a brand new row: ids
// 245–288 are the 44 events of the window, one by one, in payload order, with
// the ISO stamp normStamp() gave them on the way and no sync_id (a column that
// client does not know). player_stats / mastery_xp are accumulators the merge
// never touches, so the twins inflated only what is READ from the log: the
// Bitácora, the XP ledger on the dashboard, the Códice's day summary and the
// achievement counters.
//
// Real pairs from that database (ids as they were):
//   245  NULL                                      TASK_COMPLETED 15 @ 2026-06-11T23:18:23.000Z  (twin)
//   201  legacy-2026-06-11 23:18:23-TASK_COMPLETED-f7622878-…-15.0            @ 2026-06-11 23:18:23  (original)
//   260  NULL                                      MEAL_LOGGED 10 @ 2026-09-01T16:16:29.000Z     (twin)
//   216  c1a48730-81f3-4a88-b50f-e473210a63a8                                @ 2026-09-01 16:16:29  (original)
//   291–295 NULL ×5                                first_coin 25 @ 2026-09-02 14:08:52            (v0.7.5's own)
//   296  0d7787cb-74c9-4794-af12-8ac4912d149a                                @ 2026-09-02T14:08:52.000Z
// ─────────────────────────────────────────────────────────────────────────────

const REPAIR_VERSION = 7;

function bootCoreUpTo(maxVersion: number): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations.filter(m => m.version <= maxVersion));
  return db;
}

function bootAll(): Database.Database {
  const db = bootCoreUpTo(Infinity);
  applyMigrations(db, questsMigrations);
  applyMigrations(db, nutritionMigrations);
  applyMigrations(db, financeMigrations);
  applyMigrations(db, notificationsMigrations);
  applyMigrations(db, cauldronMigrations);
  return db;
}

function repairMigration(): string {
  const m = coreMigrations.find(x => x.namespace === 'core' && x.version === REPAIR_VERSION);
  if (!m) throw new Error(`core v${REPAIR_VERSION} (rpg_events twin repair) is missing`);
  return m.up;
}

interface Row {
  syncId: string | null;
  moduleId?: string;
  type: string;
  xp: number;
  hp?: number;
  combo?: number;
  bonus?: number;
  payload: string;
  refId?: string | null;
  createdAt: string;
}

function insert(db: Database.Database, r: Row): number {
  const info = db.prepare(`
    INSERT INTO rpg_events (sync_id, module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(r.syncId, r.moduleId ?? 'quests', r.type, r.xp, r.hp ?? 0, r.combo ?? 1, r.bonus ?? 1, r.payload, r.refId ?? null, r.createdAt);
  return Number(info.lastInsertRowid);
}

const ids = (db: Database.Database): number[] =>
  (db.prepare('SELECT id FROM rpg_events ORDER BY id').all() as Array<{ id: number }>).map(r => r.id);

const syncIds = (db: Database.Database): Array<string | null> =>
  (db.prepare('SELECT sync_id FROM rpg_events ORDER BY id').all() as Array<{ sync_id: string | null }>).map(r => r.sync_id);

const TASK_PAYLOAD = '{"xp":15,"hp":0,"taskId":"f7622878-bfce-4dd0-9f43-7439c797d2fc"}';
const MEAL_PAYLOAD = '{"xp":10,"hp":0}';
const COIN_PAYLOAD = '{"id":"first_coin","xp":25}';

/** The owner's database, reduced to the rows that matter. */
function seedOwnerDb(db: Database.Database) {
  const task = insert(db, { syncId: 'legacy-2026-06-11 23:18:23-TASK_COMPLETED-f7622878-bfce-4dd0-9f43-7439c797d2fc-15.0',
    type: 'TASK_COMPLETED', xp: 15, payload: TASK_PAYLOAD, refId: 'f7622878-bfce-4dd0-9f43-7439c797d2fc', createdAt: '2026-06-11 23:18:23' });
  const meal = insert(db, { syncId: 'c1a48730-81f3-4a88-b50f-e473210a63a8', moduleId: 'nutrition',
    type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 16:16:29' });
  // The twins: ISO stamp, no sync_id, no ref_id — exactly as v0.7.5 wrote them.
  const taskTwin = insert(db, { syncId: null, type: 'TASK_COMPLETED', xp: 15, payload: TASK_PAYLOAD, createdAt: '2026-06-11T23:18:23.000Z' });
  const mealTwin = insert(db, { syncId: null, moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T16:16:29.000Z' });
  // v0.7.5's own rows: two lonely ones (no twin anywhere) …
  const lonelyMeal = insert(db, { syncId: null, moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-02 12:14:49' });
  const lonelyExpense = insert(db, { syncId: null, moduleId: 'finance', type: 'EXPENSE_LOGGED', xp: 6.25, combo: 1.25,
    payload: '{"xp":5,"hp":0,"movementType":"expense"}', createdAt: '2026-09-02 14:08:52' });
  // … and five copies of the same achievement, next to the identified one.
  const coinTwins = [1, 2, 3, 4, 5].map(() => insert(db, { syncId: null, moduleId: 'rpg', type: 'ACHIEVEMENT_UNLOCKED', xp: 25, payload: COIN_PAYLOAD, createdAt: '2026-09-02 14:08:52' }));
  const coin = insert(db, { syncId: '0d7787cb-74c9-4794-af12-8ac4912d149a', moduleId: 'rpg', type: 'ACHIEVEMENT_UNLOCKED', xp: 25,
    payload: COIN_PAYLOAD, refId: 'first_coin', createdAt: '2026-09-02T14:08:52.000Z' });

  db.prepare("UPDATE player_stats SET level = 6, xp = 2157, hp = 100, title = 'Escudero', streak = 2 WHERE user_id = 'default'").run();
  db.prepare("INSERT INTO mastery_xp (module_id, xp, updated_at) VALUES ('quests', 741, '2026-09-02 17:35:36'), ('nutrition', 651, '2026-09-02T12:14:49.000Z')").run();
  return { task, meal, taskTwin, mealTwin, lonelyMeal, lonelyExpense, coinTwins, coin };
}

describe(`core v${REPAIR_VERSION} — repairs rpg_events twins left by an id-keyed merge`, () => {
  let db: Database.Database;
  beforeEach(() => { db = bootCoreUpTo(REPAIR_VERSION - 1); });

  it('hard-deletes the anonymous copy of every identified event and keeps the lonely ones', () => {
    const s = seedOwnerDb(db);
    expect(ids(db)).toHaveLength(12);
    db.exec(repairMigration());
    expect(ids(db)).toEqual([s.task, s.meal, s.lonelyMeal, s.lonelyExpense, s.coin]);
  });

  it('leaves player_stats and mastery_xp alone: they are accumulators the twins never entered', () => {
    seedOwnerDb(db);
    const before = {
      stats: db.prepare('SELECT level, xp, hp, title, streak FROM player_stats').get(),
      mastery: db.prepare('SELECT module_id, xp, updated_at FROM mastery_xp ORDER BY module_id').all(),
    };
    db.exec(repairMigration());
    expect(db.prepare('SELECT level, xp, hp, title, streak FROM player_stats').get()).toEqual(before.stats);
    expect(db.prepare('SELECT module_id, xp, updated_at FROM mastery_xp ORDER BY module_id').all()).toEqual(before.mastery);
  });

  it('what is READ from the log stops being doubled (XP ledger, day summary)', () => {
    seedOwnerDb(db);
    const dayXp = () => (db.prepare("SELECT COALESCE(SUM(xp_gained), 0) AS xp FROM rpg_events WHERE substr(replace(created_at, 'T', ' '), 1, 10) = '2026-09-02'").get() as { xp: number }).xp;
    expect(dayXp()).toBe(10 + 6.25 + 25 * 6);
    db.exec(repairMigration());
    expect(dayXp()).toBe(10 + 6.25 + 25);
  });

  it('is idempotent', () => {
    seedOwnerDb(db);
    db.exec(repairMigration());
    const first = db.prepare('SELECT * FROM rpg_events ORDER BY id').all();
    db.exec(repairMigration());
    expect(db.prepare('SELECT * FROM rpg_events ORDER BY id').all()).toEqual(first);
  });

  it('collapses two anonymous copies to the older one', () => {
    const older = insert(db, { syncId: null, type: 'HABIT_CHECKED', xp: 6, payload: '{"xp":6,"hp":0,"habitId":"h1"}', createdAt: '2026-06-12 15:44:37' });
    insert(db, { syncId: null, type: 'HABIT_CHECKED', xp: 6, payload: '{"xp":6,"hp":0,"habitId":"h1"}', createdAt: '2026-06-12T15:44:37.000Z' });
    db.exec(repairMigration());
    expect(ids(db)).toEqual([older]);
  });

  it('a legacy- copy loses to the uuid minted for the same event', () => {
    // A < 0.8 desktop inserted the anonymous twin, then core v1 backfilled it
    // (ISO stamp, so a legacy id no other device derives), then the pull brought
    // the real uuid row in.
    insert(db, { syncId: 'legacy-2026-09-01T16:16:29.000Z-MEAL_LOGGED--10.0', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T16:16:29.000Z' });
    const real = insert(db, { syncId: 'c1a48730-81f3-4a88-b50f-e473210a63a8', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 16:16:29' });
    db.exec(repairMigration());
    expect(ids(db)).toEqual([real]);
  });

  it('leaves genuine repeats alone', () => {
    // Two uuid rows: minted by this codebase, both real.
    insert(db, { syncId: 'u-1', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-06-01 17:00:00' });
    insert(db, { syncId: 'u-2', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-06-01 17:00:00' });
    // Two legacy rows the v1 backfill told apart with '#2'.
    insert(db, { syncId: 'legacy-2026-05-01 22:54:25-HABIT_UNCHECKED-h1-0.0', type: 'HABIT_UNCHECKED', xp: 0, payload: '{"xp":-5,"hp":0,"habitId":"h1"}', createdAt: '2026-05-01 22:54:25' });
    insert(db, { syncId: 'legacy-2026-05-01 22:54:25-HABIT_UNCHECKED-h1-0.0#2', type: 'HABIT_UNCHECKED', xp: 0, payload: '{"xp":-5,"hp":0,"habitId":"h1"}', createdAt: '2026-05-01 22:54:25' });
    // Two anonymous rows in the same second about DIFFERENT tasks.
    insert(db, { syncId: null, type: 'TASK_COMPLETED', xp: 10, payload: '{"xp":5,"hp":0,"taskId":"a"}', createdAt: '2026-09-01 16:29:45' });
    insert(db, { syncId: null, type: 'TASK_COMPLETED', xp: 10, payload: '{"xp":5,"hp":0,"taskId":"b"}', createdAt: '2026-09-01 16:29:45' });
    // An anonymous row one second away from an identified look-alike.
    insert(db, { syncId: 'u-3', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 21:22:30' });
    insert(db, { syncId: null, moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T21:22:31.000Z' });
    db.exec(repairMigration());
    expect(ids(db)).toHaveLength(8);
  });
});

describe('mergeQuestDataInto — rpg_events: a copy of an event we already hold under another identity', () => {
  let db: Database.Database;
  beforeEach(() => { db = bootAll(); });

  const remoteMeal = (syncId: string, createdAt = '2026-09-01T16:16:29.000Z') => ({
    syncId, moduleId: 'nutrition', eventType: 'MEAL_LOGGED', xpGained: 10, hpChange: 0,
    comboMultiplier: 1, bonusMultiplier: 1, payload: MEAL_PAYLOAD, refId: null, createdAt,
  });

  it('does not insert a row whose sync_id differs from the natural-key match', () => {
    insert(db, { syncId: 'c1a48730-81f3-4a88-b50f-e473210a63a8', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 16:16:29' });
    // The legacy- twin another device backfilled and pushed.
    const r = mergeQuestDataInto(db, { rpgEvents: [remoteMeal('legacy-2026-09-01T16:16:29.000Z-MEAL_LOGGED--10.0')] } as never);
    expect(syncIds(db)).toEqual(['c1a48730-81f3-4a88-b50f-e473210a63a8']);
    expect(r.changed).toBe(false);
  });

  it('lets an anonymous local copy adopt the remote identity instead of inserting a second row', () => {
    const twin = insert(db, { syncId: null, moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T16:16:29.000Z' });
    const r = mergeQuestDataInto(db, { rpgEvents: [remoteMeal('c1a48730-81f3-4a88-b50f-e473210a63a8')] } as never);
    expect(db.prepare('SELECT id, sync_id FROM rpg_events').all()).toEqual([{ id: twin, sync_id: 'c1a48730-81f3-4a88-b50f-e473210a63a8' }]);
    expect(r.changed).toBe(true);
  });

  it('lets a legacy- local copy adopt the uuid of the same event, so both devices converge on one identity', () => {
    const backfilled = insert(db, { syncId: 'legacy-2026-09-01T16:16:29.000Z-MEAL_LOGGED--10.0', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T16:16:29.000Z' });
    mergeQuestDataInto(db, { rpgEvents: [remoteMeal('c1a48730-81f3-4a88-b50f-e473210a63a8')] } as never);
    expect(db.prepare('SELECT id, sync_id FROM rpg_events').all()).toEqual([{ id: backfilled, sync_id: 'c1a48730-81f3-4a88-b50f-e473210a63a8' }]);
  });

  it('keeps the union semantics for distinct events: same type and second but another task, or one second apart', () => {
    insert(db, { syncId: 'u-a', type: 'TASK_COMPLETED', xp: 10, payload: '{"xp":5,"hp":0,"taskId":"a"}', refId: 'a', createdAt: '2026-09-01 16:29:45' });
    insert(db, { syncId: 'u-m', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 21:22:30' });
    mergeQuestDataInto(db, { rpgEvents: [
      { syncId: 'u-b', moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 10, hpChange: 0, comboMultiplier: 1, bonusMultiplier: 1, payload: '{"xp":5,"hp":0,"taskId":"b"}', refId: 'b', createdAt: '2026-09-01T16:29:45.000Z' },
      remoteMeal('u-n', '2026-09-01T21:22:31.000Z'),
      remoteMeal('u-m', '2026-09-01T21:22:30.000Z'), // already here, by sync_id
    ] } as never);
    expect(syncIds(db)).toEqual(['u-a', 'u-m', 'u-b', 'u-n']);
  });

  it('sweeps the twins an old client left behind before the payload lands', () => {
    const real = insert(db, { syncId: 'c1a48730-81f3-4a88-b50f-e473210a63a8', moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01 16:16:29' });
    insert(db, { syncId: null, moduleId: 'nutrition', type: 'MEAL_LOGGED', xp: 10, payload: MEAL_PAYLOAD, createdAt: '2026-09-01T16:16:29.000Z' });
    const r = mergeQuestDataInto(db, { rpgEvents: [] } as never);
    expect(ids(db)).toEqual([real]);
    expect(r.changed).toBe(true);
  });
});
