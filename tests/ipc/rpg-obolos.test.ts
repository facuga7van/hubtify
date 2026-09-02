import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import {
  processRpgEvent,
  sealDay,
  backfillAchievements,
  getObolosBalance,
  grantObolos,
  sealObolos,
  getRewards,
  saveReward,
  deleteReward,
  redeemReward,
} from '../../shared-logic/modules/rpg-handlers';
import { ACHIEVEMENT_OBOLOS } from '../../shared/achievements';

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

const TODAY = dateAgo(0);

/** Writes a raw event on an arbitrary local day, bypassing the engine. */
function seedEvent(db: Database.Database, moduleId: string, type: string, date: string, hhmm = '10:00', xp = 10): void {
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, 0, 1.0, 1.0, '{}', ?, NULL, ?)
  `).run(moduleId, type, xp, `${date} ${hhmm}:00`, `seed-${Math.random()}`);
}

function ledgerRows(db: Database.Database, reason?: string) {
  if (reason) {
    return db.prepare(
      'SELECT id, delta, reason, ref_id AS refId FROM obolos_ledger WHERE reason = ? ORDER BY created_at ASC'
    ).all(reason) as Array<{ id: string; delta: number; reason: string; refId: string | null }>;
  }
  return db.prepare(
    'SELECT id, delta, reason, ref_id AS refId FROM obolos_ledger ORDER BY created_at ASC'
  ).all() as Array<{ id: string; delta: number; reason: string; refId: string | null }>;
}

describe('sealDay óbolos', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('mints round(sealXp / 2), keyed to the sealed date', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', TODAY);

    const result = sealDay(db, TODAY, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.obolosGranted).toBe(sealObolos(result.xpAwarded));
    expect(result.obolosGranted).toBe(Math.round(result.xpAwarded / 2));
    expect(result.obolosGranted).toBeGreaterThan(0);

    const rows = ledgerRows(db, 'day_sealed');
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(result.obolosGranted);
    expect(rows[0].refId).toBe(TODAY);
  });

  it('mints exactly once per day — a re-seal attempt adds nothing', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    const first = sealDay(db, TODAY, TODAY);
    expect(first.ok).toBe(true);

    expect(sealDay(db, TODAY, TODAY)).toEqual({ ok: false, reason: 'already_sealed' });
    expect(ledgerRows(db, 'day_sealed')).toHaveLength(1);

    // Even a direct grant for the same date is refused by the ledger itself.
    expect(grantObolos(db, 'day_sealed', TODAY, 999)).toBe(0);
    expect(ledgerRows(db, 'day_sealed')).toHaveLength(1);
  });
});

describe('achievement óbolos', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('pays a flat amount once per unlocked achievement', () => {
    const result = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    expect(result.achievementIds.length).toBeGreaterThan(0);

    const rows = ledgerRows(db, 'achievement');
    expect(rows.map((r) => r.refId).sort()).toEqual([...result.achievementIds].sort());
    for (const row of rows) expect(row.delta).toBe(ACHIEVEMENT_OBOLOS);
  });

  it('does not pay again via the backfill sweep', () => {
    processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    const before = getObolosBalance(db);
    expect(before.earned).toBeGreaterThan(0);

    // The sweep only pays achievements it NEWLY unlocks — and each of those
    // exactly once, guarded by the (reason, ref_id) ledger key.
    const sweep = backfillAchievements(db);
    const after = getObolosBalance(db);
    expect(after.earned - before.earned).toBe(sweep.unlocked.length * ACHIEVEMENT_OBOLOS);

    // A second sweep unlocks nothing and mints nothing.
    backfillAchievements(db);
    expect(getObolosBalance(db)).toEqual(after);
  });
});

describe('rpg:getObolosBalance', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('reads zero on an empty ledger', () => {
    expect(getObolosBalance(db)).toEqual({ balance: 0, earned: 0, spent: 0 });
  });

  it('sums earnings and spends separately', () => {
    grantObolos(db, 'day_sealed', dateAgo(1), 20);
    grantObolos(db, 'achievement', 'first_step', 15);
    saveReward(db, { name: 'Té', cost: 10 });
    const reward = getRewards(db)[0];
    expect(redeemReward(db, reward.id)).toEqual({ ok: true, balance: 25 });

    expect(getObolosBalance(db)).toEqual({ balance: 25, earned: 35, spent: 10 });
  });
});

describe('rewards CRUD + redeem', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('upserts: create sanitised, then edit in place', () => {
    const created = saveReward(db, { name: '  2 h de jueguito  ', cost: 50.4, icon: 'sword' });
    expect(created).toMatchObject({ name: '2 h de jueguito', cost: 50, icon: 'sword', redeemedCount: 0 });

    const edited = saveReward(db, { id: created!.id, name: '3 h de jueguito', cost: 75 });
    expect(edited).toMatchObject({ id: created!.id, name: '3 h de jueguito', cost: 75 });
    expect(getRewards(db)).toHaveLength(1);
  });

  it('rejects unusable input', () => {
    expect(saveReward(db, { name: '   ', cost: 10 })).toBeNull();
    expect(saveReward(db, { name: 'Algo', cost: 0 })).toBeNull();
    expect(saveReward(db, { name: 'Algo' })).toBeNull();
    // A weird icon token degrades to null instead of being stored verbatim.
    expect(saveReward(db, { name: 'Algo', cost: 5, icon: '<script>' })!.icon).toBeNull();
  });

  it('refuses to redeem beyond the balance, without writing anything', () => {
    grantObolos(db, 'day_sealed', TODAY, 10);
    const reward = saveReward(db, { name: 'Delivery', cost: 120 })!;

    expect(redeemReward(db, reward.id)).toEqual({ ok: false, reason: 'insufficient' });
    expect(ledgerRows(db, 'reward_redeemed')).toHaveLength(0);
    expect(getObolosBalance(db).balance).toBe(10);
  });

  it('redeeming twice is two spends — deliberately NOT idempotent', () => {
    grantObolos(db, 'day_sealed', TODAY, 100);
    const reward = saveReward(db, { name: 'Capítulo extra', cost: 30 })!;

    expect(redeemReward(db, reward.id)).toEqual({ ok: true, balance: 70 });
    expect(redeemReward(db, reward.id)).toEqual({ ok: true, balance: 40 });
    expect(ledgerRows(db, 'reward_redeemed')).toHaveLength(2);
    expect(getRewards(db)[0].redeemedCount).toBe(2);

    // The fourth ten falls short: 40 - 30 = 10 < 30.
    expect(redeemReward(db, reward.id)).toEqual({ ok: true, balance: 10 });
    expect(redeemReward(db, reward.id)).toEqual({ ok: false, reason: 'insufficient' });
  });

  it('returns not_found for unknown ids', () => {
    grantObolos(db, 'day_sealed', TODAY, 100);
    expect(redeemReward(db, 'nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('soft delete hides the reward but keeps its ledger history', () => {
    grantObolos(db, 'day_sealed', TODAY, 100);
    const reward = saveReward(db, { name: 'Pedir delivery', cost: 40 })!;
    redeemReward(db, reward.id);

    expect(deleteReward(db, reward.id)).toEqual({ ok: true });
    expect(getRewards(db)).toHaveLength(0);
    // Retired from the counter, but never redeemable again…
    expect(redeemReward(db, reward.id)).toEqual({ ok: false, reason: 'not_found' });
    // …while the spend it produced stays in the book: append-only, always.
    expect(ledgerRows(db, 'reward_redeemed')).toHaveLength(1);
    expect(getObolosBalance(db)).toEqual({ balance: 60, earned: 100, spent: 40 });
    // Deleting twice is a no-op.
    expect(deleteReward(db, reward.id)).toEqual({ ok: false });
  });
});
