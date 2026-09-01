import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { convertArsToUsd, convertTransactionAmount } from '@modules/finance/utils/valuation';
import {
  backfillFxRates,
  cacheAgeMs,
  getCurrentRate,
  getFxHouse,
  rateFromRates,
  readDollarRatesCache,
  setFxHouse,
} from '../../../electron/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  // app_state lives in core tables (electron/ipc/db.ts); mirror it for fx_house.
  db.exec('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return db;
}

let db: Database.Database;
let seq = 0;

function addTx(opts: { amount?: number; fxRate?: number | null; currency?: string; deleted?: boolean } = {}): string {
  const id = `tx${++seq}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, impacts_balance, fx_rate, created_at, updated_at, deleted_at)
    VALUES (?, 'expense', ?, ?, 'Otros', '', '2026-08-15', 'cash', 'manual', 1, 1, ?, ?, ?, ?)
  `).run(id, opts.amount ?? 1000, opts.currency ?? 'ARS', opts.fxRate ?? null, now, now, opts.deleted ? now : null);
  return id;
}

const RATES = [
  { casa: 'oficial', nombre: 'Oficial', compra: 1300, venta: 1350 },
  { casa: 'blue', nombre: 'Blue', compra: 1330, venta: 1370 },
];

function seedRatesCache(agedSeconds = 0): void {
  db.prepare(`
    INSERT OR REPLACE INTO dollar_cache (id, data, updated_at)
    VALUES ('rates', ?, datetime('now', ?))
  `).run(JSON.stringify(RATES), `-${agedSeconds} seconds`);
}

function okFetch(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
}

function failFetch() {
  return vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
}

beforeEach(() => {
  db = setupDb();
  seq = 0;
});

// ── Migration v16 ──────────────────────────────────────────────────────────

