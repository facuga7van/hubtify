/**
 * Review 08-2026, finding #5 (high): the frozen rate written by a PROCESS
 * (backfill, import, recurring generation) is the rate of the day the process
 * ran, not of the transaction's date — and once frozen it lost the `~` mark, so
 * an honest `~US$ 74` on a 2024 row became a false-precision `US$ 74`.
 *
 * `fx_rate_source` now says where the number came from, only `'day'` reads as
 * exact, and the backfill asks the historical series first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { convertArsToUsd, convertTransactionAmount, isExactFxSource } from '@modules/finance/utils/valuation';
import {
  backfillFxRates,
  backfillFxRatesHistorical,
  fxRateSourceFor,
  getHistoricalRate,
  historicalRateUrl,
  readHistoricalRateCache,
  computeValuedView,
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
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify([{ casa: 'blue', nombre: 'Blue', compra: 1340, venta: 1350 }]));
  return db;
}

let db: Database.Database;
let seq = 0;
const TODAY = '2026-09-01';

function addTx(date: string, opts: { amount?: number; fxRate?: number | null } = {}): string {
  const id = `tx${++seq}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source, installments, impacts_balance, fx_rate, created_at, updated_at)
    VALUES (?, 'expense', ?, 'ARS', 'Otros', '', ?, 'cash', 'manual', 1, 1, ?, ?, ?)
  `).run(id, opts.amount ?? 100000, date, opts.fxRate ?? null, now, now);
  return id;
}

function rowOf(id: string): { fx: number | null; src: string | null } {
  return db.prepare('SELECT fx_rate AS fx, fx_rate_source AS src FROM finance_transactions WHERE id = ?').get(id) as { fx: number | null; src: string | null };
}

beforeEach(() => {
  db = setupDb();
  harness.db = db;
  seq = 0;
});

describe('provenance → the ~ mark', () => {
  it('only a day rate (or legacy NULL) reads as exact', () => {
    expect(isExactFxSource('day')).toBe(true);
    expect(isExactFxSource(null)).toBe(true);
    expect(isExactFxSource('process')).toBe(false);
    expect(isExactFxSource('backfill')).toBe(false);
  });

  it('convertArsToUsd keeps the frozen number but flags a non-day provenance', () => {
    expect(convertArsToUsd(135000, 1350, 2000, 'day')).toEqual({ value: 100, approx: false });
    expect(convertArsToUsd(135000, 1350, 2000, 'backfill')).toEqual({ value: 100, approx: true });
    expect(convertArsToUsd(135000, 1350, 2000, 'process')).toEqual({ value: 100, approx: true });
    // Legacy rows (pre-column) are not suddenly flagged.
    expect(convertArsToUsd(135000, 1350, 2000, null)).toEqual({ value: 100, approx: false });
  });

  it('fxRateSourceFor: today is the row\'s own day, any other date is a process rate', () => {
    expect(fxRateSourceFor('2026-09-01', '2026-09-01')).toBe('day');
    expect(fxRateSourceFor('2026-08-20', '2026-09-01')).toBe('process');
  });
});

describe('backfillFxRates (fallback pass)', () => {
  it('stamps old rows as backfill and today\'s rows as day — the old row keeps its ~', () => {
    const old = addTx('2024-03-15');
    const today = addTx(TODAY);
    expect(backfillFxRates(db, 1350, TODAY)).toBe(2);
    expect(rowOf(old)).toEqual({ fx: 1350, src: 'backfill' });
    expect(rowOf(today)).toEqual({ fx: 1350, src: 'day' });

    const oldRow = { amount: 100000, currency: 'ARS', fxRate: 1350, fxRateSource: 'backfill', date: '2024-03-15' };
    const shown = convertTransactionAmount(oldRow, 'usd', { currentRate: 1350, coefs: null });
    expect(shown.value).toBeCloseTo(74.07, 2);
    expect(shown.approx).toBe(true);
  });
});

describe('historical backfill (argentinadatos)', () => {
  const okFetch = (venta: number) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ casa: 'blue', compra: venta - 20, venta, fecha: 'x' }) })) as unknown as typeof fetch;
  const offline = () => vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;

  it('builds the per-day URL', () => {
    expect(historicalRateUrl('blue', '2024-03-15')).toBe('https://api.argentinadatos.com/v1/cotizaciones/dolares/blue/2024/03/15');
  });

  it('a year-old transaction gets the rate of ITS day, stamped exact, and the answer is cached', async () => {
    const id = addTx('2024-03-15');
    const fetchFn = okFetch(1000);
    const result = await backfillFxRatesHistorical(db, { house: 'blue', currentRate: 1350, fetchFn, today: TODAY });
    expect(result).toEqual({ updated: 1, exact: 1, approx: 0 });
    expect(rowOf(id)).toEqual({ fx: 1000, src: 'day' });
    expect(readHistoricalRateCache(db, 'blue', '2024-03-15')).toBe(1000);

    // 100.000 at 1.000 = US$ 100, exact — not US$ 74 at today's rate.
    const view = computeValuedView(db, '2024-03', { currentRate: 1350, house: 'blue', series: null });
    expect(view.usd?.balance.expenses).toBeCloseTo(100);
    expect(view.usd?.approx).toBe(false);

    // Second row on the same day: cache, no network.
    const id2 = addTx('2024-03-15');
    const fetch2 = okFetch(9999);
    await backfillFxRatesHistorical(db, { house: 'blue', currentRate: 1350, fetchFn: fetch2, today: TODAY });
    expect(fetch2).not.toHaveBeenCalled();
    expect(rowOf(id2)).toEqual({ fx: 1000, src: 'day' });
  });

  it('offline: falls back to today\'s rate stamped backfill — the ~ survives', async () => {
    const id = addTx('2024-03-15');
    const fetchFn = offline();
    const result = await backfillFxRatesHistorical(db, { house: 'blue', currentRate: 1350, fetchFn, today: TODAY });
    expect(result).toEqual({ updated: 1, exact: 0, approx: 1 });
    expect(rowOf(id)).toEqual({ fx: 1350, src: 'backfill' });
    const view = computeValuedView(db, '2024-03', { currentRate: 1350, house: 'blue', series: null });
    expect(view.usd?.approx).toBe(true);
  });

  it('offline with no current rate either: rows stay NULL, nothing throws', async () => {
    const id = addTx('2024-03-15');
    const result = await backfillFxRatesHistorical(db, { house: 'blue', currentRate: null, fetchFn: offline(), today: TODAY });
    expect(result).toEqual({ updated: 0, exact: 0, approx: 0 });
    expect(rowOf(id)).toEqual({ fx: null, src: null });
  });

  it('a Saturday purchase takes Friday\'s close (lookback), and a clean 404 is not "offline"', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/2024/03/16')) return { ok: false, json: async () => null };
      return { ok: true, json: async () => ({ venta: 990 }) };
    }) as unknown as typeof fetch;
    const res = await getHistoricalRate(db, 'blue', '2024-03-16', { fetchFn });
    expect(res).toEqual({ rate: 990, offline: false });
    expect(calls).toEqual([historicalRateUrl('blue', '2024-03-16'), historicalRateUrl('blue', '2024-03-15')]);
    expect(readHistoricalRateCache(db, 'blue', '2024-03-16')).toBe(990);
  });

  it('rows already carrying a rate are never touched', async () => {
    const frozen = addTx('2024-03-15', { fxRate: 900 });
    await backfillFxRatesHistorical(db, { house: 'blue', currentRate: 1350, fetchFn: okFetch(1000), today: TODAY });
    expect(rowOf(frozen)).toEqual({ fx: 900, src: null });
  });
});

describe('writers stamp their provenance', () => {
  it('a manual entry dated today is a day rate; a back-dated one is a process rate', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const a = await invoke<string>('finance:addTransaction', { type: 'expense', amount: 1000, date: today });
    const b = await invoke<string>('finance:addTransaction', { type: 'expense', amount: 1000, date: '2026-01-15' });
    expect(rowOf(a)).toEqual({ fx: 1350, src: 'day' });
    expect(rowOf(b)).toEqual({ fx: 1350, src: 'process' });
  });

  it('a generated recurring row and a statement payment are process rates', async () => {
    const recId = await invoke<string>('finance:addRecurring', { name: 'Luz', type: 'expense', amount: 1000, billingDay: 10 });
    await invoke('finance:generateRecurringForMonth', '2026-01');
    expect(rowOf(`recurring:${recId}:2026-01`)).toEqual({ fx: 1350, src: 'process' });

    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    await invoke('finance:addTransaction', { type: 'expense', amount: 5000, date: '2026-01-10', paymentMethod: 'credit_card', creditCardId: cardId });
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-01');
    await invoke('finance:payStatement', statementId, 5000, undefined, undefined, '2026-01-25');
    const payment = db.prepare(
      'SELECT fx_rate_source AS src FROM finance_transactions WHERE id = (SELECT transaction_id FROM finance_credit_card_statements WHERE id = ?)',
    ).get(statementId) as { src: string | null };
    expect(payment.src).toBe('process');
  });
});
