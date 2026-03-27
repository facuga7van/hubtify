import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString } from '../../shared/date-utils';

function genId(): string {
  return crypto.randomUUID();
}

export function registerFinanceIpcHandlers(): void {
  // ── Transactions ────────────────────────────────────

  ipcHandle('finance:getTransactions', (_e, month: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, amount, currency, category, description,
             date, source, created_at AS createdAt, updated_at AS updatedAt
      FROM finance_transactions
      WHERE date LIKE ?
      ORDER BY date DESC, created_at DESC
    `).all(`${month}%`);
  });

  ipcHandle('finance:addTransaction', (_e, tx: {
    type: 'expense' | 'income'; amount: number; currency?: string;
    category?: string; description?: string; date: string; source?: string;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tx.type, tx.amount, tx.currency ?? 'ARS', tx.category ?? 'Otros',
      tx.description ?? '', tx.date, tx.source ?? 'manual', now, now
    );
    return id;
  });

  ipcHandle('finance:deleteTransaction', (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM finance_transactions WHERE id = ?').run(id);
  });

  // ── Loans ───────────────────────────────────────────

  ipcHandle('finance:getLoans', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, person_name AS personName, type, amount, currency, date,
             description, settled, settled_date AS settledDate, created_at AS createdAt
      FROM finance_loans
      ORDER BY settled ASC, date DESC
    `).all();
  });

  ipcHandle('finance:addLoan', (_e, loan: {
    personName: string; type: 'lent' | 'borrowed'; amount: number;
    currency?: string; date: string; description?: string;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_loans (id, person_name, type, amount, currency, date, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, loan.personName, loan.type, loan.amount, loan.currency ?? 'ARS', loan.date, loan.description ?? '', now);
    return id;
  });

  ipcHandle('finance:settleLoan', (_e, id: string) => {
    const db = getDb();
    const now = todayDateString();
    db.prepare('UPDATE finance_loans SET settled = 1, settled_date = ? WHERE id = ?').run(now, id);
  });

  // ── Income Sources ──────────────────────────────────

  ipcHandle('finance:getIncomeSources', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, estimated_amount AS estimatedAmount, frequency,
             is_variable AS isVariable, active, created_at AS createdAt
      FROM finance_income_sources
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addIncomeSource', (_e, src: {
    name: string; estimatedAmount: number; frequency?: string; isVariable?: boolean;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_income_sources (id, name, estimated_amount, frequency, is_variable, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, src.name, src.estimatedAmount, src.frequency ?? 'monthly', src.isVariable ? 1 : 0, now);
    return id;
  });

  ipcHandle('finance:toggleIncomeSource', (_e, id: string) => {
    const db = getDb();
    db.prepare('UPDATE finance_income_sources SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  });

  // ── Categories ──────────────────────────────────────

  ipcHandle('finance:getCategories', () => {
    const db = getDb();
    return (db.prepare('SELECT name FROM finance_categories ORDER BY created_at ASC').all() as { name: string }[])
      .map((r) => r.name);
  });

  // ── Stats helpers ───────────────────────────────────

  ipcHandle('finance:getMonthlyTotal', () => {
    const db = getDb();
    const month = todayDateString().slice(0, 7); // YYYY-MM
    const result = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND date LIKE ?"
    ).get(`${month}%`) as { total: number };
    return result.total;
  });

  ipcHandle('finance:getMonthlyBalance', (_e, month?: string) => {
    const db = getDb();
    const m = month ?? todayDateString().slice(0, 7);
    const expenses = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND date LIKE ?"
    ).get(`${m}%`) as { total: number };
    const income = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'income' AND date LIKE ?"
    ).get(`${m}%`) as { total: number };
    return { expenses: expenses.total, income: income.total, balance: income.total - expenses.total };
  });

  ipcHandle('finance:getCategoryBreakdown', (_e, month?: string) => {
    const db = getDb();
    const m = month ?? todayDateString().slice(0, 7);
    return db.prepare(
      "SELECT category, SUM(amount) AS total FROM finance_transactions WHERE type = 'expense' AND date LIKE ? GROUP BY category ORDER BY total DESC"
    ).all(`${m}%`);
  });

  ipcHandle('finance:updateTransaction', (_e, id: string, fields: { amount?: number; description?: string; category?: string }) => {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    if (fields.amount !== undefined) { sets.push('amount = ?'); vals.push(fields.amount); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.category !== undefined) { sets.push('category = ?'); vals.push(fields.category); }
    vals.push(id);
    db.prepare(`UPDATE finance_transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  });

  ipcHandle('finance:getActiveLoansCount', () => {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) AS c FROM finance_loans WHERE settled = 0').get() as { c: number };
    return result.c;
  });
}
