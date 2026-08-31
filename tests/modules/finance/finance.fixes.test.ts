import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  addMonthsClamped,
  addMonthsToMonth,
  aggregateByCategory,
  computeExpenseBreakdown,
  computeMonthlyBalance,
  dateInMonthClamped,
  generateRecurringForMonth,
  getStatementPeriod,
  isValidDateString,
  isValidMonthString,
  monthRange,
  monthRangeBetween,
  parseNonEmptyString,
  parsePositiveAmount,
  recurringTransactionId,
  sumByCurrency,
} from '../../../electron/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

/**
 * A migration by version, never "the last one in the array" — these tests are
 * about what a specific migration does, and every new migration used to break
 * them by moving what `length - 1` points at.
 */
function migration(version: number) {
  const found = financeMigrations.find((m) => m.version === version);
  if (!found) throw new Error(`no finance migration v${version}`);
  return found;
}

function addTx(db: Database.Database, tx: {
  id: string;
  type?: 'expense' | 'income';
  amount: number;
  currency?: string;
  category?: string;
  date: string;
  impactsBalance?: number;
  installmentGroupId?: string | null;
  creditCardId?: string | null;
  billedAmountArs?: number | null;
  deletedAt?: string | null;
}): void {
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       installments, installment_group_id, for_third_party, credit_card_id, impacts_balance,
       billed_amount_ars, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, '', ?, 'cash', 'manual', 1, ?, 0, ?, ?, ?, ?, ?, ?)
  `).run(
    tx.id,
    tx.type ?? 'expense',
    tx.amount,
    tx.currency ?? 'ARS',
    tx.category ?? 'Otros',
    tx.date,
    tx.installmentGroupId ?? null,
    tx.creditCardId ?? null,
    tx.impactsBalance ?? 1,
    tx.billedAmountArs ?? null,
    now,
    now,
    tx.deletedAt ?? null,
  );
}

// ── Date helpers ───────────────────────────────────────────────────────────

describe('installment date clamping', () => {
  it('keeps one instalment per month when starting on the 31st', () => {
    const dates = Array.from({ length: 6 }, (_, i) => addMonthsClamped('2026-01-31', i));
    expect(dates).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31',
      '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
  });

  it('handles leap years', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('rolls over the year boundary', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('supports the credit-card one-month offset', () => {
    expect(addMonthsClamped('2026-01-31', 0 + 1)).toBe('2026-02-28');
  });

  it('clamps a billing day that does not exist in the target month', () => {
    expect(dateInMonthClamped('2026-02', 30)).toBe('2026-02-28');
    expect(dateInMonthClamped('2026-02', 15)).toBe('2026-02-15');
    expect(dateInMonthClamped('2026-04', 31)).toBe('2026-04-30');
  });

  it('produces half-open month ranges', () => {
    expect(monthRange('2026-01')).toEqual({ start: '2026-01-01', end: '2026-02-01' });
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(monthRangeBetween('2026-01', '2026-03')).toEqual({ start: '2026-01-01', end: '2026-04-01' });
  });

  it('shifts months backwards across the year boundary', () => {
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToMonth('2026-01', -3)).toBe('2025-10');
  });

  it('maps transactions to the right statement period', () => {
    expect(getStatementPeriod('2026-01-10', 15)).toBe('2026-01');
    expect(getStatementPeriod('2026-01-20', 15)).toBe('2026-02');
    expect(getStatementPeriod('2026-12-20', 15)).toBe('2027-01');
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('input validation helpers', () => {
  it('rejects non-positive, NaN and Infinity amounts', () => {
    expect(parsePositiveAmount(100)).toBe(100);
    expect(parsePositiveAmount('250.5')).toBe(250.5);
    expect(parsePositiveAmount(0)).toBeNull();
    expect(parsePositiveAmount(-500)).toBeNull();
    expect(parsePositiveAmount(NaN)).toBeNull();
    expect(parsePositiveAmount(Infinity)).toBeNull();
    expect(parsePositiveAmount(undefined)).toBeNull();
    expect(parsePositiveAmount('abc')).toBeNull();
  });

  it('rejects malformed dates', () => {
    expect(isValidDateString('2026-01-31')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('xxxx')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('no-fecha')).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });

  it('rejects blank month strings', () => {
    expect(isValidMonthString('2026-03')).toBe(true);
    expect(isValidMonthString('2026-3')).toBe(false);
    expect(isValidMonthString('2026-00')).toBe(false);
  });

  it('rejects whitespace-only names', () => {
    expect(parseNonEmptyString('   ')).toBeNull();
    expect(parseNonEmptyString('')).toBeNull();
    expect(parseNonEmptyString('  Juan  ')).toBe('Juan');
  });
});

// ── Migrations ─────────────────────────────────────────────────────────────

describe('finance migrations v11–v13', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

  it('adds the new columns', () => {
    expect(columns('finance_transactions')).toEqual(
      expect.arrayContaining(['installment_number', 'billed_amount_ars']),
    );
    expect(columns('finance_loans')).toContain('deleted_at');
    expect(columns('finance_credit_card_statements')).toEqual(
      expect.arrayContaining(['calculated_amount_usd', 'paid_amount_usd', 'transaction_id_usd']),
    );
  });

  it('creates the new indexes', () => {
    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index'",
    ).all() as Array<{ name: string }>).map((i) => i.name);
    for (const name of [
      'idx_finance_tx_live_date', 'idx_finance_tx_type_date', 'idx_finance_tx_rec_date',
      'idx_finance_tx_card_stmt', 'idx_finance_loans_person', 'idx_ccs_card_period',
    ]) {
      expect(indexes, name).toContain(name);
    }
  });

  it('backfills installment_number by chronological position', () => {
    const fresh = new Database(':memory:');
    for (const m of financeMigrations) {
      if (m.version === 11) break;
      fresh.exec(m.up);
    }
    fresh.prepare(`INSERT INTO finance_installment_groups
      (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at)
      VALUES ('g1', 'TV', 3000, 'ARS', 3, 'Compras', '2026-01-15', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')`).run();
    // Credit-card plan: transactions start one month AFTER the group date, which
    // is exactly the case the old month-diff derivation got wrong.
    for (const [id, date] of [['t1', '2026-02-15'], ['t2', '2026-03-15'], ['t3', '2026-04-15']]) {
      fresh.prepare(`INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method, source,
         installments, installment_group_id, for_third_party, impacts_balance, created_at, updated_at)
        VALUES (?, 'expense', 1000, 'ARS', 'Compras', '', ?, 'credit_card', 'manual', 3, 'g1', 0, 0,
                '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')`).run(id, date);
    }
    for (const m of financeMigrations) {
      if (m.version < 11) continue;
      fresh.exec(m.up);
    }
    const rows = fresh.prepare(
      'SELECT id, installment_number AS n FROM finance_transactions ORDER BY date',
    ).all() as Array<{ id: string; n: number }>;
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('normalises datetime(now) timestamps to ISO without touching ISO rows', () => {
    const fresh = new Database(':memory:');
    for (const m of financeMigrations) {
      if (m.version === 13) break;
      fresh.exec(m.up);
    }
    fresh.prepare(`INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, description, settled, created_at, updated_at)
      VALUES ('l1', 'Juan', 'lent', 'single', 1000, 'ARS', '2026-01-01', '', 0, '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z')`).run();
    fresh.prepare(`INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at, updated_at, deleted_at)
      VALUES ('p1', 'l1', 100, 'ARS', '2026-01-01', '2026-01-01 10:00:00', '2026-01-01 10:00:00', '2026-01-02 11:00:00')`).run();
    fresh.prepare(`INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at, updated_at)
      VALUES ('p2', 'l1', 100, 'ARS', '2026-01-01', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z')`).run();
    fresh.exec(migration(13).up);

    const p1 = fresh.prepare("SELECT updated_at AS u, deleted_at AS d FROM finance_loan_payments WHERE id = 'p1'").get() as { u: string; d: string };
    const p2 = fresh.prepare("SELECT updated_at AS u FROM finance_loan_payments WHERE id = 'p2'").get() as { u: string };
    expect(p1.u).toBe('2026-01-01T10:00:00Z');
    expect(p1.d).toBe('2026-01-02T11:00:00Z');
    expect(p2.u).toBe('2026-01-01T10:00:00.000Z');
    // The delete now sorts after the insert, so last-write-wins keeps it deleted.
    expect(p1.d > p1.u).toBe(true);
  });

  it('deactivates soft-deleted recurring templates', () => {
    const fresh = new Database(':memory:');
    for (const m of financeMigrations) {
      if (m.version === 13) break;
      fresh.exec(m.up);
    }
    fresh.prepare(`INSERT INTO finance_recurring (id, name, type, amount, currency, category, active, created_at, updated_at, deleted_at)
      VALUES ('r1', 'Netflix', 'expense', 5000, 'ARS', 'Suscripciones', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`).run();
    fresh.exec(migration(13).up);
    const row = fresh.prepare("SELECT active FROM finance_recurring WHERE id = 'r1'").get() as { active: number };
    expect(row.active).toBe(0);
  });
});

