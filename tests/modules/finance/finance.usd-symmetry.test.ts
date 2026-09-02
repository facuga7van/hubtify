/**
 * «Me gustaría poder poner que el ingreso es en dólares y que se calcule los
 * pesos con el dólar que recuperamos de la api, en mi caso quiero usar el
 * cripto pero debería ser elegible.»
 *
 * The hole behind that request: every aggregate in `computeValuedView` filtered
 * `currency = 'ARS'`, so a transaction in dollars was not converted — it was
 * EXCLUDED. Someone paid in dollars saw that money on no peso figure anywhere.
 *
 * What these tests pin down:
 *  1. symmetry — a USD row counts in the peso view at `amount × fx_rate`,
 *     exactly as an ARS row counts in the dollar view at `amount / fx_rate`,
 *     and a round trip lands back on the original number;
 *  2. a USD row with no frozen rate falls back to the current rate and is
 *     flagged `approx`, identically to the ARS→USD path;
 *  3. the alta freezes the rate OF THE CHOSEN HOUSE on a dollar row — pick
 *     `cripto` and the row carries the cripto venta, not the blue one;
 *  4. a transfer between own accounts still counts nowhere.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  convertArsToUsd,
  convertRowToCurrency,
  convertTransactionAmount,
  convertUsdToArs,
  buildIpcCoefficients,
  type IpcSeriesPoint,
} from '@modules/finance/utils/valuation';
import {
  computeValuedView,
  setFxHouse,
  TRANSFER_CATEGORY,
} from '../../../electron/modules/finance.balance';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../electron/modules/finance.ipc');
registerFinanceIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

/** The five houses dolarapi answers with — cripto is what the user wants. */
const RATES = [
  { casa: 'oficial', nombre: 'Oficial', compra: 1300, venta: 1310 },
  { casa: 'blue', nombre: 'Blue', compra: 1400, venta: 1430 },
  { casa: 'bolsa', nombre: 'Bolsa', compra: 1480, venta: 1500 },
  { casa: 'cripto', nombre: 'Cripto', compra: 1520, venta: 1545 },
  { casa: 'tarjeta', nombre: 'Tarjeta', compra: 1800, venta: 1860 },
];

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  db.exec('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify(RATES));
  return db;
}

let db: Database.Database;
let seq = 0;

interface TxOpts {
  type?: 'expense' | 'income';
  amount: number;
  currency?: 'ARS' | 'USD';
  date?: string;
  fxRate?: number | null;
  fxRateSource?: string | null;
  category?: string;
}

function addTx(opts: TxOpts): string {
  const id = `tx${++seq}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, impacts_balance, fx_rate, fx_rate_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', ?, 'cash', 'manual', 1, 1, ?, ?, ?, ?)
  `).run(
    id,
    opts.type ?? 'expense',
    opts.amount,
    opts.currency ?? 'ARS',
    opts.category ?? 'Otros',
    opts.date ?? '2026-08-15',
    opts.fxRate ?? null,
    opts.fxRateSource ?? (opts.fxRate == null ? null : 'day'),
    now,
    now,
  );
  return id;
}

/** Covers the whole six-month sparkline window, all at coefficient 1: any month
 *  outside the series is flagged approximate on its own, which would mask the
 *  flags these tests are actually about. */
const FLAT_SERIES: IpcSeriesPoint[] = [
  { month: '2026-03', index: 100 }, { month: '2026-04', index: 100 },
  { month: '2026-05', index: 100 }, { month: '2026-06', index: 100 },
  { month: '2026-07', index: 100 }, { month: '2026-08', index: 100 },
];

beforeEach(() => {
  db = setupDb();
  harness.db = db;
  seq = 0;
});

// ── The arithmetic, both ways ──────────────────────────────────────────────

