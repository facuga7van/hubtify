import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../../shared-logic/db';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { notificationsMigrations } from '../../../shared-logic/modules/notifications.schema';
import { grantObolos, getObolosBalance, redeemReward, purchaseShopItem } from '../../../electron/ipc/rpg-handlers';
import {
  mergeQuestDataInto,
  mergeNutritionFoods,
  mergeNutritionDataInto,
  mergeFinanceDataInto,
  mergeCauldronDataInto,
  clearUserDataInto,
  normStamp,
  isNewerStamp,
} from '../../../electron/modules/sync.ipc';

/**
 * Scenarios from the adversarial sync review (review-sync.md). Each `describe`
 * is one finding; each `it` is the exact data-loss path it described, replayed
 * against an in-memory database.
 */

const T0 = '2026-06-01T10:00:00.000Z';
const T1 = '2026-06-02T10:00:00.000Z';
const T2 = '2026-06-03T10:00:00.000Z';

type Mig = { up: string };
function dbWith(...sets: Mig[][]): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const set of sets) for (const m of set) db.exec(m.up);
  return db;
}

function bootAll(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, questsMigrations);
  applyMigrations(db, nutritionMigrations);
  applyMigrations(db, financeMigrations);
  applyMigrations(db, notificationsMigrations);
  applyMigrations(db, cauldronMigrations);
  return db;
}

const count = (db: Database.Database, table: string, where = '1=1') =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get() as { c: number }).c;

// ── [ALTO] habits: shields / specific days vs an old client ────────────────
describe('habits merge keeps shields and specific days an old client never mentions', () => {
  const seedHabit = (db: Database.Database) =>
    db.prepare(`INSERT INTO habits (id, name, frequency, times_per_week, specific_days, shield_count, last_shield_streak, created_at, updated_at)
                VALUES ('h1', 'Gym', 'weekly', 3, '1,3,5', 2, 14, ?, ?)`).run(T0, T1);

  it('a newer remote WITHOUT shieldCount/lastShieldStreak/specificDays leaves the local ones intact', () => {
    const db = dbWith(questsMigrations);
    seedHabit(db);
    mergeQuestDataInto(db, {
      habits: [{ id: 'h1', name: 'Gym (renamed)', frequency: 'weekly', timesPerWeek: 3, createdAt: T0, updatedAt: T2, deletedAt: null }],
    } as never);
    const row = db.prepare('SELECT name, specific_days, shield_count, last_shield_streak FROM habits WHERE id = ?').get('h1');
    expect(row).toEqual({ name: 'Gym (renamed)', specific_days: '1,3,5', shield_count: 2, last_shield_streak: 14 });
  });

  it('an EXPLICIT remote value still wins by LWW (null clears specific_days, 0 spends the shields)', () => {
    const db = dbWith(questsMigrations);
    seedHabit(db);
    mergeQuestDataInto(db, {
      habits: [{ id: 'h1', name: 'Gym', frequency: 'weekly', timesPerWeek: 3, specificDays: null, shieldCount: 0, lastShieldStreak: 21, createdAt: T0, updatedAt: T2, deletedAt: null }],
    } as never);
    const row = db.prepare('SELECT specific_days, shield_count, last_shield_streak FROM habits WHERE id = ?').get('h1');
    expect(row).toEqual({ specific_days: null, shield_count: 0, last_shield_streak: 21 });
  });
});

