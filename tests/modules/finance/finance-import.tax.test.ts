/**
 * The importer used to drop every tax line on the floor (`EXCLUDED_PATTERNS`),
 * so the total it produced could never match the paper the bank sends: stamp
 * tax, VAT debits, gross-income perceptions and financing interest are real
 * charges on the statement.
 *
 * This drives the whole chain on a simulated statement — parse → confirm →
 * generate — and asserts the peso-for-peso equality that was the point of the
 * change: two purchases, two taxes and one tax refund must add up to exactly
 * what `finance:generateStatement` writes as `calculated_amount`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { CARD_TAX_CATEGORY } from '../../../electron/modules/finance.balance';
import { parseGaliciaLine, type ParsedRow } from '../../../electron/modules/finance-import.ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../electron/ipc/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../electron/modules/finance.ipc');
const { registerFinanceImportIpcHandlers } = await import('../../../electron/modules/finance-import.ipc');

registerFinanceIpcHandlers();
registerFinanceImportIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = harness.handlers.get(channel);
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

/** Closing day 25 → every line below bills in the March statement. */
const CLOSING_DAY = 25;

/**
 * A simulated Galicia VISA statement: two purchases, a stamp tax, a CABA
 * perception and the refund of a stamp tax.
 */
const PDF_LINES = [
  'Movimientos del período',
  '05-03-26 * RAPPIPRO 299493 8.000,00',
  '10-03-26 * WWW.FRAVEGA.COM 001177 12.000,00',
  '20-03-26 IMP DE SELLOS P/INT.FIN.  $ 3,75',
  '20-03-26 IIBB PERCEP-CABA 2,00%(   14171,62) 283,43',
  '20-03-26 DEV.IMP DE SELLOS  $ 1,25',
  'TOTAL',
];

/** 8000 + 12000 + 3,75 + 283,43 − 1,25 */
const EXPECTED_TOTAL = 20285.93;

function parseAll(): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const line of PDF_LINES) {
    const parsed = parseGaliciaLine(line, new Map());
    if (parsed) rows.push(parsed);
  }
  return rows;
}

let cardId: string;

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: CLOSING_DAY });
});

describe('card taxes make the imported total match the statement', () => {
  it('parses every tax line instead of dropping it', () => {
    const rows = parseAll();
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.isTax)).toHaveLength(3);
    expect(rows.every((r) => !r.isExcluded)).toBe(true);
    // The refund keeps its sign so it can never inflate the total.
    expect(rows.find((r) => r.merchant.startsWith('DEV'))!.amountARS).toBeCloseTo(-1.25);
  });

  it('imports the tax rows onto the card, off the balance, like any purchase', async () => {
    const result = await invoke<{ count: number }>(
      'finance:importConfirm', parseAll(), '2026-03', 'resumen.pdf', cardId,
    );
    expect(result.count).toBe(5);

    const taxRows = harness.db
      .prepare(
        `SELECT type, amount, credit_card_id AS creditCardId, impacts_balance AS impactsBalance
         FROM finance_transactions
         WHERE deleted_at IS NULL AND category = ?
         ORDER BY amount ASC`,
      )
      .all(CARD_TAX_CATEGORY) as Array<{
        type: string; amount: number; creditCardId: string | null; impactsBalance: number;
      }>;

    expect(taxRows).toHaveLength(3);
    for (const row of taxRows) {
      expect(row.creditCardId).toBe(cardId);
      expect(row.impactsBalance).toBe(0);
    }
    // The refund is an income row, exactly like a reversed purchase.
    const refund = taxRows.find((r) => r.type === 'income');
    expect(refund).toBeDefined();
    expect(refund!.amount).toBeCloseTo(1.25);
  });

  it('adds up to the paper, peso for peso', async () => {
    await invoke('finance:importConfirm', parseAll(), '2026-03', 'resumen.pdf', cardId);
    const statementId = await invoke<string | null>('finance:generateStatement', cardId, '2026-03');
    expect(statementId).not.toBeNull();

    const detail = await invoke<{
      statement: { calculatedAmount: number };
      transactions: Array<{ type: string; amount: number; category: string }>;
    }>('finance:getStatementDetail', statementId!);

    expect(detail.statement.calculatedAmount).toBeCloseTo(EXPECTED_TOTAL, 2);

    // And the detail the user reads sums to the same figure — a refund counts
    // against the statement, it does not grow it.
    const sum = detail.transactions.reduce(
      (acc, tx) => acc + (tx.type === 'income' ? -tx.amount : tx.amount),
      0,
    );
    expect(sum).toBeCloseTo(EXPECTED_TOTAL, 2);
    expect(detail.transactions.filter((tx) => tx.category === CARD_TAX_CATEGORY)).toHaveLength(3);
  });

  it('leaves the taxes in the expense breakdown, unlike the statement payment', async () => {
    await invoke('finance:importConfirm', parseAll(), '2026-03', 'resumen.pdf', cardId);
    await invoke('finance:generateStatement', cardId, '2026-03');

    const breakdown = await invoke<Array<{ category: string; ARS: number }>>(
      'finance:getCategoryBreakdown', '2026-03',
    );
    const names = breakdown.map((b) => b.category);
    expect(names).toContain(CARD_TAX_CATEGORY);
    expect(names).not.toContain('Pago Tarjeta');
  });
});