describe('convertUsdToArs — the mirror of convertArsToUsd', () => {
  it('US$ 1.450 at the cripto rate of $1.545 is $ 2.240.250', () => {
    expect(convertUsdToArs(1450, 1545, 9999, 'day')).toEqual({ value: 2240250, approx: false });
  });

  it('falls back to the current rate and flags approx when the row has none', () => {
    expect(convertUsdToArs(100, null, 1545)).toEqual({ value: 154500, approx: true });
  });

  it('keeps the frozen number but flags a non-day provenance, like the ARS path', () => {
    expect(convertUsdToArs(100, 1545, 9999, 'backfill')).toEqual({ value: 154500, approx: true });
    expect(convertUsdToArs(100, 1545, 9999, 'process')).toEqual({ value: 154500, approx: true });
    // Legacy rows (written before the column existed) are not flagged.
    expect(convertUsdToArs(100, 1545, 9999, null)).toEqual({ value: 154500, approx: false });
  });

  it('returns null when no rate exists at all — no invented pesos', () => {
    expect(convertUsdToArs(100, null, null)).toBeNull();
  });

  it('round trip: pesos → dollars → pesos lands on the original number', () => {
    const usd = convertArsToUsd(2240250, 1545, null, 'day')!;
    expect(usd.value).toBe(1450);
    expect(convertUsdToArs(usd.value, 1545, null, 'day')!.value).toBe(2240250);
  });
});

describe('convertRowToCurrency — one entry point, both directions', () => {
  const ars = { amount: 2240250, currency: 'ARS', fxRate: 1545, fxRateSource: 'day' };
  const usd = { amount: 1450, currency: 'USD', fxRate: 1545, fxRateSource: 'day' };

  it('a row already in the target currency passes through exact', () => {
    expect(convertRowToCurrency(usd, 'USD', 1000)).toEqual({ value: 1450, approx: false });
    expect(convertRowToCurrency(ars, 'ARS', 1000)).toEqual({ value: 2240250, approx: false });
  });

  it('converts in both directions with the row\'s own frozen rate', () => {
    expect(convertRowToCurrency(ars, 'USD', 9999)).toEqual({ value: 1450, approx: false });
    expect(convertRowToCurrency(usd, 'ARS', 9999)).toEqual({ value: 2240250, approx: false });
  });

  it('an unknown currency code is treated as pesos, like the rest of the module', () => {
    expect(convertRowToCurrency({ amount: 100, currency: 'EUR', fxRate: 1000 }, 'USD', null))
      .toEqual({ value: 0.1, approx: false });
  });
});

describe('convertTransactionAmount — per-row display', () => {
  const ctx = { currentRate: 1545, coefs: null };
  const usdRow = { amount: 1450, currency: 'USD', fxRate: 1545, fxRateSource: 'day', date: '2026-08-15' };

  it('nominal mode leaves a dollar row in dollars — that mode promises no conversion', () => {
    expect(convertTransactionAmount(usdRow, 'ars', ctx)).toEqual({ value: 1450, currency: 'USD', approx: false });
  });

  it('usd mode leaves it untouched too', () => {
    expect(convertTransactionAmount(usdRow, 'usd', ctx)).toEqual({ value: 1450, currency: 'USD', approx: false });
  });

  it('ars-today converts the dollars first, then inflates the pesos', () => {
    // July index 150, June 100. A dollar row of June: 1450 × 1545 = 2.240.250
    // pesos of June, × 1.5 = 3.360.375 pesos of July.
    const coefs = buildIpcCoefficients([
      { month: '2026-06', index: 100 },
      { month: '2026-07', index: 150 },
    ] as IpcSeriesPoint[]);
    const june = { ...usdRow, date: '2026-06-10' };
    expect(convertTransactionAmount(june, 'ars-today', { currentRate: null, coefs }))
      .toEqual({ value: 3360375, currency: 'ARS', approx: false });
  });

  it('with no rate anywhere the dollars stay dollars, flagged approximate', () => {
    const bare = { ...usdRow, fxRate: null, fxRateSource: null };
    expect(convertTransactionAmount(bare, 'ars-today', { currentRate: null, coefs: null }))
      .toEqual({ value: 1450, currency: 'USD', approx: true });
  });
});

// ── The aggregates ─────────────────────────────────────────────────────────