// ── [ALTO] food_log: the edit must travel with the stamp ───────────────────
describe('food_log merge applies a remote edit, not only its tombstone', () => {
  const exportFoodLog = (db: Database.Database) => db.prepare(`
    SELECT f.id, f.sync_id, f.date, f.time, f.description, f.calories, f.source,
           f.frequent_food_id, ff.sync_id AS frequent_food_sync_id,
           f.ai_breakdown, f.meal, f.is_event, f.event_kcal_min, f.event_kcal_max,
           f.protein_g, f.updated_at, f.deleted_at
    FROM food_log f LEFT JOIN frequent_foods ff ON ff.id = f.frequent_food_id
  `).all() as Array<Record<string, unknown>>;

  it('A corrects 800 → 1200 kcal (+60 g protein); B learns 1200', () => {
    const dbA = dbWith(nutritionMigrations);
    dbA.prepare("INSERT INTO food_log (sync_id, date, time, description, calories, source, meal, updated_at) VALUES ('m1', '2026-06-01', '21:00', 'asado', 800, 'manual', 'dinner', ?)").run(T0);
    const dbB = dbWith(nutritionMigrations);
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });

    dbA.prepare("UPDATE food_log SET calories = 1200, protein_g = 60, description = 'asado completo', updated_at = ? WHERE sync_id = 'm1'").run(T1);
    const r = mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });

    expect(r.changed).toBe(true);
    expect(dbB.prepare("SELECT calories, protein_g, description, meal, updated_at FROM food_log WHERE sync_id = 'm1'").get())
      .toEqual({ calories: 1200, protein_g: 60, description: 'asado completo', meal: 'dinner', updated_at: T1 });
  });

  it('an event converted back to a normal meal crosses too', () => {
    const dbA = dbWith(nutritionMigrations);
    dbA.prepare("INSERT INTO food_log (sync_id, date, time, description, calories, source, is_event, event_kcal_min, event_kcal_max, updated_at) VALUES ('m2', '2026-06-01', '21:00', 'asado', 1500, 'manual', 1, 1000, 2000, ?)").run(T0);
    const dbB = dbWith(nutritionMigrations);
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });
    dbA.prepare("UPDATE food_log SET is_event = 0, event_kcal_min = NULL, event_kcal_max = NULL, updated_at = ? WHERE sync_id = 'm2'").run(T1);
    mergeNutritionFoods(dbB, { foodLog: exportFoodLog(dbA) });
    expect(dbB.prepare("SELECT is_event, event_kcal_min, event_kcal_max FROM food_log WHERE sync_id = 'm2'").get())
      .toEqual({ is_event: 0, event_kcal_min: null, event_kcal_max: null });
  });

  it('a newer payload from a client that predates protein/event columns keeps the local values', () => {
    const dbB = dbWith(nutritionMigrations);
    dbB.prepare("INSERT INTO food_log (sync_id, date, time, description, calories, source, meal, protein_g, is_event, updated_at) VALUES ('m3', '2026-06-01', '21:00', 'asado', 800, 'manual', 'dinner', 45, 1, ?)").run(T0);
    // Old export shape: no meal/is_event/event_kcal_*/protein_g keys at all.
    mergeNutritionFoods(dbB, { foodLog: [{ id: 1, sync_id: 'm3', date: '2026-06-01', time: '21:00', description: 'asado grande', calories: 900, source: 'manual', frequent_food_id: null, ai_breakdown: null, updated_at: T1, deleted_at: null }] });
    expect(dbB.prepare("SELECT calories, description, meal, protein_g, is_event FROM food_log WHERE sync_id = 'm3'").get())
      .toEqual({ calories: 900, description: 'asado grande', meal: 'dinner', protein_g: 45, is_event: 1 });
  });
});

