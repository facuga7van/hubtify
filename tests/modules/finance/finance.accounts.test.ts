import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  DEFAULT_CASH_ACCOUNT_ID,
  TRANSFER_CATEGORY,
  RESERVED_CATEGORIES,
  computeAccountDeltas,
  computeAccountsOverview,
  computeCategorySpend,
  computeMonthlyBalance,
  listAccounts,
  monthRange,
  saveAccount,
  softDeleteAccount,
  transferBetweenAccounts,
} from '../../../shared-logic/modules/finance.balance';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

/** Mirrors the columns `finance:addTransaction` writes, account included. */
function addTransaction(
  db: Database.Database,
  id: string,
  tx: {
    type: 'expense' | 'income';
    amount: number;
    currency?: string;
    category?: string;
    date: string;
    accountId?: string | null;
    impactsBalance?: boolean;
    deletedAt?: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, impacts_balance, account_id, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, '', ?, 'cash', 'manual', 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    tx.type,
    tx.amount,
    tx.currency ?? 'ARS',
    tx.category ?? 'Otros',
    tx.date,
    tx.impactsBalance === false ? 0 : 1,
    tx.accountId ?? null,
    now,
    now,
    tx.deletedAt ?? null,
  );
}

describe('finance accounts — migration & deterministic seed', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('creates finance_accounts and the new transaction columns', () => {
    const cols = (db.pragma('table_info(finance_accounts)') as Array<{ name: string }>).map((c) => c.name);
    for (const col of ['id', 'name', 'kind', 'currency', 'initial_balance', 'account_order', 'created_at', 'updated_at', 'deleted_at']) {
      expect(cols, `column ${col}`).toContain(col);
    }
    const txCols = (db.pragma('table_info(finance_transactions)') as Array<{ name: string }>).map((c) => c.name);
    expect(txCols).toContain('account_id');
    expect(txCols).toContain('transfer_group_id');
  });

  it('seeds exactly one «Efectivo» account with the deterministic id', () => {
    const rows = db.prepare('SELECT id, name, kind, currency, initial_balance AS ib FROM finance_accounts').all() as
      Array<{ id: string; name: string; kind: string; currency: string; ib: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: DEFAULT_CASH_ACCOUNT_ID, name: 'Efectivo', kind: 'cash', currency: 'ARS', ib: 0,
    });
  });

  it('two devices migrating in parallel converge on the SAME account row', () => {
    const other = setupDb();
    const a = db.prepare('SELECT id FROM finance_accounts').get() as { id: string };
    const b = other.prepare('SELECT id FROM finance_accounts').get() as { id: string };
    expect(a.id).toBe(b.id);
    other.close();
  });

  it('saving the deterministic id again updates instead of duplicating (idempotent)', () => {
    const res = saveAccount(db, { id: DEFAULT_CASH_ACCOUNT_ID, name: 'Efectivo', kind: 'cash', initialBalance: 5000 });
    expect(res.ok).toBe(true);
    const rows = db.prepare('SELECT COUNT(*) AS c FROM finance_accounts').get() as { c: number };
    expect(rows.c).toBe(1);
    expect(listAccounts(db)[0].initialBalance).toBe(5000);
  });

  it('registers Transferencia as a reserved category present in the table', () => {
    expect([...RESERVED_CATEGORIES]).toContain(TRANSFER_CATEGORY);
    const names = (db.prepare('SELECT name FROM finance_categories').all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain(TRANSFER_CATEGORY);
  });
});

