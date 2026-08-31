import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  CARD_PAYMENT_CATEGORY,
  computeBudgetStatus,
  computeCategorySpend,
  isBudgetMonthMet,
  listBudgets,
  monthRange,
  setBudget,
} from '../../../electron/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

let db: Database.Database;
let seq = 0;

function addExpense(opts: {
  amount: number;
  category: string;
  date: string;
  currency?: string;
  /** 0 = a card purchase whose statement has not landed yet. */
  impactsBalance?: number;
  source?: string;
  deleted?: boolean;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, impacts_balance, created_at, updated_at, deleted_at)
    VALUES (?, 'expense', ?, ?, ?, '', ?, 'cash', ?, 1, ?, ?, ?, ?)
  `).run(
    `tx${++seq}`,
    opts.amount,
    opts.currency ?? 'ARS',
    opts.category,
    opts.date,
    opts.source ?? 'manual',
    opts.impactsBalance ?? 1,
    now,
    now,
    opts.deleted ? now : null,
  );
}

beforeEach(() => {
  db = setupDb();
  seq = 0;
});

// ── setBudget ──────────────────────────────────────────────────────────────

describe('finance:setBudget', () => {
  it('creates, then updates, a single row per category', () => {
    expect(setBudget(db, 'Delivery', 50000)).toEqual({ ok: true, category: 'Delivery', monthlyLimit: 50000 });
    expect(setBudget(db, 'Delivery', 30000)).toEqual({ ok: true, category: 'Delivery', monthlyLimit: 30000 });

    const rows = listBudgets(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].monthlyLimit).toBe(30000);
  });

  it('stamps ISO timestamps, so last-write-wins sync can compare them as strings', () => {
    setBudget(db, 'Delivery', 50000);
    const row = db.prepare('SELECT created_at, updated_at FROM finance_budgets WHERE category = ?')
      .get('Delivery') as { created_at: string; updated_at: string };
    // A space instead of a 'T' is exactly the bug finance v13 had to migrate away.
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('the schema DEFAULTs are ISO too, so an insert that omits them cannot poison LWW', () => {
    // The sync merge writes rows straight into the table; a datetime('now')
    // default would hand it a space-separated stamp that always loses.
    db.prepare("INSERT INTO finance_budgets (category, monthly_limit) VALUES ('Delivery', 1)").run();
    const row = db.prepare('SELECT created_at, updated_at, deleted_at FROM finance_budgets WHERE category = ?')
      .get('Delivery') as { created_at: string; updated_at: string; deleted_at: string | null };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(row.deleted_at).toBeNull();
  });

  it('a null limit soft-deletes, so the removal travels through sync', () => {
    setBudget(db, 'Delivery', 50000);
    expect(setBudget(db, 'Delivery', null)).toEqual({ ok: true, category: 'Delivery', monthlyLimit: null });

    expect(listBudgets(db)).toHaveLength(0);
    const raw = db.prepare('SELECT deleted_at FROM finance_budgets WHERE category = ?')
      .get('Delivery') as { deleted_at: string | null };
    expect(raw.deleted_at).not.toBeNull();
  });

  it('re-setting a cleared budget revives the row instead of failing on the primary key', () => {
    setBudget(db, 'Delivery', 50000);
    setBudget(db, 'Delivery', null);
    expect(setBudget(db, 'Delivery', 20000)).toEqual({ ok: true, category: 'Delivery', monthlyLimit: 20000 });
    expect(listBudgets(db)).toEqual([expect.objectContaining({ category: 'Delivery', monthlyLimit: 20000 })]);
  });

  it('rejects junk instead of writing it', () => {
    expect(setBudget(db, '   ', 100)).toEqual({ ok: false, reason: 'invalid_category' });
    expect(setBudget(db, 'Delivery', -5)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(setBudget(db, 'Delivery', 'abc')).toEqual({ ok: false, reason: 'invalid_amount' });
    // The app writes these categories itself; budgeting them is meaningless.
    expect(setBudget(db, CARD_PAYMENT_CATEGORY, 100)).toEqual({ ok: false, reason: 'reserved_category' });
    expect(listBudgets(db)).toHaveLength(0);
  });
});

// ── getBudgetStatus ────────────────────────────────────────────────────────

describe('finance:getBudgetStatus', () => {
  it('reports spent / limit / pct per budgeted category, plus the totals', () => {
    setBudget(db, 'Delivery', 10000);
    setBudget(db, 'Transporte', 20000);
    addExpense({ amount: 4000, category: 'Delivery', date: '2026-08-05' });
    addExpense({ amount: 1000, category: 'Delivery', date: '2026-08-20' });
    addExpense({ amount: 5000, category: 'Transporte', date: '2026-08-10' });
    // Not budgeted — counts nowhere in this answer.
    addExpense({ amount: 99000, category: 'Compras', date: '2026-08-10' });

    const status = computeBudgetStatus(db, '2026-08');
    expect(status.categories).toEqual([
      { category: 'Delivery', limit: 10000, spent: 5000, pct: 50 },
      { category: 'Transporte', limit: 20000, spent: 5000, pct: 25 },
    ]);
    expect(status.totalLimit).toBe(30000);
    expect(status.totalSpent).toBe(10000);
  });

  it('keeps a budgeted category with zero spend, at 0%', () => {
    setBudget(db, 'Delivery', 10000);
    const status = computeBudgetStatus(db, '2026-08');
    expect(status.categories).toEqual([{ category: 'Delivery', limit: 10000, spent: 0, pct: 0 }]);
  });

  it('is empty when nothing is budgeted — a month with no limits has nothing to report', () => {
    addExpense({ amount: 5000, category: 'Delivery', date: '2026-08-05' });
    expect(computeBudgetStatus(db, '2026-08')).toEqual({
      month: '2026-08', categories: [], totalLimit: 0, totalSpent: 0,
    });
  });

  it('ignores other months and an invalid month string', () => {
    setBudget(db, 'Delivery', 10000);
    addExpense({ amount: 7000, category: 'Delivery', date: '2026-07-31' });
    addExpense({ amount: 3000, category: 'Delivery', date: '2026-09-01' });
    addExpense({ amount: 1000, category: 'Delivery', date: '2026-08-01' });

    expect(computeBudgetStatus(db, '2026-08').categories[0].spent).toBe(1000);
    expect(computeBudgetStatus(db, 'nonsense').categories).toEqual([]);
  });

  it('counts pending card purchases and ignores soft-deleted rows and dollars', () => {
    setBudget(db, 'Delivery', 10000);
    addExpense({ amount: 2000, category: 'Delivery', date: '2026-08-02' });
    // A card purchase whose statement has not landed: already spent, already counts.
    addExpense({ amount: 3000, category: 'Delivery', date: '2026-08-03', impactsBalance: 0 });
    addExpense({ amount: 9000, category: 'Delivery', date: '2026-08-04', deleted: true });
    // The wheel is a pesos-only picture; so is the budget. Adding USD would mean
    // inventing an exchange rate.
    addExpense({ amount: 50, category: 'Delivery', date: '2026-08-05', currency: 'USD' });

    expect(computeBudgetStatus(db, '2026-08').categories[0].spent).toBe(5000);
  });
});

// ── The number MUST be the wheel's number ──────────────────────────────────

describe('budget spend === the number the dashboard wheel draws', () => {
  it('matches computeCategorySpend, card purchases and Pago Tarjeta included', () => {
    setBudget(db, 'Delivery', 10000);
    setBudget(db, 'Supermercado', 80000);

    addExpense({ amount: 2500, category: 'Delivery', date: '2026-08-02' });
    addExpense({ amount: 4300, category: 'Delivery', date: '2026-08-09', impactsBalance: 0 });
    addExpense({ amount: 61000, category: 'Supermercado', date: '2026-08-14' });
    addExpense({ amount: 12000, category: 'Supermercado', date: '2026-08-22', source: 'recurring' });
    // Excluded from BOTH: counting the statement payment would double-count the
    // card purchases above.
    addExpense({ amount: 500000, category: CARD_PAYMENT_CATEGORY, date: '2026-08-28' });

    const wheel = new Map(computeCategorySpend(db, monthRange('2026-08')).map(c => [c.category, c.ARS]));
    const status = computeBudgetStatus(db, '2026-08');

    for (const cat of status.categories) {
      expect(cat.spent, `«${cat.category}» — la barra y la rueda tienen que decir lo mismo`)
        .toBe(wheel.get(cat.category));
    }
    expect(wheel.has(CARD_PAYMENT_CATEGORY)).toBe(false);
  });
});

// ── Month close ────────────────────────────────────────────────────────────

describe('BUDGET_MONTH_MET — the month-close reward', () => {
  it('detects a month closed inside every limit', () => {
    setBudget(db, 'Delivery', 10000);
    setBudget(db, 'Transporte', 20000);
    addExpense({ amount: 9999, category: 'Delivery', date: '2026-07-15' });
    addExpense({ amount: 1, category: 'Transporte', date: '2026-07-16' });

    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(true);
  });

  it('counts spending exactly ON the limit as met — the limit is inclusive', () => {
    setBudget(db, 'Delivery', 10000);
    addExpense({ amount: 10000, category: 'Delivery', date: '2026-07-15' });

    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(true);
  });

  it('one blown category sinks the whole month', () => {
    setBudget(db, 'Delivery', 10000);
    setBudget(db, 'Transporte', 20000);
    addExpense({ amount: 10001, category: 'Delivery', date: '2026-07-15' });
    addExpense({ amount: 1, category: 'Transporte', date: '2026-07-16' });

    const status = computeBudgetStatus(db, '2026-07');
    expect(isBudgetMonthMet(status)).toBe(false);
    expect(status.categories.find(c => c.category === 'Delivery')!.pct).toBeGreaterThan(100);
  });

  it('no budgets at all is NOT a met month — there was nothing to respect', () => {
    addExpense({ amount: 1, category: 'Delivery', date: '2026-07-15' });
    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(false);
  });

  it('a budget cleared before the month closed stops counting against it', () => {
    setBudget(db, 'Delivery', 10000);
    setBudget(db, 'Transporte', 20000);
    addExpense({ amount: 50000, category: 'Delivery', date: '2026-07-15' });
    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(false);

    setBudget(db, 'Delivery', null);
    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(true);
  });

  it('answers for the month asked about, not for today', () => {
    setBudget(db, 'Delivery', 10000);
    addExpense({ amount: 50000, category: 'Delivery', date: '2026-08-15' });

    // July is clean; August is blown. The month string is the only thing that
    // decides which one the renderer celebrates.
    expect(computeBudgetStatus(db, '2026-07').month).toBe('2026-07');
    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-07'))).toBe(true);
    expect(isBudgetMonthMet(computeBudgetStatus(db, '2026-08'))).toBe(false);
  });
});