// ── [ALTO] per-table isolation for finance / nutrition / cauldron ─────────
describe('finance merge isolates each table and drops unusable rows', () => {
  it('a transaction without `type` is skipped; the rest of finance lands; no throw', () => {
    const db = dbWith(financeMigrations);
    let result: { changed: boolean } | undefined;
    expect(() => {
      result = mergeFinanceDataInto(db, {
        transactions: [
          { id: 'tx-bad', amount: 100, date: '2026-06-01', updatedAt: T1 },
          { id: 'tx-ok', type: 'expense', amount: 50, date: '2026-06-01', updatedAt: T1 },
        ],
        accounts: [{ id: 'acc-bank', name: 'Banco', kind: 'bank', updatedAt: T1 }],
        budgets: [{ category: 'Delivery', monthlyLimit: 1000, updatedAt: T1 }],
        creditCards: [{ id: 'cc1', name: 'Visa', closingDay: 20, updatedAt: T1 }],
      });
    }).not.toThrow();
    expect(result?.changed).toBe(true);
    expect(db.prepare('SELECT id FROM finance_transactions').all()).toEqual([{ id: 'tx-ok' }]);
    expect(count(db, 'finance_accounts', "id = 'acc-bank'")).toBe(1);
    expect(count(db, 'finance_budgets')).toBe(1);
    expect(count(db, 'finance_credit_cards')).toBe(1);
  });

  it('a CHECK violation inside one table rolls back only that table', () => {
    const db = dbWith(financeMigrations);
    db.prepare("INSERT INTO finance_accounts (id, name, kind, updated_at) VALUES ('acc-check', 'Cripto', 'wallet', ?)").run(T0);
    expect(() => mergeFinanceDataInto(db, {
      accounts: [
        { id: 'acc-ok', name: 'Banco', kind: 'bank', updatedAt: T1 },
        // newer remote, passes the NOT NULL guard, the UPDATE fails
        // CHECK (kind IN ('cash','bank','wallet')) — INSERT OR IGNORE would
        // have swallowed it, an UPDATE throws and the savepoint unwinds.
        { id: 'acc-check', name: 'Cripto', kind: 'crypto', updatedAt: T1 },
      ],
      loans: [{ id: 'l1', personName: 'Ana', direction: 'lent', amount: 100, date: '2026-06-01', updatedAt: T1 }],
    })).not.toThrow();
    expect(count(db, 'finance_accounts', "id = 'acc-ok'")).toBe(0);
    expect(db.prepare("SELECT kind FROM finance_accounts WHERE id = 'acc-check'").get()).toEqual({ kind: 'wallet' });
    expect(count(db, 'finance_loans')).toBe(1);
  });

  it('carries recurring.frequency (the cadence) and keeps it when an old client omits it', () => {
    const db = dbWith(financeMigrations);
    mergeFinanceDataInto(db, { recurring: [{ id: 'r1', name: 'Seguro', type: 'expense', amount: 100, frequency: 'bimonthly', updatedAt: T0 }] });
    mergeFinanceDataInto(db, { recurring: [{ id: 'r1', name: 'Seguro auto', type: 'expense', amount: 100, updatedAt: T1 }] });
    expect(db.prepare("SELECT name, frequency FROM finance_recurring WHERE id = 'r1'").get()).toEqual({ name: 'Seguro auto', frequency: 'bimonthly' });
  });

  it('a transaction with an unknown type is skipped as a row, not as a table', () => {
    const db = dbWith(financeMigrations);
    mergeFinanceDataInto(db, {
      transactions: [
        { id: 'tx-ok', type: 'expense', amount: 50, date: '2026-06-01', updatedAt: T1 },
        { id: 'tx-gift', type: 'gift', amount: 50, date: '2026-06-01', updatedAt: T1 },
      ],
    });
    expect(db.prepare('SELECT id FROM finance_transactions').all()).toEqual([{ id: 'tx-ok' }]);
  });

  it('carries the finance v18 columns and treats their absence as no opinion', () => {
    const db = dbWith(financeMigrations);
    mergeFinanceDataInto(db, {
      transactions: [{ id: 'tx1', type: 'expense', amount: 50, date: '2026-06-01', fxRate: 1200, fxRateSource: 'day', statementPeriod: '2026-07', updatedAt: T0 }],
      recurring: [{ id: 'r1', name: 'Alquiler', type: 'expense', amount: 100, accountId: 'acc-1', anchorMonth: '2026-03', updatedAt: T0 }],
    });
    // Old client (no v18 keys), newer stamp: the v18 columns survive.
    mergeFinanceDataInto(db, {
      transactions: [{ id: 'tx1', type: 'expense', amount: 60, date: '2026-06-01', updatedAt: T1 }],
      recurring: [{ id: 'r1', name: 'Alquiler', type: 'expense', amount: 120, updatedAt: T1 }],
    });
    expect(db.prepare("SELECT amount, fx_rate, fx_rate_source, statement_period FROM finance_transactions WHERE id = 'tx1'").get())
      .toEqual({ amount: 60, fx_rate: 1200, fx_rate_source: 'day', statement_period: '2026-07' });
    expect(db.prepare("SELECT amount, account_id, anchor_month FROM finance_recurring WHERE id = 'r1'").get())
      .toEqual({ amount: 120, account_id: 'acc-1', anchor_month: '2026-03' });
    // New client, explicit null: cleared.
    mergeFinanceDataInto(db, {
      transactions: [{ id: 'tx1', type: 'expense', amount: 60, date: '2026-06-01', statementPeriod: null, updatedAt: T2 }],
      recurring: [{ id: 'r1', name: 'Alquiler', type: 'expense', amount: 120, accountId: null, anchorMonth: null, updatedAt: T2 }],
    });
    expect(db.prepare("SELECT statement_period FROM finance_transactions WHERE id = 'tx1'").get()).toEqual({ statement_period: null });
    expect(db.prepare("SELECT account_id, anchor_month FROM finance_recurring WHERE id = 'r1'").get()).toEqual({ account_id: null, anchor_month: null });
  });

  it('orphan FK rows (payment/statement/history without parent) are dropped, not fatal', () => {
    const db = dbWith(financeMigrations);
    expect(() => mergeFinanceDataInto(db, {
      loanPayments: [{ id: 'p-orphan', loanId: 'ghost', amount: 10, date: '2026-06-01', updatedAt: T1 }],
      creditCardStatements: [{ id: 's-orphan', creditCardId: 'ghost', periodMonth: '2026-06', updatedAt: T1 }],
      recurringHistory: [{ id: 'h-orphan', recurringId: 'ghost', amount: 10, effectiveDate: '2026-06-01' }],
      categories: [{ name: 'Mascotas', updatedAt: T1 }],
    })).not.toThrow();
    expect(count(db, 'finance_loan_payments')).toBe(0);
    expect(count(db, 'finance_credit_card_statements')).toBe(0);
    expect(count(db, 'finance_recurring_amount_history')).toBe(0);
    expect(count(db, 'finance_categories', "name = 'Mascotas'")).toBe(1);
  });
});