describe('finance accounts — balance per account', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('balance = initial + live income − live expenses, own currency only', () => {
    const acc = saveAccount(db, { name: 'Banco', kind: 'bank', initialBalance: 1000 });
    if (!acc.ok) throw new Error('saveAccount failed');

    addTransaction(db, 't1', { type: 'income', amount: 500, date: '2026-08-05', accountId: acc.id });
    addTransaction(db, 't2', { type: 'expense', amount: 200, date: '2026-08-06', accountId: acc.id });
    // Soft-deleted: must not count.
    addTransaction(db, 't3', { type: 'expense', amount: 300, date: '2026-08-07', accountId: acc.id, deletedAt: '2026-08-08T00:00:00Z' });
    // Card purchase (impacts_balance = 0): money has not left yet.
    addTransaction(db, 't4', { type: 'expense', amount: 400, date: '2026-08-08', accountId: acc.id, impactsBalance: false });
    // USD row filed under an ARS account: wrong unit, must not be summed raw.
    addTransaction(db, 't5', { type: 'expense', amount: 50, currency: 'USD', date: '2026-08-09', accountId: acc.id });
    // Unassigned row: belongs to no account.
    addTransaction(db, 't6', { type: 'expense', amount: 999, date: '2026-08-09', accountId: null });

    const overview = computeAccountsOverview(db);
    const banco = overview.accounts.find((a) => a.id === acc.id);
    expect(banco?.balance).toBe(1000 + 500 - 200);
    // Efectivo (seed, 0) + Banco.
    expect(overview.totalArs).toBe(1300);
    expect(overview.totalUsd).toBe(0);
  });

  it('a dangling account_id (account not synced in yet) is simply invisible', () => {
    addTransaction(db, 'orphan', { type: 'income', amount: 700, date: '2026-08-05', accountId: 'ghost-account' });
    expect(computeAccountDeltas(db).has('ghost-account')).toBe(false);
    expect(computeAccountsOverview(db).totalArs).toBe(0);
  });
});

