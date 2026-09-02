/**
 * Review 08-2026, medium findings:
 *  #6  category averages ignored card purchases while the month included them;
 *  #7  the cadence anchor was the UTC month of created_at and not editable;
 *  #10 finance:getProjection summed every template into every month;
 *  #14 JS sums were persisted / compared with binary noise.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { notificationsMigrations } from '../../../shared-logic/modules/notifications.schema';
import { evaluateFinanceNotifications } from '../../../shared-logic/modules/notification-engine';
import {
  addMonthsToMonth,
  computeBudgetStatus,
  computeUpcomingTimeline,
  generateRecurringForMonth,
  isBudgetMonthMet,
  recurringAnchorMonth,
  round2,
  setBudget,
} from '../../../shared-logic/modules/finance.balance';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../shared-logic/modules/finance.ipc');
registerFinanceIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  for (const m of notificationsMigrations) db.exec(m.up);
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify([{ casa: 'blue', nombre: 'Blue', compra: 990, venta: 1000 }]));
  return db;
}

let db: Database.Database;
let seq = 0;
const CURRENT_MONTH = new Date().toLocaleDateString('en-CA').slice(0, 7);

function addTx(opts: { amount: number; date: string; category?: string; impactsBalance?: number; type?: string }): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source, installments, impacts_balance, created_at, updated_at)
    VALUES (?, ?, ?, 'ARS', ?, '', ?, 'cash', 'manual', 1, ?, ?, ?)
  `).run(`tx${++seq}`, opts.type ?? 'expense', opts.amount, opts.category ?? 'Otros', opts.date, opts.impactsBalance ?? 1, now, now);
}

beforeEach(() => {
  db = setupDb();
  harness.db = db;
  seq = 0;
});

describe('#6 — averages and the month use the same definition (the wheel\'s)', () => {
  it('a category paid 20k cash + 80k card every month averages 100k, not 20k', async () => {
    for (let back = 1; back <= 3; back++) {
      const m = addMonthsToMonth(CURRENT_MONTH, -back);
      addTx({ amount: 20000, date: `${m}-10`, category: 'Supermercado' });
      addTx({ amount: 80000, date: `${m}-11`, category: 'Supermercado', impactsBalance: 0 }); // card, pending
      addTx({ amount: 999999, date: `${m}-12`, category: 'Pago Tarjeta' });                     // never counts
    }
    const averages = await invoke<Record<string, number>>('finance:getCategoryAverages');
    expect(averages.Supermercado).toBe(100000);
    expect(averages['Pago Tarjeta']).toBeUndefined();
  });
});

describe('#7 — the anchor month is the user\'s, in local time', () => {
  it('addRecurring defaults the anchor to the current LOCAL month and stores an explicit one', async () => {
    const def = await invoke<string>('finance:addRecurring', { name: 'A', type: 'expense', amount: 1 });
    const explicit = await invoke<string>('finance:addRecurring', { name: 'B', type: 'expense', amount: 1, frequency: 'annual', anchorMonth: '2026-03' });
    const rows = await invoke<Array<{ id: string; anchorMonth: string | null }>>('finance:getRecurring');
    expect(rows.find((r) => r.id === def)?.anchorMonth).toBe(CURRENT_MONTH);
    expect(rows.find((r) => r.id === explicit)?.anchorMonth).toBe('2026-03');
    expect(await invoke('finance:addRecurring', { name: 'C', type: 'expense', amount: 1, anchorMonth: '2026-13' }))
      .toEqual({ ok: false, reason: 'invalid_anchor_month' });
  });

  it('an annual insurance due in March, loaded in September, bills every March — not every September', async () => {
    db.prepare(`
      INSERT INTO finance_recurring (id, name, type, amount, currency, category, billing_day, frequency, active, anchor_month, created_at, updated_at)
      VALUES ('seguro', 'Seguro', 'expense', 600000, 'ARS', 'Otros', 5, 'annual', 1, '2026-03', '2026-09-15T01:00:00Z', '2026-09-15T01:00:00Z')
    `).run();
    expect(recurringAnchorMonth({ createdAt: '2026-09-15T01:00:00Z', anchorMonth: '2026-03' })).toBe('2026-03');
    expect(generateRecurringForMonth(db, '2026-09')).toBe(0);
    expect(generateRecurringForMonth(db, '2027-03')).toBe(1);
    expect(generateRecurringForMonth(db, '2027-09')).toBe(0);

    // The 30-day agenda agrees.
    const items = computeUpcomingTimeline(db, '2027-02-20', 30).items.filter((i) => i.refId === 'seguro');
    expect(items.map((i) => i.date)).toEqual(['2027-03-05']);
    expect(computeUpcomingTimeline(db, '2027-08-20', 30).items.filter((i) => i.refId === 'seguro')).toHaveLength(0);
  });

  it('updateRecurring moves the anchor; null falls back to the creation month', async () => {
    const id = await invoke<string>('finance:addRecurring', { name: 'Bi', type: 'expense', amount: 1, frequency: 'bimonthly', anchorMonth: '2026-08' });
    expect(await invoke('finance:updateRecurring', id, { anchorMonth: '2026-09' })).toEqual({ ok: true });
    expect(generateRecurringForMonth(db, '2026-08')).toBe(0);
    expect(generateRecurringForMonth(db, '2026-09')).toBe(1);
    expect(await invoke('finance:updateRecurring', id, { anchorMonth: 'nope' })).toEqual({ ok: false, reason: 'invalid_anchor_month' });
    expect(await invoke('finance:updateRecurring', id, { anchorMonth: null })).toEqual({ ok: true });
    const row = db.prepare('SELECT anchor_month AS a FROM finance_recurring WHERE id = ?').get(id) as { a: string | null };
    expect(row.a).toBeNull();
  });

  it('the "recurring missing" bell respects the anchor: an off month never warns', () => {
    const prevMonth = addMonthsToMonth(CURRENT_MONTH, -1);
    db.prepare(`
      INSERT INTO finance_recurring (id, name, type, amount, currency, category, billing_day, frequency, active, anchor_month, created_at, updated_at)
      VALUES ('q-off', 'Trimestral', 'expense', 1, 'ARS', 'Otros', 1, 'quarterly', 1, ?, ?, ?)
    `).run(prevMonth, `${CURRENT_MONTH}-01T00:00:00Z`, `${CURRENT_MONTH}-01T00:00:00Z`);
    const missing = evaluateFinanceNotifications(db).filter((n) => n.type === 'finance_recurring_missing');
    expect(missing).toHaveLength(0);
  });
});

describe('#10 — the projection respects each template\'s frequency', () => {
  it('an annual 600k anchored in October + a monthly 100k → 100k, 700k, 100k', async () => {
    await invoke('finance:addRecurring', { name: 'Seguro', type: 'expense', amount: 600000, frequency: 'annual', anchorMonth: '2026-10' });
    await invoke('finance:addRecurring', { name: 'Alquiler', type: 'expense', amount: 100000 });
    const projection = await invoke<Array<{ month: string; recurring: number; total: number }>>('finance:getProjection', 3, '2026-08');
    expect(projection.map((p) => [p.month, p.recurring])).toEqual([
      ['2026-09', 100000],
      ['2026-10', 700000],
      ['2026-11', 100000],
    ]);
  });
});

describe('#14 — round2 where sums are persisted or compared', () => {
  it('round2 kills binary noise', () => {
    expect(round2(1000.1 + 2000.2 + 3000.3 + 4000.4 + 5000.5 + 15.05 + 0.07)).toBe(15016.62);
    expect(round2(0.1 * 10)).toBe(1);
  });

  it('a statement of noisy lines persists an exact calculated_amount and payment', async () => {
    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    for (const amount of [1000.1, 2000.2, 3000.3, 4000.4, 5000.5, 15.05, 0.07]) {
      await invoke('finance:addTransaction', { type: 'expense', amount, date: '2026-08-10', paymentMethod: 'credit_card', creditCardId: cardId });
    }
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    const stmt = db.prepare('SELECT calculated_amount AS c, transaction_id AS txId FROM finance_credit_card_statements WHERE id = ?').get(statementId) as { c: number; txId: string };
    expect(stmt.c).toBe(15016.62);
    const payment = db.prepare('SELECT amount FROM finance_transactions WHERE id = ?').get(stmt.txId) as { amount: number };
    expect(payment.amount).toBe(15016.62);
  });

  it('ten charges of $0,10 against a $1 budget are inside it', () => {
    setBudget(db, 'Delivery', 1);
    for (let i = 0; i < 10; i++) addTx({ amount: 0.1, date: '2026-08-10', category: 'Delivery' });
    const status = computeBudgetStatus(db, '2026-08');
    expect(status.categories[0].spent).toBe(1);
    expect(isBudgetMonthMet(status)).toBe(true);
  });
});
