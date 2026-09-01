/**
 * Review 08-2026, finding #4 (high): "real +X%" of the month on screen was
 * ALWAYS the nominal figure. The current month never has a published IPC index
 * (INDEC publishes mid next month), `coefficientForMonth` answered `1` for it,
 * and `1` was treated as data — so "nominal +8% · real +8%" every single month.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  buildIpcCoefficients,
  coefficientDetail,
  coefficientForMonth,
  convertArsToToday,
  convertTransactionAmount,
} from '@modules/finance/utils/valuation';
import { computeValuedView, type IpcSeriesPoint } from '../../../electron/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

let db: Database.Database;
let seq = 0;

function addTx(amount: number, date: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source, installments, impacts_balance, created_at, updated_at)
    VALUES (?, 'expense', ?, 'ARS', 'Otros', '', ?, 'cash', 'manual', 1, 1, ?, ?)
  `).run(`tx${++seq}`, amount, date, now, now);
}

/** Last index published: July. August (and September) are unpublished. */
const SERIES_TO_JULY: IpcSeriesPoint[] = [
  { month: '2026-06', index: 100 },
  { month: '2026-07', index: 150 },
];

beforeEach(() => {
  db = setupDb();
  seq = 0;
});

describe('coefficientDetail — exact vs assumed', () => {
  it('a published month is exact, an unpublished one is an assumed 1, an older one does not exist', () => {
    const coefs = buildIpcCoefficients(SERIES_TO_JULY)!;
    expect(coefficientDetail(coefs, '2026-06')).toEqual({ coef: 1.5, assumed: false });
    expect(coefficientDetail(coefs, '2026-07')).toEqual({ coef: 1, assumed: false });
    expect(coefficientDetail(coefs, '2026-08')).toEqual({ coef: 1, assumed: true });
    expect(coefficientDetail(coefs, '2016-01')).toBeNull();
    // The legacy helper keeps answering the number.
    expect(coefficientForMonth(coefs, '2026-08')).toBe(1);
  });

  it('convertArsToToday flags an unpublished month as approximate', () => {
    const coefs = buildIpcCoefficients(SERIES_TO_JULY);
    expect(convertArsToToday(1000, '2026-06', coefs)).toEqual({ value: 1500, approx: false });
    expect(convertArsToToday(1000, '2026-09', coefs)).toEqual({ value: 1000, approx: true });
    const row = { amount: 1000, currency: 'ARS', fxRate: null, date: '2026-09-01' };
    expect(convertTransactionAmount(row, 'ars-today', { currentRate: null, coefs }).approx).toBe(true);
  });
});

describe('computeValuedView.trend — no number where INDEC has none', () => {
  it('September vs August with the series ending in July: real is null and flagged pending, nominal stays', () => {
    addTx(100000, '2026-08-10');
    addTx(108000, '2026-09-10');
    const view = computeValuedView(db, '2026-09', { currentRate: null, house: 'blue', series: SERIES_TO_JULY });
    expect(view.trend.nominalPct).toBe(8);
    expect(view.trend.realPct).toBeNull();
    expect(view.trend.realPending).toBe(true);
  });

  it('August vs July: July is exact but August is not published yet → still pending', () => {
    addTx(100000, '2026-07-10');
    addTx(108000, '2026-08-10');
    const view = computeValuedView(db, '2026-08', { currentRate: null, house: 'blue', series: SERIES_TO_JULY });
    expect(view.trend.realPct).toBeNull();
    expect(view.trend.realPending).toBe(true);
    // And "ARS de hoy" for that month is honest about its coefficient of 1.
    expect(view.arsToday?.approx).toBe(true);
  });

  it('July vs June, both published: a real figure, not pending', () => {
    addTx(100000, '2026-06-10'); // ×1.5 → 150.000 in July pesos
    addTx(150000, '2026-07-10'); // ×1
    const view = computeValuedView(db, '2026-07', { currentRate: null, house: 'blue', series: SERIES_TO_JULY });
    expect(view.trend.nominalPct).toBe(50);
    expect(view.trend.realPct).toBe(0);
    expect(view.trend.realPending).toBe(false);
    // The viewed month itself converts exactly (its index is published).
    expect(view.arsToday?.balance.expenses).toBe(150000);
  });

  it('no series at all: nothing pending, nothing real', () => {
    addTx(100000, '2026-08-10');
    addTx(108000, '2026-09-10');
    const view = computeValuedView(db, '2026-09', { currentRate: null, house: 'blue', series: null });
    expect(view.trend.realPct).toBeNull();
    expect(view.trend.realPending).toBe(false);
    expect(view.arsToday).toBeNull();
  });
});