describe('nutrition merge isolates each table and drops unusable rows', () => {
  it('a daily summary without bmr is skipped; metrics still land', () => {
    const db = dbWith(nutritionMigrations);
    let result: { changed: boolean } | undefined;
    expect(() => {
      result = mergeNutritionDataInto(db, {
        dailySummary: [
          { date: '2026-06-01', tdee: 2000, total_calories_in: 1500, balance: 500, updated_at: T1 },
          { date: '2026-06-02', bmr: 1600, tdee: 2000, total_calories_in: 1500, balance: 500, updated_at: T1 },
        ],
        dailyMetrics: [{ date: '2026-06-01', steps: 5000, gym: 1, updated_at: T1 }, { steps: 1 }],
        weeklyMetrics: [{ date: '2026-06-01', weight_kg: 80, waist_cm: null, updated_at: T1 }],
        favoriteFoods: [{ id: 'f1', description: 'Yogur', calories: 120, createdAt: T0, updatedAt: T1 }, { id: 'f-bad', createdAt: T0 }],
      });
    }).not.toThrow();
    expect(result?.changed).toBe(true);
    expect(db.prepare('SELECT date FROM nutrition_daily_summary').all()).toEqual([{ date: '2026-06-02' }]);
    expect(count(db, 'nutrition_daily_metrics')).toBe(1);
    expect(count(db, 'nutrition_weekly_metrics')).toBe(1);
    expect(count(db, 'favorite_foods')).toBe(1);
  });
});

describe('cauldron merge isolates each table and drops unusable rows', () => {
  it('a preset without name is skipped; sessions still land', () => {
    const db = dbWith(cauldronMigrations);
    let result: { changed: boolean } | undefined;
    expect(() => {
      result = mergeCauldronDataInto(db, {
        cauldron_presets: [
          { id: 'p-bad', work_minutes: 25, created_at: T0, updated_at: T0 },
          { id: 'p-ok', name: 'Deep', work_minutes: 90, break_minutes: 10, long_break_minutes: 30, cycles_before_long: 2, is_default: 0, created_at: T0, updated_at: T0 },
        ],
        cauldron_sessions: [{ id: 's1', preset_id: 'p-ok', type: 'work', duration_minutes: 25, completed: 1, started_at: '2026-06-01 10:00:00', created_at: T0, updated_at: T0 }],
      });
    }).not.toThrow();
    expect(result?.changed).toBe(true);
    expect(count(db, 'cauldron_presets', "id = 'p-ok'")).toBe(1);
    expect(count(db, 'cauldron_presets', "id = 'p-bad'")).toBe(0);
    expect(count(db, 'cauldron_sessions')).toBe(1);
  });
});

