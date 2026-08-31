import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { dialog, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import { todayDateString } from '../../shared/date-utils';
import {
  CARD_PAYMENT_CATEGORY,
  MAX_INSTALLMENTS,
  addMonthsClamped,
  addMonthsToMonth,
  aggregateByCategory,
  computeExpenseBreakdown,
  computeMonthlyBalance,
  generateRecurringForMonth,
  getStatementPeriod,
  isValidDateString,
  isValidMonthString,
  monthRange,
  monthRangeBetween,
  nowIso,
  parseNonEmptyString,
  parsePositiveAmount,
  sumByCurrency,
  sumIncomeExpenseByCurrency,
} from './finance.balance';

function genId(): string {
  return crypto.randomUUID();
}

/** Uniform failure envelope for handlers that used to persist garbage or throw raw. */
function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

const TRANSACTION_COLUMNS = `
  id, type, amount, currency, category, description, date,
  payment_method AS paymentMethod, source, installments,
  installment_group_id AS installmentGroupId,
  installment_number AS installmentNumber,
  for_third_party AS forThirdParty,
  recurring_id AS recurringId,
  import_batch_id AS importBatchId,
  credit_card_id AS creditCardId,
  impacts_balance AS impactsBalance,
  billed_amount_ars AS billedAmountArs,
  created_at AS createdAt, updated_at AS updatedAt
`;

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
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.month && isValidMonthString(filters.month)) {
      const { start, end } = monthRange(filters.month);
      conditions.push('date >= ?', 'date < ?');
      params.push(start, end);
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

    return db.prepare(`
      SELECT ${TRANSACTION_COLUMNS}
      FROM finance_transactions
      WHERE ${conditions.join(' AND ')}
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
    const amount = parsePositiveAmount(tx.amount);
    if (amount === null) {
      throw new Error('Amount must be a positive finite number');
    }
    if (!isValidDateString(tx.date)) {
      throw new Error('Date must be a valid YYYY-MM-DD string');
    }
    const db = getDb();
    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tx.type,
      amount,
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
    const vals: unknown[] = [nowIso()];

    if (fields.amount !== undefined) {
      const amount = parsePositiveAmount(fields.amount);
      if (amount === null) return fail('invalid_amount');
      sets.push('amount = ?'); vals.push(amount);
    }
    if (fields.date !== undefined && !isValidDateString(fields.date)) {
      return fail('invalid_date');
    }
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
    return { ok: true };
  });

  ipcHandle('finance:deleteTransaction', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    db.prepare('UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  });

  // ── Dashboard / Stats ──────────────────────────────

  ipcHandle('finance:getMonthlyBalance', (_e, month?: string) => {
    const db = getDb();
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    return computeMonthlyBalance(db, m);
  });

  /**
   * Category breakdown = "what did I spend on", so every live expense counts,
   * including card purchases whose statement has not landed yet. The auto-generated
   * `Pago Tarjeta` transaction is excluded so card spend is not counted twice.
   * `finance:getCategoryBreakdownForRange` uses the exact same definition —
   * switching the dashboard from "month" to "quarter" no longer changes it.
   */
  ipcHandle('finance:getCategoryBreakdown', (_e, month?: string) => {
    const db = getDb();
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    const { start, end } = monthRange(m);
    return aggregateByCategory(db, {
      start, end,
      type: 'expense',
      balanceScope: 'all',
      excludeCategories: [CARD_PAYMENT_CATEGORY],
    });
  });

  ipcHandle('finance:getCategoryBreakdownForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(startMonth) || !isValidMonthString(endMonth)) return [];
    const { start, end } = monthRangeBetween(startMonth, endMonth);
    return aggregateByCategory(db, {
      start, end,
      type: 'expense',
      balanceScope: 'all',
      excludeCategories: [CARD_PAYMENT_CATEGORY],
    }).sort((a, b) => b.ARS - a.ARS);
  });

  ipcHandle('finance:getBalanceForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(startMonth) || !isValidMonthString(endMonth)) {
      return {
        ARS: { income: 0, expenses: 0, balance: 0 },
        USD: { income: 0, expenses: 0, balance: 0 },
      };
    }
    const { start, end } = monthRangeBetween(startMonth, endMonth);
    return sumIncomeExpenseByCurrency(db, { start, end, balanceScope: 'impacting' });
  });

  /** Explicit spend breakdown so the UI never has to guess which definition a number uses. */
  ipcHandle('finance:getExpenseBreakdown', (_e, month?: string) => {
    const db = getDb();
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    return computeExpenseBreakdown(db, monthRange(m));
  });

  ipcHandle('finance:getExpenseBreakdownForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(startMonth) || !isValidMonthString(endMonth)) return null;
    return computeExpenseBreakdown(db, monthRangeBetween(startMonth, endMonth));
  });

  ipcHandle('finance:getProjection', (_e, months: number) => {
    const db = getDb();
    const count = Number.isFinite(months) ? Math.max(0, Math.min(Math.trunc(months), 60)) : 0;
    const currentMonth = todayDateString().slice(0, 7);

    const recurringRows = db.prepare(`
      SELECT currency, COALESCE(SUM(amount), 0) AS total
      FROM finance_recurring
      WHERE deleted_at IS NULL AND active = 1 AND type = 'expense'
      GROUP BY currency
    `).all() as Array<{ currency: string; total: number }>;
    const recurring = { ARS: 0, USD: 0 };
    for (const row of recurringRows) {
      if (row.currency === 'ARS' || row.currency === 'USD') recurring[row.currency] = row.total;
    }

    const projection = [];
    for (let i = 1; i <= count; i++) {
      const targetMonth = addMonthsToMonth(currentMonth, i);
      const { start, end } = monthRange(targetMonth);
      const installments = sumByCurrency(db, {
        start, end,
        balanceScope: 'all',
        installmentsOnly: true,
      });

      const byCurrency = {
        ARS: { installments: installments.ARS, recurring: recurring.ARS, total: installments.ARS + recurring.ARS },
        USD: { installments: installments.USD, recurring: recurring.USD, total: installments.USD + recurring.USD },
      };

      projection.push({
        month: targetMonth,
        // Legacy flat fields (ARS) kept so existing consumers keep working.
        installments: byCurrency.ARS.installments,
        recurring: byCurrency.ARS.recurring,
        total: byCurrency.ARS.total,
        ...byCurrency,
      });
    }

    return projection;
  });

  // ── Categories ──────────────────────────────────────

  ipcHandle('finance:getCategories', () => {
    const db = getDb();
    return (db.prepare('SELECT name FROM finance_categories WHERE deleted_at IS NULL ORDER BY created_at ASC').all() as { name: string }[])
      .map((r) => r.name);
  });

  ipcHandle('finance:addCategory', (_e, name: string) => {
    const trimmed = parseNonEmptyString(name);
    if (trimmed === null) return fail('invalid_name');

    const db = getDb();
    const now = nowIso();
    // Check if soft-deleted category with same name exists — un-delete it
    const deleted = db.prepare('SELECT name FROM finance_categories WHERE name = ? AND deleted_at IS NOT NULL').get(trimmed);
    if (deleted) {
      db.prepare('UPDATE finance_categories SET deleted_at = NULL, updated_at = ? WHERE name = ?').run(now, trimmed);
    } else {
      db.prepare('INSERT OR IGNORE INTO finance_categories (name, updated_at) VALUES (?, ?)').run(trimmed, now);
    }
    return { ok: true, name: trimmed };
  });

  ipcHandle('finance:deleteCategory', (_e, name: string) => {
    const db = getDb();
    const usage = db.prepare(
      'SELECT COUNT(*) AS c FROM finance_transactions WHERE category = ? AND deleted_at IS NULL'
    ).get(name) as { c: number };
    if (usage.c > 0) {
      throw new Error(`Cannot delete category in use by ${usage.c} transactions`);
    }
    const now = nowIso();
    db.prepare('UPDATE finance_categories SET deleted_at = ?, updated_at = ? WHERE name = ?').run(now, now, name);
  });

  // ── Credit Cards ──────────────────────────────────

  ipcHandle('finance:getCreditCards', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, closing_day AS closingDay, created_at AS createdAt
      FROM finance_credit_cards
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addCreditCard', (_e, card: { name: string; closingDay: number }) => {
    const name = parseNonEmptyString(card?.name);
    if (name === null) return fail('invalid_name');
    const closingDay = Number(card?.closingDay);
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) return fail('invalid_closing_day');

    const db = getDb();
    const id = genId();
    const now = nowIso();
    db.prepare('INSERT INTO finance_credit_cards (id, name, closing_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, closingDay, now, now);
    return id;
  });

  ipcHandle('finance:updateCreditCard', (_e, id: string, fields: { name?: string; closingDay?: number }) => {
    const db = getDb();
    const now = nowIso();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    if (fields.name !== undefined) {
      const name = parseNonEmptyString(fields.name);
      if (name === null) return fail('invalid_name');
      sets.push('name = ?'); vals.push(name);
    }
    if (fields.closingDay !== undefined) {
      const closingDay = Number(fields.closingDay);
      if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) return fail('invalid_closing_day');
      sets.push('closing_day = ?'); vals.push(closingDay);
    }
    if (sets.length === 1) return { ok: true }; // only updated_at, no real changes
    vals.push(id);
    db.prepare(`UPDATE finance_credit_cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  /**
   * Deleting a card releases its purchases back onto the balance
   * (`impacts_balance = 1`). The statement payment transactions it generated must
   * go with it, otherwise every purchase would be counted twice — once as itself,
   * once inside the surviving "Pago Tarjeta" row.
   */
  ipcHandle('finance:deleteCreditCard', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    const trx = db.transaction(() => {
      db.prepare(`
        UPDATE finance_transactions
        SET deleted_at = ?, updated_at = ?
        WHERE deleted_at IS NULL AND id IN (
          SELECT transaction_id FROM finance_credit_card_statements
          WHERE credit_card_id = ? AND transaction_id IS NOT NULL
          UNION
          SELECT transaction_id_usd FROM finance_credit_card_statements
          WHERE credit_card_id = ? AND transaction_id_usd IS NOT NULL
        )
      `).run(now, now, id, id);
      db.prepare('UPDATE finance_credit_card_statements SET deleted_at = ?, updated_at = ? WHERE credit_card_id = ?').run(now, now, id);
      db.prepare('UPDATE finance_transactions SET credit_card_id = NULL, impacts_balance = 1, updated_at = ? WHERE credit_card_id = ?').run(now, id);
      db.prepare('UPDATE finance_credit_cards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
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
    const conditions: string[] = ['s.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.creditCardId) { conditions.push('s.credit_card_id = ?'); params.push(filters.creditCardId); }
    if (filters.periodMonth) { conditions.push('s.period_month = ?'); params.push(filters.periodMonth); }
    if (filters.status) { conditions.push('s.status = ?'); params.push(filters.status); }

    return db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, c.name AS creditCardName,
             s.period_month AS periodMonth, s.calculated_amount AS calculatedAmount,
             s.calculated_amount_usd AS calculatedAmountUsd,
             s.paid_amount AS paidAmount, s.paid_amount_usd AS paidAmountUsd,
             s.status, s.paid_date AS paidDate,
             s.transaction_id AS transactionId, s.transaction_id_usd AS transactionIdUsd,
             s.created_at AS createdAt
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id AND c.deleted_at IS NULL
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.period_month DESC, c.name ASC
    `).all(...params);
  });

  ipcHandle('finance:getStatementDetail', (_e, statementId: string) => {
    const db = getDb();
    const statement = db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, s.period_month AS periodMonth,
             s.calculated_amount AS calculatedAmount,
             s.calculated_amount_usd AS calculatedAmountUsd,
             s.paid_amount AS paidAmount, s.paid_amount_usd AS paidAmountUsd,
             s.status, c.closing_day AS closingDay, c.name AS creditCardName
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id
      WHERE s.id = ?
    `).get(statementId) as { creditCardId: string; periodMonth: string; closingDay: number } | undefined;

    if (!statement) return null;

    const transactions = db.prepare(`
      SELECT ${TRANSACTION_COLUMNS}
      FROM finance_transactions
      WHERE deleted_at IS NULL AND credit_card_id = ? AND impacts_balance = 0
      ORDER BY date DESC, created_at DESC
    `).all(statement.creditCardId);

    const filtered = (transactions as Array<{ date: string; [key: string]: unknown }>).filter((tx) => {
      return getStatementPeriod(tx.date, statement.closingDay) === statement.periodMonth;
    });

    return { statement, transactions: filtered };
  });

  /** Sums the purchases that belong to a statement period, keeping currencies apart.
   *  USD lines imported from a card PDF carry the ARS amount the card actually
   *  charged (`billed_amount_ars`); those roll into the ARS total. */
  function computeStatementTotals(
    db: ReturnType<typeof getDb>,
    creditCardId: string,
    closingDay: number,
    periodMonth: string,
  ): { ars: number; usd: number } {
    const rows = db.prepare(`
      SELECT date, amount, currency, billed_amount_ars AS billedAmountArs
      FROM finance_transactions
      WHERE deleted_at IS NULL AND credit_card_id = ? AND impacts_balance = 0
    `).all(creditCardId) as Array<{ date: string; amount: number; currency: string; billedAmountArs: number | null }>;

    let ars = 0;
    let usd = 0;
    for (const tx of rows) {
      if (getStatementPeriod(tx.date, closingDay) !== periodMonth) continue;
      if (tx.currency === 'USD') {
        if (tx.billedAmountArs != null) ars += tx.billedAmountArs;
        else usd += tx.amount;
      } else {
        ars += tx.amount;
      }
    }
    return { ars, usd };
  }

  /**
   * Creates or REFRESHES the statement for a period.
   *
   * The dashboard auto-generates statements on mount, typically on the 1st or 2nd
   * of the month. The old early-return meant every purchase made after that point
   * mapped to the already-existing statement and was silently dropped forever.
   * Now only a `paid` statement is frozen; a `pending` one is recalculated.
   */
  ipcHandle('finance:generateStatement', (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(periodMonth)) return null;

    const card = db.prepare(
      'SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL'
    ).get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    const now = nowIso();
    const paymentDate = `${periodMonth}-01`;

    const insertPayment = (txId: string, amount: number, currency: string) => {
      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
        VALUES (?, 'expense', ?, ?, ?, ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?)
      `).run(txId, amount, currency, CARD_PAYMENT_CATEGORY, `Pago tarjeta - ${periodMonth}`, paymentDate, now, now);
    };

    /** Keeps the payment transaction for one currency in sync with the recomputed total. */
    const syncPayment = (currentId: string | null, amount: number, currency: string): string | null => {
      if (amount > 0) {
        if (currentId) {
          const res = db.prepare(
            'UPDATE finance_transactions SET amount = ?, currency = ?, deleted_at = NULL, updated_at = ? WHERE id = ?'
          ).run(amount, currency, now, currentId);
          if (res.changes > 0) return currentId;
        }
        const txId = genId();
        insertPayment(txId, amount, currency);
        return txId;
      }
      if (currentId) {
        db.prepare('UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(now, now, currentId);
      }
      return null;
    };

    const trx = db.transaction(() => {
      const existing = db.prepare(`
        SELECT id, status, transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
        FROM finance_credit_card_statements
        WHERE credit_card_id = ? AND period_month = ? AND deleted_at IS NULL
      `).get(creditCardId, periodMonth) as
        { id: string; status: string; transactionId: string | null; transactionIdUsd: string | null } | undefined;

      // A paid statement is history — never rewrite it.
      if (existing && existing.status === 'paid') return existing.id;

      const { ars, usd } = computeStatementTotals(db, creditCardId, card.closingDay, periodMonth);

      if (!existing) {
        if (ars === 0 && usd === 0) return null;
        const statementId = genId();
        const arsTxId = syncPayment(null, ars, 'ARS');
        const usdTxId = syncPayment(null, usd, 'USD');
        db.prepare(`
          INSERT INTO finance_credit_card_statements
            (id, credit_card_id, period_month, calculated_amount, calculated_amount_usd,
             status, transaction_id, transaction_id_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `).run(statementId, creditCardId, periodMonth, ars, usd, arsTxId, usdTxId, now, now);
        return statementId;
      }

      // Every purchase that fed this statement is gone — retire it with its payments.
      if (ars === 0 && usd === 0) {
        syncPayment(existing.transactionId, 0, 'ARS');
        syncPayment(existing.transactionIdUsd, 0, 'USD');
        db.prepare('UPDATE finance_credit_card_statements SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, existing.id);
        return null;
      }

      const arsTxId = syncPayment(existing.transactionId, ars, 'ARS');
      const usdTxId = syncPayment(existing.transactionIdUsd, usd, 'USD');
      db.prepare(`
        UPDATE finance_credit_card_statements
        SET calculated_amount = ?, calculated_amount_usd = ?,
            transaction_id = ?, transaction_id_usd = ?, updated_at = ?
        WHERE id = ?
      `).run(ars, usd, arsTxId, usdTxId, now, existing.id);
      return existing.id;
    });

    return trx();
  });

  ipcHandle('finance:payStatement', (_e, statementId: string, paidAmount: number, paidAmountUsd?: number) => {
    const ars = Number(paidAmount ?? 0);
    const usd = Number(paidAmountUsd ?? 0);
    if (!Number.isFinite(ars) || !Number.isFinite(usd) || ars < 0 || usd < 0) return fail('invalid_amount');
    if (ars <= 0 && usd <= 0) return fail('invalid_amount');

    const db = getDb();
    const now = nowIso();
    const today = now.slice(0, 10);

    const stmt = db.prepare(`
      SELECT transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
      FROM finance_credit_card_statements WHERE id = ?
    `).get(statementId) as { transactionId: string | null; transactionIdUsd: string | null } | undefined;

    if (!stmt) return fail('not_found');

    const trx = db.transaction(() => {
      db.prepare(`
        UPDATE finance_credit_card_statements
        SET paid_amount = ?, paid_amount_usd = ?, status = 'paid', paid_date = ?, updated_at = ?
        WHERE id = ?
      `).run(ars, usd, today, now, statementId);

      const updateTx = db.prepare('UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?');
      if (stmt.transactionId) updateTx.run(ars, now, stmt.transactionId);
      if (stmt.transactionIdUsd) updateTx.run(usd, now, stmt.transactionIdUsd);
    });
    trx();
    return { ok: true };
  });

  // ── Backward compat (dashboard widget) ─────────────

  ipcHandle('finance:getMonthlyTotal', () => {
    const db = getDb();
    const { start, end } = monthRange(todayDateString().slice(0, 7));
    return sumByCurrency(db, { start, end, type: 'expense', balanceScope: 'impacting' }).ARS;
  });

  ipcHandle('finance:getActiveLoansCount', () => {
    const db = getDb();
    const result = db.prepare(
      'SELECT COUNT(*) AS c FROM finance_loans WHERE settled = 0 AND deleted_at IS NULL'
    ).get() as { c: number };
    return result.c;
  });

  ipcHandle('finance:getTodayTransactionsCount', () => {
    const db = getDb();
    const today = todayDateString();
    const result = db.prepare('SELECT COUNT(*) AS c FROM finance_transactions WHERE deleted_at IS NULL AND date = ?').get(today) as { c: number };
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
      LEFT JOIN finance_transactions t ON t.installment_group_id = g.id AND t.deleted_at IS NULL
      WHERE g.deleted_at IS NULL
      GROUP BY g.id
      ORDER BY g.date DESC, g.created_at DESC
    `).all();
  });

  ipcHandle('finance:getInstallmentsForMonth', (_e, month: string) => {
    const db = getDb();
    if (!isValidMonthString(month)) return [];
    const { start, end } = monthRange(month);
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
             COALESCE(
               t.installment_number,
               (CAST(SUBSTR(t.date, 1, 4) AS INTEGER) - CAST(SUBSTR(g.date, 1, 4) AS INTEGER)) * 12
                 + (CAST(SUBSTR(t.date, 6, 2) AS INTEGER) - CAST(SUBSTR(g.date, 6, 2) AS INTEGER))
                 + 1
             ) AS installmentNumber
      FROM finance_transactions t
      JOIN finance_installment_groups g ON g.id = t.installment_group_id
      WHERE t.deleted_at IS NULL AND t.installment_group_id IS NOT NULL
        AND t.date >= ? AND t.date < ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(start, end);
  });

  ipcHandle('finance:getInstallmentProjection', (_e, months: number) => {
    const db = getDb();
    const count = Number.isFinite(months) ? Math.max(0, Math.min(Math.trunc(months), 60)) : 0;
    const currentMonth = todayDateString().slice(0, 7);

    const projection = [];
    for (let i = 1; i <= count; i++) {
      const targetMonth = addMonthsToMonth(currentMonth, i);
      const { start, end } = monthRange(targetMonth);
      const totals = sumByCurrency(db, { start, end, balanceScope: 'all', installmentsOnly: true });
      // `total` stays the ARS figure for existing consumers.
      projection.push({ month: targetMonth, total: totals.ARS, ARS: totals.ARS, USD: totals.USD });
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
    if (!isValidDateString(group?.startDate)) return fail('invalid_start_date');

    const installmentCount = Number(group.installmentCount);
    if (!Number.isInteger(installmentCount) || installmentCount < 1) return fail('invalid_installment_count');
    if (installmentCount > MAX_INSTALLMENTS) return fail('too_many_installments');

    const amounts: number[] = [];
    for (let i = 0; i < installmentCount; i++) {
      const raw = group.installmentAmounts?.[i] ?? group.installmentAmount;
      const parsed = parsePositiveAmount(raw);
      if (parsed === null) return fail('invalid_amount');
      amounts.push(parsed);
    }

    const totalAmount = group.installmentAmounts
      ? amounts.reduce((a, b) => a + b, 0)
      : parsePositiveAmount(group.totalAmount) ?? amounts.reduce((a, b) => a + b, 0);

    const db = getDb();
    const groupId = genId();
    const now = nowIso();

    const isCreditCard = group.paymentMethod === 'credit_card' && !!group.creditCardId;
    // Card purchases land on next month's statement.
    const monthOffset = isCreditCard ? 1 : 0;

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `);

    const trx = db.transaction(() => {
      db.prepare(`
        INSERT INTO finance_installment_groups
          (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        groupId,
        group.description,
        totalAmount,
        group.currency ?? 'ARS',
        installmentCount,
        group.category ?? 'Otros',
        group.startDate,
        now,
        now,
      );

      for (let i = 0; i < installmentCount; i++) {
        insertTx.run(
          genId(),
          amounts[i],
          group.currency ?? 'ARS',
          group.category ?? 'Otros',
          `${group.description} (Cuota ${i + 1}/${installmentCount})`,
          // Clamped: a plan starting on the 31st must not skip February.
          addMonthsClamped(group.startDate, i + monthOffset),
          group.paymentMethod ?? 'credit_card',
          installmentCount,
          groupId,
          i + 1,
          group.forThirdParty ? 1 : 0,
          isCreditCard ? group.creditCardId : null,
          isCreditCard ? 0 : 1,
          now,
          now,
        );
      }
    });

    trx();
    return groupId;
  });

  ipcHandle('finance:deleteInstallmentGroup', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    // Application-level cascade: soft-delete linked transactions and the group atomically
    const trx = db.transaction(() => {
      db.prepare('UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE installment_group_id = ?').run(now, now, id);
      db.prepare('UPDATE finance_installment_groups SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    });
    trx();
  });

  ipcHandle('finance:updateInstallmentAmount', (_e, txId: string, newAmount: number) => {
    const amount = parsePositiveAmount(newAmount);
    if (amount === null) return fail('invalid_amount');
    const db = getDb();
    db.prepare('UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), txId);
    return { ok: true };
  });

  // ── Loans ────────────────────────────────────────────

  ipcHandle('finance:getLoans', (_e, filter: { direction?: 'lent' | 'borrowed'; settled?: boolean } = {}) => {
    const db = getDb();
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filter.direction !== undefined) {
      conditions.push('direction = ?');
      params.push(filter.direction);
    }
    if (filter.settled !== undefined) {
      conditions.push('settled = ?');
      params.push(filter.settled ? 1 : 0);
    }

    return db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt
      FROM finance_loans
      WHERE ${conditions.join(' AND ')}
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
      WHERE person_name = ? AND settled = 0 AND deleted_at IS NULL
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
    const personName = parseNonEmptyString(loan?.personName);
    if (personName === null) return fail('invalid_person_name');
    const amount = parsePositiveAmount(loan?.amount);
    if (amount === null) return fail('invalid_amount');
    if (!isValidDateString(loan?.date)) return fail('invalid_date');
    if (loan.direction !== 'lent' && loan.direction !== 'borrowed') return fail('invalid_direction');

    const db = getDb();
    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_loans
        (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      personName,
      loan.direction,
      loan.type ?? 'single',
      amount,
      loan.currency ?? 'ARS',
      loan.date,
      loan.description ?? '',
      loan.installmentGroupId ?? null,
      now,
      now,
    );
    return id;
  });

  ipcHandle('finance:settleLoan', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    db.prepare('UPDATE finance_loans SET settled = 1, settled_date = ?, updated_at = ? WHERE id = ?')
      .run(now.slice(0, 10), now, id);
  });

  ipcHandle('finance:addLoanPayment', (_e, loanId: string, payment: {
    amount: number;
    currency?: string;
    date: string;
    note?: string;
  }) => {
    const amount = parsePositiveAmount(payment?.amount);
    if (amount === null) return fail('invalid_amount');
    if (!isValidDateString(payment?.date)) return fail('invalid_date');

    const db = getDb();
    const loan = db.prepare('SELECT id FROM finance_loans WHERE id = ? AND deleted_at IS NULL').get(loanId);
    if (!loan) return fail('loan_not_found');

    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, loanId, amount, payment.currency ?? 'ARS', payment.date, payment.note ?? '', now, now);
    return id;
  });

  ipcHandle('finance:getLoanPayments', (_e, loanId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, loan_id AS loanId, amount, currency, date, note, created_at AS createdAt
      FROM finance_loan_payments
      WHERE loan_id = ? AND deleted_at IS NULL
      ORDER BY date ASC
    `).all(loanId);
  });

  ipcHandle('finance:deleteLoanPayment', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    db.prepare('UPDATE finance_loan_payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, id);
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
    if (!isValidDateString(data?.startDate)) return fail('invalid_start_date');
    const personName = parseNonEmptyString(data?.personName);
    if (personName === null) return fail('invalid_person_name');
    const installmentCount = Number(data.installmentCount);
    if (!Number.isInteger(installmentCount) || installmentCount < 1) return fail('invalid_installment_count');
    if (installmentCount > MAX_INSTALLMENTS) return fail('too_many_installments');
    const installmentAmount = parsePositiveAmount(data.installmentAmount);
    if (installmentAmount === null) return fail('invalid_amount');

    const db = getDb();
    const currency = data.currency ?? 'ARS';
    const category = data.category ?? 'Otros';
    const totalAmount = installmentCount * installmentAmount;
    const groupId = genId();
    const loanId = genId();
    const now = nowIso();

    // Same rule as createInstallmentGroup: only a real card defers to next month
    // and keeps the purchase off the balance until the statement is paid.
    const isCreditCard = !!data.creditCardId;
    const monthOffset = isCreditCard ? 1 : 0;

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, 'credit_card', 'manual', ?, ?, ?, 1, NULL, NULL, ?, ?, ?, ?)
    `);

    const trx = db.transaction(() => {
      db.prepare(`
        INSERT INTO finance_installment_groups
          (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(groupId, data.description, totalAmount, currency, installmentCount, category, data.startDate, now, now);

      for (let i = 0; i < installmentCount; i++) {
        insertTx.run(
          genId(),
          installmentAmount,
          currency,
          category,
          `${data.description} (Cuota ${i + 1}/${installmentCount})`,
          addMonthsClamped(data.startDate, i + monthOffset),
          installmentCount,
          groupId,
          i + 1,
          data.creditCardId ?? null,
          isCreditCard ? 0 : 1,
          now,
          now,
        );
      }

      db.prepare(`
        INSERT INTO finance_loans
          (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at, updated_at)
        VALUES (?, ?, ?, 'installments', ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(loanId, personName, data.direction ?? 'lent', totalAmount, currency, data.startDate, data.description, groupId, now, now);
    });

    trx();
    return { groupId, loanId };
  });

  /**
   * Outstanding loans per currency (never mix ARS with USD) and net of the
   * repayments already registered in `finance_loan_payments`.
   */
  ipcHandle('finance:getActiveLoanSummary', () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT l.direction, l.currency,
             COALESCE(SUM(l.amount), 0) AS total,
             COALESCE(SUM(MAX(l.amount - COALESCE(p.paid, 0), 0)), 0) AS pending
      FROM finance_loans l
      LEFT JOIN (
        SELECT loan_id, SUM(amount) AS paid
        FROM finance_loan_payments
        WHERE deleted_at IS NULL
        GROUP BY loan_id
      ) p ON p.loan_id = l.id
      WHERE l.settled = 0 AND l.deleted_at IS NULL
      GROUP BY l.direction, l.currency
    `).all() as Array<{ direction: string; currency: string; total: number; pending: number }>;

    const summary = {
      ARS: { lent: 0, borrowed: 0, lentPending: 0, borrowedPending: 0 },
      USD: { lent: 0, borrowed: 0, lentPending: 0, borrowedPending: 0 },
      // Legacy flat ARS fields kept so existing consumers keep working.
      lent: 0,
      borrowed: 0,
    };

    for (const row of rows) {
      if (row.currency !== 'ARS' && row.currency !== 'USD') continue;
      const bucket = summary[row.currency];
      if (row.direction === 'lent') {
        bucket.lent = row.total;
        bucket.lentPending = row.pending;
      } else if (row.direction === 'borrowed') {
        bucket.borrowed = row.total;
        bucket.borrowedPending = row.pending;
      }
    }
    summary.lent = summary.ARS.lent;
    summary.borrowed = summary.ARS.borrowed;
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
      WHERE deleted_at IS NULL
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
    const name = parseNonEmptyString(rec?.name);
    if (name === null) return fail('invalid_name');
    const amount = parsePositiveAmount(rec?.amount);
    if (amount === null) return fail('invalid_amount');

    const db = getDb();
    const id = rec.id ?? genId();
    const now = nowIso();
    db.prepare(`
      INSERT OR IGNORE INTO finance_recurring
        (id, name, type, amount, currency, category, billing_day, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      name,
      rec.type,
      amount,
      rec.currency ?? 'ARS',
      rec.category ?? 'Otros',
      rec.billingDay ?? 1,
      now,
      now,
    );
    return id;
  });

  ipcHandle('finance:updateRecurringAmount', (_e, id: string, newAmount: number) => {
    const amount = parsePositiveAmount(newAmount);
    if (amount === null) return fail('invalid_amount');

    const db = getDb();
    const now = nowIso();
    const today = now.slice(0, 10);
    const historyId = genId();
    const current = db.prepare('SELECT amount FROM finance_recurring WHERE id = ?').get(id) as { amount: number } | undefined;
    if (!current) return fail('not_found');

    const trx = db.transaction(() => {
      db.prepare(`
        INSERT INTO finance_recurring_amount_history
          (id, recurring_id, previous_amount, amount, currency, effective_date, created_at)
        SELECT ?, id, ?, ?, currency, ?, ?
        FROM finance_recurring
        WHERE id = ?
      `).run(historyId, current.amount, amount, today, now, id);
      db.prepare('UPDATE finance_recurring SET amount = ?, updated_at = ? WHERE id = ?').run(amount, now, id);
    });
    trx();
    return { ok: true };
  });

  ipcHandle('finance:updateRecurring', (_e, id: string, fields: {
    name?: string;
    type?: 'expense' | 'income';
    category?: string;
    billingDay?: number;
  }) => {
    const allowed = new Set(['name', 'type', 'category', 'billingDay']);
    const safe = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k))) as typeof fields;

    const db = getDb();
    const now = nowIso();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (safe.name !== undefined) {
      const name = parseNonEmptyString(safe.name);
      if (name === null) return fail('invalid_name');
      sets.push('name = ?'); params.push(name);
    }
    if (safe.type !== undefined) { sets.push('type = ?'); params.push(safe.type); }
    if (safe.category !== undefined) { sets.push('category = ?'); params.push(safe.category); }
    if (safe.billingDay !== undefined) {
      const billingDay = Number(safe.billingDay);
      if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) return fail('invalid_billing_day');
      sets.push('billing_day = ?'); params.push(billingDay);
    }

    if (sets.length === 1) return { ok: true }; // only updated_at, no real changes
    params.push(id);
    db.prepare(`UPDATE finance_recurring SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true };
  });

  ipcHandle('finance:toggleRecurring', (_e, id: string) => {
    const db = getDb();
    db.prepare(`
      UPDATE finance_recurring
      SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END,
          updated_at = ?
      WHERE id = ?
    `).run(nowIso(), id);
  });

  /** Soft-delete AND deactivate: an active-but-deleted template used to be
   *  invisible in the UI while the bootstrap job kept regenerating it forever. */
  ipcHandle('finance:deleteRecurring', (_e, id: string) => {
    const db = getDb();
    const now = nowIso();
    const trx = db.transaction(() => {
      db.prepare('UPDATE finance_transactions SET recurring_id = NULL, updated_at = ? WHERE recurring_id = ?').run(now, id);
      db.prepare('UPDATE finance_recurring SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?').run(now, now, id);
    });
    trx();
  });

  ipcHandle('finance:generateRecurringForMonth', (_e, month: string) => {
    return generateRecurringForMonth(getDb(), month);
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

  // ── C3: Monthly expenses sparkline (last 6 months) ────────

  ipcHandle('finance:getMonthlyExpenses', () => {
    const db = getDb();
    const currentMonth = todayDateString().slice(0, 7);

    const result: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const { start, end } = monthRange(addMonthsToMonth(currentMonth, -i));
      result.push(sumByCurrency(db, { start, end, type: 'expense', currency: 'ARS', balanceScope: 'impacting' }).ARS);
    }
    return result;
  });

  // ── C7: Category averages (last 3 months) ─────────────────

  ipcHandle('finance:getCategoryAverages', () => {
    const db = getDb();
    const currentMonth = todayDateString().slice(0, 7);
    // Window: the three complete months before the current one.
    const start = monthRange(addMonthsToMonth(currentMonth, -3)).start;
    const end = monthRange(addMonthsToMonth(currentMonth, -1)).end;

    const rows = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
      FROM finance_transactions
      WHERE deleted_at IS NULL AND type = 'expense' AND currency = 'ARS' AND impacts_balance = 1
        AND category != ?
        AND date >= ? AND date < ?
      GROUP BY category
    `).all(CARD_PAYMENT_CATEGORY, start, end) as Array<{ category: string; total: number }>;

    // Divide by the months that actually have data, not a hard-coded 3 —
    // otherwise a user with one month of history sees a third of reality.
    const monthsWithData = db.prepare(`
      SELECT COUNT(DISTINCT SUBSTR(date, 1, 7)) AS c
      FROM finance_transactions
      WHERE deleted_at IS NULL AND type = 'expense' AND currency = 'ARS' AND impacts_balance = 1
        AND category != ?
        AND date >= ? AND date < ?
    `).get(CARD_PAYMENT_CATEGORY, start, end) as { c: number };
    const divisor = Math.max(monthsWithData.c, 1);

    const averages: Record<string, number> = {};
    for (const row of rows) {
      averages[row.category] = row.total / divisor;
    }
    return averages;
  });

  // ── C8: Previous month summary ────────────────────────────

  ipcHandle('finance:getPreviousMonthSummary', () => {
    const db = getDb();
    const prevMonth = addMonthsToMonth(todayDateString().slice(0, 7), -1);
    const { start, end } = monthRange(prevMonth);

    const balance = sumIncomeExpenseByCurrency(db, {
      start, end, currency: 'ARS', balanceScope: 'impacting',
    });

    return { income: balance.ARS.income, expenses: balance.ARS.expenses, month: prevMonth };
  });

  // ── C5: Export CSV ──────────────────────────────────────────

  ipcHandle('finance:exportCsv', async (_e, month?: string) => {
    const db = getDb();
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    const { start, end } = monthRange(m);

    const rows = db.prepare(`
      SELECT date, description, amount, currency, category, type,
             payment_method AS paymentMethod
      FROM finance_transactions
      WHERE deleted_at IS NULL AND date >= ? AND date < ?
      ORDER BY date ASC, created_at ASC
    `).all(start, end) as Array<{
      date: string;
      description: string;
      amount: number;
      currency: string;
      category: string;
      type: string;
      paymentMethod: string;
    }>;

    if (rows.length === 0) {
      return { success: false, error: 'no_data' };
    }

    const win = BrowserWindow.getFocusedWindow();
    const { filePath, canceled } = await dialog.showSaveDialog(win!, {
      title: 'Export CSV',
      defaultPath: `coinify-${m}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const escape = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const header = 'date,description,amount,currency,category,type,payment_method';
    const csvRows = rows.map((r) =>
      [
        r.date,
        escape(r.description),
        r.amount.toString(),
        r.currency,
        escape(r.category),
        r.type,
        r.paymentMethod,
      ].join(','),
    );

    const csv = [header, ...csvRows].join('\n');
    fs.writeFileSync(filePath, csv, 'utf-8');

    return { success: true, path: filePath, count: rows.length };
  });
}