// ── Aggregation ────────────────────────────────────────────────────────────

describe('unified expense aggregation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    addTx(db, { id: 'cash1', amount: 1000, category: 'Delivery', date: '2026-03-05' });
    addTx(db, { id: 'cuota1', amount: 2000, category: 'Compras', date: '2026-03-10', installmentGroupId: 'g1' });
    addTx(db, { id: 'card1', amount: 3000, category: 'Suscripciones', date: '2026-03-12', impactsBalance: 0, creditCardId: 'c1' });
    addTx(db, { id: 'pago1', amount: 2500, category: 'Pago Tarjeta', date: '2026-03-01' });
    addTx(db, { id: 'inc1', type: 'income', amount: 9000, category: 'Otros', date: '2026-03-02' });
    addTx(db, { id: 'usd1', amount: 50, currency: 'USD', category: 'Compras', date: '2026-03-20' });
    addTx(db, { id: 'gone', amount: 999, category: 'Delivery', date: '2026-03-07', deletedAt: '2026-03-08T00:00:00.000Z' });
  });

  it('gives the month and the range the same definition of an expense', () => {
    const filter = { type: 'expense' as const, balanceScope: 'all' as const, excludeCategories: ['Pago Tarjeta'] };
    const byMonth = aggregateByCategory(db, { ...monthRange('2026-03'), ...filter });
    const byRange = aggregateByCategory(db, { ...monthRangeBetween('2026-03', '2026-03'), ...filter });
    expect(byMonth).toEqual(byRange);
  });

  it('counts pending card purchases as spending but not the statement payment', () => {
    const cats = aggregateByCategory(db, {
      ...monthRange('2026-03'),
      type: 'expense',
      balanceScope: 'all',
      excludeCategories: ['Pago Tarjeta'],
    });
    const names = cats.map((c) => c.category);
    expect(names).toContain('Suscripciones');
    expect(names).not.toContain('Pago Tarjeta');
    expect(cats.find((c) => c.category === 'Delivery')!.ARS).toBe(1000);
  });

  it('breaks spending down into direct / instalments / pending card', () => {
    const breakdown = computeExpenseBreakdown(db, monthRange('2026-03'));
    expect(breakdown.ARS.direct).toBe(1000);
    expect(breakdown.ARS.installments).toBe(2000);
    expect(breakdown.ARS.pendingCard).toBe(3000);
    expect(breakdown.ARS.cardPayments).toBe(2500);
    expect(breakdown.ARS.total).toBe(6000);
    expect(breakdown.ARS.direct + breakdown.ARS.installments + breakdown.ARS.pendingCard)
      .toBe(breakdown.ARS.total);
    expect(breakdown.USD.total).toBe(50);
  });

  it('never mixes currencies in the monthly balance', () => {
    const balance = computeMonthlyBalance(db, '2026-03');
    expect(balance.ARS.income).toBe(9000);
    // 1000 cash + 2000 cuota + 2500 pago tarjeta; the pending card purchase is excluded.
    expect(balance.ARS.expenses).toBe(5500);
    expect(balance.USD.expenses).toBe(50);
    expect(balance.USD.income).toBe(0);
  });

  it('excludes soft-deleted rows', () => {
    const total = sumByCurrency(db, { ...monthRange('2026-03'), type: 'expense', balanceScope: 'all' });
    expect(total.ARS).toBe(1000 + 2000 + 3000 + 2500);
  });

  it('uses a half-open range so the last day of the month still counts', () => {
    addTx(db, { id: 'last', amount: 7, category: 'Otros', date: '2026-03-31' });
    addTx(db, { id: 'next', amount: 9, category: 'Otros', date: '2026-04-01' });
    const total = sumByCurrency(db, { ...monthRange('2026-03'), type: 'expense', balanceScope: 'all', categories: ['Otros'] });
    expect(total.ARS).toBe(7);
  });
});

