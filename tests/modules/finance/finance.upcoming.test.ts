import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  addDaysToDate,
  computeUpcomingTimeline,
} from '../../../electron/modules/finance.balance';
import { evaluateFinanceNotifications } from '../../../electron/modules/notification-engine';
import { notificationsMigrations } from '../../../electron/modules/notifications.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  for (const m of notificationsMigrations) db.exec(m.up);
  return db;
}

let db: Database.Database;
let seq = 0;
const NOW = '2026-08-31T00:00:00Z';

function addInstallmentGroup(id: string, description: string, dates: string[], amount = 10000, currency = 'ARS'): void {
  db.prepare(`
    INSERT INTO finance_installment_groups (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Otros', ?, ?, ?)
  `).run(id, description, amount * dates.length, currency, dates.length, dates[0], NOW, NOW);
  dates.forEach((date, i) => {
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, impacts_balance, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, 'Otros', ?, ?, 'credit_card', 'manual', ?, ?, ?, 0, ?, ?)
    `).run(`i${++seq}`, amount, currency, `${description} ${i + 1}`, date, dates.length, id, i + 1, NOW, NOW);
  });
}

function addRecurring(id: string, opts: {
  amount?: number;
  billingDay?: number;
  frequency?: string;
  createdMonth?: string;
  type?: string;
  active?: number;
} = {}): void {
  db.prepare(`
    INSERT INTO finance_recurring (id, name, type, amount, currency, category, billing_day, frequency, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ARS', 'Otros', ?, ?, ?, ?, ?)
  `).run(
    id, `rec ${id}`, opts.type ?? 'expense', opts.amount ?? 5000,
    opts.billingDay ?? 10, opts.frequency ?? 'monthly', opts.active ?? 1,
    `${opts.createdMonth ?? '2026-01'}-02T00:00:00Z`, `${opts.createdMonth ?? '2026-01'}-02T00:00:00Z`,
  );
}

function addCard(id: string, closingDay: number, dueDay: number | null): void {
  db.prepare(`
    INSERT INTO finance_credit_cards (id, name, closing_day, due_day, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `Card ${id}`, closingDay, dueDay, NOW, NOW);
}

function addStatement(id: string, cardId: string, periodMonth: string, ars: number, usd = 0, status = 'pending'): void {
  db.prepare(`
    INSERT INTO finance_credit_card_statements
      (id, credit_card_id, period_month, calculated_amount, calculated_amount_usd, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cardId, periodMonth, ars, usd, status, NOW, NOW);
}

beforeEach(() => {
  db = setupDb();
  seq = 0;
});

describe('addDaysToDate', () => {
  it('is calendar-correct across month and year boundaries', () => {
    expect(addDaysToDate('2026-08-31', 30)).toBe('2026-09-30');
    expect(addDaysToDate('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDaysToDate('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });
});

describe('computeUpcomingTimeline', () => {
  it('collects instalments inside the [from, from+30) window only', () => {
    addInstallmentGroup('g1', 'Heladera', ['2026-08-25', '2026-09-05', '2026-10-05']);
    const timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    const cuotas = timeline.items.filter((i) => i.kind === 'installment');
    expect(cuotas).toHaveLength(1);
    expect(cuotas[0].date).toBe('2026-09-05');
    expect(cuotas[0].detail).toBe('2/3');
    expect(cuotas[0].label).toBe('Heladera');
  });

  it('projects recurring expenses respecting frequency and billing day', () => {
    addRecurring('mensual', { billingDay: 10 });                                   // Sep 10 → in
    addRecurring('bimestral-off', { billingDay: 10, frequency: 'bimonthly', createdMonth: '2026-08' }); // next due Oct → out
    addRecurring('bimestral-on', { billingDay: 10, frequency: 'bimonthly', createdMonth: '2026-07' });  // Sep due → in
    addRecurring('ingreso', { type: 'income' });                                   // money IN, not out
    addRecurring('pausado', { active: 0 });

    const timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    const ids = timeline.items.filter((i) => i.kind === 'recurring').map((i) => i.refId).sort();
    expect(ids).toEqual(['bimestral-on', 'mensual']);
  });

  it('an already-generated month uses the REAL row; a cancelled (soft-deleted) one is silent', () => {
    addRecurring('real', { billingDay: 10, amount: 5000 });
    // Generated with a different date and an updated amount.
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, recurring_id, impacts_balance, created_at, updated_at)
      VALUES ('gen1', 'expense', 7777, 'ARS', 'Otros', 'rec real', '2026-09-12', 'cash', 'recurring', 1, 'real', 1, ?, ?)
    `).run(NOW, NOW);

    let timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    const item = timeline.items.find((i) => i.refId === 'real')!;
    expect(item.date).toBe('2026-09-12');
    expect(item.amount).toBe(7777);

    // The user deleted this month's instance — nothing to show, nothing revived.
    db.prepare("UPDATE finance_transactions SET deleted_at = ? WHERE id = 'gen1'").run(NOW);
    timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    expect(timeline.items.find((i) => i.refId === 'real')).toBeUndefined();
  });

  it('card due dates: due after closing lands in the period month, before closing in the next', () => {
    addCard('late', 15, 25);  // closes the 15th, due the 25th of the SAME month
    addCard('early', 28, 10); // closes the 28th, due the 10th of the NEXT month
    addCard('mute', 15, null);
    addStatement('s1', 'late', '2026-09', 40000);
    addStatement('s2', 'early', '2026-08', 30000, 120);
    addStatement('s3', 'mute', '2026-09', 99999);
    addStatement('s4', 'late', '2026-09', 11111, 0, 'paid'); // paid: not upcoming

    const timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    const dues = timeline.items.filter((i) => i.kind === 'card_due');
    expect(dues.map((d) => [d.refId, d.date, d.currency, d.amount])).toEqual(
      expect.arrayContaining([
        ['s1', '2026-09-25', 'ARS', 40000],
        ['s2', '2026-09-10', 'ARS', 30000],
        ['s2', '2026-09-10', 'USD', 120],
      ]),
    );
    expect(dues).toHaveLength(3); // no card without due_day, no paid statement
  });

  it('orders by date and totals the window per currency', () => {
    addInstallmentGroup('g1', 'Notebook', ['2026-09-20'], 20000);
    addRecurring('alq', { billingDay: 5, amount: 100000 });
    addCard('c1', 15, 25);
    addStatement('s1', 'c1', '2026-09', 50000, 80);

    const timeline = computeUpcomingTimeline(db, '2026-08-31', 30);
    // The statement bills both currencies, so its due date appears twice (one row per currency).
    expect(timeline.items.map((i) => i.date)).toEqual(['2026-09-05', '2026-09-20', '2026-09-25', '2026-09-25']);
    expect(timeline.totals).toEqual({ ARS: 170000, USD: 80 });
    expect(timeline.from).toBe('2026-08-31');
    expect(timeline.to).toBe('2026-09-30');
  });
});