describe('rpgEvents merge validates each row instead of dropping the 90-day batch', () => {
  it('one malformed event does not discard its siblings', () => {
    const db = bootAll();
    mergeQuestDataInto(db, {
      rpgEvents: [
        { syncId: 'e-bad', moduleId: 'quests', createdAt: T0 }, // no eventType
        { syncId: 'e-ok', moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 5, hpChange: 0, comboMultiplier: 1, bonusMultiplier: 1, payload: '{}', createdAt: T0 },
      ],
    } as never);
    expect(db.prepare('SELECT sync_id FROM rpg_events').all()).toEqual([{ sync_id: 'e-ok' }]);
  });
});

// ── obolos ledger: the merge never hides a spend; the engine holds the line ─
describe('obolos ledger merge (documented trade-off)', () => {
  const today = new Date().toLocaleDateString('en-CA');

  it('two devices spending against the same pre-sync balance converge negative, and spends are refused until it recovers', () => {
    const db = bootAll();
    grantObolos(db, 'day_sealed', 'seal-2026-06-01', 400);
    db.prepare("INSERT INTO rewards (id, name, cost, created_at, updated_at) VALUES ('rw-200', 'Jueguito', 200, ?, ?)").run(T0, T0);
    db.prepare("INSERT INTO rewards (id, name, cost, created_at, updated_at) VALUES ('rw-50', 'Cafe', 50, ?, ?)").run(T0, T0);
    // B (this device) redeems 200 → 200 left.
    expect(redeemReward(db, 'rw-200')).toEqual({ ok: true, balance: 200 });

    // A redeemed 300 against the same 400 before syncing. Union by id: the
    // spend is real and must survive; the balance goes to -100.
    const r = mergeQuestDataInto(db, {
      obolosLedger: [
        { id: 'spend-on-A', delta: -300, reason: 'reward_redeemed', refId: 'rw-300', createdAt: T1, updatedAt: T1 },
        // Same earning minted on A under another uuid: the (reason, ref_id) guard drops it.
        { id: 'earn-dup-on-A', delta: 400, reason: 'day_sealed', refId: 'seal-2026-06-01', createdAt: T0, updatedAt: T0 },
      ],
    } as never);
    expect(r.changed).toBe(true);
    expect(getObolosBalance(db).balance).toBe(-100);

    // The engine, not the merge, refuses further spends.
    expect(redeemReward(db, 'rw-50')).toEqual({ ok: false, reason: 'insufficient' });
    expect(purchaseShopItem(db, 'seal_stag', today)).toEqual({ ok: false, reason: 'insufficient' });

    // …until a new earning brings the balance back over the cost.
    grantObolos(db, 'day_sealed', 'seal-2026-06-02', 200);
    expect(getObolosBalance(db).balance).toBe(100);
    expect(redeemReward(db, 'rw-50')).toEqual({ ok: true, balance: 50 });
  });
});

