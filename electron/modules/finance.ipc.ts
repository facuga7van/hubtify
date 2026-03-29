import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString } from '../../shared/date-utils';

function genId(): string {
  return crypto.randomUUID();
}

export function registerFinanceIpcHandlers(): void {
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
  }) => {
    const db = getDb();
    const id = genId();
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
    return id;
  });

  ipcHandle('finance:updateTransaction', (_e, id: string, fields: {
    amount?: number;
    description?: string;
    category?: string;
    paymentMethod?: string;
  }) => {
    const db = getDb();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    if (fields.amount !== undefined) { sets.push('amount = ?'); vals.push(fields.amount); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.category !== undefined) { sets.push('category = ?'); vals.push(fields.category); }
    if (fields.paymentMethod !== undefined) { sets.push('payment_method = ?'); vals.push(fields.paymentMethod); }
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
      WHERE date LIKE ?
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
      WHERE type = 'expense' AND date LIKE ?
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

  // ── Backward compat (dashboard widget) ─────────────

  ipcHandle('finance:getMonthlyTotal', () => {
    const db = getDb();
    const month = todayDateString().slice(0, 7);
    const result = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND currency = 'ARS' AND date LIKE ?"
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
             g.total_amount AS groupTotalAmount
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
    currency?: string;
    category?: string;
    startDate: string;
    forThirdParty?: boolean;
  }) => {
    const db = getDb();
    const groupId = genId();
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
      const txId = genId();

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

    return groupId;
  });

  ipcHandle('finance:deleteInstallmentGroup', (_e, id: string) => {
    const db = getDb();
    // Application-level cascade: delete linked transactions first, then the group
    db.prepare('DELETE FROM finance_transactions WHERE installment_group_id = ?').run(id);
    db.prepare('DELETE FROM finance_installment_groups WHERE id = ?').run(id);
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
             import_batch_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          now,
          now,
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
             created_at AS createdAt
      FROM finance_recurring
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addRecurring', (_e, rec: {
    name: string;
    type: 'expense' | 'income';
    amount: number;
    currency?: string;
    category?: string;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO finance_recurring
        (id, name, type, amount, currency, category, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      rec.name,
      rec.type,
      rec.amount,
      rec.currency ?? 'ARS',
      rec.category ?? 'Otros',
      now,
    );
    return id;
  });

  ipcHandle('finance:updateRecurringAmount', (_e, id: string, newAmount: number) => {
    const db = getDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const historyId = genId();
    db.prepare(`
      INSERT INTO finance_recurring_amount_history
        (id, recurring_id, amount, currency, effective_date, created_at)
      SELECT ?, id, ?, currency, ?, ?
      FROM finance_recurring
      WHERE id = ?
    `).run(historyId, newAmount, today, now, id);
    db.prepare(`UPDATE finance_recurring SET amount = ? WHERE id = ?`).run(newAmount, id);
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
    db.prepare('DELETE FROM finance_recurring WHERE id = ?').run(id);
  });

  ipcHandle('finance:generateRecurringForMonth', (_e, month: string) => {
    const db = getDb();
    const actives = db.prepare(`
      SELECT id, name, type, amount, currency, category
      FROM finance_recurring
      WHERE active = 1
    `).all() as Array<{
      id: string;
      name: string;
      type: 'expense' | 'income';
      amount: number;
      currency: string;
      category: string;
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
        `${month}-01`,
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
      SELECT id, recurring_id AS recurringId, amount, currency,
             effective_date AS effectiveDate, created_at AS createdAt
      FROM finance_recurring_amount_history
      WHERE recurring_id = ?
      ORDER BY created_at DESC
    `).all(recurringId);
  });
}
