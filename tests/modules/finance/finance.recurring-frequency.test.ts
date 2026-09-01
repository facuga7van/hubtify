import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  frequencyIntervalMonths,
  generateRecurringForMonth,
  isRecurringDueInMonth,
  monthDiff,
} from '../../../electron/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

let db: Database.Database;

function addTemplate(opts: {
  id: string;
  frequency?: string;
  createdMonth?: string;
  billingDay?: number;
  amount?: number;
  type?: string;
  active?: number;
}): void {
  db.prepare(`
    INSERT INTO finance_recurring
      (id, name, type, amount, currency, category, billing_day, frequency, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ARS', 'Otros', ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    `rec ${opts.id}`,
    opts.type ?? 'expense',
    opts.amount ?? 1000,
    opts.billingDay ?? 10,
    opts.frequency ?? 'monthly',
    opts.active ?? 1,
    `${opts.createdMonth ?? '2026-01'}-05T10:00:00Z`,
    `${opts.createdMonth ?? '2026-01'}-05T10:00:00Z`,
  );
}

function txCountFor(recurringId: string, month: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM finance_transactions
    WHERE recurring_id = ? AND date >= ? AND date < ?
  `).get(recurringId, `${month}-01`, `${month}-31`) as { c: number };
  return row.c;
}

beforeEach(() => {
  db = setupDb();
});

// ── Pure cadence math ──────────────────────────────────────────────────────

describe('frequency helpers', () => {
  it('maps every supported frequency to its month interval', () => {
    expect(frequencyIntervalMonths('monthly')).toBe(1);
    expect(frequencyIntervalMonths('bimonthly')).toBe(2);
    expect(frequencyIntervalMonths('quarterly')).toBe(3);
    expect(frequencyIntervalMonths('four_monthly')).toBe(4);
    expect(frequencyIntervalMonths('semiannual')).toBe(6);
    expect(frequencyIntervalMonths('annual')).toBe(12);
    // Legacy / garbage values behave as monthly, never break generation.
    expect(frequencyIntervalMonths(undefined)).toBe(1);
    expect(frequencyIntervalMonths('weekly')).toBe(1);
  });

  it('monthDiff handles year boundaries', () => {
    expect(monthDiff('2026-11', '2027-02')).toBe(3);
    expect(monthDiff('2026-06', '2026-06')).toBe(0);
    expect(monthDiff('2026-06', '2026-05')).toBe(-1);
  });
});

describe('isRecurringDueInMonth — next period per cadence', () => {
  it('monthly is due every month', () => {
    expect(isRecurringDueInMonth('monthly', '2026-01', '2026-08')).toBe(true);
  });

  it('bimonthly: anchor, +2, +4… but not the odd months', () => {
    expect(isRecurringDueInMonth('bimonthly', '2026-08', '2026-08')).toBe(true);
    expect(isRecurringDueInMonth('bimonthly', '2026-08', '2026-09')).toBe(false);
    expect(isRecurringDueInMonth('bimonthly', '2026-08', '2026-10')).toBe(true);
    expect(isRecurringDueInMonth('bimonthly', '2026-08', '2026-12')).toBe(true);
    // Year boundary: 2026-12 → 2027-02.
    expect(isRecurringDueInMonth('bimonthly', '2026-12', '2027-02')).toBe(true);
    expect(isRecurringDueInMonth('bimonthly', '2026-12', '2027-01')).toBe(false);
  });

  it('quarterly / four_monthly step 3 and 4 months', () => {
    expect(isRecurringDueInMonth('quarterly', '2026-02', '2026-05')).toBe(true);
    expect(isRecurringDueInMonth('quarterly', '2026-02', '2026-04')).toBe(false);
    expect(isRecurringDueInMonth('four_monthly', '2026-03', '2026-07')).toBe(true);
    expect(isRecurringDueInMonth('four_monthly', '2026-03', '2026-06')).toBe(false);
  });

  it('semiannual (el aguinaldo): June anchor bills June and December', () => {
    expect(isRecurringDueInMonth('semiannual', '2026-06', '2026-06')).toBe(true);
    expect(isRecurringDueInMonth('semiannual', '2026-06', '2026-12')).toBe(true);
    expect(isRecurringDueInMonth('semiannual', '2026-06', '2026-09')).toBe(false);
    expect(isRecurringDueInMonth('semiannual', '2026-06', '2027-06')).toBe(true);
  });

  it('annual bills once a year, on the anchor month', () => {
    expect(isRecurringDueInMonth('annual', '2026-03', '2027-03')).toBe(true);
    expect(isRecurringDueInMonth('annual', '2026-03', '2026-09')).toBe(false);
    expect(isRecurringDueInMonth('annual', '2026-03', '2027-04')).toBe(false);
  });

  it('never bills before the anchor month', () => {
    expect(isRecurringDueInMonth('bimonthly', '2026-08', '2026-06')).toBe(false);
    expect(isRecurringDueInMonth('annual', '2026-08', '2025-08')).toBe(false);
  });
});