// ── [MEDIO] nutrition_profile: absent keys carry no opinion ───────────────
describe('nutrition_profile merge keeps every column an old client omits', () => {
  const seedProfile = (db: Database.Database) =>
    db.prepare(`INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, day_cutoff_hour, protein_target_g, updated_at)
                VALUES (1, 30, 'M', 180, 85, 'moderate', 400, 450, 0.05, '1996-01-01', 3, 0, '{"custom":true}', 6, 150, ?)`).run(T0);

  it('remote without day_cutoff_hour / meal_schedule / gym_calories keeps cutoff 6 and the rest', () => {
    const db = dbWith(nutritionMigrations);
    seedProfile(db);
    // pre-v11 export: SELECT * from a schema that had none of the newer columns
    mergeNutritionDataInto(db, {
      profile: { id: 1, age: 30, sex: 'M', height_cm: 180, initial_weight_kg: 82, activity_level: 'moderate', deficit_target_kcal: 400, updated_at: T1 },
    });
    expect(db.prepare('SELECT initial_weight_kg, day_cutoff_hour, meal_schedule, gym_calories, step_calories_factor, date_of_birth, weight_check_day, weight_popup_enabled, protein_target_g, updated_at FROM nutrition_profile WHERE id = 1').get())
      .toEqual({ initial_weight_kg: 82, day_cutoff_hour: 6, meal_schedule: '{"custom":true}', gym_calories: 450, step_calories_factor: 0.05, date_of_birth: '1996-01-01', weight_check_day: 3, weight_popup_enabled: 0, protein_target_g: 150, updated_at: T1 });
  });

  it('an explicit remote value still wins (cutoff 0 = strict midnight)', () => {
    const db = dbWith(nutritionMigrations);
    seedProfile(db);
    mergeNutritionDataInto(db, { profile: { age: 30, sex: 'M', height_cm: 180, initial_weight_kg: 85, activity_level: 'moderate', day_cutoff_hour: 0, protein_target_g: null, updated_at: T1 } });
    expect(db.prepare('SELECT day_cutoff_hour, protein_target_g FROM nutrition_profile WHERE id = 1').get())
      .toEqual({ day_cutoff_hour: 0, protein_target_g: null });
  });

  it('a first-time profile missing a NOT NULL column is skipped instead of throwing', () => {
    const db = dbWith(nutritionMigrations);
    expect(() => mergeNutritionDataInto(db, { profile: { age: 30, sex: 'M', updated_at: T1 } })).not.toThrow();
    expect(count(db, 'nutrition_profile')).toBe(0);
  });
});

// ── [MEDIO] stamps written by datetime('now') on old clients ──────────────
describe('normStamp / isNewerStamp', () => {
  it("converts SQLite datetime('now') to ISO and leaves ISO alone", () => {
    expect(normStamp('2026-09-01 12:00:00')).toBe('2026-09-01T12:00:00.000Z');
    expect(normStamp('2026-09-01T09:00:00.000Z')).toBe('2026-09-01T09:00:00.000Z');
    expect(normStamp(null)).toBeNull();
    expect(normStamp(undefined)).toBeUndefined();
  });

  it("'2026-09-01 12:00:00' vs '2026-09-01T09:00:00.000Z' compares by time, not by 0x20 < 0x54", () => {
    expect(isNewerStamp('2026-09-01 12:00:00', '2026-09-01T09:00:00.000Z')).toBe(true);
    expect(isNewerStamp('2026-09-01T09:00:00.000Z', '2026-09-01 12:00:00')).toBe(false);
    expect(isNewerStamp('2026-09-01 12:00:00', '2026-09-01 12:00:00')).toBe(false);
    expect(isNewerStamp(T1, null)).toBe(true);
    expect(isNewerStamp(null, T1)).toBe(false);
  });

  it('a loan payment deleted at 12:00 (space) beats a local edit at 09:00 (ISO)', () => {
    const db = dbWith(financeMigrations);
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, date, updated_at) VALUES ('l1', 'Ana', 'lent', 'single', 100, '2026-06-01', ?)").run(T0);
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, date, updated_at) VALUES ('p1', 'l1', 10, '2026-06-01', '2026-09-01T09:00:00.000Z')").run();
    mergeFinanceDataInto(db, {
      loanPayments: [{ id: 'p1', loanId: 'l1', amount: 10, date: '2026-06-01', updatedAt: '2026-09-01 12:00:00', deletedAt: '2026-09-01 12:00:00' }],
    });
    expect(db.prepare("SELECT deleted_at, updated_at FROM finance_loan_payments WHERE id = 'p1'").get())
      .toEqual({ deleted_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z' });
  });

  it('a stale remote in space format does NOT beat a newer local ISO edit', () => {
    const db = dbWith(financeMigrations);
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, date, updated_at) VALUES ('l1', 'Ana', 'lent', 'single', 100, '2026-06-01', ?)").run(T0);
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, date, updated_at) VALUES ('p1', 'l1', 10, '2026-06-01', '2026-09-01T15:00:00.000Z')").run();
    mergeFinanceDataInto(db, {
      loanPayments: [{ id: 'p1', loanId: 'l1', amount: 10, date: '2026-06-01', updatedAt: '2026-09-01 12:00:00', deletedAt: '2026-09-01 12:00:00' }],
    });
    expect(db.prepare("SELECT deleted_at FROM finance_loan_payments WHERE id = 'p1'").get()).toEqual({ deleted_at: null });
  });
});