describe('finance accounts — transfers', () => {
  let db: Database.Database;
  let fromId: string;
  let toId: string;

  beforeEach(() => {
    db = setupDb();
    const from = saveAccount(db, { name: 'Mercado Pago', kind: 'wallet', initialBalance: 10000 });
    const to = saveAccount(db, { name: 'Banco', kind: 'bank', initialBalance: 2000 });
    if (!from.ok || !to.ok) throw new Error('setup failed');
    fromId = from.id;
    toId = to.id;
  });

  it('creates a consistent live pair sharing a transfer_group_id', () => {
    const res = transferBetweenAccounts(db, { fromId, toId, amount: 500, date: '2026-08-10' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rows = db.prepare(`
      SELECT id, type, amount, currency, category, account_id AS accountId,
             transfer_group_id AS groupId, impacts_balance AS impacts, deleted_at AS deletedAt
      FROM finance_transactions
      WHERE transfer_group_id = ?
      ORDER BY type ASC
    `).all(res.transferGroupId) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    const [expense, income] = rows;
    expect(expense).toMatchObject({ type: 'expense', amount: 500, category: TRANSFER_CATEGORY, accountId: fromId, impacts: 1, deletedAt: null });
    expect(income).toMatchObject({ type: 'income', amount: 500, category: TRANSFER_CATEGORY, accountId: toId, impacts: 1, deletedAt: null });
    expect(expense.groupId).toBe(income.groupId);
  });

  it('moves both balances without inflating the month totals or the wheel', () => {
    // A real expense so the month is not trivially empty.
    addTransaction(db, 'real', { type: 'expense', amount: 100, category: 'Delivery', date: '2026-08-10', accountId: fromId });
    const res = transferBetweenAccounts(db, { fromId, toId, amount: 500, date: '2026-08-10' });
    expect(res.ok).toBe(true);

    const overview = computeAccountsOverview(db);
    expect(overview.accounts.find((a) => a.id === fromId)?.balance).toBe(10000 - 100 - 500);
    expect(overview.accounts.find((a) => a.id === toId)?.balance).toBe(2000 + 500);

    // Month totals: only the real expense counts, neither transfer leg does.
    const balance = computeMonthlyBalance(db, '2026-08');
    expect(balance.ARS.expenses).toBe(100);
    expect(balance.ARS.income).toBe(0);

    // The wheel never shows a Transferencia slice.
    const spend = computeCategorySpend(db, monthRange('2026-08'));
    expect(spend.map((c) => c.category)).not.toContain(TRANSFER_CATEGORY);
    expect(spend.find((c) => c.category === 'Delivery')?.ARS).toBe(100);
  });

  it('refuses mixed currencies, same account, dead accounts and bad amounts', () => {
    const usd = saveAccount(db, { name: 'Caja USD', kind: 'cash', currency: 'USD' });
    if (!usd.ok) throw new Error('setup failed');

    expect(transferBetweenAccounts(db, { fromId, toId: usd.id, amount: 100, date: '2026-08-10' }))
      .toMatchObject({ ok: false, reason: 'transfer_currency_mismatch' });
    expect(transferBetweenAccounts(db, { fromId, toId: fromId, amount: 100, date: '2026-08-10' }))
      .toMatchObject({ ok: false, reason: 'same_account' });
    expect(transferBetweenAccounts(db, { fromId, toId: 'ghost', amount: 100, date: '2026-08-10' }))
      .toMatchObject({ ok: false, reason: 'account_not_found' });
    expect(transferBetweenAccounts(db, { fromId, toId, amount: -5, date: '2026-08-10' }))
      .toMatchObject({ ok: false, reason: 'invalid_amount' });
    expect(transferBetweenAccounts(db, { fromId, toId, amount: 100, date: 'nope' }))
      .toMatchObject({ ok: false, reason: 'invalid_date' });

    // Nothing was written by any refused attempt.
    const count = db.prepare('SELECT COUNT(*) AS c FROM finance_transactions').get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('finance accounts — soft delete keeps history', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('removes the account from reads but leaves its transactions linked', () => {
    const acc = saveAccount(db, { name: 'Banco', kind: 'bank', initialBalance: 1000 });
    if (!acc.ok) throw new Error('setup failed');
    addTransaction(db, 't1', { type: 'expense', amount: 200, date: '2026-08-05', accountId: acc.id });

    expect(softDeleteAccount(db, acc.id)).toEqual({ ok: true });
    expect(softDeleteAccount(db, acc.id)).toMatchObject({ ok: false, reason: 'account_not_found' });

    // Gone from the chest…
    expect(listAccounts(db).map((a) => a.id)).not.toContain(acc.id);
    expect(computeAccountsOverview(db).totalArs).toBe(0);

    // …but the ledger row still remembers where the money went.
    const tx = db.prepare('SELECT account_id AS accountId, deleted_at AS deletedAt FROM finance_transactions WHERE id = ?')
      .get('t1') as { accountId: string; deletedAt: string | null };
    expect(tx.accountId).toBe(acc.id);
    expect(tx.deletedAt).toBeNull();

    // And the month totals never lost the expense — it is history, not trash.
    expect(computeMonthlyBalance(db, '2026-08').ARS.expenses).toBe(200);
  });

  it('saveAccount with a soft-deleted id revives the row instead of duplicating', () => {
    const acc = saveAccount(db, { name: 'Banco', kind: 'bank' });
    if (!acc.ok) throw new Error('setup failed');
    softDeleteAccount(db, acc.id);
    const again = saveAccount(db, { id: acc.id, name: 'Banco Nación', kind: 'bank' });
    expect(again.ok).toBe(true);
    const live = listAccounts(db).filter((a) => a.id === acc.id);
    expect(live).toHaveLength(1);
    expect(live[0].name).toBe('Banco Nación');
  });
});

describe('finance accounts — alta con accountId', () => {
  it('a transaction written with an accountId lands on that account only', () => {
    const db = setupDb();
    const acc = saveAccount(db, { name: 'Banco', kind: 'bank' });
    if (!acc.ok) throw new Error('setup failed');

    addTransaction(db, 'with-account', { type: 'income', amount: 700, date: '2026-08-05', accountId: acc.id });
    addTransaction(db, 'without-account', { type: 'income', amount: 300, date: '2026-08-05', accountId: null });

    const deltas = computeAccountDeltas(db);
    expect(deltas.get(acc.id)).toBe(700);
    // The unassigned row belongs to no account — including the seeded Efectivo.
    expect(deltas.get(DEFAULT_CASH_ACCOUNT_ID)).toBeUndefined();
    // Both still count for the month: account assignment never changes totals.
    expect(computeMonthlyBalance(db, '2026-08').ARS.income).toBe(1000);
  });
});
