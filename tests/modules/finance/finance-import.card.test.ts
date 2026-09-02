/**
 * `finance:importConfirm` used to write every imported row with
 * `payment_method = 'credit_card'` while leaving `impacts_balance` at its
 * default `1` and `credit_card_id` NULL. The row hit the balance the moment it
 * was imported and belonged to no statement, so paying the statement counted the
 * same purchase a second time.
 *
 * These tests drive the real handlers (mocked `electron` + injected DB) rather
 * than a hand-copied version of their SQL.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { computeMonthlyBalance } from '../../../electron/modules/finance.balance';

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
  return db;
}

/** Closing day 25 → anything up to the 25th bills in the same month. */
const CLOSING_DAY = 25;

const ROWS = [
  { date: '2026-03-05', merchant: 'RAPPIPRO', amountARS: 8000, isExcluded: false, suggestedCategory: 'Delivery' },
  { date: '2026-03-10', merchant: 'FRAVEGA', amountARS: 12000, isExcluded: false, suggestedCategory: 'Compras' },
];

let cardId: string;

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: CLOSING_DAY });
});

function liveRows() {
  return harness.db
    .prepare(
      `SELECT description, payment_method AS paymentMethod, credit_card_id AS creditCardId,
              impacts_balance AS impactsBalance, amount
       FROM finance_transactions WHERE deleted_at IS NULL AND source = 'import'
       ORDER BY date ASC`,
    )
    .all() as Array<{
      description: string;
      paymentMethod: string;
      creditCardId: string | null;
      impactsBalance: number;
      amount: number;
    }>;
}

describe('finance:importConfirm — statement card assignment', () => {
  it('parks the rows on the chosen card instead of on the balance', async () => {
    const result = await invoke<{ count: number; creditCardId: string | null }>(
      'finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', cardId,
    );

    expect(result.count).toBe(2);
    expect(result.creditCardId).toBe(cardId);

    const rows = liveRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.paymentMethod).toBe('credit_card');
      expect(row.creditCardId).toBe(cardId);
      expect(row.impactsBalance).toBe(0);
    }
  });

  it('rolls the imported rows into that card\'s statement', async () => {
    await invoke('finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', cardId);

    const statementId = await invoke<string | null>('finance:generateStatement', cardId, '2026-03');
    expect(statementId).not.toBeNull();

    const detail = await invoke<{
      statement: { calculatedAmount: number };
      transactions: Array<{ description: string }>;
    }>('finance:getStatementDetail', statementId!);

    expect(detail.statement.calculatedAmount).toBe(20000);
    expect(detail.transactions.map((t) => t.description).sort()).toEqual(['FRAVEGA', 'RAPPIPRO']);
  });

  it('never counts an imported purchase twice against the balance', async () => {
    await invoke('finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', cardId);

    // Before the statement exists the purchases are off the balance entirely.
    expect(computeMonthlyBalance(harness.db, '2026-03').ARS.expenses).toBe(0);

    await invoke('finance:generateStatement', cardId, '2026-03');

    // Afterwards the ONLY impacting expense is the single statement payment —
    // 20 000 once, not 20 000 as purchases plus 20 000 as the statement.
    const impacting = harness.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total
         FROM finance_transactions
         WHERE deleted_at IS NULL AND impacts_balance = 1 AND type = 'expense'`,
      )
      .get() as { c: number; total: number };
    expect(impacting.c).toBe(1);
    expect(impacting.total).toBe(20000);
    expect(computeMonthlyBalance(harness.db, '2026-03').ARS.expenses).toBe(20000);
  });

  it('falls back to cash — not a card-less card purchase — when no card is chosen', async () => {
    const result = await invoke<{ count: number; creditCardId: string | null }>(
      'finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', null,
    );
    expect(result.creditCardId).toBeNull();

    const rows = liveRows();
    for (const row of rows) {
      expect(row.paymentMethod).toBe('cash');
      expect(row.creditCardId).toBeNull();
      expect(row.impactsBalance).toBe(1);
    }
    // No card, no statement — the rows land on the balance right away, once.
    expect(computeMonthlyBalance(harness.db, '2026-03').ARS.expenses).toBe(20000);
  });

  it('keeps the old three-argument call working', async () => {
    const result = await invoke<{ count: number }>('finance:importConfirm', ROWS, '2026-03', 'resumen.pdf');
    expect(result.count).toBe(2);
    expect(liveRows().every((r) => r.impactsBalance === 1 && r.creditCardId === null)).toBe(true);
  });

  it('refuses a card that does not exist and writes nothing', async () => {
    const result = await invoke<{ ok: false; reason: string }>(
      'finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', 'ghost-card',
    );
    expect(result).toEqual({ ok: false, reason: 'credit_card_not_found' });
    expect(liveRows()).toHaveLength(0);
    const batches = harness.db.prepare('SELECT COUNT(*) AS c FROM finance_import_batches').get() as { c: number };
    expect(batches.c).toBe(0);
  });
});
