import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { platform } from '../platform';
import { todayDateString } from '../../shared/date-utils';
import {
  CARD_PAYMENT_CATEGORY,
  RESERVED_CATEGORIES,
  DEFAULT_CASH_ACCOUNT_ID,
  MAX_INSTALLMENTS,
  RECURRING_FREQUENCY_MONTHS,
  TRANSFER_CATEGORY,
  addMonthsClamped,
  addMonthsToMonth,
  backfillFxRatesHistorical,
  categorySpendFilter,
  buildTransactionWhere,
  computeBudgetStatus,
  computeCategorySpend,
  computeExpenseBreakdown,
  computeMonthlyBalance,
  computeUpcomingTimeline,
  computeValuedView,
  fxRateSourceFor,
  generateRecurringForMonth,
  getCurrentRate,
  getFxHouse,
  getIpcSeries,
  isRecurringDueInMonth,
  listBudgets,
  loadStatementBoundaries,
  recurringAnchorMonth,
  round2,
  setBudget,
  statementPeriodForWithBoundaries,
  type StatementBoundary,
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
import { getEntryDefaults } from './finance-defaults';

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
  ${p}fx_rate_source AS fxRateSource,
  ${p}statement_period AS statementPeriod,
  ${p}purchase_date AS purchaseDate,
  ${p}account_id AS accountId,
  ${p}transfer_group_id AS transferGroupId,
  ${p}created_at AS createdAt, ${p}updated_at AS updatedAt
`;
}

/**
 * Resolves the account a write should land on, mirroring `finance:addTransaction`:
 * `undefined` = not chosen (cash → the seeded «Efectivo» if it is still alive,
 * anything else → none); `null` = explicitly "sin cuenta"; a string = that
 * account, but only if it is alive (a dangling id would be invisible anyway).
 */
function resolveAccountId(
  db: ReturnType<typeof getDb>,
  accountId: string | null | undefined,
  paymentMethod: string,
): string | null {
  if (accountId === null) return null;
  if (typeof accountId === 'string' && accountId.trim() !== '') {
    const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId.trim());
    return alive ? accountId.trim() : null;
  }
  if (paymentMethod !== 'cash') return null;
  const def = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(DEFAULT_CASH_ACCOUNT_ID);
  return def ? DEFAULT_CASH_ACCOUNT_ID : null;
}

/**
 * Salda un resumen: escribe (o actualiza) su «Pago Tarjeta» por moneda,
 * fechado el DÍA DEL PAGO, y lo marca `paid`. Un resumen pendiente no tiene
 * transacción (invariante 6); esta es la única función que la crea, así que
 * nunca hay dos por moneda. Es síncrona y NO abre transacción: el llamador ya
 * está adentro de una (`db.transaction`).
 *
 * `accountId` cae en la pata cuya moneda coincide con la cuenta (un banco en
 * pesos no paga la pata en dólares). Una pata en cero no escribe nada; si
 * existía de un pago anterior, se retira.
 */
function settleStatement(
  db: ReturnType<typeof getDb>,
  statementId: string,
  input: { ars: number; usd: number; paidDate: string; accountId: string | null; fxRate: number | null },
): boolean {
  const stmt = db.prepare(`
    SELECT id, period_month AS periodMonth,
           transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
    FROM finance_credit_card_statements WHERE id = ? AND deleted_at IS NULL
  `).get(statementId) as
    { id: string; periodMonth: string; transactionId: string | null; transactionIdUsd: string | null } | undefined;
  if (!stmt) return false;

  const now = nowIso();
  const fxRateSource = input.fxRate === null ? null : fxRateSourceFor(input.paidDate);
  const account = input.accountId
    ? db.prepare('SELECT id, currency FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(input.accountId) as
      { id: string; currency: string } | undefined
    : undefined;
  const accountFor = (currency: 'ARS' | 'USD') => (account && account.currency === currency ? account.id : null);

  const insertTx = db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source, account_id, created_at, updated_at)
    VALUES (?, 'expense', ?, ?, ?, ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?, ?, ?, ?)
  `);
  // Un repago recaptura la cotización: la pata existente la refresca junto
  // con la fecha, si no quedaría congelada la del primer pago.
  const updateTx = db.prepare(`
    UPDATE finance_transactions
    SET amount = ?, date = ?, deleted_at = NULL, fx_rate = ?, fx_rate_source = ?,
        account_id = CASE WHEN ? THEN ? ELSE account_id END, updated_at = ?
    WHERE id = ?
  `);
  const retireTx = db.prepare(
    'UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  );

  const settleLeg = (currentId: string | null, amount: number, currency: 'ARS' | 'USD'): string | null => {
    if (amount <= 0) {
      if (currentId) retireTx.run(now, now, currentId);
      return null;
    }
    const acc = accountFor(currency);
    if (currentId) {
      const res = updateTx.run(amount, input.paidDate, input.fxRate, fxRateSource, acc !== null ? 1 : 0, acc, now, currentId);
      if (res.changes > 0) return currentId;
    }
    const id = genId();
    insertTx.run(
      id, amount, currency, CARD_PAYMENT_CATEGORY, `Pago tarjeta - ${stmt.periodMonth}`, input.paidDate,
      input.fxRate, fxRateSource, acc, now, now,
    );
    return id;
  };

  const arsTxId = settleLeg(stmt.transactionId, input.ars, 'ARS');
  const usdTxId = settleLeg(stmt.transactionIdUsd, input.usd, 'USD');

  db.prepare(`
    UPDATE finance_credit_card_statements
    SET paid_amount = ?, paid_amount_usd = ?, status = 'paid', paid_date = ?,
        transaction_id = ?, transaction_id_usd = ?, updated_at = ?
    WHERE id = ?
  `).run(input.ars, input.usd, input.paidDate, arsTxId, usdTxId, now, statementId);
  return true;
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
    // An explicit account id is kept as given (the read-side JOIN resolves a
    // dangling one), matching the previous behaviour of this handler.
    let accountId = tx.accountId ?? null;
    if (tx.accountId === undefined) accountId = resolveAccountId(db, undefined, tx.paymentMethod ?? 'cash');

    // Freeze today's venta rate on the row. Offline with no cache → NULL, and
    // the write goes through regardless — a missing rate never blocks the alta.
    // Today's rate is the row's own rate only when the row is dated today.
    const fxRate = await captureFxRate(db);
    const id = genId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      fxRate === null ? null : fxRateSourceFor(tx.date),
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
        // Sin creditCardId explícito la tarjeta, impacts_balance y el período
        // existentes se conservan: editar el monto de una compra con tarjeta no
        // puede desengancharla de su resumen. Con creditCardId (incluido null)
        // se respeta lo que vino, como siempre.
        if (fields.creditCardId !== undefined) {
          sets.push('impacts_balance = ?'); vals.push(0);
          sets.push('credit_card_id = ?'); vals.push(fields.creditCardId);
        }
      } else {
        sets.push('impacts_balance = ?'); vals.push(1);
        sets.push('credit_card_id = ?'); vals.push(null);
        sets.push('statement_period = ?'); vals.push(null);
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

    // Per template, not a global SUM: a $600.000 annual insurance used to be
    // added to every projected month alongside the rent.
    const templates = db.prepare(`
      SELECT amount, currency, frequency, created_at AS createdAt, anchor_month AS anchorMonth
      FROM finance_recurring
      WHERE deleted_at IS NULL AND active = 1 AND type = 'expense'
    `).all() as Array<{ amount: number; currency: string; frequency: string | null; createdAt: string; anchorMonth: string | null }>;

    const recurringFor = (targetMonth: string) => {
      const totals = { ARS: 0, USD: 0 };
      for (const rec of templates) {
        if (rec.currency !== 'ARS' && rec.currency !== 'USD') continue;
        if (!isRecurringDueInMonth(rec.frequency, recurringAnchorMonth(rec), targetMonth)) continue;
        totals[rec.currency] += rec.amount;
      }
      return { ARS: round2(totals.ARS), USD: round2(totals.USD) };
    };

    const projection = [];
    for (let i = 1; i <= count; i++) {
      const targetMonth = addMonthsToMonth(currentMonth, i);
      const { start, end } = monthRange(targetMonth);
      const installments = sumByCurrency(db, {
        start, end,
        balanceScope: 'all',
        installmentsOnly: true,
      });
      const recurring = recurringFor(targetMonth);

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

  /**
   * El default del alta manual, inferido del historial (no una constante).
   *
   * El formulario arrancaba en efectivo y el usuario tiene CERO movimientos en
   * efectivo cargados a mano: cada alta empezaba corrigiendo el medio de pago.
   */
  ipcHandle('finance:getEntryDefaults', () => getEntryDefaults(getDb(), RESERVED_CATEGORIES));

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

  /**
   * Borrar una categoría en uso rompería los movimientos que la referencian, así
   * que se frena. Antes eso era un `throw` con un mensaje en inglés que la UI
   * convertía en «Error al eliminar» a secas: el usuario no sabía por qué no
   * podía, ni cuántos movimientos lo impedían. Devuelve la razón y el número.
   */
  ipcHandle('finance:deleteCategory', (_e, name: string) => {
    const db = getDb();
    const usage = db.prepare(
      'SELECT COUNT(*) AS c FROM finance_transactions WHERE category = ? AND deleted_at IS NULL'
    ).get(name) as { c: number };
    if (usage.c > 0) return { ok: false as const, reason: 'category_in_use', count: usage.c };
    const now = nowIso();
    db.prepare('UPDATE finance_categories SET deleted_at = ?, updated_at = ? WHERE name = ?').run(now, now, name);
    return { ok: true as const };
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
      SELECT id, name, closing_day AS closingDay, due_day AS dueDay,
             last4, issuer, created_at AS createdAt
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

  /** `last4` / `issuer` los completa el import desde el papel; a mano son opcionales. */
  function parseLast4(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^\d{4}$/.test(trimmed) ? trimmed : null;
  }

  ipcHandle('finance:addCreditCard', (_e, card: { name: string; closingDay: number; dueDay?: number | null; last4?: string | null; issuer?: string | null }) => {
    const name = parseNonEmptyString(card?.name);
    if (name === null) return fail('invalid_name');
    const closingDay = Number(card?.closingDay);
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) return fail('invalid_closing_day');
    const dueDay = parseDueDay(card?.dueDay);
    if (dueDay === 'invalid') return fail('invalid_due_day');

    const db = getDb();
    const id = genId();
    const now = nowIso();
    db.prepare('INSERT INTO finance_credit_cards (id, name, closing_day, due_day, last4, issuer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, closingDay, dueDay, parseLast4(card?.last4),
        typeof card?.issuer === 'string' && card.issuer.trim() !== '' ? card.issuer.trim() : null, now, now);
    return id;
  });

  ipcHandle('finance:updateCreditCard', (_e, id: string, fields: { name?: string; closingDay?: number; dueDay?: number | null; last4?: string | null; issuer?: string | null }) => {
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
    if (fields.last4 !== undefined) { sets.push('last4 = ?'); vals.push(parseLast4(fields.last4)); }
    if (fields.issuer !== undefined) {
      sets.push('issuer = ?');
      vals.push(typeof fields.issuer === 'string' && fields.issuer.trim() !== '' ? fields.issuer.trim() : null);
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
      db.prepare('UPDATE finance_transactions SET credit_card_id = NULL, statement_period = NULL, impacts_balance = 1, updated_at = ? WHERE credit_card_id = ?').run(now, id);
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

    // The explicit statement_period (imports) wins; then the real closing dates
    // of the saved papers; only then the card's fixed closing day.
    const boundaries = loadStatementBoundaries(db, statement.creditCardId);
    const filtered = (transactions as Array<{ date: string; statementPeriod?: string | null; [key: string]: unknown }>).filter((tx) => {
      return statementPeriodForWithBoundaries(tx, statement.closingDay, boundaries) === statement.periodMonth;
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
    boundaries: StatementBoundary[],
  ): { ars: number; usd: number } {
    const rows = db.prepare(`
      SELECT date, type, amount, currency, billed_amount_ars AS billedAmountArs,
             statement_period AS statementPeriod
      FROM finance_transactions
      WHERE deleted_at IS NULL AND credit_card_id = ? AND impacts_balance = 0
    `).all(creditCardId) as Array<{
      date: string; type: string; amount: number; currency: string;
      billedAmountArs: number | null; statementPeriod: string | null;
    }>;

    let ars = 0;
    let usd = 0;
    for (const tx of rows) {
      // An imported row carries the period the user chose for the PDF; a manual
      // card purchase falls into the period the real closing dates (or, failing
      // those, the card's closing day) imply.
      if (statementPeriodForWithBoundaries(tx, closingDay, boundaries) !== periodMonth) continue;
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
    // round2: this sum is persisted (calculated_amount, the Pago Tarjeta row)
    // and compared (`ars > 0`), and JS `+=` leaves binary noise behind.
    return { ars: round2(Math.max(ars, 0)), usd: round2(Math.max(usd, 0)) };
  }

  /**
   * Creates or REFRESHES the statement for a period.
   *
   * Only a `paid` statement is frozen; a `pending` one is recalculated on every
   * call (the dashboard auto-generates on mount). A pending statement carries NO
   * `Pago Tarjeta` row (invariante 6): the payment is written by
   * `settleStatement` on the day it is actually paid. A pending statement that
   * still points at a transaction (synced from a device that never ran v21) is
   * sanitised here, which also makes the v21 backfill idempotent by construction.
   */
  ipcHandle('finance:generateStatement', (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(periodMonth)) return null;

    const card = db.prepare(
      'SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL'
    ).get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    // Ya no captura cotización: no escribe ninguna transacción. Síncrono como
    // el resto de las lecturas/escrituras sin red (los llamadores hacen `await`
    // sobre el invoke igual, nada cambia para ellos).
    const now = nowIso();
    const retireTx = db.prepare(
      'UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    );

    const trx = db.transaction(() => {
      const existing = db.prepare(`
        SELECT id, status, calculated_amount AS ars, calculated_amount_usd AS usd,
               transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
        FROM finance_credit_card_statements
        WHERE credit_card_id = ? AND period_month = ? AND deleted_at IS NULL
      `).get(creditCardId, periodMonth) as
        { id: string; status: string; ars: number | null; usd: number | null; transactionId: string | null; transactionIdUsd: string | null } | undefined;

      // A paid statement is history — never rewrite it.
      if (existing && existing.status === 'paid') return existing.id;

      if (existing?.transactionId) retireTx.run(now, now, existing.transactionId);
      if (existing?.transactionIdUsd) retireTx.run(now, now, existing.transactionIdUsd);

      const boundaries = loadStatementBoundaries(db, creditCardId);
      const { ars, usd } = computeStatementTotals(db, creditCardId, card.closingDay, periodMonth, boundaries);

      // Nothing changed → no write at all. The dashboard regenerates on every
      // mount; stamping `updated_at` each time would let a device that is
      // offline (still `pending`) win the LWW merge over one that already
      // PAID the statement, reviving it and doubling the payment.
      if (
        existing && (ars > 0 || usd > 0)
        && round2(existing.ars ?? 0) === ars && round2(existing.usd ?? 0) === usd
        && existing.transactionId === null && existing.transactionIdUsd === null
      ) {
        return existing.id;
      }

      if (!existing) {
        if (ars === 0 && usd === 0) return null;
        const statementId = genId();
        db.prepare(`
          INSERT INTO finance_credit_card_statements
            (id, credit_card_id, period_month, calculated_amount, calculated_amount_usd,
             status, transaction_id, transaction_id_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
        `).run(statementId, creditCardId, periodMonth, ars, usd, now, now);
        return statementId;
      }

      // Every purchase that fed this statement is gone — retire it.
      if (ars === 0 && usd === 0) {
        db.prepare(`
          UPDATE finance_credit_card_statements
          SET transaction_id = NULL, transaction_id_usd = NULL, deleted_at = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, existing.id);
        return null;
      }

      db.prepare(`
        UPDATE finance_credit_card_statements
        SET calculated_amount = ?, calculated_amount_usd = ?,
            transaction_id = NULL, transaction_id_usd = NULL, updated_at = ?
        WHERE id = ?
      `).run(ars, usd, now, existing.id);
      return existing.id;
    });

    return trx();
  });

  /**
   * Guarda LOS NÚMEROS DEL PAPEL sobre un resumen que ya existe.
   *
   * `calculated_amount` (lo que Coinify suma con las filas que tiene) y
   * `statement_total_ars` (lo que dice el banco) conviven a propósito y no se
   * pisan: que difieran ES el dato, y de esa diferencia vive la conciliación.
   *
   * Efectos, todos en la misma transacción:
   *  1. estampa los 11 campos del resumen;
   *  2. completa la tarjeta con el cierre, el vencimiento, los últimos 4 y el
   *     emisor que trae el papel — dejaban de tipearse;
   *  3. **salda el resumen ANTERIOR** con el «SU PAGO» impreso, que es
   *     exactamente el «total que pagué en el mes».
   *
   * Regla dura (precedente de las cuotas huérfanas): **nunca inventar datos.**
   * Si el resumen del período no existe, no se crea; si el anterior no existe o
   * ya está `paid`, no se toca. Un resumen que la app no vio nunca no se puede
   * reconstruir desde una sola cifra sin adivinar qué había adentro.
   */
  ipcHandle('finance:saveStatementPaper', async (_e, creditCardId: string, paper: {
    period?: string;
    closingDate?: string | null;
    dueDate?: string | null;
    totalArs?: number | null;
    totalUsd?: number | null;
    minimumArs?: number | null;
    previousArs?: number | null;
    previousUsd?: number | null;
    priorPaymentArs?: number | null;
    priorPaymentUsd?: number | null;
    /** `true` cerró · `false` no cerró · `null`/ausente = no había checksum. */
    reconciled?: boolean | null;
    forecast?: unknown;
    last4?: string | null;
    issuer?: string | null;
  }) => {
    const db = getDb();
    const period = typeof paper?.period === 'string' ? paper.period : '';
    if (!isValidMonthString(period)) return fail('invalid_period');

    const card = db.prepare(
      'SELECT id, closing_day AS closingDay, due_day AS dueDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL',
    ).get(creditCardId) as { id: string; closingDay: number | null; dueDay: number | null } | undefined;
    if (!card) return fail('credit_card_not_found');

    const statement = db.prepare(`
      SELECT id FROM finance_credit_card_statements
      WHERE credit_card_id = ? AND period_month = ? AND deleted_at IS NULL
    `).get(creditCardId, period) as { id: string } | undefined;
    if (!statement) return fail('statement_not_found');

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? round2(v) : null;
    /** Un día del mes válido a partir de una fecha completa del papel. */
    const dayOf = (iso: unknown): number | null => {
      if (typeof iso !== 'string') return null;
      const m = iso.match(/^\d{4}-\d{2}-(\d{2})$/);
      if (!m) return null;
      const day = Number(m[1]);
      return day >= 1 && day <= 31 ? day : null;
    };

    const now = nowIso();
    const forecastJson = Array.isArray(paper.forecast) && paper.forecast.length > 0
      ? JSON.stringify(paper.forecast)
      : null;
    const reconciled = paper.reconciled === true ? 1 : paper.reconciled === false ? 0 : null;

    // Before the write transaction opens: async work inside db.transaction is not allowed.
    const fxRate = await captureFxRate(db);

    const trx = db.transaction(() => {
      db.prepare(`
        UPDATE finance_credit_card_statements
        SET closing_date = ?, due_date = ?,
            statement_total_ars = ?, statement_total_usd = ?,
            minimum_payment_ars = ?,
            previous_balance_ars = ?, previous_balance_usd = ?,
            prior_payment_ars = ?, prior_payment_usd = ?,
            reconciled = ?, forecast_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        typeof paper.closingDate === 'string' ? paper.closingDate : null,
        typeof paper.dueDate === 'string' ? paper.dueDate : null,
        num(paper.totalArs), num(paper.totalUsd), num(paper.minimumArs),
        num(paper.previousArs), num(paper.previousUsd),
        num(paper.priorPaymentArs), num(paper.priorPaymentUsd),
        reconciled, forecastJson, now, statement.id,
      );

      // La tarjeta: solo lo que el papel efectivamente trae, y el cierre y el
      // vencimiento SOLO si estaban vacíos (invariante 5: closing_day es
      // configuración del usuario; el papel la completa, nunca la pisa). Un
      // vacío solo aparece en filas insertadas por SQL o por sync: el alta
      // rechaza < 1. Lo que no viene se deja como está — el silencio no borra.
      const sets: string[] = [];
      const vals: unknown[] = [];
      const closingDay = dayOf(paper.closingDate);
      const dueDay = dayOf(paper.dueDate);
      if (closingDay !== null && !(Number(card.closingDay) >= 1)) { sets.push('closing_day = ?'); vals.push(closingDay); }
      if (dueDay !== null && !(Number(card.dueDay) >= 1)) { sets.push('due_day = ?'); vals.push(dueDay); }
      if (typeof paper.last4 === 'string' && /^\d{4}$/.test(paper.last4)) {
        sets.push('last4 = ?'); vals.push(paper.last4);
      }
      if (typeof paper.issuer === 'string' && paper.issuer.trim() !== '') {
        sets.push('issuer = ?'); vals.push(paper.issuer.trim());
      }
      if (sets.length > 0) {
        sets.push('updated_at = ?'); vals.push(now, creditCardId);
        db.prepare(`UPDATE finance_credit_cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }

      // El resumen anterior, saldado con lo que el papel dice que se pagó.
      const paidArs = num(paper.priorPaymentArs) ?? 0;
      const paidUsd = num(paper.priorPaymentUsd) ?? 0;
      if (paidArs <= 0 && paidUsd <= 0) return { settledPrevious: false };

      const previousPeriod = addMonthsToMonth(period, -1);
      const previous = db.prepare(`
        SELECT id, status, transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
        FROM finance_credit_card_statements
        WHERE credit_card_id = ? AND period_month = ? AND deleted_at IS NULL
      `).get(creditCardId, previousPeriod) as
        { id: string; status: string; transactionId: string | null; transactionIdUsd: string | null } | undefined;

      // No existe → no se fabrica. Ya pagado → es historia.
      if (!previous || previous.status === 'paid') return { settledPrevious: false };

      // El «Pago Tarjeta» del resumen anterior nace acá, fechado el día del
      // cierre del papel (el banco lo recibió antes de cerrar), sin cuenta: el
      // papel no dice de qué bolsillo salió.
      const paidDate = typeof paper.closingDate === 'string' && isValidDateString(paper.closingDate)
        ? paper.closingDate
        : todayDateString();
      const settled = settleStatement(db, previous.id, {
        ars: paidArs, usd: paidUsd, paidDate, accountId: null, fxRate,
      });
      return { settledPrevious: settled };
    });

    const result = trx();
    return { ok: true as const, statementId: statement.id, ...result };
  });

  /**
   * Marks a statement paid and writes its `Pago Tarjeta` row(s) dated the day
   * it was paid (`paidDate`, default today). Until then the statement has no
   * transaction at all, so the balance moves exactly once, on the right month.
   *
   * `accountId` (optional) is the pocket the money left: it lands on the
   * payment row whose currency matches the account. Omitted or `null` = no
   * account. A dead/unknown account is refused rather than silently dropped.
   */
  ipcHandle('finance:payStatement', async (
    _e,
    statementId: string,
    paidAmount: number,
    paidAmountUsd?: number,
    accountId?: string | null,
    paidDate?: string,
  ) => {
    const ars = Number(paidAmount ?? 0);
    const usd = Number(paidAmountUsd ?? 0);
    if (!Number.isFinite(ars) || !Number.isFinite(usd) || ars < 0 || usd < 0) return fail('invalid_amount');
    if (ars <= 0 && usd <= 0) return fail('invalid_amount');
    const date = paidDate === undefined || paidDate === null ? todayDateString() : paidDate;
    if (!isValidDateString(date)) return fail('invalid_date');

    const db = getDb();
    const stmt = db.prepare('SELECT id FROM finance_credit_card_statements WHERE id = ? AND deleted_at IS NULL').get(statementId);
    if (!stmt) return fail('not_found');

    const wantedAccount = typeof accountId === 'string' && accountId.trim() !== '' ? accountId.trim() : null;
    if (wantedAccount) {
      const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(wantedAccount);
      if (!alive) return fail('account_not_found');
    }

    // Before the write transaction opens: async work inside db.transaction is not allowed.
    const fxRate = await captureFxRate(db);
    const trx = db.transaction(() => settleStatement(db, statementId, {
      ars: round2(ars), usd: round2(usd), paidDate: date, accountId: wantedAccount, fxRate,
    }));
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
    /** Account every instalment lands on (non-card plans only). Same
     *  semantics as `finance:addTransaction`: `undefined` = default mapping. */
    accountId?: string | null;
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

    const totalAmount = round2(group.installmentAmounts
      ? amounts.reduce((a, b) => a + b, 0)
      : parsePositiveAmount(group.totalAmount) ?? amounts.reduce((a, b) => a + b, 0));

    const db = getDb();
    const groupId = genId();
    // One purchase, one rate: every instalment freezes the rate of the day the
    // plan was registered — that is when the price was agreed in pesos. Exact
    // only when the plan starts today; a back-dated plan gets a process rate.
    const fxRate = await captureFxRate(db);
    const fxRateSource = fxRate === null ? null : fxRateSourceFor(group.startDate);
    const now = nowIso();

    const isCreditCard = group.paymentMethod === 'credit_card' && !!group.creditCardId;
    // Card purchases land on next month's statement.
    const monthOffset = isCreditCard ? 1 : 0;
    // A card plan touches no account until its statements are paid; a debit /
    // cash / transfer plan takes money out of a pocket on every instalment.
    const paymentMethod = group.paymentMethod ?? 'credit_card';
    const accountId = isCreditCard || paymentMethod === 'credit_card'
      ? null
      : resolveAccountId(db, group.accountId, paymentMethod);

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source,
         account_id, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
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
          paymentMethod,
          installmentCount,
          groupId,
          i + 1,
          group.forThirdParty ? 1 : 0,
          isCreditCard ? group.creditCardId : null,
          isCreditCard ? 0 : 1,
          fxRate,
          fxRateSource,
          accountId,
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
    /** Monto cuota por cuota, cuando repartir el total no da un número redondo
     *  y la última se lleva el resto — mismo contrato que
     *  `finance:createInstallmentGroup`. */
    installmentAmounts?: number[];
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

    const amounts: number[] = [];
    for (let i = 0; i < installmentCount; i++) {
      const parsed = parsePositiveAmount(data.installmentAmounts?.[i] ?? data.installmentAmount);
      if (parsed === null) return fail('invalid_amount');
      amounts.push(parsed);
    }
    const db = getDb();
    const currency = data.currency ?? 'ARS';
    const category = data.category ?? 'Otros';
    const totalAmount = round2(amounts.reduce((a, b) => a + b, 0));
    const groupId = genId();
    const loanId = genId();
    const fxRate = await captureFxRate(db);
    const fxRateSource = fxRate === null ? null : fxRateSourceFor(data.startDate);
    const now = nowIso();

    // Same rule as createInstallmentGroup: only a real card defers to next month
    // and keeps the purchase off the balance until the statement is paid.
    const isCreditCard = !!data.creditCardId;
    const monthOffset = isCreditCard ? 1 : 0;

    const insertTx = db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, installment_number, for_third_party,
         recurring_id, import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source, created_at, updated_at)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, 'credit_card', 'manual', ?, ?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?, ?)
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
          amounts[i],
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
          fxRateSource,
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
             account_id AS accountId,
             anchor_month AS anchorMonth,
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

  /** `YYYY-MM` or null/undefined/'' (= not set); anything else is invalid. */
  function parseAnchorMonth(value: unknown): string | null | 'invalid' {
    if (value === undefined || value === null || value === '') return null;
    return isValidMonthString(value) ? value : 'invalid';
  }

  /** `null` = "sin cuenta"; a string must be a live account; undefined = not given. */
  function parseAccountId(db: ReturnType<typeof getDb>, value: unknown): string | null | undefined | 'invalid' {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string') return 'invalid';
    const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(value);
    return alive ? value : 'invalid';
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
    /** Account every generated instance inherits. Omitted/null = none. */
    accountId?: string | null;
    /** `YYYY-MM` the cadence counts from. Omitted = the current LOCAL month. */
    anchorMonth?: string | null;
  }) => {
    const name = parseNonEmptyString(rec?.name);
    if (name === null) return fail('invalid_name');
    const amount = parsePositiveAmount(rec?.amount);
    if (amount === null) return fail('invalid_amount');
    const frequency = parseFrequency(rec?.frequency);
    if (frequency === 'invalid') return fail('invalid_frequency');
    const anchor = parseAnchorMonth(rec?.anchorMonth);
    if (anchor === 'invalid') return fail('invalid_anchor_month');

    const db = getDb();
    const accountId = parseAccountId(db, rec?.accountId);
    if (accountId === 'invalid') return fail('account_not_found');

    const id = rec.id ?? genId();
    const now = nowIso();
    db.prepare(`
      INSERT OR IGNORE INTO finance_recurring
        (id, name, type, amount, currency, category, billing_day, frequency, active,
         account_id, anchor_month, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      id,
      name,
      rec.type,
      amount,
      rec.currency ?? 'ARS',
      rec.category ?? 'Otros',
      rec.billingDay ?? 1,
      frequency,
      accountId ?? null,
      // Local month, never UTC: a template created 31/08 22:00 ART is an
      // August template, and the first charge lands in August.
      anchor ?? todayDateString().slice(0, 7),
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
    /** `null` clears the account; `undefined` leaves it alone. */
    accountId?: string | null;
    /** `null` falls back to the creation month; `undefined` leaves it alone. */
    anchorMonth?: string | null;
  }) => {
    const allowed = new Set(['name', 'type', 'category', 'billingDay', 'frequency', 'accountId', 'anchorMonth']);
    const safe = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k))) as typeof fields;

    const db = getDb();
    const now = nowIso();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (safe.accountId !== undefined) {
      const accountId = parseAccountId(db, safe.accountId);
      if (accountId === 'invalid') return fail('account_not_found');
      sets.push('account_id = ?'); params.push(accountId ?? null);
    }
    if (safe.anchorMonth !== undefined) {
      const anchor = parseAnchorMonth(safe.anchorMonth);
      if (anchor === 'invalid') return fail('invalid_anchor_month');
      sets.push('anchor_month = ?'); params.push(anchor);
    }

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
   * Fills `fx_rate` on every live transaction that has none: the rate of each
   * row's OWN date from the historical series where it answers (exact, no `~`),
   * today's rate for the rest (stamped `backfill`, keeps the `~`). One pass,
   * idempotent — safe to press twice.
   */
  ipcHandle('finance:backfillFxRates', async () => {
    const db = getDb();
    const house = getFxHouse(db);
    const rate = await getCurrentRate(db, house);
    const result = await backfillFxRatesHistorical(db, { house, currentRate: rate });
    if (rate === null && result.updated === 0) return fail('no_rate_available');
    return { ok: true, updated: result.updated, exact: result.exact, approx: result.approx, rate };
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

  /**
   * Per-category average of the three complete months before the current one,
   * using THE wheel definition (`categorySpendFilter`: every live expense, card
   * purchases included, `Pago Tarjeta` and transfers out). The ledger compares
   * the current month against this with the same filter — the old
   * `impacts_balance = 1` here made every card-paid category "anomalous" every
   * month, since its average only saw the cash part.
   */
  ipcHandle('finance:getCategoryAverages', () => {
    const db = getDb();
    const currentMonth = todayDateString().slice(0, 7);
    // Window: the three complete months before the current one.
    const start = monthRange(addMonthsToMonth(currentMonth, -3)).start;
    const end = monthRange(addMonthsToMonth(currentMonth, -1)).end;
    const { where, params } = buildTransactionWhere({ ...categorySpendFilter({ start, end }), currency: 'ARS' });

    const rows = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
      FROM finance_transactions
      WHERE ${where}
      GROUP BY category
    `).all(...params) as Array<{ category: string; total: number }>;

    // Divide by the months that actually have data, not a hard-coded 3 —
    // otherwise a user with one month of history sees a third of reality.
    const monthsWithData = db.prepare(`
      SELECT COUNT(DISTINCT SUBSTR(date, 1, 7)) AS c
      FROM finance_transactions
      WHERE ${where}
    `).get(...params) as { c: number };
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
    const saved = await platform().saveTextFile(`coinify-${m}.csv`, csv);
    if (!saved) return { success: false, canceled: true };

    return { success: true, count: rows.length };
  });
}