// ── Notifications: «vence en 3 días» + frequency-aware missing rule ────────

describe('finance notifications', () => {
  function dayOfMonthInDays(days: number): number {
    return new Date(Date.now() + days * 86400000).getDate();
  }

  it('fires finance_card_due when the due day is within 3 days', () => {
    addCard('due-soon', 1, dayOfMonthInDays(2));
    const results = evaluateFinanceNotifications(db);
    const due = results.filter((r) => r.type === 'finance_card_due');
    expect(due).toHaveLength(1);
    expect(due[0].refId).toBe('due-soon');
    expect(due[0].title).toContain('Card due-soon');
  });

  it('stays quiet for far due days and for cards without one', () => {
    addCard('far', 1, dayOfMonthInDays(10));
    addCard('none', 1, null);
    const results = evaluateFinanceNotifications(db);
    expect(results.filter((r) => r.type === 'finance_card_due')).toHaveLength(0);
  });

  it('finance_recurring_missing respects the frequency: an off month never warns', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const twoAgo = new Date(now.getFullYear(), now.getMonth() - 2, 2);
    const anchorTwoAgo = `${twoAgo.getFullYear()}-${String(twoAgo.getMonth() + 1).padStart(2, '0')}`;

    // Quarterly anchored two months ago: current month is an off month.
    addRecurring('q-off', { frequency: 'quarterly', createdMonth: anchorTwoAgo, billingDay: 1 });
    // Monthly with no transaction this month: this one SHOULD warn.
    addRecurring('m-due', { frequency: 'monthly', createdMonth: anchorTwoAgo, billingDay: 1 });

    const missing = evaluateFinanceNotifications(db).filter((r) => r.type === 'finance_recurring_missing');
    expect(missing.map((m) => m.refId)).toEqual(['m-due']);
    void currentMonth;
  });
});