describe('migration v16', () => {
  it('adds fx_rate to finance_transactions, NULL by default', () => {
    const cols = db.prepare("PRAGMA table_info('finance_transactions')").all() as Array<{ name: string; dflt_value: unknown }>;
    const fx = cols.find((c) => c.name === 'fx_rate');
    expect(fx).toBeDefined();
    const id = addTx({ fxRate: null });
    const row = db.prepare('SELECT fx_rate AS fxRate FROM finance_transactions WHERE id = ?').get(id) as { fxRate: number | null };
    expect(row.fxRate).toBeNull();
  });

  it('adds due_day to finance_credit_cards, NULL by default', () => {
    db.prepare("INSERT INTO finance_credit_cards (id, name, closing_day, created_at, updated_at) VALUES ('cc1', 'Visa', 15, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    const row = db.prepare('SELECT due_day AS dueDay FROM finance_credit_cards WHERE id = ?').get('cc1') as { dueDay: number | null };
    expect(row.dueDay).toBeNull();
  });
});

// ── fx house preference ────────────────────────────────────────────────────

describe('fx house', () => {
  it("defaults to 'blue' when nothing is stored", () => {
    expect(getFxHouse(db)).toBe('blue');
  });

  it('stores and reads back a house, lowercased', () => {
    expect(setFxHouse(db, 'Oficial')).toEqual({ ok: true, house: 'oficial' });
    expect(getFxHouse(db)).toBe('oficial');
  });

  it('rejects an empty house', () => {
    expect(setFxHouse(db, '   ')).toEqual({ ok: false, reason: 'invalid_house' });
  });
});

// ── getCurrentRate ─────────────────────────────────────────────────────────

describe('getCurrentRate', () => {
  it('serves a fresh cache (<1h) without touching the network', async () => {
    seedRatesCache(60); // 1 minute old
    const fetchFn = okFetch([{ casa: 'blue', venta: 9999 }]);
    const rate = await getCurrentRate(db, 'blue', { fetchFn });
    expect(rate).toBe(1370);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches when the cache is stale, refreshing it', async () => {
    seedRatesCache(2 * 60 * 60); // 2 hours old
    const fetchFn = okFetch([{ casa: 'blue', nombre: 'Blue', venta: 1400 }]);
    const rate = await getCurrentRate(db, 'blue', { fetchFn });
    expect(rate).toBe(1400);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // Cache refreshed with the fetched payload.
    const cached = readDollarRatesCache(db);
    expect(cached?.rates[0].venta).toBe(1400);
  });

  it('falls back to the stale cache when the fetch fails (offline)', async () => {
    seedRatesCache(2 * 60 * 60);
    const rate = await getCurrentRate(db, 'blue', { fetchFn: failFetch() });
    expect(rate).toBe(1370);
  });

  it('returns null offline with no cache — and never throws', async () => {
    const rate = await getCurrentRate(db, 'blue', { fetchFn: failFetch() });
    expect(rate).toBeNull();
  });

  it('falls back to blue, then the first entry, for an unknown house', () => {
    expect(rateFromRates(RATES, 'cripto')).toBe(1370); // blue fallback
    expect(rateFromRates([RATES[0]], 'cripto')).toBe(1350); // first entry
    expect(rateFromRates([], 'blue')).toBeNull();
  });

  it('treats an unparseable cache stamp as stale', () => {
    expect(cacheAgeMs('garbage')).toBe(Infinity);
    // SQLite datetime('now') format (space, UTC) parses fine.
    expect(cacheAgeMs('2026-08-31 10:00:00', Date.UTC(2026, 7, 31, 10, 30, 0))).toBe(30 * 60 * 1000);
  });
});

// ── backfillFxRates ────────────────────────────────────────────────────────

describe('backfillFxRates', () => {
  it('fills only live NULL rows, and is idempotent', () => {
    const bare = addTx({ fxRate: null });
    const frozen = addTx({ fxRate: 900 });
    const deleted = addTx({ fxRate: null, deleted: true });

    expect(backfillFxRates(db, 1370)).toBe(1);
    // Second pass finds nothing to do.
    expect(backfillFxRates(db, 1400)).toBe(0);

    const get = (id: string) => (db.prepare('SELECT fx_rate AS fx FROM finance_transactions WHERE id = ?').get(id) as { fx: number | null }).fx;
    expect(get(bare)).toBe(1370);
    expect(get(frozen)).toBe(900); // never rewrites a frozen rate
    expect(get(deleted)).toBeNull(); // soft-deleted rows stay untouched
  });

  it('rejects a garbage rate without writing', () => {
    addTx({ fxRate: null });
    expect(backfillFxRates(db, 0)).toBe(0);
    expect(backfillFxRates(db, NaN)).toBe(0);
  });

  it('bumps updated_at so LWW sync carries the backfill', () => {
    const id = addTx({ fxRate: null });
    db.prepare("UPDATE finance_transactions SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(id);
    backfillFxRates(db, 1370);
    const row = db.prepare('SELECT updated_at AS u FROM finance_transactions WHERE id = ?').get(id) as { u: string };
    expect(row.u > '2020-01-01T00:00:00Z').toBe(true);
  });
});

// ── USD conversion: own frozen rate vs current-rate fallback ───────────────

describe('convertArsToUsd', () => {
  it('uses the row\'s own frozen rate when present (exact, not approx)', () => {
    expect(convertArsToUsd(137000, 1370, 2000)).toEqual({ value: 100, approx: false });
  });

  it('falls back to the current rate and flags approx when no frozen rate', () => {
    expect(convertArsToUsd(200000, null, 2000)).toEqual({ value: 100, approx: true });
  });

  it('returns null when no rate exists at all', () => {
    expect(convertArsToUsd(1000, null, null)).toBeNull();
  });

  it('convertTransactionAmount leaves USD rows untouched and honours mode', () => {
    const ctx = { currentRate: 2000, coefs: null };
    const usdRow = { amount: 50, currency: 'USD', fxRate: null, date: '2026-08-15' };
    expect(convertTransactionAmount(usdRow, 'usd', ctx)).toEqual({ value: 50, currency: 'USD', approx: false });

    const arsRow = { amount: 137000, currency: 'ARS', fxRate: 1370, date: '2026-08-15' };
    expect(convertTransactionAmount(arsRow, 'ars', ctx)).toEqual({ value: 137000, currency: 'ARS', approx: false });
    expect(convertTransactionAmount(arsRow, 'usd', ctx)).toEqual({ value: 100, currency: 'USD', approx: false });
    // No frozen rate → current rate + approx flag.
    expect(convertTransactionAmount({ ...arsRow, fxRate: null }, 'usd', ctx))
      .toEqual({ value: 68.5, currency: 'USD', approx: true });
  });
});
