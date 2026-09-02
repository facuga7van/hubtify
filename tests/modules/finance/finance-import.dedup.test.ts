/**
 * Review 08-2026, findings #1 and #2 (critical):
 *
 *  - The import dedup key was `(date, description, amount)`. Galicia prints the
 *    ORIGINAL purchase date on every instalment line and the parser strips the
 *    `04/12` marker from the merchant, so instalments 2..N of any plan matched
 *    instalment 1 and were silently dropped as "duplicates".
 *  - `statementMonth` was received and ignored: card rows were filed into the
 *    statement their DATE implied, so a May-dated `04/12` imported from the
 *    August PDF landed in May's (paid, frozen) statement and never reached any
 *    `Pago Tarjeta`.
 *
 * These drive the real handlers (mocked `electron` + injected DB).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { DEFAULT_CASH_ACCOUNT_ID, computeMonthlyBalance, saveAccount } from '../../../shared-logic/modules/finance.balance';

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

const { registerFinanceIpcHandlers } = await import('../../../electron/modules/finance.ipc');
const { registerFinanceImportIpcHandlers } = await import('../../../electron/modules/finance-import.ipc');

registerFinanceIpcHandlers();
registerFinanceImportIpcHandlers();

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
  // A fresh rates cache so the handlers never reach for the network.
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify([{ casa: 'blue', nombre: 'Blue', compra: 990, venta: 1000 }]));
  return db;
}

/** The fridge: 12 instalments of $25.000, every line dated the purchase day. */
function fridge(installmentCurrent: number) {
  return {
    date: '2026-05-10', merchant: 'FRAVEGA', amountARS: 25000,
    installmentCurrent, installmentTotal: 12,
    isExcluded: false, suggestedCategory: 'Compras',
  };
}

const CLOSING_DAY = 28;
let cardId: string;

interface ImportResult { count: number; duplicateCount: number; creditCardId: string | null }

function liveImportRows() {
  return harness.db.prepare(`
    SELECT description, amount, installment_number AS installmentNumber, installments,
           statement_period AS statementPeriod, impacts_balance AS impactsBalance,
           account_id AS accountId, fx_rate_source AS fxRateSource
    FROM finance_transactions WHERE deleted_at IS NULL AND source = 'import'
    ORDER BY installment_number ASC, created_at ASC
  `).all() as Array<{
    description: string; amount: number; installmentNumber: number | null; installments: number;
    statementPeriod: string | null; impactsBalance: number; accountId: string | null; fxRateSource: string | null;
  }>;
}

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: CLOSING_DAY });
});

describe('finance:importConfirm — dedup keeps instalments 2..N (#1)', () => {
  it('three monthly statements of the same purchase → the three instalments enter', async () => {
    const r1 = await invoke<ImportResult>('finance:importConfirm', [fridge(1)], '2026-06', 'jun.pdf', cardId);
    const r2 = await invoke<ImportResult>('finance:importConfirm', [fridge(2)], '2026-07', 'jul.pdf', cardId);
    const r3 = await invoke<ImportResult>('finance:importConfirm', [fridge(3)], '2026-08', 'ago.pdf', cardId);

    expect([r1, r2, r3].map((r) => [r.count, r.duplicateCount])).toEqual([[1, 0], [1, 0], [1, 0]]);

    const rows = liveImportRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.installments === 12 && r.amount === 25000)).toBe(true);
    // $75.000 in, not $25.000 — the paper finally adds up across months.
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(75000);
  });

  it('re-importing the SAME statement is still a duplicate', async () => {
    await invoke('finance:importConfirm', [fridge(4)], '2026-09', 'sep.pdf', cardId);
    const again = await invoke<ImportResult>('finance:importConfirm', [fridge(4)], '2026-09', 'sep.pdf', cardId);
    expect(again.count).toBe(0);
    expect(again.duplicateCount).toBe(1);
    expect(liveImportRows()).toHaveLength(1);
  });

  it('two identical tax lines in ONE PDF both land (dedup is against previous batches only)', async () => {
    const iva = { date: '2026-08-27', merchant: 'DB IVA', amountARS: 71.75, isExcluded: false, isTax: true, suggestedCategory: 'Impuestos de tarjeta' };
    const result = await invoke<ImportResult>('finance:importConfirm', [iva, { ...iva }], '2026-09', 'sep.pdf', cardId);
    expect(result.count).toBe(2);
    expect(result.duplicateCount).toBe(0);
  });

  it('a card-less import stamps its rows as a process rate (never the line\'s own day)', async () => {
    await invoke('finance:importConfirm', [fridge(1)], '2026-06', 'jun.pdf', null);
    expect(liveImportRows()[0].fxRateSource).toBe('process');
  });
});

