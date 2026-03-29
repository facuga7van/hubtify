import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

// ── helpers that mirror the handler SQL ────────────────────────────────────

function addTransaction(
  db: Database.Database,
  id: string,
  tx: {
    type: 'expense' | 'income';
    amount: number;
    currency?: string;
    category?: string;
    description?: string;
    date: string;
    paymentMethod?: string;
    source?: string;
    installments?: number;
    installmentGroupId?: string | null;
    forThirdParty?: boolean;
    recurringId?: string | null;
    importBatchId?: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    tx.type,
    tx.amount,
    tx.currency ?? 'ARS',
    tx.category ?? 'Otros',
    tx.description ?? '',
    tx.date,
    tx.paymentMethod ?? 'cash',
    tx.source ?? 'manual',
    tx.installments ?? 1,
    tx.installmentGroupId ?? null,
    tx.forThirdParty ? 1 : 0,
    tx.recurringId ?? null,
    tx.importBatchId ?? null,
    now,
    now,
  );
}

function getTransactions(
  db: Database.Database,
  filters: {
    month?: string;
    category?: string;
    type?: string;
    paymentMethod?: string;
    installmentGroupId?: string;
  },
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.month) {
    conditions.push('date LIKE ?');
    params.push(`${filters.month}%`);
  }
  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.paymentMethod) {
    conditions.push('payment_method = ?');
    params.push(filters.paymentMethod);
  }
  if (filters.installmentGroupId !== undefined) {
    conditions.push('installment_group_id = ?');
    params.push(filters.installmentGroupId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, type, amount, currency, category, description, date,
           payment_method AS paymentMethod, source, installments,
           installment_group_id AS installmentGroupId,
           for_third_party AS forThirdParty,
           recurring_id AS recurringId,
           import_batch_id AS importBatchId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM finance_transactions
    ${where}
    ORDER BY date DESC, created_at DESC
  `).all(...params);
}

function getMonthlyBalance(
  db: Database.Database,
  month: string,
): { ARS: { income: number; expenses: number; balance: number }; USD: { income: number; expenses: number; balance: number } } {
  const rows = db.prepare(`
    SELECT currency,
           COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
    FROM finance_transactions
    WHERE date LIKE ?
    GROUP BY currency
  `).all(`${month}%`) as Array<{ currency: string; income: number; expenses: number }>;

  const result = {
    ARS: { income: 0, expenses: 0, balance: 0 },
    USD: { income: 0, expenses: 0, balance: 0 },
  };
  for (const row of rows) {
    const key = row.currency as 'ARS' | 'USD';
    if (key === 'ARS' || key === 'USD') {
      result[key].income = row.income;
      result[key].expenses = row.expenses;
      result[key].balance = row.income - row.expenses;
    }
  }
  return result;
}

function getCategoryBreakdown(
  db: Database.Database,
  month: string,
): Array<{ category: string; ARS: number; USD: number }> {
  const rows = db.prepare(`
    SELECT category, currency,
           COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    WHERE type = 'expense' AND date LIKE ?
    GROUP BY category, currency
    ORDER BY category ASC
  `).all(`${month}%`) as Array<{ category: string; currency: string; total: number }>;

  const map = new Map<string, { ARS: number; USD: number }>();
  for (const row of rows) {
    if (!map.has(row.category)) map.set(row.category, { ARS: 0, USD: 0 });
    const entry = map.get(row.category)!;
    if (row.currency === 'ARS' || row.currency === 'USD') {
      entry[row.currency] += row.total;
    }
  }
  return Array.from(map.entries()).map(([category, amounts]) => ({ category, ...amounts }));
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('transaction handlers (SQL-level)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  // ── addTransaction + getTransactions ──────────────────────────────────

  it('adds a transaction and retrieves it by month', () => {
    addTransaction(db, 'tx-1', { type: 'expense', amount: 1500, date: '2026-03-15', category: 'Delivery' });
    addTransaction(db, 'tx-2', { type: 'income', amount: 100000, date: '2026-03-01' });
    // Different month — should not appear
    addTransaction(db, 'tx-3', { type: 'expense', amount: 999, date: '2026-02-28' });

    const rows = getTransactions(db, { month: '2026-03' }) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain('tx-1');
    expect(rows.map((r) => r.id)).toContain('tx-2');
    expect(rows.map((r) => r.id)).not.toContain('tx-3');
  });

  it('returns camelCase aliases for snake_case columns', () => {
    addTransaction(db, 'tx-alias', {
      type: 'expense',
      amount: 500,
      date: '2026-03-10',
      paymentMethod: 'credit',
      installmentGroupId: 'grp-1',
    });

    const [row] = getTransactions(db, { month: '2026-03' }) as Array<Record<string, unknown>>;
    expect(row.paymentMethod).toBe('credit');
    expect(row.installmentGroupId).toBe('grp-1');
    expect(row.forThirdParty).toBe(0);
    // snake_case aliases must NOT appear
    expect(row.payment_method).toBeUndefined();
    expect(row.installment_group_id).toBeUndefined();
  });

  it('applies category filter', () => {
    addTransaction(db, 'tx-a', { type: 'expense', amount: 200, date: '2026-03-01', category: 'Delivery' });
    addTransaction(db, 'tx-b', { type: 'expense', amount: 300, date: '2026-03-02', category: 'Transporte' });

    const rows = getTransactions(db, { category: 'Delivery' }) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tx-a');
  });

  it('applies type filter', () => {
    addTransaction(db, 'tx-exp', { type: 'expense', amount: 100, date: '2026-03-01' });
    addTransaction(db, 'tx-inc', { type: 'income', amount: 5000, date: '2026-03-01' });

    const rows = getTransactions(db, { type: 'income' }) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tx-inc');
  });

  it('applies paymentMethod filter', () => {
    addTransaction(db, 'tx-cash', { type: 'expense', amount: 100, date: '2026-03-01', paymentMethod: 'cash' });
    addTransaction(db, 'tx-credit', { type: 'expense', amount: 200, date: '2026-03-01', paymentMethod: 'credit' });

    const rows = getTransactions(db, { paymentMethod: 'credit' }) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tx-credit');
  });

  it('filters transactions by installment_group_id', () => {
    addTransaction(db, 'tx-inst-1', { type: 'expense', amount: 1000, date: '2026-03-01', installmentGroupId: 'grp-abc', installments: 3 });
    addTransaction(db, 'tx-inst-2', { type: 'expense', amount: 1000, date: '2026-04-01', installmentGroupId: 'grp-abc', installments: 3 });
    addTransaction(db, 'tx-other', { type: 'expense', amount: 500, date: '2026-03-01', installmentGroupId: null });

    const rows = getTransactions(db, { installmentGroupId: 'grp-abc' }) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.installmentGroupId === 'grp-abc')).toBe(true);
  });

  it('orders results by date DESC then created_at DESC', () => {
    addTransaction(db, 'tx-older', { type: 'expense', amount: 100, date: '2026-03-01' });
    addTransaction(db, 'tx-newer', { type: 'expense', amount: 200, date: '2026-03-15' });

    const rows = getTransactions(db, { month: '2026-03' }) as Array<Record<string, unknown>>;
    expect(rows[0].id).toBe('tx-newer');
    expect(rows[1].id).toBe('tx-older');
  });

  // ── updateTransaction ─────────────────────────────────────────────────

  it('updates transaction fields', () => {
    addTransaction(db, 'tx-upd', { type: 'expense', amount: 500, date: '2026-03-01', description: 'original' });

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    const fields = { amount: 750, description: 'updated desc', category: 'Salud', paymentMethod: 'debit' };
    if (fields.amount !== undefined) { sets.push('amount = ?'); vals.push(fields.amount); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.category !== undefined) { sets.push('category = ?'); vals.push(fields.category); }
    if (fields.paymentMethod !== undefined) { sets.push('payment_method = ?'); vals.push(fields.paymentMethod); }
    vals.push('tx-upd');

    db.prepare(`UPDATE finance_transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const row = db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get('tx-upd') as Record<string, unknown>;
    expect(row.amount).toBe(750);
    expect(row.description).toBe('updated desc');
    expect(row.category).toBe('Salud');
    expect(row.payment_method).toBe('debit');
  });

  it('partial update only touches provided fields', () => {
    addTransaction(db, 'tx-partial', { type: 'expense', amount: 300, date: '2026-03-01', category: 'Delivery' });

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    // Only update amount — category must stay
    sets.push('amount = ?');
    vals.push(999);
    vals.push('tx-partial');

    db.prepare(`UPDATE finance_transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const row = db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get('tx-partial') as Record<string, unknown>;
    expect(row.amount).toBe(999);
    expect(row.category).toBe('Delivery');
  });

  // ── deleteTransaction ─────────────────────────────────────────────────

  it('deletes a transaction', () => {
    addTransaction(db, 'tx-del', { type: 'expense', amount: 100, date: '2026-03-01' });
    expect(db.prepare('SELECT id FROM finance_transactions WHERE id = ?').get('tx-del')).toBeTruthy();

    db.prepare('DELETE FROM finance_transactions WHERE id = ?').run('tx-del');

    expect(db.prepare('SELECT id FROM finance_transactions WHERE id = ?').get('tx-del')).toBeUndefined();
  });

  it('deleting nonexistent id does not throw', () => {
    expect(() => {
      db.prepare('DELETE FROM finance_transactions WHERE id = ?').run('does-not-exist');
    }).not.toThrow();
  });

  // ── getMonthlyBalance ─────────────────────────────────────────────────

  it('returns monthly balance separated by currency', () => {
    addTransaction(db, 'b-ars-inc', { type: 'income', amount: 100000, currency: 'ARS', date: '2026-03-01' });
    addTransaction(db, 'b-ars-exp', { type: 'expense', amount: 30000, currency: 'ARS', date: '2026-03-10' });
    addTransaction(db, 'b-usd-inc', { type: 'income', amount: 500, currency: 'USD', date: '2026-03-05' });
    addTransaction(db, 'b-usd-exp', { type: 'expense', amount: 150, currency: 'USD', date: '2026-03-20' });

    const result = getMonthlyBalance(db, '2026-03');
    expect(result.ARS.income).toBe(100000);
    expect(result.ARS.expenses).toBe(30000);
    expect(result.ARS.balance).toBe(70000);
    expect(result.USD.income).toBe(500);
    expect(result.USD.expenses).toBe(150);
    expect(result.USD.balance).toBe(350);
  });

  it('returns zeros for currencies with no transactions', () => {
    addTransaction(db, 'only-ars', { type: 'income', amount: 5000, currency: 'ARS', date: '2026-03-01' });

    const result = getMonthlyBalance(db, '2026-03');
    expect(result.USD.income).toBe(0);
    expect(result.USD.expenses).toBe(0);
    expect(result.USD.balance).toBe(0);
  });

  it('ignores transactions outside the requested month', () => {
    addTransaction(db, 'in-month', { type: 'expense', amount: 1000, currency: 'ARS', date: '2026-03-15' });
    addTransaction(db, 'out-month', { type: 'expense', amount: 9999, currency: 'ARS', date: '2026-02-28' });

    const result = getMonthlyBalance(db, '2026-03');
    expect(result.ARS.expenses).toBe(1000);
  });

  // ── getCategoryBreakdown ──────────────────────────────────────────────

  it('returns category breakdown by currency', () => {
    addTransaction(db, 'cb-1', { type: 'expense', amount: 500, currency: 'ARS', category: 'Delivery', date: '2026-03-01' });
    addTransaction(db, 'cb-2', { type: 'expense', amount: 200, currency: 'ARS', category: 'Delivery', date: '2026-03-10' });
    addTransaction(db, 'cb-3', { type: 'expense', amount: 50, currency: 'USD', category: 'Delivery', date: '2026-03-05' });
    addTransaction(db, 'cb-4', { type: 'expense', amount: 1000, currency: 'ARS', category: 'Transporte', date: '2026-03-08' });
    // Income must not appear in category breakdown
    addTransaction(db, 'cb-5', { type: 'income', amount: 9999, currency: 'ARS', category: 'Delivery', date: '2026-03-01' });

    const breakdown = getCategoryBreakdown(db, '2026-03');
    const delivery = breakdown.find((r) => r.category === 'Delivery');
    expect(delivery).toBeDefined();
    expect(delivery!.ARS).toBe(700);
    expect(delivery!.USD).toBe(50);

    const transport = breakdown.find((r) => r.category === 'Transporte');
    expect(transport).toBeDefined();
    expect(transport!.ARS).toBe(1000);
    expect(transport!.USD).toBe(0);
  });

  it('excludes income from category breakdown', () => {
    addTransaction(db, 'income-only', { type: 'income', amount: 10000, currency: 'ARS', category: 'Otros', date: '2026-03-01' });

    const breakdown = getCategoryBreakdown(db, '2026-03');
    expect(breakdown).toHaveLength(0);
  });

  // ── getMonthlyTotal (backward compat) ─────────────────────────────────

  it('getMonthlyTotal sums only ARS expenses for the given month', () => {
    addTransaction(db, 'mt-1', { type: 'expense', amount: 1000, currency: 'ARS', date: '2026-03-01' });
    addTransaction(db, 'mt-2', { type: 'expense', amount: 500, currency: 'ARS', date: '2026-03-15' });
    addTransaction(db, 'mt-3', { type: 'income', amount: 9999, currency: 'ARS', date: '2026-03-10' });
    addTransaction(db, 'mt-4', { type: 'expense', amount: 200, currency: 'USD', date: '2026-03-10' });

    const month = '2026-03';
    const result = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND currency = 'ARS' AND date LIKE ?",
    ).get(`${month}%`) as { total: number };

    expect(result.total).toBe(1500);
  });

  // ── getActiveLoansCount (backward compat) ─────────────────────────────

  it('getActiveLoansCount returns count of unsettled loans', () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, description, settled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('ln-1', 'Juan', 'lent', 'single', 5000, 'ARS', '2026-03-01', '', 0, now);
    db.prepare(`INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, description, settled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('ln-2', 'Ana', 'borrowed', 'single', 2000, 'ARS', '2026-03-05', '', 0, now);
    db.prepare(`INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, description, settled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('ln-3', 'Pedro', 'lent', 'single', 1000, 'ARS', '2026-03-10', '', 1, now);

    const result = db.prepare('SELECT COUNT(*) AS c FROM finance_loans WHERE settled = 0').get() as { c: number };
    expect(result.c).toBe(2);
  });

  // ── getCategories (backward compat) ──────────────────────────────────

  it('getCategories returns category name list', () => {
    const rows = db.prepare('SELECT name FROM finance_categories ORDER BY created_at ASC').all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('Delivery');
    expect(names).toContain('Otros');
    expect(names).toContain('Inversiones');
    expect(names.length).toBeGreaterThanOrEqual(11);
  });
});

// ── helpers for installment group tests ────────────────────────────────────

function addInstallmentGroup(
  db: Database.Database,
  id: string,
  group: {
    description?: string;
    totalAmount: number;
    currency?: string;
    totalInstallments: number;
    category?: string;
    date: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_installment_groups
      (id, description, total_amount, currency, total_installments, category, date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    group.description ?? '',
    group.totalAmount,
    group.currency ?? 'ARS',
    group.totalInstallments,
    group.category ?? 'Otros',
    group.date,
    now,
  );
}

// Mirrors the createInstallmentGroup handler logic
function createInstallmentGroupWithTransactions(
  db: Database.Database,
  groupId: string,
  group: {
    description: string;
    totalAmount: number;
    installmentCount: number;
    installmentAmount: number;
    currency?: string;
    category?: string;
    startDate: string;
    forThirdParty?: boolean;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_installment_groups
      (id, description, total_amount, currency, total_installments, category, date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    groupId,
    group.description,
    group.totalAmount,
    group.currency ?? 'ARS',
    group.installmentCount,
    group.category ?? 'Otros',
    group.startDate,
    now,
  );

  const [yearStr, monthStr, dayStr] = group.startDate.split('-');
  const startYear = parseInt(yearStr, 10);
  const startMonth = parseInt(monthStr, 10) - 1; // 0-based
  const startDay = parseInt(dayStr, 10);

  for (let i = 0; i < group.installmentCount; i++) {
    const txDate = new Date(startYear, startMonth + i, startDay);
    const txDateStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
    const txId = `${groupId}-tx-${i}`;
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      'expense',
      group.installmentAmount,
      group.currency ?? 'ARS',
      group.category ?? 'Otros',
      `${group.description} (Cuota ${i + 1}/${group.installmentCount})`,
      txDateStr,
      'credit_card',
      'manual',
      group.installmentCount,
      groupId,
      group.forThirdParty ? 1 : 0,
      null,
      null,
      now,
      now,
    );
  }
}

describe('installment group handlers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('creates an installment group and generates monthly transactions', () => {
    createInstallmentGroupWithTransactions(db, 'grp-create', {
      description: 'Laptop',
      totalAmount: 3000,
      installmentCount: 3,
      installmentAmount: 1000,
      currency: 'ARS',
      category: 'Compras',
      startDate: '2026-03-15',
    });

    // Verify group was created
    const group = db.prepare('SELECT * FROM finance_installment_groups WHERE id = ?').get('grp-create') as Record<string, unknown>;
    expect(group).toBeDefined();
    expect(group.description).toBe('Laptop');
    expect(group.total_installments).toBe(3);

    // Verify 3 transactions were generated
    const txs = db.prepare('SELECT * FROM finance_transactions WHERE installment_group_id = ? ORDER BY date ASC').all('grp-create') as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(3);

    // Check descriptions
    expect(txs[0].description).toBe('Laptop (Cuota 1/3)');
    expect(txs[1].description).toBe('Laptop (Cuota 2/3)');
    expect(txs[2].description).toBe('Laptop (Cuota 3/3)');

    // Check dates (same day, incremented monthly)
    expect(txs[0].date).toBe('2026-03-15');
    expect(txs[1].date).toBe('2026-04-15');
    expect(txs[2].date).toBe('2026-05-15');

    // Check all link back to group
    expect(txs.every((tx) => tx.installment_group_id === 'grp-create')).toBe(true);

    // Check type and payment method
    expect(txs.every((tx) => tx.type === 'expense')).toBe(true);
    expect(txs.every((tx) => tx.payment_method === 'credit_card')).toBe(true);
    expect(txs.every((tx) => tx.source === 'manual')).toBe(true);
  });

  it('deleting a group removes all linked transactions', () => {
    addInstallmentGroup(db, 'grp-del', { totalAmount: 6000, totalInstallments: 3, date: '2026-03-01' });
    addTransaction(db, 'tx-del-1', { type: 'expense', amount: 2000, date: '2026-03-01', installmentGroupId: 'grp-del' });
    addTransaction(db, 'tx-del-2', { type: 'expense', amount: 2000, date: '2026-04-01', installmentGroupId: 'grp-del' });
    addTransaction(db, 'tx-del-3', { type: 'expense', amount: 2000, date: '2026-05-01', installmentGroupId: 'grp-del' });
    // An unrelated transaction — should survive
    addTransaction(db, 'tx-unrelated', { type: 'expense', amount: 500, date: '2026-03-10' });

    // Delete transactions first, then group (application-level cascade)
    db.prepare('DELETE FROM finance_transactions WHERE installment_group_id = ?').run('grp-del');
    db.prepare('DELETE FROM finance_installment_groups WHERE id = ?').run('grp-del');

    // Verify group is gone
    expect(db.prepare('SELECT id FROM finance_installment_groups WHERE id = ?').get('grp-del')).toBeUndefined();

    // Verify linked transactions are gone
    const linked = db.prepare('SELECT id FROM finance_transactions WHERE installment_group_id = ?').all('grp-del');
    expect(linked).toHaveLength(0);

    // Verify unrelated transaction survived
    expect(db.prepare('SELECT id FROM finance_transactions WHERE id = ?').get('tx-unrelated')).toBeTruthy();
  });

  it('gets installments for a specific month', () => {
    addInstallmentGroup(db, 'grp-month', { totalAmount: 3000, totalInstallments: 3, date: '2026-03-01' });
    addTransaction(db, 'tx-m1', { type: 'expense', amount: 1000, date: '2026-03-01', installmentGroupId: 'grp-month' });
    addTransaction(db, 'tx-m2', { type: 'expense', amount: 1000, date: '2026-04-01', installmentGroupId: 'grp-month' });
    addTransaction(db, 'tx-m3', { type: 'expense', amount: 1000, date: '2026-05-01', installmentGroupId: 'grp-month' });
    // Non-installment transaction in same month — should NOT appear
    addTransaction(db, 'tx-no-grp', { type: 'expense', amount: 500, date: '2026-03-15' });

    const month = '2026-03';
    const rows = db.prepare(`
      SELECT t.id, t.amount, t.date, t.installment_group_id AS installmentGroupId,
             g.description AS groupDescription, g.total_installments AS installmentCount
      FROM finance_transactions t
      JOIN finance_installment_groups g ON g.id = t.installment_group_id
      WHERE t.installment_group_id IS NOT NULL AND t.date LIKE ?
    `).all(`${month}%`) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tx-m1');
    expect(rows[0].installmentGroupId).toBe('grp-month');
    expect(rows[0].groupDescription).toBe('');
    expect(rows[0].installmentCount).toBe(3);
  });

  it('projects installments for upcoming months', () => {
    addInstallmentGroup(db, 'grp-proj', { totalAmount: 6000, totalInstallments: 6, date: '2026-03-01' });
    // 6 monthly installments starting 2026-03
    const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    for (let i = 0; i < months.length; i++) {
      addTransaction(db, `tx-proj-${i}`, {
        type: 'expense',
        amount: 1000,
        date: `${months[i]}-01`,
        installmentGroupId: 'grp-proj',
      });
    }

    // Query projection for 6 months starting from 2026-03
    const [yearStr, monthStr] = '2026-02'.split('-').map(Number); // simulate "current month" as Feb so next 6 = Mar-Aug
    const projection: Array<{ month: string; total: number }> = [];

    for (let i = 1; i <= 6; i++) {
      const targetDate = new Date(yearStr, monthStr - 1 + i, 1);
      const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM finance_transactions
        WHERE installment_group_id IS NOT NULL AND date LIKE ?
      `).get(`${targetMonth}%`) as { total: number };
      projection.push({ month: targetMonth, total: row.total });
    }

    expect(projection).toHaveLength(6);
    expect(projection.every((p) => p.total === 1000)).toBe(true);
    expect(projection[0].month).toBe('2026-03');
    expect(projection[5].month).toBe('2026-08');
  });
});