// ── [BAJO] cauldron_sessions: abandoned / task_id / deleted_at travel ─────
describe('cauldron_sessions merge applies newer remote state after the insert', () => {
  const seedSession = (db: Database.Database) =>
    db.prepare("INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at) VALUES ('s1', 'preset-classic', 'work', 25, 0, '2026-06-01 10:00:00', ?, ?)").run(T0, T0);

  it('abandoned = 1 on a newer remote is learned locally', () => {
    const db = dbWith(cauldronMigrations);
    seedSession(db);
    const r = mergeCauldronDataInto(db, {
      cauldron_sessions: [{ id: 's1', preset_id: 'preset-classic', type: 'work', duration_minutes: 25, completed: 0, abandoned: 1, task_id: 't9', completed_at: '2026-06-01 10:07:00', started_at: '2026-06-01 10:00:00', created_at: T0, updated_at: T1, deleted_at: null }],
    });
    expect(r.changed).toBe(true);
    expect(db.prepare("SELECT abandoned, task_id, completed_at, updated_at FROM cauldron_sessions WHERE id = 's1'").get())
      .toEqual({ abandoned: 1, task_id: 't9', completed_at: '2026-06-01 10:07:00', updated_at: T1 });
  });

  it('a newer remote soft-delete is learned; an older one is ignored', () => {
    const db = dbWith(cauldronMigrations);
    seedSession(db);
    const base = { id: 's1', preset_id: 'preset-classic', type: 'work', duration_minutes: 25, completed: 0, started_at: '2026-06-01 10:00:00', created_at: T0 };
    mergeCauldronDataInto(db, { cauldron_sessions: [{ ...base, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-01T00:00:00.000Z' }] });
    expect(db.prepare("SELECT deleted_at FROM cauldron_sessions WHERE id = 's1'").get()).toEqual({ deleted_at: null });
    mergeCauldronDataInto(db, { cauldron_sessions: [{ ...base, updated_at: T2, deleted_at: T2 }] });
    expect(db.prepare("SELECT deleted_at FROM cauldron_sessions WHERE id = 's1'").get()).toEqual({ deleted_at: T2 });
  });

  it('a newer remote from a client without `abandoned`/`task_id` keeps the local scar', () => {
    const db = dbWith(cauldronMigrations);
    seedSession(db);
    db.prepare("UPDATE cauldron_sessions SET abandoned = 1, task_id = 't1' WHERE id = 's1'").run();
    mergeCauldronDataInto(db, {
      cauldron_sessions: [{ id: 's1', preset_id: 'preset-classic', type: 'work', duration_minutes: 25, completed: 0, started_at: '2026-06-01 10:00:00', created_at: T0, updated_at: T1, deleted_at: null }],
    });
    expect(db.prepare("SELECT abandoned, task_id FROM cauldron_sessions WHERE id = 's1'").get()).toEqual({ abandoned: 1, task_id: 't1' });
  });
});

// ── [BAJO] tasks.completed_at arrives in the v11 local-naive format ───────
describe('tasks/subtasks completed_at is normalised to the v11 local format on merge', () => {
  const localOf = (db: Database.Database, iso: string) =>
    (db.prepare("SELECT datetime(?, 'localtime') AS v").get(iso) as { v: string }).v;

  it('a UTC ISO completedAt from an old client lands as datetime(x, "localtime")', () => {
    const db = dbWith(questsMigrations);
    const iso = '2026-09-02T02:00:00.000Z';
    mergeQuestDataInto(db, {
      tasks: [{ id: 't1', name: 'Late', status: 1, completedAt: iso, createdAt: T0, updatedAt: T1, deletedAt: null }],
      subtasks: [{ id: 's1', taskId: 't1', name: 'Sub', status: 1, completedAt: iso, createdAt: T0, updatedAt: T1, deletedAt: null }],
    } as never);
    const expected = localOf(db, iso);
    expect(expected).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get('t1')).toEqual({ completed_at: expected });
    expect(db.prepare('SELECT completed_at FROM subtasks WHERE id = ?').get('s1')).toEqual({ completed_at: expected });
  });

  it('a naive local stamp and a bare date pass through untouched (also on UPDATE)', () => {
    const db = dbWith(questsMigrations);
    mergeQuestDataInto(db, {
      tasks: [{ id: 't1', name: 'A', status: 1, completedAt: '2026-09-01 23:00:00', createdAt: T0, updatedAt: T0, deletedAt: null }],
      subtasks: [{ id: 's1', taskId: 't1', name: 'Sub', status: 1, completedAt: '2026-09-01', createdAt: T0, updatedAt: T0, deletedAt: null }],
    } as never);
    expect(db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get('t1')).toEqual({ completed_at: '2026-09-01 23:00:00' });
    expect(db.prepare('SELECT completed_at FROM subtasks WHERE id = ?').get('s1')).toEqual({ completed_at: '2026-09-01' });

    const iso = '2026-09-02T02:00:00.000Z';
    mergeQuestDataInto(db, {
      tasks: [{ id: 't1', name: 'A', status: 1, completedAt: iso, createdAt: T0, updatedAt: T2, deletedAt: null }],
    } as never);
    expect(db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get('t1')).toEqual({ completed_at: localOf(db, iso) });
  });
});

// ── [BAJO] clearUserData: re-seed «Efectivo» with a 1970 stamp, drop equipment ──
describe('clearUserData', () => {
  const EPOCH = '1970-01-01T00:00:00.000Z';

  it('re-seeds account-cash-default with the epoch stamp so any real edit/delete wins', () => {
    const db = bootAll();
    db.prepare("DELETE FROM finance_accounts").run();
    db.prepare("INSERT INTO finance_accounts (id, name, updated_at) VALUES ('acc-x', 'Banco', ?)").run(T0);
    clearUserDataInto(db);
    expect(db.prepare('SELECT id, name, kind, currency, initial_balance, account_order, created_at, updated_at, deleted_at FROM finance_accounts').all())
      .toEqual([{ id: 'account-cash-default', name: 'Efectivo', kind: 'cash', currency: 'ARS', initial_balance: 0, account_order: 0, created_at: EPOCH, updated_at: EPOCH, deleted_at: null }]);

    // The other device deleted it on Monday: the tombstone must beat the seed.
    mergeFinanceDataInto(db, { accounts: [{ id: 'account-cash-default', name: 'Efectivo', kind: 'cash', updatedAt: T1, deletedAt: T1 }] });
    expect(db.prepare("SELECT deleted_at FROM finance_accounts WHERE id = 'account-cash-default'").get()).toEqual({ deleted_at: T1 });
  });

  it('drops equipped_* from app_state but keeps last_uid', () => {
    const db = bootAll();
    const put = db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
    put.run('last_uid', 'uid-A');
    put.run('equipped_seal_style', 'seal_wax_red');
    put.run('equipped_frame', 'frame_gold');
    put.run('equipped_background', 'bg_parchment');
    put.run('dollar_visible_types', '["blue"]');
    clearUserDataInto(db);
    const keys = (db.prepare('SELECT key FROM app_state ORDER BY key').all() as Array<{ key: string }>).map(k => k.key);
    expect(keys).toEqual(['last_uid']);
  });

  it('still empties every user table and re-seeds the singletons', () => {
    const db = bootAll();
    db.prepare("INSERT INTO tasks (id, name, created_at, updated_at) VALUES ('t1', 'X', ?, ?)").run(T0, T0);
    db.prepare("INSERT INTO finance_transactions (id, type, amount, date, created_at, updated_at) VALUES ('tx', 'expense', 1, '2026-06-01', ?, ?)").run(T0, T0);
    clearUserDataInto(db);
    expect(count(db, 'tasks')).toBe(0);
    expect(count(db, 'finance_transactions')).toBe(0);
    expect(count(db, 'player_stats')).toBe(1);
    expect(count(db, 'user_profile')).toBe(1);
    expect(count(db, 'cauldron_presets')).toBe(3);
  });
});