describe('finance:importConfirm — statementMonth is the statement period (#2)', () => {
  it('a May-dated instalment imported in the August statement belongs to August', async () => {
    await invoke('finance:importConfirm', [fridge(4)], '2026-08', 'ago.pdf', cardId);

    const [row] = liveImportRows();
    expect(row.statementPeriod).toBe('2026-08');
    expect(row.impactsBalance).toBe(0);

    // Nothing owes in May — the purchase date must NOT drag the line back there.
    expect(await invoke('finance:generateStatement', cardId, '2026-05')).toBeNull();

    const augustId = await invoke<string | null>('finance:generateStatement', cardId, '2026-08');
    expect(augustId).not.toBeNull();
    const detail = await invoke<{ statement: { calculatedAmount: number }; transactions: Array<{ description: string }> }>(
      'finance:getStatementDetail', augustId!,
    );
    expect(detail.statement.calculatedAmount).toBe(25000);
    expect(detail.transactions.map((t) => t.description)).toEqual(['FRAVEGA']);
  });

  it('once the August statement is paid the instalment leaves the August cash balance, not May\'s', async () => {
    await invoke('finance:importConfirm', [fridge(4)], '2026-08', 'ago.pdf', cardId);
    // Off the balance until the statement exists and is paid.
    expect(computeMonthlyBalance(harness.db, '2026-05').ARS.expenses).toBe(0);
    expect(computeMonthlyBalance(harness.db, '2026-08').ARS.expenses).toBe(0);

    const augustId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    expect(await invoke('finance:payStatement', augustId, 25000)).toEqual({ ok: true });

    expect(computeMonthlyBalance(harness.db, '2026-08').ARS.expenses).toBe(25000);
    expect(computeMonthlyBalance(harness.db, '2026-05').ARS.expenses).toBe(0);
  });

  it('a manual card purchase without an explicit period still follows the closing day', async () => {
    await invoke('finance:importConfirm', [fridge(4)], '2026-08', 'ago.pdf', cardId);
    // Dated after the 28th → September by the closing-day rule.
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 1000, date: '2026-08-30', paymentMethod: 'credit_card', creditCardId: cardId, category: 'Otros',
    });
    const augustId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    const august = await invoke<{ statement: { calculatedAmount: number } }>('finance:getStatementDetail', augustId);
    expect(august.statement.calculatedAmount).toBe(25000);
    const septemberId = await invoke<string>('finance:generateStatement', cardId, '2026-09');
    const september = await invoke<{ statement: { calculatedAmount: number } }>('finance:getStatementDetail', septemberId);
    expect(september.statement.calculatedAmount).toBe(1000);
  });

  it('refuses a card import without a valid statement month, writing nothing', async () => {
    const result = await invoke('finance:importConfirm', [fridge(1)], '', 'x.pdf', cardId);
    expect(result).toEqual({ ok: false, reason: 'invalid_statement_month' });
    expect(liveImportRows()).toHaveLength(0);
  });
});

describe('finance:importConfirm — account for card-less imports (#3)', () => {
  it('lands the rows on the chosen account, defaults to Efectivo, honours an explicit "sin cuenta"', async () => {
    const banco = saveAccount(harness.db, { name: 'Banco', kind: 'bank' });
    if (!banco.ok) throw new Error('setup failed');

    await invoke('finance:importConfirm', [fridge(1)], '2026-06', 'a.pdf', null, banco.id);
    await invoke('finance:importConfirm', [fridge(2)], '2026-07', 'b.pdf', null);
    await invoke('finance:importConfirm', [fridge(3)], '2026-08', 'c.pdf', null, null);

    const rows = liveImportRows();
    expect(rows.map((r) => r.accountId)).toEqual([banco.id, DEFAULT_CASH_ACCOUNT_ID, null]);
    expect(rows.every((r) => r.impactsBalance === 1)).toBe(true);
  });

  it('a card import never touches an account (the statement payment will)', async () => {
    const banco = saveAccount(harness.db, { name: 'Banco', kind: 'bank' });
    if (!banco.ok) throw new Error('setup failed');
    await invoke('finance:importConfirm', [fridge(1)], '2026-06', 'a.pdf', cardId, banco.id);
    expect(liveImportRows()[0].accountId).toBeNull();
  });

  it('refuses a dead account', async () => {
    const result = await invoke('finance:importConfirm', [fridge(1)], '2026-06', 'a.pdf', null, 'ghost');
    expect(result).toEqual({ ok: false, reason: 'account_not_found' });
    expect(liveImportRows()).toHaveLength(0);
  });
});
