import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString } from '../../shared/date-utils';

function genId(): string {
  return crypto.randomUUID();
}

export function registerFinanceIpcHandlers(): void {
  /** Given a transaction date and a card's closing day, returns the statement period_month (YYYY-MM).
   *  Convention: for closingDay=15, the January statement covers Dec 16 – Jan 15.
   *  So a tx on Jan 10 (d <= closingDay) belongs to January ("2025-01"),
   *  and a tx on Jan 20 (d > closingDay) belongs to February ("2025-02"). */
  function getStatementPeriod(txDate: string, closingDay: number): string {
    const [y, m, d] = txDate.split('-').map(Number);
    if (d <= closingDay) {
      // Transaction falls within the current month's statement period
      return `${y}-${String(m).padStart(2, '0')}`;
    } else {
      // Transaction falls after closing day → next month's statement
      const dt = new Date(y, m, 1); // m is 1-based, Date 0-based, so this gives next month
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  // ── Transactions ────────────────────────────────────

  ipcHandle('finance:getTransactions', (_e, filters: {
    month?: string;
    category?: string;
    type?: string;
    paymentMethod?: string;
    installmentGroupId?: string;
  } = {}) => {
    const db = getDb();
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
             credit_card_id AS creditCardId,
             impacts_balance AS impactsBalance,
             created_at AS createdAt, updated_at AS updatedAt
      FROM finance_transactions
      ${where}
      ORDER BY date DESC, created_at DESC
    `).all(...params);
  });

  ipcHandle('finance:addTransaction', (_e, tx: {
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
    creditCardId?: string | null;
    impactsBalance?: boolean;
  }) => {
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      throw new Error('Amount must be a positive finite number');
    }
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      tx.creditCardId ?? null,
      (tx.impactsBalance === false || tx.paymentMethod === 'credit_card') ? 0 : 1,
      now,
      now,
    );
    return id;
  });

  ipcHandle('finance:updateTransaction', (_e, id: string, fields: {
    amount?: number;
    description?: string;
    category?: string;
    paymentMethod?: string;
    date?: string;
    creditCardId?: string | null;
  }) => {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    if (fields.amount !== undefined) { sets.push('amount = ?'); vals.push(fields.amount); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.category !== undefined) { sets.push('category = ?'); vals.push(fields.category); }
    if (fields.paymentMethod !== undefined) {
      sets.push('payment_method = ?'); vals.push(fields.paymentMethod);
      if (fields.paymentMethod === 'credit_card') {
        sets.push('impacts_balance = ?'); vals.push(0);
        sets.push('credit_card_id = ?'); vals.push(fields.creditCardId ?? null);
      } else {
        sets.push('impacts_balance = ?'); vals.push(1);
        sets.push('credit_card_id = ?'); vals.push(null);
      }
    } else if (fields.creditCardId !== undefined) {
      sets.push('credit_card_id = ?'); vals.push(fields.creditCardId);
    }
    if (fields.date !== undefined) { sets.push('date = ?'); vals.push(fields.date); }
    vals.push(id);
    db.prepare(`UPDATE finance_transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  });

  ipcHandle('finance:deleteTransaction', (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM finance_transactions WHERE id = ?').run(id);
  });

  // ── Dashboard / Stats ──────────────────────────────

  ipcHandle('finance:getMonthlyBalance', (_e, month?: string) => {
    const db = getDb();
    const m = month ?? todayDateString().slice(0, 7);

    const rows = db.prepare(`
      SELECT currency,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
      FROM finance_transactions
      WHERE date LIKE ? AND impacts_balance = 1
      GROUP BY currency
    `).all(`${m}%`) as Array<{ currency: string; income: number; expenses: number }>;

    const result: Record<string, { income: number; expenses: number; balance: number }> = {
      ARS: { income: 0, expenses: 0, balance: 0 },
      USD: { income: 0, expenses: 0, balance: 0 },
    };
    for (const row of rows) {
      if (result[row.currency]) {
        result[row.currency].income = row.income;
        result[row.currency].expenses = row.expenses;
        result[row.currency].balance = row.income - row.expenses;
      }
    }
    return result;
  });

  ipcHandle('finance:getCategoryBreakdown', (_e, month?: string) => {
    const db = getDb();
    const m = month ?? todayDateString().slice(0, 7);

    const rows = db.prepare(`
      SELECT category, currency,
             COALESCE(SUM(amount), 0) AS total
      FROM finance_transactions
      WHERE type = 'expense' AND date LIKE ? AND category != 'Pago Tarjeta'
      GROUP BY category, currency
      ORDER BY category ASC
    `).all(`${m}%`) as Array<{ category: string; currency: string; total: number }>;

    const map = new Map<string, { ARS: number; USD: number }>();
    for (const row of rows) {
      if (!map.has(row.category)) map.set(row.category, { ARS: 0, USD: 0 });
      const entry = map.get(row.category)!;
      if (row.currency === 'ARS' || row.currency === 'USD') {
        entry[row.currency] += row.total;
      }
    }
    return Array.from(map.entries()).map(([category, amounts]) => ({ category, ...amounts }));
  });

  ipcHandle('finance:getBalanceForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' AND currency = 'ARS' THEN amount ELSE 0 END), 0) AS incomeARS,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'ARS' THEN amount ELSE 0 END), 0) AS expensesARS,
        COALESCE(SUM(CASE WHEN type = 'income' AND currency = 'USD' THEN amount ELSE 0 END), 0) AS incomeUSD,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'USD' THEN amount ELSE 0 END), 0) AS expensesUSD
      FROM finance_transactions
      WHERE impacts_balance = 1 AND date >= ? AND date < ?
    `).get(`${startMonth}-01`, `${endMonth}-32`) as {
      incomeARS: number; expensesARS: number; incomeUSD: number; expensesUSD: number;
    };

    return {
      ARS: { income: row.incomeARS, expenses: row.expensesARS, balance: row.incomeARS - row.expensesARS },
      USD: { income: row.incomeUSD, expenses: row.expensesUSD, balance: row.incomeUSD - row.expensesUSD },
    };
  });

  ipcHandle('finance:getCategoryBreakdownForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT category,
        COALESCE(SUM(CASE WHEN currency = 'ARS' THEN amount ELSE 0 END), 0) AS "ARS",
        COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount ELSE 0 END), 0) AS "USD"
      FROM finance_transactions
      WHERE type = 'expense' AND impacts_balance = 1 AND category != 'Pago Tarjeta'
        AND date >= ? AND date < ?
      GROUP BY category
      ORDER BY "ARS" DESC
    `).all(`${startMonth}-01`, `${endMonth}-32`);
  });

  ipcHandle('finance:getProjection', (_e, months: number) => {
    const db = getDb();
    const today = todayDateString(); // YYYY-MM-DD
    const [year, month] = today.slice(0, 7).split('-').map(Number);

    const recurring = db.prepare(
      "SELECT SUM(amount) AS total FROM finance_recurring WHERE active = 1 AND type = 'expense'"
    ).get() as { total: number | null };
    const recurringTotal = recurring.total ?? 0;

    const projection: Array<{ month: string; installments: number; recurring: number; total: number }> = [];

    for (let i = 1; i <= months; i++) {
      const targetDate = new Date(year, month - 1 + i, 1);
      const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

      const installmentRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM finance_transactions
        WHERE installment_group_id IS NOT NULL AND date LIKE ?
      `).get(`${targetMonth}%`) as { total: number };

      projection.push({
        month: targetMonth,
        installments: installmentRow.total,
        recurring: recurringTotal,
        total: installmentRow.total + recurringTotal,
      });
    }

    return projection;
  });

  // ── Categories ──────────────────────────────────────

  ipcHandle('finance:getCategories', () => {
    const db = getDb();
    return (db.prepare('SELECT name FROM finance_categories ORDER BY created_at ASC').all() as { name: string }[])
      .map((r) => r.name);
  });

  ipcHandle('finance:addCategory', (_e, name: string) => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO finance_categories (name) VALUES (?)').run(name.trim());
  });

  ipcHandle('finance:deleteCategory', (_e, name: string) => {
    const db = getDb();
    const usage = db.prepare(
      'SELECT COUNT(*) AS c FROM finance_transactions WHERE category = ?'
    ).get(name) as { c: number };
    if (usage.c > 0) {
      throw new Error(`Cannot delete category in use by ${usage.c} transactions`);
    }
    db.prepare('DELETE FROM finance_categories WHERE name = ?').run(name);
  });

  // ── Credit Cards ──────────────────────────────────

  ipcHandle('finance:getCreditCards', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, closing_day AS closingDay, created_at AS createdAt
      FROM finance_credit_cards
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addCreditCard', (_e, card: { name: string; closingDay: number }) => {
    const db = getDb();
    const id = genId();
    db.prepare('INSERT INTO finance_credit_cards (id, name, closing_day) VALUES (?, ?, ?)').run(id, card.name.trim(), card.closingDay);
    return id;
  });

  ipcHandle('finance:updateCreditCard', (_e, id: string, fields: { name?: string; closingDay?: number }) => {
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name.trim()); }
    if (fields.closingDay !== undefined) { sets.push('closing_day = ?'); vals.push(fields.closingDay); }
    if (sets.length === 0) return;
    vals.push(id);
    db.prepare(`UPDATE finance_credit_cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  });

  ipcHandle('finance:deleteCreditCard', (_e, id: string) => {
    const db = getDb();
    const trx = db.transaction(() => {
      db.prepare('DELETE FROM finance_credit_card_statements WHERE credit_card_id = ?').run(id);
      db.prepare('UPDATE finance_transactions SET credit_card_id = NULL, impacts_balance = 1 WHERE credit_card_id = ?').run(id);
      db.prepare('DELETE FROM finance_credit_cards WHERE id = ?').run(id);
    });
    trx();
  });

  // ── Credit Card Statements ─────────────────────────

  ipcHandle('finance:getCreditCardStatements', (_e, filters: {
    creditCardId?: string;
    periodMonth?: string;
    status?: 'pending' | 'paid';
  } = {}) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.creditCardId) { conditions.push('s.credit_card_id = ?'); params.push(filters.creditCardId); }
    if (filters.periodMonth) { conditions.push('s.period_month = ?'); params.push(filters.periodMonth); }
    if (filters.status) { conditions.push('s.status = ?'); params.push(filters.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, c.name AS creditCardName,
             s.period_month AS periodMonth, s.calculated_amount AS calculatedAmount,
             s.paid_amount AS paidAmount, s.status, s.paid_date AS paidDate,
             s.transaction_id AS transactionId, s.created_at AS createdAt
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id
      ${where}
      ORDER BY s.period_month DESC, c.name ASC
    `).all(...params);
  });

  ipcHandle('finance:getStatementDetail', (_e, statementId: string) => {
    const db = getDb();
    const statement = db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, s.period_month AS periodMonth,
             s.calculated_amount AS calculatedAmount, s.paid_amount AS paidAmount,
             s.status, c.closing_day AS closingDay, c.name AS creditCardName
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id
      WHERE s.id = ?
    `).get(statementId) as { creditCardId: string; periodMonth: string; closingDay: number } | undefined;

    if (!statement) return null;

    const transactions = db.prepare(`
      SELECT id, type, amount, currency, category, description, date,
             payment_method AS paymentMethod, source, installments,
             installment_group_id AS installmentGroupId,
             created_at AS createdAt
      FROM finance_transactions
      WHERE credit_card_id = ? AND impacts_balance = 0
      ORDER BY date DESC, created_at DESC
    `).all(statement.creditCardId);

    const filtered = (transactions as Array<{ date: string; [key: string]: unknown }>).filter((tx) => {
      return getStatementPeriod(tx.date, statement.closingDay) === statement.periodMonth;
    });

    return { statement, transactions: filtered };
  });

  ipcHandle('finance:generateStatement', (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    const card = db.prepare('SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ?').get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    const statementId = genId();
    const txId = genId();
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
      const existing = db.prepare(
        'SELECT id FROM finance_credit_card_statements WHERE credit_card_id = ? AND period_month = ?'
      ).get(creditCardId, periodMonth);
      if (existing) return (existing as { id: string }).id;

      const allTx = db.prepare(`
        SELECT date, amount FROM finance_transactions
        WHERE credit_card_id = ? AND impacts_balance = 0
      `).all(creditCardId) as Array<{ date: string; amount: number }>;

      const total = allTx
        .filter((tx) => getStatementPeriod(tx.date, card.closingDay) === periodMonth)
        .reduce((sum, tx) => sum + tx.amount, 0);

      if (total === 0) return null;

      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
        VALUES (?, 'expense', ?, 'ARS', 'Pago Tarjeta', ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?)
      `).run(txId, total, `Pago tarjeta - ${periodMonth}`, `${periodMonth}-01`, now, now);

      db.prepare(`
        INSERT INTO finance_credit_card_statements
          (id, credit_card_id, period_month, calculated_amount, status, transaction_id, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(statementId, creditCardId, periodMonth, total, txId, now);

      return statementId;
    });

    return trx();
  });

  ipcHandle('finance:payStatement', (_e, statementId: string, paidAmount: number) => {
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      throw new Error('Pay amount must be a positive finite number');
    }
    const db = getDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const stmt = db.prepare(
      'SELECT transaction_id AS transactionId FROM finance_credit_card_statements WHERE id = ?'
    ).get(statementId) as { transactionId: string } | undefined;

    if (!stmt) return;

    db.prepare(`
      UPDATE finance_credit_card_statements
      SET paid_amount = ?, status = 'paid', paid_date = ?
      WHERE id = ?
    `).run(paidAmount, today, statementId);

    db.prepare(`
      UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?
    `).run(paidAmount, now, stmt.transactionId);
  });

  // ── Backward compat (dashboard widget) ─────────────

  ipcHandle('finance:getMonthlyTotal', () => {
    const db = getDb();
    const month = todayDateString().slice(0, 7);
    const result = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND currency = 'ARS' AND impacts_balance = 1 AND date LIKE ?"
    ).get(`${month}%`) as { total: number };
    return result.total;
  });

  ipcHandle('finance:getActiveLoansCount', () => {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) AS c FROM finance_loans WHERE settled = 0').get() as { c: number };
    return result.c;
  });

  // ── Installment Groups ───────────────────────────────

  ipcHandle('finance:getInstallmentGroups', () => {
    const db = getDb();
    return db.prepare(`
      SELECT g.id, g.description, g.total_amount AS totalAmount, g.currency,
             g.total_installments AS totalInstallments, g.category, g.date,
             g.created_at AS createdAt,
             COUNT(t.id) AS transactionCount
      FROM finance_installment_groups g
      LEFT JOIN finance_transactions t ON t.installment_group_id = g.id
      GROUP BY g.id
      ORDER BY g.date DESC, g.created_at DESC
    `).all();
  });

  ipcHandle('finance:getInstallmentsForMonth', (_e, month: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT t.id, t.type, t.amount, t.currency, t.category, t.description, t.date,
             t.payment_method AS paymentMethod, t.source, t.installments,
             t.installment_group_id AS installmentGroupId,
             t.for_third_party AS forThirdParty,
             t.recurring_id AS recurringId,
             t.import_batch_id AS importBatchId,
             t.created_at AS createdAt, t.updated_at AS updatedAt,
             g.description AS groupDescription,
             g.total_installments AS installmentCount,
             g.total_amount AS groupTotalAmount,
             (CAST(SUBSTR(t.date, 1, 4) AS INTEGER) - CAST(SUBSTR(g.date, 1, 4) AS INTEGER)) * 12
               + (CAST(SUBSTR(t.date, 6, 2) AS INTEGER) - CAST(SUBSTR(g.date, 6, 2) AS INTEGER))
               + 1 AS installmentNumber
      FROM finance_transactions t
      JOIN finance_installment_groups g ON g.id = t.installment_group_id
      WHERE t.installment_group_id IS NOT NULL AND t.date LIKE ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(`${month}%`);
  });

  ipcHandle('finance:getInstallmentProjection', (_e, months: number) => {
    const db = getDb();
    const today = todayDateString(); // YYYY-MM-DD
    const [year, month] = today.slice(0, 7).split('-').map(Number);

    const projection: Array<{ month: string; total: number }> = [];

    for (let i = 1; i <= months; i++) {
      const targetDate = new Date(year, month - 1 + i, 1);
      const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

      const row = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM finance_transactions
        WHERE installment_group_id IS NOT NULL AND date LIKE ?
      `).get(`${targetMonth}%`) as { total: number };

      projection.push({ month: targetMonth, total: row.total });
    }

    return projection;
  });

  ipcHandle('finance:createInstallmentGroup', (_e, group: {
    description: string;
    totalAmount: number;
    installmentCount: number;
    installmentAmount: number;
    installmentAmounts?: number[];
    currency?: string;
    category?: string;
    startDate: string;
    forThirdParty?: boolean;
    paymentMethod?: string;
    creditCardId?: string | null;
  }) => {
    const db = getDb();
    const groupId = genId();
    const now = new Date().toISOString();
    const totalAmount = group.installmentAmounts
      ? group.installmentAmounts.reduce((a, b) => a + b, 0)
      : group.totalAmount;

    db.prepare(`
      INSERT INTO finance_installment_groups
        (id, description, total_amount, currency, total_installments, category, date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      group.description,
      totalAmount,
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

    const isCreditCard = group.paymentMethod === 'credit_card' && group.creditCardId;
    const monthOffset = isCreditCard ? 1 : 0;

    for (let i = 0; i < group.installmentCount; i++) {
      const txDate = new Date(startYear, startMonth + i + monthOffset, startDay);
      const txDateStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
      const txId = genId();
      const cuotaAmount = group.installmentAmounts?.[i] ?? group.installmentAmount;

      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        'expense',
        cuotaAmount,
        group.currency ?? 'ARS',
        group.category ?? 'Otros',
        `${group.description} (Cuota ${i + 1}/${group.installmentCount})`,
        txDateStr,
        group.paymentMethod ?? 'credit_card',
        'manual',
        group.installmentCount,
        groupId,
        group.forThirdParty ? 1 : 0,
        null,
        null,
        isCreditCard ? group.creditCardId : null,
        isCreditCard ? 0 : 1,
        now,
        now,
      );
    }

    return groupId;
  });

  ipcHandle('finance:deleteInstallmentGroup', (_e, id: string) => {
    const db = getDb();
    // Application-level cascade: delete linked transactions first, then the group
    db.prepare('DELETE FROM finance_transactions WHERE installment_group_id = ?').run(id);
    db.prepare('DELETE FROM finance_installment_groups WHERE id = ?').run(id);
  });

  ipcHandle('finance:updateInstallmentAmount', (_e, txId: string, newAmount: number) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?
    `).run(newAmount, now, txId);
  });

  // ── Loans ────────────────────────────────────────────

  ipcHandle('finance:getLoans', (_e, filter: { direction?: 'lent' | 'borrowed'; settled?: boolean } = {}) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.direction !== undefined) {
      conditions.push('direction = ?');
      params.push(filter.direction);
    }
    if (filter.settled !== undefined) {
      conditions.push('settled = ?');
      params.push(filter.settled ? 1 : 0);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt
      FROM finance_loans
      ${where}
      ORDER BY settled ASC, date DESC
    `).all(...params);
  });

  ipcHandle('finance:getLoansByPerson', (_e, personName: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt
      FROM finance_loans
      WHERE person_name = ? AND settled = 0
      ORDER BY date DESC
    `).all(personName);
  });

  ipcHandle('finance:addLoan', (_e, loan: {
    personName: string;
    direction: 'lent' | 'borrowed';
    type?: 'single' | 'installments';
    amount: number;
    currency?: string;
    date: string;
    description?: string;
    installmentGroupId?: string | null;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_loans
        (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      loan.personName,
      loan.direction,
      loan.type ?? 'single',
      loan.amount,
      loan.currency ?? 'ARS',
      loan.date,
      loan.description ?? '',
      loan.installmentGroupId ?? null,
      now,
    );
    return id;
  });

  ipcHandle('finance:settleLoan', (_e, id: string) => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ? WHERE id = ?`).run(today, id);
  });

  ipcHandle('finance:addLoanPayment', (_e, loanId: string, payment: {
    amount: number;
    currency?: string;
    date: string;
    note?: string;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      loanId,
      payment.amount,
      payment.currency ?? 'ARS',
      payment.date,
      payment.note ?? '',
      now,
    );
    return id;
  });

  ipcHandle('finance:getLoanPayments', (_e, loanId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, loan_id AS loanId, amount, currency, date, note, created_at AS createdAt
      FROM finance_loan_payments
      WHERE loan_id = ?
      ORDER BY date ASC
    `).all(loanId);
  });

  ipcHandle('finance:createThirdPartyPurchase', (_e, data: {
    description: string;
    installmentCount: number;
    installmentAmount: number;
    currency?: string;
    category?: string;
    startDate: string;
    personName: string;
    direction?: 'lent' | 'borrowed';
    creditCardId?: string | null;
  }) => {
    const db = getDb();
    const currency = data.currency ?? 'ARS';
    const category = data.category ?? 'Otros';
    const totalAmount = data.installmentCount * data.installmentAmount;
    const groupId = genId();
    const loanId = genId();
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
        const txId = genId();

        db.prepare(`
          INSERT INTO finance_transactions
            (id, type, amount, currency, category, description, date, payment_method,
             source, installments, installment_group_id, for_third_party, recurring_id,
             import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          txId,
          'expense',
          data.installmentAmount,
          currency,
          category,
          `${data.description} (Cuota ${i + 1}/${data.installmentCount})`,
          txDateStr,
          'credit_card',
          'manual',
          data.installmentCount,
          groupId,
          1,
          null,
          null,
          data.creditCardId ?? null,
          0,
          now,
          now,
        );
      }

      // 3. Create loan linked to group
      db.prepare(`
        INSERT INTO finance_loans
          (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at)
        VALUES (?, ?, ?, 'installments', ?, ?, ?, ?, 0, ?, ?)
      `).run(loanId, data.personName, data.direction ?? 'lent', totalAmount, currency, data.startDate, data.description, groupId, now);
    });

    trx();
    return { groupId, loanId };
  });

  ipcHandle('finance:getActiveLoanSummary', () => {
    const db = getDb();
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
    return summary;
  });

  // ── Recurring Transactions ────────────────────────────────────────────

  ipcHandle('finance:getRecurring', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, type, amount, currency, category, active,
             billing_day AS billingDay,
             created_at AS createdAt
      FROM finance_recurring
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addRecurring', (_e, rec: {
    id?: string;
    name: string;
    type: 'expense' | 'income';
    amount: number;
    currency?: string;
    category?: string;
    billingDay?: number;
  }) => {
    const db = getDb();
    const id = rec.id ?? genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO finance_recurring
        (id, name, type, amount, currency, category, billing_day, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      rec.name,
      rec.type,
      rec.amount,
      rec.currency ?? 'ARS',
      rec.category ?? 'Otros',
      rec.billingDay ?? 1,
      now,
    );
    return id;
  });

  ipcHandle('finance:updateRecurringAmount', (_e, id: string, newAmount: number) => {
    const db = getDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const historyId = genId();
    const current = db.prepare('SELECT amount FROM finance_recurring WHERE id = ?').get(id) as { amount: number } | undefined;
    const previousAmount = current?.amount ?? 0;
    db.prepare(`
      INSERT INTO finance_recurring_amount_history
        (id, recurring_id, previous_amount, amount, currency, effective_date, created_at)
      SELECT ?, id, ?, ?, currency, ?, ?
      FROM finance_recurring
      WHERE id = ?
    `).run(historyId, previousAmount, newAmount, today, now, id);
    db.prepare(`UPDATE finance_recurring SET amount = ? WHERE id = ?`).run(newAmount, id);
  });

  ipcHandle('finance:updateRecurring', (_e, id: string, fields: {
    name?: string;
    type?: 'expense' | 'income';
    category?: string;
    billingDay?: number;
  }) => {
    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
    if (fields.type !== undefined) { sets.push('type = ?'); params.push(fields.type); }
    if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category); }
    if (fields.billingDay !== undefined) { sets.push('billing_day = ?'); params.push(fields.billingDay); }

    if (sets.length === 0) return;
    params.push(id);
    db.prepare(`UPDATE finance_recurring SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  });

  ipcHandle('finance:toggleRecurring', (_e, id: string) => {
    const db = getDb();
    db.prepare(`
      UPDATE finance_recurring
      SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END
      WHERE id = ?
    `).run(id);
  });

  ipcHandle('finance:deleteRecurring', (_e, id: string) => {
    const db = getDb();
    db.prepare('UPDATE finance_transactions SET recurring_id = NULL WHERE recurring_id = ?').run(id);
    db.prepare('DELETE FROM finance_recurring WHERE id = ?').run(id);
  });

  ipcHandle('finance:generateRecurringForMonth', (_e, month: string) => {
    const db = getDb();
    const actives = db.prepare(`
      SELECT id, name, type, amount, currency, category, billing_day AS billingDay
      FROM finance_recurring
      WHERE active = 1
    `).all() as Array<{
      id: string;
      name: string;
      type: 'expense' | 'income';
      amount: number;
      currency: string;
      category: string;
      billingDay: number;
    }>;

    const now = new Date().toISOString();
    let generated = 0;

    for (const rec of actives) {
      const existing = db.prepare(`
        SELECT COUNT(*) AS c
        FROM finance_transactions
        WHERE source = 'recurring' AND recurring_id = ? AND date LIKE ?
      `).get(rec.id, `${month}%`) as { c: number };

      if (existing.c > 0) continue;

      const txId = genId();
      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        rec.type,
        rec.amount,
        rec.currency,
        rec.category,
        rec.name,
        `${month}-${String(rec.billingDay ?? 1).padStart(2, '0')}`,
        'cash',
        'recurring',
        1,
        null,
        0,
        rec.id,
        null,
        now,
        now,
      );
      generated++;
    }

    return generated;
  });

  ipcHandle('finance:getRecurringAmountHistory', (_e, recurringId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, recurring_id AS recurringId,
             previous_amount AS previousAmount, amount AS newAmount,
             currency, effective_date AS changedAt, created_at AS createdAt
      FROM finance_recurring_amount_history
      WHERE recurring_id = ?
      ORDER BY created_at DESC
    `).all(recurringId);
  });
}
