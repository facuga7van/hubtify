import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  buildIpcCoefficients,
  coefficientForMonth,
  convertArsToToday,
  nominalAndRealTrend,
} from '@modules/finance/utils/valuation';
import {
  computeValuedView,
  getIpcSeries,
  parseIpcApiResponse,
  readIpcSeriesCache,
  type IpcSeriesPoint,
} from '../../../shared-logic/modules/finance.balance';
import { vi } from 'vitest';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

let db: Database.Database;
let seq = 0;

function addTx(opts: {
  type?: 'expense' | 'income';
  amount: number;
  date: string;
  fxRate?: number | null;
  currency?: string;
  category?: string;
  impactsBalance?: number;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, impacts_balance, fx_rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', ?, 'cash', 'manual', 1, ?, ?, ?, ?)
  `).run(
    `tx${++seq}`,
    opts.type ?? 'expense',
    opts.amount,
    opts.currency ?? 'ARS',
    opts.category ?? 'Otros',
    opts.date,
    opts.impactsBalance ?? 1,
    opts.fxRate ?? null,
    now,
    now,
  );
}

// Index doubles over three months: 100 → 150 → 200.
const SERIES: IpcSeriesPoint[] = [
  { month: '2026-06', index: 100 },
  { month: '2026-07', index: 150 },
  { month: '2026-08', index: 200 },
];

beforeEach(() => {
  db = setupDb();
  seq = 0;
});

// ── API parsing ────────────────────────────────────────────────────────────

describe('parseIpcApiResponse', () => {
  it('parses the datos.gob.ar shape into monthly points', () => {
    const parsed = parseIpcApiResponse({
      data: [['2026-06-01', 100.5], ['2026-07-01', 150.25]],
    });
    expect(parsed).toEqual([
      { month: '2026-06', index: 100.5 },
      { month: '2026-07', index: 150.25 },
    ]);
  });

  it('drops nulls (unpublished months) and garbage rows', () => {
    const parsed = parseIpcApiResponse({
      data: [['2026-06-01', 100], ['2026-07-01', null], 'nope', ['bad-date', 5], ['2026-08-01', -3]],
    });
    expect(parsed).toEqual([{ month: '2026-06', index: 100 }]);
  });

  it('answers an empty list for a broken payload', () => {
    expect(parseIpcApiResponse(null)).toEqual([]);
    expect(parseIpcApiResponse({})).toEqual([]);
  });
});

// ── Cumulative coefficient ─────────────────────────────────────────────────

describe('IPC coefficients', () => {
  it('cumulative coefficient = latestIndex / monthIndex', () => {
    const coefs = buildIpcCoefficients(SERIES)!;
    expect(coefs.latestMonth).toBe('2026-08');
    expect(coefficientForMonth(coefs, '2026-06')).toBe(2);     // 200/100
    expect(coefficientForMonth(coefs, '2026-07')).toBeCloseTo(200 / 150);
    expect(coefficientForMonth(coefs, '2026-08')).toBe(1);
  });

  it('months after the latest index (IPC lags) count as today\'s pesos', () => {
    const coefs = buildIpcCoefficients(SERIES)!;
    expect(coefficientForMonth(coefs, '2026-09')).toBe(1);
  });

  it('months before the series have no honest coefficient', () => {
    const coefs = buildIpcCoefficients(SERIES)!;
    expect(coefficientForMonth(coefs, '2016-01')).toBeNull();
  });

  it('convertArsToToday multiplies, and flags nominal fallbacks', () => {
    const coefs = buildIpcCoefficients(SERIES);
    expect(convertArsToToday(1000, '2026-06', coefs)).toEqual({ value: 2000, approx: false });
    expect(convertArsToToday(1000, '2016-01', coefs)).toEqual({ value: 1000, approx: true });
    expect(convertArsToToday(1000, '2026-06', null)).toEqual({ value: 1000, approx: true });
  });
});

// ── Real vs nominal trend ──────────────────────────────────────────────────

describe('nominalAndRealTrend', () => {
  it('a month of equal REAL spending shows ~0% real, not the inflation', () => {
    // Prev month: 100.000 nominal at coef 200/150; this month 133.333 at coef 1
    // — nominally +33%, identical in today's pesos.
    const { nominalPct, realPct } = nominalAndRealTrend(133333.33, 100000, 1, 200 / 150);
    expect(nominalPct).toBe(33);
    expect(realPct).toBe(0);
  });

  it('reports both when spending truly grew', () => {
    const { nominalPct, realPct } = nominalAndRealTrend(160000, 100000, 1, 200 / 150);
    expect(nominalPct).toBe(60);
    expect(realPct).toBe(20); // 160000 vs 133333 in today's pesos
  });

  it('real is null when a coefficient is missing; nominal null without a prev month', () => {
    expect(nominalAndRealTrend(100, 50, null, 1).realPct).toBeNull();
    expect(nominalAndRealTrend(100, 0, 1, 1)).toEqual({ nominalPct: null, realPct: null });
  });
});

// ── getIpcSeries cache philosophy ──────────────────────────────────────────

describe('getIpcSeries', () => {
  const payload = { data: [['2026-06-01', 100], ['2026-07-01', 150]] };

  it('fetches on a cold cache and stores the series in dollar_cache["ipc"]', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
    const series = await getIpcSeries(db, { fetchFn });
    expect(series).toHaveLength(2);
    expect(readIpcSeriesCache(db)?.series[0]).toEqual({ month: '2026-06', index: 100 });
  });

  it('serves a fresh cache without the network, and a stale one when offline', async () => {
    db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('ipc', ?, datetime('now'))`)
      .run(JSON.stringify(SERIES));
    const fetchFn = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await getIpcSeries(db, { fetchFn })).toHaveLength(3);
    expect(fetchFn).not.toHaveBeenCalled();

    // Stale cache + offline → still the cache, never a crash.
    db.prepare(`UPDATE dollar_cache SET updated_at = datetime('now', '-3 days') WHERE id = 'ipc'`).run();
    expect(await getIpcSeries(db, { fetchFn })).toHaveLength(3);
  });

  it('returns null offline with nothing cached', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await getIpcSeries(db, { fetchFn })).toBeNull();
  });
});

