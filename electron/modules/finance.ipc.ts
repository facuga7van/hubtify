import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { dialog, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import { todayDateString } from '../../shared/date-utils';
import {
  CARD_PAYMENT_CATEGORY,
  DEFAULT_CASH_ACCOUNT_ID,
  MAX_INSTALLMENTS,
  RECURRING_FREQUENCY_MONTHS,
  TRANSFER_CATEGORY,
  addMonthsClamped,
  addMonthsToMonth,
  backfillFxRates,
  computeBudgetStatus,
  computeCategorySpend,
  computeExpenseBreakdown,
  computeMonthlyBalance,
  computeUpcomingTimeline,
  computeValuedView,
  generateRecurringForMonth,
  getCurrentRate,
  getFxHouse,
  getIpcSeries,
  listBudgets,
  setBudget,
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
  computeAccountsOverview,
  saveAccount,
  softDeleteAccount,
  transferBetweenAccounts,
} from './finance.balance';

function genId(): string {
  return crypto.randomUUID();
}

/** Uniform failure envelope for handlers that used to persist garbage or throw raw. */
function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * Venta rate of the preferred house to freeze on a new transaction.
 * Cache-first, bounded fetch, and NEVER throws or blocks a write for long:
 * offline with no cache simply means `fx_rate = NULL` (backfill fixes it later).
 */
function captureFxRate(db: ReturnType<typeof getDb>): Promise<number | null> {
  return getCurrentRate(db, getFxHouse(db));
}

/**
 * `for_third_party` is a 0/1 flag; the person's name lives on the loan that
 * shares the instalment group. The UI used to print the flag, so every
 * third-party row read "→ 1".
 *
 * A correlated subquery rather than a LEFT JOIN on purpose: two loans pointing
 * at the same group would fan a JOIN out into duplicate transactions (and break
 * the COUNT in `finance:getInstallmentGroups`).
 */
function thirdPartyNameColumn(alias: string): string {
  return `
  (SELECT l.person_name FROM finance_loans l
    WHERE l.installment_group_id = ${alias}.installment_group_id
      AND l.deleted_at IS NULL
    ORDER BY l.created_at ASC LIMIT 1) AS thirdPartyName`;
}

/** Transaction columns, optionally prefixed with a table alias. */
function transactionColumns(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `
  ${p}id, ${p}type, ${p}amount, ${p}currency, ${p}category, ${p}description, ${p}date,
  ${p}payment_method AS paymentMethod, ${p}source, ${p}installments,
  ${p}installment_group_id AS installmentGroupId,
  ${p}installment_number AS installmentNumber,
  ${p}for_third_party AS forThirdParty,
  ${p}recurring_id AS recurringId,
  ${p}import_batch_id AS importBatchId,
  ${p}credit_card_id AS creditCardId,
  ${p}impacts_balance AS impactsBalance,
  ${p}billed_amount_ars AS billedAmountArs,
  ${p}fx_rate AS fxRate,
  ${p}account_id AS accountId,
  ${p}transfer_group_id AS transferGroupId,
  ${p}created_at AS createdAt, ${p}updated_at AS updatedAt
`;
}

const TRANSACTION_COLUMNS = transactionColumns();

export function registerFinanceIpcHandlers(): void {
  // ── Transactions ────────────────────────────────────

  ipcHandle('finance:getTransactions', (_e, filters: {
    month?: string;
    category?: string;
    type?: string;
    paymentMethod?: string;
    installmentGroupId?: string;
    /** `manual` | `recurring` | `import`. */
    source?: string;
    /** Account drill-down: an id, or `null` for "sin cuenta asignada". */
    accountId?: string | null;
    /** Cap the result set — "give me the last N" without pulling the ledger. */
    limit?: number;
  } = {}) => {
    const db = getDb();
    const conditions: string[] = ['t.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.month && isValidMonthString(filters.month)) {
      const { start, end } = monthRange(filters.month);
      conditions.push('t.date >= ?', 't.date < ?');
      params.push(start, end);
    }
    if (filters.category) {
      conditions.push('t.category = ?');
      params.push(filters.category);
    }
    if (filters.type) {
      conditions.push('t.type = ?');
      params.push(filters.type);
    }
    if (filters.paymentMethod) {
      conditions.push('t.payment_method = ?');
      params.push(filters.paymentMethod);
    }
    if (filters.installmentGroupId !== undefined) {
      conditions.push('t.installment_group_id = ?');
      params.push(filters.installmentGroupId);
    }
    if (filters.source) {
      conditions.push('t.source = ?');
      params.push(filters.source);
    }
    if (filters.accountId !== undefined) {
      if (filters.accountId === null) conditions.push('t.account_id IS NULL');
      else { conditions.push('t.account_id = ?'); params.push(filters.accountId); }
    }

    const rawLimit = Number(filters.limit);
    const limitClause = Number.isInteger(rawLimit) && rawLimit > 0
      ? ` LIMIT ${Math.min(rawLimit, 1000)}`
      : '';

    return db.prepare(`
      SELECT ${transactionColumns('t')},
             ${thirdPartyNameColumn('t')}
      FROM finance_transactions t
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.date DESC, t.created_at DESC${limitClause}
    `).all(...params);
  });

  ipcHandle('finance:addTransaction', async (_e, tx: {
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
    /** `undefined` = not chosen (cash maps to the default «Efectivo»);
     *  `null` = explicitly "sin cuenta"; a string = that account. */
    accountId?: string | null;
  }) => {
    const amount = parsePositiveAmount(tx.amount);
    if (amount === null) {
      throw new Error('Amount must be a positive finite number');
    }
    if (!isValidDateString(tx.date)) {
      throw new Error('Date must be a valid YYYY-MM-DD string');
    }
    const db = getDb();

    // Default mapping when no account was chosen at all: cash goes to the
    // seeded «Efectivo» account (if it is still alive); every other payment
    // method stays unassigned. NEVER invent accounts from payment_method.
    let accountId = tx.accountId ?? null;
    if (tx.accountId === undefined && (tx.paymentMethod ?? 'cash') === 'cash') {
      const def = db.prepare(
        'SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL'
      ).get(DEFAULT_CASH_ACCOUNT_ID) as { id: string } | undefined;
      if (def) accountId = DEFAULT_CASH_ACCOUNT_ID;
    }

    // Freeze today's venta rate on the row. Offline with no cache → NULL, and
    // the write goes through regardless — a missing rate never blocks the alta.
    const fxRate = await captureFxRate(db);
    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, credit_card_id, impacts_balance, fx_rate, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      fxRate,
      accountId,
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
    /** `null` clears the account ("sin cuenta"); `undefined` leaves it alone. */
    accountId?: string | null;
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
    if (fields.accountId !== undefined) { sets.push('account_id = ?'); vals.push(fields.accountId); }
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
    return computeCategorySpend(db, monthRange(m));
  });

  ipcHandle('finance:getCategoryBreakdownForRange', (_e, startMonth: string, endMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(startMonth) || !isValidMonthString(endMonth)) return [];
    return computeCategorySpend(db, monthRangeBetween(startMonth, endMonth))
      .sort((a, b) => b.ARS - a.ARS);
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
    return sumIncomeExpenseByCurrency(db, {
      start, end, balanceScope: 'impacting', excludeCategories: [TRANSFER_CATEGORY],
    });
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

  /**
   * Forward projection of installments + recurring expenses.
   *
   * `fromMonth` anchors the projection: month `i` of the result is
   * `fromMonth + i`. Omitted, it falls back to the real current month, so the
   * dashboard widget and any older caller keep the previous behaviour.
   */
  ipcHandle('finance:getProjection', (_e, months: number, fromMonth?: string) => {
    const db = getDb();
    const count = Number.isFinite(months) ? Math.max(0, Math.min(Math.trunc(months), 60)) : 0;
    const currentMonth = isValidMonthString(fromMonth) ? fromMonth : todayDateString().slice(0, 7);

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

  // ── Budgets ─────────────────────────────────────────
  //
  // A budget is an attribute of a category the expense wheel already draws, not
  // a screen of its own — hence no id, no month column, no CRUD surface beyond
  // "set the number" and "clear it".

  ipcHandle('finance:getBudgets', () => listBudgets(getDb()));

  /** `limit === null` clears the budget (soft delete, so the removal syncs). */
  ipcHandle('finance:setBudget', (_e, category: string, limit: number | null) =>
    setBudget(getDb(), category, limit));

  /**
   * Budget vs. reality for a month. Spend comes from the exact aggregation the
   * dashboard wheel is drawn from (`computeCategorySpend`), so the bar under a
   * slice and the slice itself can never disagree.
   */
  ipcHandle('finance:getBudgetStatus', (_e, month?: string) => {
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    return computeBudgetStatus(getDb(), m);
  });

  // ── Accounts (cuentas y billeteras) ────────────────
  //
  // The chest opened into rows: each live account with its computed balance
  // (initial_balance + income − expenses of its live, balance-impacting rows,
  // in the account's own currency). All the arithmetic lives in
  // finance.balance.ts so the Syl snapshot and the tests share it.

  /** Live accounts with computed balance. */
  ipcHandle('finance:getAccounts', () => computeAccountsOverview(getDb()).accounts);

  /** `{ accounts, totalArs, totalUsd }` — the chest's row view plus its totals. */
  ipcHandle('finance:getAccountsOverview', () => computeAccountsOverview(getDb()));

  /** Upsert: `id` present → update (revives a soft-deleted row); absent → create. */
  ipcHandle('finance:saveAccount', (_e, account: {
    id?: string;
    name: string;
    kind: 'cash' | 'bank' | 'wallet';
    currency?: string;
    initialBalance?: number;
    order?: number;
  }) => saveAccount(getDb(), account));

  /** Soft delete. Its transactions keep account_id untouched — history stays. */
  ipcHandle('finance:deleteAccount', (_e, id: string) => softDeleteAccount(getDb(), id));

  /**
   * Two live legs (expense on origin, income on destination) sharing a
   * transfer_group_id under the reserved `Transferencia` category — balances
   * move, monthly totals and the wheel do not, and no XP is paid.
   */
  ipcHandle('finance:transferBetweenAccounts', async (_e, input: {
    fromId: string;
    toId: string;
    amount: number;
    date?: string;
  }) => {
    const db = getDb();
    const fxRate = await captureFxRate(db);
    return transferBetweenAccounts(db, {
      fromId: input?.fromId,
      toId: input?.toId,
      amount: input?.amount,
      date: input?.date ?? todayDateString(),
      fxRate,
    });
  });

  // ── Credit Cards ──────────────────────────────────

  ipcHandle('finance:getCreditCards', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, closing_day AS closingDay, due_day AS dueDay, created_at AS createdAt
      FROM finance_credit_cards
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `).all();
  });

  /** `dueDay` 1–31 or null/undefined (no due-date agenda for this card). */
  function parseDueDay(value: unknown): number | null | 'invalid' {
    if (value === undefined || value === null || value === 0 || value === '') return null;
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'invalid';
    return day;
  }

  ipcHandle('finance:addCreditCard', (_e, card: { name: string; closingDay: number; dueDay?: number | null }) => {
    const name = parseNonEmptyString(card?.name);
    if (name === null) return fail('invalid_name');
    const closingDay = Number(card?.closingDay);
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) return fail('invalid_closing_day');
    const dueDay = parseDueDay(card?.dueDay);
    if (dueDay === 'invalid') return fail('invalid_due_day');

    const db = getDb();
    const id = genId();
    const now = nowIso();
    db.prepare('INSERT INTO finance_credit_cards (id, name, closing_day, due_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, closingDay, dueDay, now, now);
    return id;
  });

  ipcHandle('finance:updateCreditCard', (_e, id: string, fields: { name?: string; closingDay?: number; dueDay?: number | null }) => {
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
    if (fields.dueDay !== undefined) {
      const dueDay = parseDueDay(fields.dueDay);
      if (dueDay === 'invalid') return fail('invalid_due_day');
      sets.push('due_day = ?'); vals.push(dueDay);
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
      SELECT date, type, amount, currency, billed_amount_ars AS billedAmountArs
      FROM finance_transactions
      WHERE deleted_at IS NULL AND credit_card_id = ? AND impacts_balance = 0
    `).all(creditCardId) as Array<{ date: string; type: string; amount: number; currency: string; billedAmountArs: number | null }>;

    let ars = 0;
    let usd = 0;
    for (const tx of rows) {
      if (getStatementPeriod(tx.date, closingDay) !== periodMonth) continue;
      // A refund (a reversed purchase, a `DEV.IMP` tax credit) is stored as an
      // `income` row with a positive amount. Summing it blind used to make the
      // statement bigger than the paper by twice the refund.
      const sign = tx.type === 'income' ? -1 : 1;
      if (tx.currency === 'USD') {
        if (tx.billedAmountArs != null) ars += sign * tx.billedAmountArs;
        else usd += sign * tx.amount;
      } else {
        ars += sign * tx.amount;
      }
    }
    // A period that nets out negative owes nothing — never invent a credit.
    return { ars: Math.max(ars, 0), usd: Math.max(usd, 0) };
  }

  /**
   * Creates or REFRESHES the statement for a period.
   *
   * The dashboard auto-generates statements on mount, typically on the 1st or 2nd
   * of the month. The old early-return meant every purchase made after that point
   * mapped to the already-existing statement and was silently dropped forever.
   * Now only a `paid` statement is frozen; a `pending` one is recalculated.
   */
  ipcHandle('finance:generateStatement', async (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(periodMonth)) return null;

    const card = db.prepare(
      'SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL'
    ).get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    // Before the write transaction opens: async work inside db.transaction is not allowed.
    const fxRate = await captureFxRate(db);
    const now = nowIso();
    const paymentDate = `${periodMonth}-01`;

    const insertPayment = (txId: string, amount: number, currency: string) => {
      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, credit_card_id, impacts_balance, fx_rate, created_at, updated_at)
        VALUES (?, 'expense', ?, ?, ?, ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?, ?)
      `).run(txId, amount, currency, CARD_PAYMENT_CATEGORY, `Pago tarjeta - ${periodMonth}`, paymentDate, fxRate, now, now);
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
    return sumByCurrency(db, {
      start, end, type: 'expense', balanceScope: 'impacting',
      excludeCategories: [TRANSFER_CATEGORY],
    }).ARS;
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

  /**
   * `month` narrows the list to the plans that actually bill in that month —
   * the plans a "N cuotas activas" figure is supposed to be counting. Without it
   * the answer is every plan ever created, finished ones included.
   */
  ipcHandle('finance:getInstallmentGroups', (_e, month?: string) => {
    const db = getDb();
    const conditions = ['g.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (isValidMonthString(month)) {
      const { start, end } = monthRange(month);
      conditions.push(`EXISTS (
        SELECT 1 FROM finance_transactions t2
        WHERE t2.installment_group_id = g.id AND t2.deleted_at IS NULL
          AND t2.date >= ? AND t2.date < ?
      )`);
      params.push(start, end);
    }

    return db.prepare(`
      SELECT g.id, g.description, g.total_amount AS totalAmount, g.currency,
             g.total_installments AS totalInstallments, g.category, g.date,
             g.created_at AS createdAt,
             (SELECT l.person_name FROM finance_loans l
               WHERE l.installment_group_id = g.id AND l.deleted_at IS NULL
               ORDER BY l.created_at ASC LIMIT 1) AS thirdPartyName,
             COUNT(t.id) AS transactionCount
      FROM finance_installment_groups g
      LEFT JOIN finance_transactions t ON t.installment_group_id = g.id AND t.deleted_at IS NULL
      WHERE ${conditions.join(' AND ')}
      GROUP BY g.id
      ORDER BY g.date DESC, g.created_at DESC
    `).all(...params);
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
             (SELECT l.person_name FROM finance_loans l
               WHERE l.installment_group_id = t.installment_group_id AND l.deleted_at IS NULL
               ORDER BY l.created_at ASC LIMIT 1) AS thirdPartyName,
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

  ipcHandle('finance:createInstallmentGroup', async (_e, group: {
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
    // One purchase, one rate: every instalment freezes the rate of the day the
    // plan was registered — that is when the price was agreed in pesos.
    const fxRate = await captureFxRate(db);
    const now = nowIso();

    const isCreditCard = group.paymentMethod === 'credit_card' && !!group.creditCardId;
    // Card purchases land on next month's statement.
    const monthOffset = isCreditCard ? 1 : 0;

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, fx_rate, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
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
          fxRate,
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

  /**
   * A repayment is always in the loan's own currency.
   *
   * The form used to send nothing, so every payment was written as ARS and
   * subtracted raw from a loan denominated in USD — 100 pesos wiped out 100
   * dollars of debt. The loan is now the single source of truth for the
   * currency, and a payload that disagrees (only sync can produce one, since
   * the UI shows the currency fixed) is refused instead of silently coerced.
   */
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
    const loan = db.prepare(
      'SELECT id, currency FROM finance_loans WHERE id = ? AND deleted_at IS NULL'
    ).get(loanId) as { id: string; currency: string } | undefined;
    if (!loan) return fail('loan_not_found');

    const loanCurrency = loan.currency || 'ARS';
    if (payment.currency != null && payment.currency !== loanCurrency) {
      return fail('currency_mismatch');
    }

    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, loanId, amount, loanCurrency, payment.date, payment.note ?? '', now, now);
    return id;
  });

  ipcHandle('finance:getLoanPayments', (_e, loanId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, loan_id AS loanId, amount, currency, date, note,
             created_at AS createdAt, updated_at AS updatedAt
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

  ipcHandle('finance:createThirdPartyPurchase', async (_e, data: {
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
    const fxRate = await captureFxRate(db);
    const now = nowIso();

    // Same rule as createInstallmentGroup: only a real card defers to next month
    // and keeps the purchase off the balance until the statement is paid.
    const isCreditCard = !!data.creditCardId;
    const monthOffset = isCreditCard ? 1 : 0;

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, fx_rate, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, 'credit_card', 'manual', ?, ?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?)
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
          fxRate,
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
   *
   * `asOfMonth` rebuilds the same figure at the *end* of that month: only loans
   * taken by then count, only repayments made by then are subtracted, and a loan
   * settled after that date is still outstanding. A loan flagged settled with no
   * `settled_date` (pre-column history) is treated as settled all along. Omitted,
   * the answer is the present state, exactly as before.
   */
  ipcHandle('finance:getActiveLoanSummary', (_e, asOfMonth?: string) => {
    const db = getDb();
    const cutoff = isValidMonthString(asOfMonth) ? monthRange(asOfMonth).end : null;

    const loanFilter = cutoff
      ? `l.deleted_at IS NULL AND l.date < ?
         AND (l.settled = 0 OR (l.settled_date IS NOT NULL AND l.settled_date >= ?))`
      : 'l.settled = 0 AND l.deleted_at IS NULL';
    const paymentFilter = cutoff ? 'deleted_at IS NULL AND date < ?' : 'deleted_at IS NULL';
    const params = cutoff ? [cutoff, cutoff, cutoff] : [];

    const rows = db.prepare(`
      SELECT l.direction, l.currency,
             COALESCE(SUM(l.amount), 0) AS total,
             COALESCE(SUM(MAX(l.amount - COALESCE(p.paid, 0), 0)), 0) AS pending
      FROM finance_loans l
      LEFT JOIN (
        SELECT loan_id, SUM(amount) AS paid
        FROM finance_loan_payments
        WHERE ${paymentFilter}
        GROUP BY loan_id
      ) p ON p.loan_id = l.id
      WHERE ${loanFilter}
      GROUP BY l.direction, l.currency
    `).all(...params) as Array<{ direction: string; currency: string; total: number; pending: number }>;

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
             frequency,
             created_at AS createdAt
      FROM finance_recurring
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `).all();
  });

  /** `monthly` (default) | `bimonthly` | `quarterly` | `four_monthly` | `semiannual` | `annual`. */
  function parseFrequency(value: unknown): string | 'invalid' {
    if (value === undefined || value === null || value === '') return 'monthly';
    if (typeof value !== 'string' || !(value in RECURRING_FREQUENCY_MONTHS)) return 'invalid';
    return value;
  }

  ipcHandle('finance:addRecurring', (_e, rec: {
    id?: string;
    name: string;
    type: 'expense' | 'income';
    amount: number;
    currency?: string;
    category?: string;
    billingDay?: number;
    frequency?: string;
  }) => {
    const name = parseNonEmptyString(rec?.name);
    if (name === null) return fail('invalid_name');
    const amount = parsePositiveAmount(rec?.amount);
    if (amount === null) return fail('invalid_amount');
    const frequency = parseFrequency(rec?.frequency);
    if (frequency === 'invalid') return fail('invalid_frequency');

    const db = getDb();
    const id = rec.id ?? genId();
    const now = nowIso();
    db.prepare(`
      INSERT OR IGNORE INTO finance_recurring
        (id, name, type, amount, currency, category, billing_day, frequency, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      name,
      rec.type,
      amount,
      rec.currency ?? 'ARS',
      rec.category ?? 'Otros',
      rec.billingDay ?? 1,
      frequency,
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
    frequency?: string;
  }) => {
    const allowed = new Set(['name', 'type', 'category', 'billingDay', 'frequency']);
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
    if (safe.frequency !== undefined) {
      const frequency = parseFrequency(safe.frequency);
      if (frequency === 'invalid') return fail('invalid_frequency');
      sets.push('frequency = ?'); params.push(frequency);
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

  ipcHandle('finance:generateRecurringForMonth', async (_e, month: string) => {
    const db = getDb();
    // Rows generated today freeze today's rate (if any); offline stays NULL.
    const fxRate = await captureFxRate(db);
    return generateRecurringForMonth(db, month, { fxRate });
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

  // ── FX / inflation (cotización congelada, ARS·USD·ARS de hoy) ─────────────

  /**
   * Fills `fx_rate` on every live transaction that has none, with the best rate
   * available right now. One pass, idempotent — safe to press twice.
   */
  ipcHandle('finance:backfillFxRates', async () => {
    const db = getDb();
    const rate = await captureFxRate(db);
    if (rate === null) return fail('no_rate_available');
    const updated = backfillFxRates(db, rate);
    return { ok: true, updated, rate };
  });

  /**
   * The dashboard re-expressed in USD (each amount with its own frozen rate)
   * and in today's pesos (cumulative INDEC IPC coefficient), plus the
   * nominal + real "% vs mes anterior" trend. See computeValuedView.
   */
  ipcHandle('finance:getValuedView', async (_e, month?: string) => {
    const db = getDb();
    const m = isValidMonthString(month) ? month : todayDateString().slice(0, 7);
    const house = getFxHouse(db);
    const [currentRate, series] = await Promise.all([
      getCurrentRate(db, house),
      getIpcSeries(db),
    ]);
    return computeValuedView(db, m, { currentRate, house, series });
  });

  /**
   * Raw monthly IPC index series (nivel general nacional, base dic-2016),
   * cache-first, for per-row conversion in the renderer.
   */
  ipcHandle('finance:getInflationSeries', async () => {
    const series = await getIpcSeries(getDb());
    if (series === null) return { ok: false as const, series: null };
    return { ok: true as const, series };
  });

  // ── Upcoming timeline ("Próximas batallas", 30 días) ──────

  ipcHandle('finance:getUpcoming', (_e, days?: number) => {
    return computeUpcomingTimeline(getDb(), todayDateString(), typeof days === 'number' ? days : 30);
  });

  // ── C3: Monthly expenses sparkline (last 6 months) ────────

  /** Six-month expense sparkline ending on `endMonth` (default: the real current month). */
  ipcHandle('finance:getMonthlyExpenses', (_e, endMonth?: string) => {
    const db = getDb();
    const currentMonth = isValidMonthString(endMonth) ? endMonth : todayDateString().slice(0, 7);

    const result: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const { start, end } = monthRange(addMonthsToMonth(currentMonth, -i));
      result.push(sumByCurrency(db, {
        start, end, type: 'expense', currency: 'ARS', balanceScope: 'impacting',
        excludeCategories: [TRANSFER_CATEGORY],
      }).ARS);
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
        AND category NOT IN (?, ?)
        AND date >= ? AND date < ?
      GROUP BY category
    `).all(CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY, start, end) as Array<{ category: string; total: number }>;

    // Divide by the months that actually have data, not a hard-coded 3 —
    // otherwise a user with one month of history sees a third of reality.
    const monthsWithData = db.prepare(`
      SELECT COUNT(DISTINCT SUBSTR(date, 1, 7)) AS c
      FROM finance_transactions
      WHERE deleted_at IS NULL AND type = 'expense' AND currency = 'ARS' AND impacts_balance = 1
        AND category NOT IN (?, ?)
        AND date >= ? AND date < ?
    `).get(CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY, start, end) as { c: number };
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
      excludeCategories: [TRANSFER_CATEGORY],
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