describe('computeValuedView — a dollar income is money on the peso side', () => {
  it('US$ 1.450 frozen at cripto 1.545 shows as $ 2.240.250 in ARS de hoy', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: 1545 });
    // The series has to cover the whole six-month sparkline window: a month
    // older than the series is flagged approximate even when it holds nothing.
    const series: IpcSeriesPoint[] = [
      { month: '2026-03', index: 100 }, { month: '2026-04', index: 100 },
      { month: '2026-05', index: 100 }, { month: '2026-06', index: 100 },
      { month: '2026-07', index: 100 }, { month: '2026-08', index: 120 },
    ];
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    expect(view.arsToday?.balance.income).toBe(2240250);
    expect(view.arsToday?.balance.balance).toBe(2240250);
    expect(view.arsToday?.approx).toBe(false);
    // And in dollars it is simply itself.
    expect(view.usd?.balance.income).toBe(1450);
  });

  it('symmetry: the same money typed in pesos or in dollars gives the same two views', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: 1545 });
    const series: IpcSeriesPoint[] = [{ month: '2026-08', index: 100 }];
    const asUsd = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    db.prepare('DELETE FROM finance_transactions').run();
    addTx({ type: 'income', amount: 2240250, currency: 'ARS', date: '2026-08-15', fxRate: 1545 });
    const asArs = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    expect(asUsd.usd?.balance.income).toBe(asArs.usd?.balance.income);
    expect(asUsd.arsToday?.balance.income).toBe(asArs.arsToday?.balance.income);
    expect(asUsd.usd?.balance.income).toBe(1450);
    expect(asUsd.arsToday?.balance.income).toBe(2240250);
  });

  it('a mixed month adds both currencies into one honest total', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: 1545 });
    addTx({ type: 'income', amount: 1000000, currency: 'ARS', date: '2026-08-15', fxRate: 1545 });
    addTx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-08-16', fxRate: 1545 });

    const series: IpcSeriesPoint[] = [{ month: '2026-08', index: 100 }];
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    // Pesos: 2.240.250 + 1.000.000 income, 154.500 expense.
    expect(view.arsToday?.balance.income).toBe(3240250);
    expect(view.arsToday?.balance.expenses).toBe(154500);
    expect(view.arsToday?.balance.balance).toBe(3085750);

    // Dollars: 1450 + (1.000.000 / 1545 = 647.2492…), expense 100.
    expect(view.usd?.balance.income).toBeCloseTo(1450 + 1000000 / 1545, 2);
    expect(view.usd?.balance.expenses).toBe(100);
    expect(view.usd?.approx).toBe(false);
  });

  it('a dollar row with no frozen rate uses the current one and is flagged approximate', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: null });
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series: FLAT_SERIES });

    expect(view.arsToday?.balance.income).toBe(2240250);
    expect(view.arsToday?.approx).toBe(true);
    // The dollar side needs no rate for a dollar row, so it stays exact.
    expect(view.usd?.balance.income).toBe(1450);
    expect(view.usd?.approx).toBe(false);
  });

  it('a frozen rate written by a PROCESS keeps its ~ going to pesos too', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: 1545, fxRateSource: 'backfill' });
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series: FLAT_SERIES });
    expect(view.arsToday?.balance.income).toBe(2240250);
    expect(view.arsToday?.approx).toBe(true);
  });

  it('the expense wheel and the sparkline count dollar rows too', () => {
    addTx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-08-10', fxRate: 1545, category: 'Servicios' });
    addTx({ type: 'expense', amount: 200000, currency: 'ARS', date: '2026-08-11', fxRate: 1545, category: 'Comida' });
    addTx({ type: 'expense', amount: 50, currency: 'USD', date: '2026-07-10', fxRate: 1500, category: 'Servicios' });

    const series: IpcSeriesPoint[] = [{ month: '2026-07', index: 100 }, { month: '2026-08', index: 100 }];
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    const cats = Object.fromEntries((view.arsToday?.categories ?? []).map((c) => [c.category, c.value]));
    expect(cats.Servicios).toBe(154500);
    expect(cats.Comida).toBe(200000);

    // Six-month sparkline, [mar…ago]: July holds the 50 USD at 1500.
    expect(view.arsToday?.monthlyExpenses).toEqual([0, 0, 0, 0, 75000, 354500]);
    expect(view.usd?.monthlyExpenses[4]).toBe(50);
  });

  it('the trend compares two peso totals that both count the dollars', () => {
    addTx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-07-10', fxRate: 1000 }); // $100.000
    addTx({ type: 'expense', amount: 110000, currency: 'ARS', date: '2026-08-10', fxRate: 1545 });
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series: null });
    // Without the fix July valued 0 pesos and the trend had no previous month.
    expect(view.trend.nominalPct).toBe(10);
  });

  it('a transfer between own accounts still counts nowhere', () => {
    addTx({ type: 'income', amount: 1450, currency: 'USD', date: '2026-08-15', fxRate: 1545 });
    addTx({ type: 'expense', amount: 500, currency: 'USD', date: '2026-08-16', fxRate: 1545, category: TRANSFER_CATEGORY });
    addTx({ type: 'income', amount: 500, currency: 'USD', date: '2026-08-16', fxRate: 1545, category: TRANSFER_CATEGORY });

    const series: IpcSeriesPoint[] = [{ month: '2026-08', index: 100 }];
    const view = computeValuedView(db, '2026-08', { currentRate: 1545, house: 'cripto', series });

    expect(view.arsToday?.balance.income).toBe(2240250);
    expect(view.arsToday?.balance.expenses).toBe(0);
    expect(view.usd?.balance.income).toBe(1450);
    expect(view.usd?.balance.expenses).toBe(0);
    expect((view.arsToday?.categories ?? []).some((c) => c.category === TRANSFER_CATEGORY)).toBe(false);
  });
});