// ── computeValuedView ──────────────────────────────────────────────────────

describe('computeValuedView', () => {
  it('USD: each amount converts at ITS OWN frozen rate; missing rates use the current one and flag approx', () => {
    addTx({ amount: 100000, date: '2026-08-10', fxRate: 1000 }); // 100 USD frozen
    addTx({ amount: 100000, date: '2026-08-11', fxRate: null }); // 50 USD at current 2000, approx

    const view = computeValuedView(db, '2026-08', { currentRate: 2000, house: 'blue', series: null });
    expect(view.usd).not.toBeNull();
    expect(view.usd!.balance.expenses).toBeCloseTo(150);
    expect(view.usd!.approx).toBe(true);
    expect(view.arsToday).toBeNull(); // no series
  });

  it('USD is null when no rate exists at all — no invented dollars', () => {
    addTx({ amount: 1000, date: '2026-08-10', fxRate: null });
    const view = computeValuedView(db, '2026-08', { currentRate: null, house: 'blue', series: SERIES });
    expect(view.usd).toBeNull();
  });

  it('the USD sparkline stops climbing when spending only followed the dollar', () => {
    // Same 100 USD of spending every month, at each month's own frozen rate.
    addTx({ amount: 100000, date: '2026-06-15', fxRate: 1000 });
    addTx({ amount: 150000, date: '2026-07-15', fxRate: 1500 });
    addTx({ amount: 200000, date: '2026-08-15', fxRate: 2000 });

    const view = computeValuedView(db, '2026-08', { currentRate: 2000, house: 'blue', series: null });
    const spark = view.usd!.monthlyExpenses;
    // Nominal ARS climbs monotonically (100k → 150k → 200k); in USD it is flat.
    expect(spark[3]).toBeCloseTo(100);
    expect(spark[4]).toBeCloseTo(100);
    expect(spark[5]).toBeCloseTo(100);
  });

  it('ARS de hoy scales each month by its cumulative coefficient', () => {
    addTx({ amount: 100000, date: '2026-06-15' }); // coef 2 → 200k
    addTx({ amount: 100000, date: '2026-08-15' }); // coef 1 → 100k

    const view = computeValuedView(db, '2026-08', { currentRate: null, house: 'blue', series: SERIES });
    expect(view.arsToday).not.toBeNull();
    const spark = view.arsToday!.monthlyExpenses;
    expect(spark[3]).toBeCloseTo(200000);
    expect(spark[5]).toBeCloseTo(100000);
    expect(view.arsToday!.balance.expenses).toBeCloseTo(100000); // the viewed month only
  });

  it('trend: equal real spending reads ~0% real while nominal shows the inflation', () => {
    addTx({ amount: 150000, date: '2026-07-10' });
    addTx({ amount: 200000, date: '2026-08-10' }); // +33% nominal, flat in real terms

    const view = computeValuedView(db, '2026-08', { currentRate: null, house: 'blue', series: SERIES });
    expect(view.trend.nominalPct).toBe(33);
    expect(view.trend.realPct).toBe(0);
  });

  it('categories use the wheel definition (card purchases in, Pago Tarjeta out)', () => {
    addTx({ amount: 100000, date: '2026-08-10', fxRate: 1000, category: 'Delivery' });
    addTx({ amount: 50000, date: '2026-08-11', fxRate: 1000, category: 'Delivery', impactsBalance: 0 }); // pending card purchase
    addTx({ amount: 150000, date: '2026-08-12', fxRate: 1000, category: 'Pago Tarjeta' }); // excluded

    const view = computeValuedView(db, '2026-08', { currentRate: 1000, house: 'blue', series: null });
    expect(view.usd!.categories).toEqual([{ category: 'Delivery', value: 150 }]);
  });
});
