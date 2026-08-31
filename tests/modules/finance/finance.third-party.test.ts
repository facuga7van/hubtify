/**
 * Two things the ledger got wrong about other people's money:
 *
 *  1. `for_third_party` is a 0/1 flag and the UI printed it, so every
 *     third-party row read "→ 1". The name lives on the loan that shares the
 *     instalment group; the read handlers now resolve it.
 *  2. A repayment form with no currency wrote every payment as ARS, including
 *     the ones against a USD loan — where the amount was then subtracted raw.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

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
registerFinanceIpcHandlers();

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

beforeEach(() => { harness.db = setupDb(); });

describe('third-party rows carry the person\'s name', () => {
  interface Row { description: string; forThirdParty: number; thirdPartyName: string | null }

  async function createPurchase() {
    return invoke<{ groupId: string; loanId: string }>('finance:createThirdPartyPurchase', {
      description: 'Notebook',
      installmentCount: 3,
      installmentAmount: 50000,
      category: 'Compras',
      startDate: '2026-03-10',
      personName: 'Malena',
    });
  }

  it('finance:getTransactions resolves the loan holder', async () => {
    await createPurchase();
    const rows = await invoke<Row[]>('finance:getTransactions', { month: '2026-03' });
    expect(rows).toHaveLength(1);
    expect(rows[0].forThirdParty).toBe(1);
    expect(rows[0].thirdPartyName).toBe('Malena');
  });

  it('finance:getInstallmentsForMonth resolves it too', async () => {
    await createPurchase();
    const rows = await invoke<Row[]>('finance:getInstallmentsForMonth', '2026-04');
    expect(rows).toHaveLength(1);
    expect(rows[0].thirdPartyName).toBe('Malena');
  });

  it('finance:getInstallmentGroups resolves it without inflating the row count', async () => {
    await createPurchase();
    const groups = await invoke<Array<{ thirdPartyName: string | null; transactionCount: number }>>(
      'finance:getInstallmentGroups',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].thirdPartyName).toBe('Malena');
    expect(groups[0].transactionCount).toBe(3);
  });

  it('leaves thirdPartyName null for an ordinary purchase', async () => {
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 1000, date: '2026-03-05', category: 'Compras',
    });
    const rows = await invoke<Row[]>('finance:getTransactions', { month: '2026-03' });
    expect(rows[0].thirdPartyName).toBeNull();
  });

  it('a soft-deleted loan stops naming the rows', async () => {
    const { loanId } = await createPurchase();
    harness.db.prepare('UPDATE finance_loans SET deleted_at = ? WHERE id = ?')
      .run('2026-05-01T00:00:00.000Z', loanId);
    const rows = await invoke<Row[]>('finance:getTransactions', { month: '2026-03' });
    expect(rows[0].thirdPartyName).toBeNull();
  });
});

describe('finance:addLoanPayment matches the loan currency', () => {
  async function addLoan(currency: string) {
    return invoke<string>('finance:addLoan', {
      personName: 'Bruno', direction: 'lent', amount: 500,
      currency, date: '2026-03-01',
    });
  }

  it('stamps a USD loan\'s repayment as USD even when the caller says nothing', async () => {
    const loanId = await addLoan('USD');
    await invoke('finance:addLoanPayment', loanId, { amount: 100, date: '2026-03-15' });
    const payments = await invoke<Array<{ currency: string }>>('finance:getLoanPayments', loanId);
    expect(payments).toHaveLength(1);
    expect(payments[0].currency).toBe('USD');
  });

  it('refuses a payment in a different currency instead of coercing it', async () => {
    const loanId = await addLoan('USD');
    const result = await invoke('finance:addLoanPayment', loanId, {
      amount: 100, currency: 'ARS', date: '2026-03-15',
    });
    expect(result).toEqual({ ok: false, reason: 'currency_mismatch' });
    expect(await invoke<unknown[]>('finance:getLoanPayments', loanId)).toHaveLength(0);
  });

  it('accepts a matching currency', async () => {
    const loanId = await addLoan('ARS');
    const result = await invoke('finance:addLoanPayment', loanId, {
      amount: 100, currency: 'ARS', date: '2026-03-15',
    });
    expect(typeof result).toBe('string');
  });

  it('subtracts the repayment from the right currency bucket', async () => {
    const loanId = await addLoan('USD');
    await invoke('finance:addLoanPayment', loanId, { amount: 200, date: '2026-03-15' });
    const summary = await invoke<{
      ARS: { lentPending: number }; USD: { lentPending: number };
    }>('finance:getActiveLoanSummary');
    expect(summary.USD.lentPending).toBe(300);
    expect(summary.ARS.lentPending).toBe(0);
  });
});

describe('finance:getTransactions source and limit filters', () => {
  beforeEach(async () => {
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 100, date: '2026-03-01', category: 'Compras', description: 'vieja',
    });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 200, date: '2026-03-20', category: 'Delivery', description: 'nueva',
    });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 300, date: '2026-03-25', category: 'Otros',
      description: 'importada', source: 'import',
    });
  });

  it('narrows to one source', async () => {
    const rows = await invoke<Array<{ description: string }>>('finance:getTransactions', { source: 'manual' });
    expect(rows.map((r) => r.description)).toEqual(['nueva', 'vieja']);
  });

  it('caps the result set, newest first', async () => {
    const rows = await invoke<Array<{ description: string }>>('finance:getTransactions', {
      source: 'manual', limit: 1,
    });
    expect(rows.map((r) => r.description)).toEqual(['nueva']);
  });

  it('ignores a nonsense limit rather than returning nothing', async () => {
    const rows = await invoke<unknown[]>('finance:getTransactions', { limit: 'todas' });
    expect(rows).toHaveLength(3);
  });
});