// ── The alta freezes the rate of the CHOSEN house ──────────────────────────

describe('finance:addTransaction — the house is elegible and respected', () => {
  it('a dollar income freezes the CRIPTO venta once the preference says cripto', async () => {
    setFxHouse(db, 'cripto');
    const today = new Date().toLocaleDateString('en-CA');
    const id = await invoke<string>('finance:addTransaction', {
      type: 'income', amount: 1450, currency: 'USD', date: today,
    });
    const row = db.prepare(
      'SELECT amount, currency, fx_rate AS fx, fx_rate_source AS src FROM finance_transactions WHERE id = ?',
    ).get(id) as { amount: number; currency: string; fx: number; src: string };

    expect(row).toEqual({ amount: 1450, currency: 'USD', fx: 1545, src: 'day' });
    // The whole point: US$ 1.450 × 1.545 = $ 2.240.250 on the peso side.
    expect(convertUsdToArs(row.amount, row.fx, null, row.src)).toEqual({ value: 2240250, approx: false });
  });

  it('switching the house switches the rate the next alta freezes', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    setFxHouse(db, 'blue');
    const blue = await invoke<string>('finance:addTransaction', { type: 'income', amount: 100, currency: 'USD', date: today });
    setFxHouse(db, 'oficial');
    const oficial = await invoke<string>('finance:addTransaction', { type: 'income', amount: 100, currency: 'USD', date: today });

    const fxOf = (id: string) =>
      (db.prepare('SELECT fx_rate AS fx FROM finance_transactions WHERE id = ?').get(id) as { fx: number }).fx;
    expect(fxOf(blue)).toBe(1430);
    expect(fxOf(oficial)).toBe(1310);
  });

  it('a back-dated dollar row is a process rate, so it keeps its ~ in pesos', async () => {
    setFxHouse(db, 'cripto');
    const id = await invoke<string>('finance:addTransaction', {
      type: 'income', amount: 1450, currency: 'USD', date: '2026-01-15',
    });
    const row = db.prepare('SELECT fx_rate AS fx, fx_rate_source AS src FROM finance_transactions WHERE id = ?')
      .get(id) as { fx: number; src: string };
    expect(row).toEqual({ fx: 1545, src: 'process' });
    expect(convertUsdToArs(1450, row.fx, null, row.src)?.approx).toBe(true);
  });
});