// ── Recurring generation ───────────────────────────────────────────────────

describe('generateRecurringForMonth', () => {
  let db: Database.Database;

  const addRecurring = (id: string, billingDay: number, opts: { active?: number; deletedAt?: string | null } = {}) => {
    db.prepare(`
      INSERT INTO finance_recurring
        (id, name, type, amount, currency, category, billing_day, active, created_at, updated_at, deleted_at)
      VALUES (?, ?, 'expense', 5000, 'ARS', 'Servicios', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)
    `).run(id, `Rec ${id}`, billingDay, opts.active ?? 1, opts.deletedAt ?? null);
  };

  beforeEach(() => { db = setupDb(); });

  it('uses a deterministic id so two devices converge on one row', () => {
    addRecurring('r1', 10);
    expect(generateRecurringForMonth(db, '2026-03')).toBe(1);
    const row = db.prepare("SELECT id, date FROM finance_transactions WHERE recurring_id = 'r1'").get() as { id: string; date: string };
    expect(row.id).toBe(recurringTransactionId('r1', '2026-03'));
    expect(row.date).toBe('2026-03-10');
  });

  it('is idempotent', () => {
    addRecurring('r1', 10);
    generateRecurringForMonth(db, '2026-03');
    expect(generateRecurringForMonth(db, '2026-03')).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM finance_transactions').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('respects billing_day 31 in a short month', () => {
    addRecurring('r1', 31);
    generateRecurringForMonth(db, '2026-02');
    const row = db.prepare("SELECT date FROM finance_transactions WHERE recurring_id = 'r1'").get() as { date: string };
    expect(row.date).toBe('2026-02-28');
  });

  it('does not resurrect a transaction the user deleted by hand', () => {
    addRecurring('r1', 10);
    generateRecurringForMonth(db, '2026-03');
    db.prepare("UPDATE finance_transactions SET deleted_at = '2026-03-11T00:00:00.000Z' WHERE recurring_id = 'r1'").run();
    expect(generateRecurringForMonth(db, '2026-03')).toBe(0);
    const live = db.prepare('SELECT COUNT(*) AS c FROM finance_transactions WHERE deleted_at IS NULL').get() as { c: number };
    expect(live.c).toBe(0);
  });

  it('skips soft-deleted templates even if they are still flagged active', () => {
    addRecurring('r1', 10, { active: 1, deletedAt: '2026-02-01T00:00:00.000Z' });
    expect(generateRecurringForMonth(db, '2026-03')).toBe(0);
  });

  it('skips inactive templates', () => {
    addRecurring('r1', 10, { active: 0 });
    expect(generateRecurringForMonth(db, '2026-03')).toBe(0);
  });

  it('ignores an invalid month instead of writing garbage dates', () => {
    addRecurring('r1', 10);
    expect(generateRecurringForMonth(db, 'xxxx')).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM finance_transactions').get() as { c: number };
    expect(count.c).toBe(0);
  });
});
