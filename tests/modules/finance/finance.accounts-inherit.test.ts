/**
 * Review 08-2026, finding #3 (high): the chest ("Total en cuentas") only saw
 * manual entries. `Pago Tarjeta`, generated recurring rows and instalment plans
 * were all born with `account_id = NULL`, so a bank with $500.000, a generated
 * $200.000 rent and a $120.000 statement paid still printed $500.000.
 *
 * Drives the real handlers (mocked `electron` + injected DB).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  CARD_PAYMENT_CATEGORY,
  DEFAULT_CASH_ACCOUNT_ID,
  computeAccountsOverview,
  computeMonthlyBalance,
} from '../../../electron/modules/finance.balance';

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

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

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
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify([{ casa: 'blue', nombre: 'Blue', compra: 990, venta: 1000 }]));
  return db;
}

function accountOf(id: string): string | null {
  return (harness.db.prepare('SELECT account_id AS a FROM finance_transactions WHERE id = ?').get(id) as { a: string | null }).a;
}

let bancoId: string;

beforeEach(async () => {
  harness.db = setupDb();
  const res = await invoke<{ ok: true; id: string }>('finance:saveAccount', { name: 'Banco', kind: 'bank', initialBalance: 500000 });
  bancoId = res.id;
});

describe('the chest sees every kind of movement', () => {
  it('bank 500k + generated rent 200k + statement 120k paid from the bank → overview 180k', async () => {
    // Rent template that bills from the bank.
    await invoke('finance:addRecurring', {
      name: 'Alquiler', type: 'expense', amount: 200000, category: 'Servicios', billingDay: 5, accountId: bancoId,
    });
    expect(await invoke('finance:generateRecurringForMonth', '2026-08')).toBe(1);

    // A card purchase, its statement, paid from the bank.
    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 120000, date: '2026-08-10', category: 'Compras',
      paymentMethod: 'credit_card', creditCardId: cardId,
    });
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    expect(await invoke('finance:payStatement', statementId, 120000, undefined, bancoId)).toEqual({ ok: true });

    const overview = computeAccountsOverview(harness.db);
    expect(overview.accounts.find((a) => a.id === bancoId)?.balance).toBe(180000);
    // Efectivo (seed, 0) + Banco.
    expect(overview.totalArs).toBe(180000);
    // The month itself was never wrong — only the chest was.
    expect(computeMonthlyBalance(harness.db, '2026-08').ARS.expenses).toBe(320000);
  });

  it('payStatement lands the ARS leg on an ARS account and leaves the USD leg alone', async () => {
    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 50000, date: '2026-08-10', paymentMethod: 'credit_card', creditCardId: cardId,
    });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 30, currency: 'USD', date: '2026-08-11', paymentMethod: 'credit_card', creditCardId: cardId,
    });
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    await invoke('finance:payStatement', statementId, 50000, 30, bancoId);

    const rows = harness.db.prepare(
      `SELECT currency, account_id AS accountId FROM finance_transactions WHERE category = ? AND deleted_at IS NULL ORDER BY currency`,
    ).all(CARD_PAYMENT_CATEGORY) as Array<{ currency: string; accountId: string | null }>;
    expect(rows).toEqual([{ currency: 'ARS', accountId: bancoId }, { currency: 'USD', accountId: null }]);
  });

  it('payStatement without an account behaves exactly as before; a dead account is refused', async () => {
    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    await invoke('finance:addTransaction', {
      type: 'expense', amount: 10000, date: '2026-08-10', paymentMethod: 'credit_card', creditCardId: cardId,
    });
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    expect(await invoke('finance:payStatement', statementId, 10000, undefined, 'ghost')).toEqual({ ok: false, reason: 'account_not_found' });
    expect(await invoke('finance:payStatement', statementId, 10000)).toEqual({ ok: true });
    const payment = harness.db.prepare('SELECT account_id AS a FROM finance_transactions WHERE category = ?').get(CARD_PAYMENT_CATEGORY) as { a: string | null };
    expect(payment.a).toBeNull();
  });
});

describe('recurring templates carry an account', () => {
  it('generated instances inherit it; a template without one generates unassigned rows', async () => {
    const withAcc = await invoke<string>('finance:addRecurring', {
      name: 'Luz', type: 'expense', amount: 30000, billingDay: 10, accountId: bancoId,
    });
    const without = await invoke<string>('finance:addRecurring', {
      name: 'Gas', type: 'expense', amount: 20000, billingDay: 10,
    });
    await invoke('finance:generateRecurringForMonth', '2026-08');

    expect(accountOf(`recurring:${withAcc}:2026-08`)).toBe(bancoId);
    expect(accountOf(`recurring:${without}:2026-08`)).toBeNull();

    const listed = await invoke<Array<{ id: string; accountId: string | null }>>('finance:getRecurring');
    expect(listed.find((r) => r.id === withAcc)?.accountId).toBe(bancoId);
  });

  it('updateRecurring sets and clears the account; a dead one is refused', async () => {
    const id = await invoke<string>('finance:addRecurring', { name: 'Agua', type: 'expense', amount: 5000 });
    expect(await invoke('finance:updateRecurring', id, { accountId: 'ghost' })).toEqual({ ok: false, reason: 'account_not_found' });
    expect(await invoke('finance:updateRecurring', id, { accountId: bancoId })).toEqual({ ok: true });
    await invoke('finance:generateRecurringForMonth', '2026-09');
    expect(accountOf(`recurring:${id}:2026-09`)).toBe(bancoId);
    expect(await invoke('finance:updateRecurring', id, { accountId: null })).toEqual({ ok: true });
    await invoke('finance:generateRecurringForMonth', '2026-10');
    expect(accountOf(`recurring:${id}:2026-10`)).toBeNull();
  });

  it('addRecurring refuses a dead account', async () => {
    expect(await invoke('finance:addRecurring', { name: 'X', type: 'expense', amount: 1, accountId: 'ghost' }))
      .toEqual({ ok: false, reason: 'account_not_found' });
  });
});

describe('instalment plans carry an account', () => {
  function planAccounts(groupId: string): Array<string | null> {
    return (harness.db.prepare(
      'SELECT account_id AS a FROM finance_transactions WHERE installment_group_id = ? ORDER BY installment_number',
    ).all(groupId) as Array<{ a: string | null }>).map((r) => r.a);
  }

  it('a debit plan puts every instalment on the chosen account', async () => {
    const groupId = await invoke<string>('finance:createInstallmentGroup', {
      description: 'Notebook', totalAmount: 300000, installmentCount: 3, installmentAmount: 100000,
      startDate: '2026-08-01', paymentMethod: 'debit', accountId: bancoId,
    });
    expect(planAccounts(groupId)).toEqual([bancoId, bancoId, bancoId]);
    expect(computeAccountsOverview(harness.db).accounts.find((a) => a.id === bancoId)?.balance).toBe(200000);
  });

  it('a cash plan without an explicit account defaults to Efectivo; a card plan touches none', async () => {
    const cash = await invoke<string>('finance:createInstallmentGroup', {
      description: 'Bici', totalAmount: 2000, installmentCount: 2, installmentAmount: 1000,
      startDate: '2026-08-01', paymentMethod: 'cash',
    });
    expect(planAccounts(cash)).toEqual([DEFAULT_CASH_ACCOUNT_ID, DEFAULT_CASH_ACCOUNT_ID]);

    const cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
    const card = await invoke<string>('finance:createInstallmentGroup', {
      description: 'TV', totalAmount: 2000, installmentCount: 2, installmentAmount: 1000,
      startDate: '2026-08-01', paymentMethod: 'credit_card', creditCardId: cardId, accountId: bancoId,
    });
    expect(planAccounts(card)).toEqual([null, null]);
  });

  it('an explicit "sin cuenta" is honoured', async () => {
    const groupId = await invoke<string>('finance:createInstallmentGroup', {
      description: 'Silla', totalAmount: 2000, installmentCount: 2, installmentAmount: 1000,
      startDate: '2026-08-01', paymentMethod: 'cash', accountId: null,
    });
    expect(planAccounts(groupId)).toEqual([null, null]);
  });
});