// ── Generation ─────────────────────────────────────────────────────────────

describe('generateRecurringForMonth with frequencies', () => {
  it('generates only on due months and stays idempotent', () => {
    addTemplate({ id: 'bi', frequency: 'bimonthly', createdMonth: '2026-08' });
    addTemplate({ id: 'mo', frequency: 'monthly', createdMonth: '2026-08' });

    expect(generateRecurringForMonth(db, '2026-08')).toBe(2); // both due
    expect(generateRecurringForMonth(db, '2026-09')).toBe(1); // only monthly
    expect(generateRecurringForMonth(db, '2026-10')).toBe(2); // both again
    // Idempotent: a second pass over any month writes nothing.
    expect(generateRecurringForMonth(db, '2026-10')).toBe(0);

    expect(txCountFor('bi', '2026-08')).toBe(1);
    expect(txCountFor('bi', '2026-09')).toBe(0);
    expect(txCountFor('bi', '2026-10')).toBe(1);
  });

  it('semiannual generates six months after the anchor, across the year boundary', () => {
    addTemplate({ id: 'agui', frequency: 'semiannual', createdMonth: '2026-12', amount: 500000 });
    expect(generateRecurringForMonth(db, '2026-12')).toBe(1);
    expect(generateRecurringForMonth(db, '2027-03')).toBe(0);
    expect(generateRecurringForMonth(db, '2027-06')).toBe(1);
  });

  it('a template with a soft-deleted instance for the month is not resurrected', () => {
    addTemplate({ id: 'qa', frequency: 'quarterly', createdMonth: '2026-08' });
    expect(generateRecurringForMonth(db, '2026-08')).toBe(1);
    const now = new Date().toISOString();
    db.prepare("UPDATE finance_transactions SET deleted_at = ? WHERE recurring_id = 'qa'").run(now);
    expect(generateRecurringForMonth(db, '2026-08')).toBe(0);
  });

  it('freezes the fx rate passed in opts on the generated rows (NULL when absent)', () => {
    addTemplate({ id: 'fx1', frequency: 'monthly', createdMonth: '2026-08' });
    generateRecurringForMonth(db, '2026-08', { fxRate: 1370 });
    const withFx = db.prepare("SELECT fx_rate AS fx FROM finance_transactions WHERE recurring_id = 'fx1'").get() as { fx: number | null };
    expect(withFx.fx).toBe(1370);

    addTemplate({ id: 'fx2', frequency: 'monthly', createdMonth: '2026-08' });
    generateRecurringForMonth(db, '2026-08'); // offline: no rate available
    const noFx = db.prepare("SELECT fx_rate AS fx FROM finance_transactions WHERE recurring_id = 'fx2'").get() as { fx: number | null };
    expect(noFx.fx).toBeNull();
  });
});