// ── helpers for loan tests ──────────────────────────────────────────────────

function addLoan(
  db: Database.Database,
  id: string,
  loan: {
    personName: string;
    direction: 'lent' | 'borrowed';
    type?: 'single' | 'installments';
    amount: number;
    currency?: string;
    date: string;
    description?: string;
    settled?: number;
    installmentGroupId?: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_loans
      (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    loan.personName,
    loan.direction,
    loan.type ?? 'single',
    loan.amount,
    loan.currency ?? 'ARS',
    loan.date,
    loan.description ?? '',
    loan.settled ?? 0,
    loan.installmentGroupId ?? null,
    now,
  );
}

function addLoanPayment(
  db: Database.Database,
  id: string,
  payment: {
    loanId: string;
    amount: number;
    currency?: string;
    date: string;
    note?: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payment.loanId,
    payment.amount,
    payment.currency ?? 'ARS',
    payment.date,
    payment.note ?? '',
    now,
  );
}

function createThirdPartyPurchase(
  db: Database.Database,
  data: {
    description: string;
    installmentCount: number;
    installmentAmount: number;
    currency?: string;
    category?: string;
    startDate: string;
    personName: string;
  },
  groupId: string,
  loanId: string,
): void {
  const currency = data.currency ?? 'ARS';
  const category = data.category ?? 'Otros';
  const totalAmount = data.installmentCount * data.installmentAmount;
  const now = new Date().toISOString();

  const trx = db.transaction(() => {
    // 1. Create installment group
    db.prepare(`
      INSERT INTO finance_installment_groups
        (id, description, total_amount, currency, total_installments, category, date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(groupId, data.description, totalAmount, currency, data.installmentCount, category, data.startDate, now);

    // 2. Generate monthly transactions
    const [yearStr, monthStr, dayStr] = data.startDate.split('-');
    const startYear = parseInt(yearStr, 10);
    const startMonth = parseInt(monthStr, 10) - 1;
    const startDay = parseInt(dayStr, 10);

    for (let i = 0; i < data.installmentCount; i++) {
      const txDate = new Date(startYear, startMonth + i, startDay);
      const txDateStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
      const txId = `${groupId}-tx-${i}`;
      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId, 'expense', data.installmentAmount, currency, category,
        `${data.description} (Cuota ${i + 1}/${data.installmentCount})`,
        txDateStr, 'credit_card', 'manual', data.installmentCount,
        groupId, 1, null, null, now, now,
      );
    }

    // 3. Create loan linked to group
    db.prepare(`
      INSERT INTO finance_loans
        (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at)
      VALUES (?, ?, 'lent', 'installments', ?, ?, ?, ?, 0, ?, ?)
    `).run(loanId, data.personName, totalAmount, currency, data.startDate, data.description, groupId, now);
  });

  trx();
}

// ── loan handler tests ──────────────────────────────────────────────────────

describe('loan handlers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('creates a single-payment loan and retrieves it', () => {
    addLoan(db, 'ln-single', {
      personName: 'Maria',
      direction: 'lent',
      type: 'single',
      amount: 10000,
      currency: 'ARS',
      date: '2026-03-01',
      description: 'Prestamo personal',
    });

    const rows = db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt
      FROM finance_loans
      WHERE settled = 0
      ORDER BY settled ASC, date DESC
    `).all() as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    const loan = rows[0];
    expect(loan.id).toBe('ln-single');
    expect(loan.personName).toBe('Maria');
    expect(loan.direction).toBe('lent');
    expect(loan.type).toBe('single');
    expect(loan.amount).toBe(10000);
    expect(loan.settled).toBe(0);
    // camelCase aliases must be present
    expect(loan.personName).toBeDefined();
    expect(loan.person_name).toBeUndefined();
  });

  it('records loan payments and computes remaining amount', () => {
    addLoan(db, 'ln-pay', { personName: 'Carlos', direction: 'borrowed', amount: 5000, date: '2026-03-01' });
    addLoanPayment(db, 'pay-1', { loanId: 'ln-pay', amount: 1500, date: '2026-03-10' });
    addLoanPayment(db, 'pay-2', { loanId: 'ln-pay', amount: 2000, date: '2026-03-20' });

    const payments = db.prepare(`
      SELECT id, loan_id AS loanId, amount, date, note, created_at AS createdAt
      FROM finance_loan_payments
      WHERE loan_id = ?
      ORDER BY date ASC
    `).all('ln-pay') as Array<Record<string, unknown>>;

    expect(payments).toHaveLength(2);
    expect(payments[0].id).toBe('pay-1');
    expect(payments[1].id).toBe('pay-2');

    const totalPaid = (payments as Array<{ amount: number }>).reduce((sum, p) => sum + p.amount, 0);
    const loan = db.prepare('SELECT amount FROM finance_loans WHERE id = ?').get('ln-pay') as { amount: number };
    expect(loan.amount - totalPaid).toBe(1500);
  });

  it('creates third-party purchase atomically (group + transactions + loan)', () => {
    createThirdPartyPurchase(db, {
      description: 'iPhone para Juan',
      installmentCount: 3,
      installmentAmount: 50000,
      currency: 'ARS',
      category: 'Compras',
      startDate: '2026-03-01',
      personName: 'Juan',
    }, 'grp-3p', 'ln-3p');

    // Verify installment group exists
    const group = db.prepare('SELECT * FROM finance_installment_groups WHERE id = ?').get('grp-3p') as Record<string, unknown>;
    expect(group).toBeDefined();
    expect(group.description).toBe('iPhone para Juan');
    expect(group.total_amount).toBe(150000);
    expect(group.total_installments).toBe(3);

    // Verify 3 transactions exist with for_third_party=1
    const txs = db.prepare('SELECT * FROM finance_transactions WHERE installment_group_id = ? ORDER BY date ASC').all('grp-3p') as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(3);
    expect(txs.every((tx) => tx.for_third_party === 1)).toBe(true);
    expect(txs[0].date).toBe('2026-03-01');
    expect(txs[1].date).toBe('2026-04-01');
    expect(txs[2].date).toBe('2026-05-01');

    // Verify loan exists linked to group
    const loan = db.prepare('SELECT * FROM finance_loans WHERE id = ?').get('ln-3p') as Record<string, unknown>;
    expect(loan).toBeDefined();
    expect(loan.person_name).toBe('Juan');
    expect(loan.direction).toBe('lent');
    expect(loan.type).toBe('installments');
    expect(loan.amount).toBe(150000);
    expect(loan.installment_group_id).toBe('grp-3p');
    expect(loan.settled).toBe(0);
  });

  it('groups loans by person (getLoansByPerson)', () => {
    addLoan(db, 'ln-p1a', { personName: 'Ana', direction: 'lent', amount: 3000, date: '2026-02-01' });
    addLoan(db, 'ln-p1b', { personName: 'Ana', direction: 'lent', amount: 7000, date: '2026-03-01' });
    addLoan(db, 'ln-p2', { personName: 'Luis', direction: 'borrowed', amount: 1000, date: '2026-03-05' });
    // Settled loan for Ana — should not appear
    addLoan(db, 'ln-p1c', { personName: 'Ana', direction: 'lent', amount: 500, date: '2026-01-01', settled: 1 });

    const rows = db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, settled
      FROM finance_loans
      WHERE person_name = ? AND settled = 0
      ORDER BY date DESC
    `).all('Ana') as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.personName === 'Ana')).toBe(true);
    expect(rows.map((r) => r.id)).toContain('ln-p1a');
    expect(rows.map((r) => r.id)).toContain('ln-p1b');
    expect(rows.map((r) => r.id)).not.toContain('ln-p1c');
  });

  it('settles a loan by setting settled=1 and settled_date', () => {
    addLoan(db, 'ln-settle', { personName: 'Pedro', direction: 'lent', amount: 2000, date: '2026-03-01' });

    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ? WHERE id = ?`).run(today, 'ln-settle');

    const loan = db.prepare('SELECT * FROM finance_loans WHERE id = ?').get('ln-settle') as Record<string, unknown>;
    expect(loan.settled).toBe(1);
    expect(loan.settled_date).toBe(today);
  });

  it('returns loan summary: total lent vs borrowed', () => {
    addLoan(db, 'ls-1', { personName: 'A', direction: 'lent', amount: 10000, date: '2026-03-01' });
    addLoan(db, 'ls-2', { personName: 'B', direction: 'lent', amount: 5000, date: '2026-03-02' });
    addLoan(db, 'ls-3', { personName: 'C', direction: 'borrowed', amount: 3000, date: '2026-03-03' });
    // Settled — should not be included
    addLoan(db, 'ls-4', { personName: 'D', direction: 'lent', amount: 99999, date: '2026-03-04', settled: 1 });

    const rows = db.prepare(`
      SELECT direction, COALESCE(SUM(amount), 0) AS total
      FROM finance_loans
      WHERE settled = 0
      GROUP BY direction
    `).all() as Array<{ direction: string; total: number }>;

    const summary = { lent: 0, borrowed: 0 };
    for (const row of rows) {
      if (row.direction === 'lent') summary.lent = row.total;
      if (row.direction === 'borrowed') summary.borrowed = row.total;
    }

    expect(summary.lent).toBe(15000);
    expect(summary.borrowed).toBe(3000);
  });
});
