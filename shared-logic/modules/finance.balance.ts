import { genId } from '../ids';
import type { SqlDatabase } from '../db';
import type { ExpenseBreakdown, ExpenseBreakdownByCurrency } from '../../shared/types';
import { todayDateString } from '../../shared/date-utils';
import { getEntryDefaults } from './finance-defaults';
import {
  buildIpcCoefficients,
  coefficientDetail,
  convertRowToCurrency,
  nominalAndRealTrend,
  type FxRateSource,
  type IpcCoefficients,
  type IpcSeriesPoint,
  type ValuationCurrency,
} from '../../src/modules/finance/utils/valuation';

export type { ExpenseBreakdown, ExpenseBreakdownByCurrency };
export type { FxRateSource, IpcCoefficients, IpcSeriesPoint, ValuationCurrency };

/**
 * Shared, electron-free finance helpers.
 *
 * Everything here is pure (or takes an explicit `db`), so it can be reused by the
 * `finance:*` IPC handlers, the app bootstrap in `electron/main.ts`, the Syl
 * snapshot, and unit tests with an in-memory database.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Category used for the auto-generated "pay the card statement" transaction.
 *  Excluded from expense aggregations so card spending is not counted twice
 *  (once as the purchase, once as the statement payment). */
export const CARD_PAYMENT_CATEGORY = 'Pago Tarjeta';

/** Category used for the taxes, perceptions and financing interest a card
 *  statement charges (IMP DE SELLOS, DB IVA, IIBB PERCEP, IVA RG, DB.RG 5617,
 *  INTERESES FINANCIACION and their DEV.IMP refunds).
 *
 *  These lines used to be dropped by the PDF importer, so the imported total
 *  never matched the paper. They are real charges: they belong to the statement
 *  and to the expense breakdown, just under their own reserved name.
 *
 *  Mirrored in `src/modules/finance/types.ts` for the renderer — the guard test
 *  `finance.tax-category.test.ts` fails if the two ever drift apart. */
export const CARD_TAX_CATEGORY = 'Impuestos de tarjeta';

/** Category shared by the two legs of an inter-account transfer.
 *
 *  A transfer moves money between the user's own pockets, so it must count for
 *  each account's balance (`impacts_balance = 1`) while staying OUT of every
 *  income/expense aggregation — the month totals, the wheel, budgets, the
 *  sparkline and the valued view. Otherwise moving $100k from Mercado Pago to
 *  the bank would print as $100k spent AND $100k earned in the same month.
 *
 *  Mirrored in `src/modules/finance/types.ts`; the guard test
 *  `finance.tax-category.test.ts` fails if the copies drift. */
export const TRANSFER_CATEGORY = 'Transferencia';

/** Categories the app writes on its own. The user may see them in reports but
 *  must never be able to file a manual transaction under one. */
export const RESERVED_CATEGORIES = [CARD_PAYMENT_CATEGORY, CARD_TAX_CATEGORY, TRANSFER_CATEGORY] as const;

/** Hard cap for `finance:createInstallmentGroup` so a typo cannot create
 *  thousands of rows. 120 months = 10 years, well beyond any real plan. */
export const MAX_INSTALLMENTS = 120;

// ── Timestamps ─────────────────────────────────────────────────────────────

/**
 * Every finance write MUST use this for created_at / updated_at / deleted_at.
 * Mixing ISO (`2026-08-31T14:12:01.445Z`) with SQLite's `datetime('now')`
 * (`2026-08-31 14:12:01`) breaks last-write-wins sync: comparison is by string
 * and `'T'` (0x54) > `' '` (0x20), so a newer `datetime('now')` value loses.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

// ── Money rounding ─────────────────────────────────────────────────────────

/**
 * Two-decimal rounding for any sum accumulated in JS that gets PERSISTED or
 * COMPARED. `1000.1 + 2000.2 + …` leaves binary noise (`15016.619999999999`)
 * that then lands in `calculated_amount`, and ten charges of $0.10 add up to
 * `0.9999999999999999` — which is "under $1" when a budget is checked. SQLite's
 * own SUM() is Kahan-compensated and needs no help; JS `+=` does.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── Frozen-rate provenance ─────────────────────────────────────────────────

/**
 * What to write in `fx_rate_source` for a row being written NOW with the rate
 * of TODAY: exact (`day`) only when the row is dated today; a past-dated row
 * carries the rate of the process that wrote it, not of its own day.
 */
export function fxRateSourceFor(rowDate: string, today: string = todayDateString()): FxRateSource {
  return rowDate === today ? 'day' : 'process';
}

// ── Date helpers ───────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month === last day of this month.
  return new Date(year, month0 + 1, 0).getDate();
}

export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

export function isValidMonthString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m - 1);
}

/**
 * Adds `months` to a `YYYY-MM-DD` date, clamping the day to the last day of the
 * target month.
 *
 * `new Date(2026, 0 + 1, 31)` overflows to March 3rd, which is why installment
 * schedules starting on the 29th–31st used to skip February/April/June and
 * double up on March/May. Clamping keeps exactly one instalment per month.
 */
export function addMonthsClamped(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const { year, month0 } = shiftMonth(y, m - 1, months);
  const day = Math.min(d, daysInMonth(year, month0));
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

/** Builds `YYYY-MM-DD` for a month + day-of-month, clamping the day (billing_day 31 in February). */
export function dateInMonthClamped(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const raw = Number.isFinite(day) ? Math.trunc(day) : 1;
  const safeDay = Math.min(Math.max(raw || 1, 1), daysInMonth(y, m - 1));
  return `${month}-${pad2(safeDay)}`;
}

export function addMonthsToMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const s = shiftMonth(y, m - 1, delta);
  return `${s.year}-${pad2(s.month0 + 1)}`;
}

/**
 * Half-open date range `[start, end)` for a month.
 *
 * Always prefer this over `date LIKE 'YYYY-MM%'`: SQLite only applies the
 * LIKE prefix optimisation when `case_sensitive_like` is ON (it is OFF by
 * default), so every `LIKE` filter degrades into a full table scan and
 * `idx_finance_tx_date` never gets used.
 */
export function monthRange(month: string): { start: string; end: string } {
  const next = addMonthsToMonth(month, 1);
  return { start: `${month}-01`, end: `${next}-01` };
}

export function monthRangeBetween(startMonth: string, endMonth: string): { start: string; end: string } {
  return { start: monthRange(startMonth).start, end: monthRange(endMonth).end };
}

/**
 * Given a transaction date and a card's closing day, returns the statement
 * period_month (YYYY-MM).
 *
 * Convention: for closingDay=15, the January statement covers Dec 16 – Jan 15.
 * So a tx on Jan 10 (d <= closingDay) belongs to January ("2025-01"),
 * and a tx on Jan 20 (d > closingDay) belongs to February ("2025-02").
 */
export function getStatementPeriod(txDate: string, closingDay: number): string {
  const [y, m, d] = txDate.split('-').map(Number);
  if (d <= closingDay) return `${y}-${pad2(m)}`;
  const next = shiftMonth(y, m - 1, 1);
  return `${next.year}-${pad2(next.month0 + 1)}`;
}

/**
 * The statement period a card purchase belongs to: the EXPLICIT one the row
 * carries (`statement_period`, written by the importer from the month the user
 * chose) wins over the one derived from its date. A `04/12` instalment printed
 * with its original purchase date belongs to the statement it was billed on,
 * not to the month the fridge was bought.
 */
export function statementPeriodFor(
  tx: { date: string; statementPeriod?: string | null },
  closingDay: number,
): string {
  if (isValidMonthString(tx.statementPeriod)) return tx.statementPeriod;
  return getStatementPeriod(tx.date, closingDay);
}

/** Cierre REAL de un resumen guardado: el papel manda sobre el `closing_day` fijo. */
export interface StatementBoundary {
  periodMonth: string;
  /** `finance_credit_card_statements.closing_date` (YYYY-MM-DD). */
  closingDate: string;
}

/**
 * Fronteras de una tarjeta, ordenadas por cierre. Solo resúmenes vivos con
 * papel. Un `closing_date` que no sea `YYYY-MM-DD` (OCR, sync sin validar) se
 * ignora: comparado como string taparía las fronteras reales.
 */
export function loadStatementBoundaries(db: SqlDatabase, creditCardId: string): StatementBoundary[] {
  const rows = db.prepare(`
    SELECT period_month AS periodMonth, closing_date AS closingDate
    FROM finance_credit_card_statements
    WHERE credit_card_id = ? AND deleted_at IS NULL AND closing_date IS NOT NULL
    ORDER BY closing_date ASC, period_month ASC
  `).all(creditCardId) as StatementBoundary[];
  return rows.filter((b) => isValidDateString(b.closingDate));
}

/**
 * The statement period of a card purchase, using the REAL closing dates of the
 * statements the user saved (`closing_date`) before the card's fixed
 * `closing_day`. Rules, in order:
 *  1. an explicit `statementPeriod` wins;
 *  2. no boundary closes on or after the purchase → `getStatementPeriod`;
 *  3. the previous boundary `a` closed before the purchase and is the
 *     consecutive month of `b` → `b.periodMonth`;
 *  4. otherwise (first paper, or a gap) → `b.periodMonth` only if the purchase
 *     is at most one month older than `b`'s closing;
 *  5. anything else → `getStatementPeriod`.
 */
export function statementPeriodForWithBoundaries(
  tx: { date: string; statementPeriod?: string | null },
  closingDay: number,
  boundaries: StatementBoundary[],
): string {
  if (isValidMonthString(tx.statementPeriod)) return tx.statementPeriod;
  const idx = boundaries.findIndex((b) => b.closingDate >= tx.date);
  if (idx === -1) return getStatementPeriod(tx.date, closingDay);
  const b = boundaries[idx];
  const a = idx > 0 ? boundaries[idx - 1] : null;
  if (a && a.closingDate < tx.date && a.periodMonth === addMonthsToMonth(b.periodMonth, -1)) {
    return b.periodMonth;
  }
  if (tx.date > addMonthsClamped(b.closingDate, -1)) return b.periodMonth;
  return getStatementPeriod(tx.date, closingDay);
}

// ── Validation ─────────────────────────────────────────────────────────────

/** Returns the amount as a positive finite number, or null when unusable. */
export function parsePositiveAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Returns a trimmed non-empty string, or null. */
export function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Parameterised transaction aggregation ──────────────────────────────────

/**
 * `impacting` — only rows that move the cash balance (`impacts_balance = 1`).
 * `pending`   — only card purchases waiting for a statement (`impacts_balance = 0`).
 * `all`       — every live row, regardless of when it hits the balance.
 */
export type BalanceScope = 'impacting' | 'pending' | 'all';

export interface TransactionFilter {
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  start: string;
  /** Exclusive upper bound, `YYYY-MM-DD`. */
  end: string;
  type?: 'expense' | 'income';
  currency?: string;
  /** Defaults to `'impacting'`. */
  balanceScope?: BalanceScope;
  excludeCategories?: string[];
  installmentsOnly?: boolean;
  /** Only rows that are NOT part of an instalment plan. */
  excludeInstallments?: boolean;
  categories?: string[];
  creditCardId?: string;
  source?: string;
  recurringId?: string;
  /** Include soft-deleted rows (only useful for idempotency guards). */
  includeDeleted?: boolean;
}

/** Single source of truth for "which transactions count". */
export function buildTransactionWhere(f: TransactionFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!f.includeDeleted) conditions.push('deleted_at IS NULL');
  conditions.push('date >= ?', 'date < ?');
  params.push(f.start, f.end);

  const scope = f.balanceScope ?? 'impacting';
  if (scope === 'impacting') conditions.push('impacts_balance = 1');
  else if (scope === 'pending') conditions.push('impacts_balance = 0');

  if (f.type) { conditions.push('type = ?'); params.push(f.type); }
  if (f.currency) { conditions.push('currency = ?'); params.push(f.currency); }
  if (f.creditCardId) { conditions.push('credit_card_id = ?'); params.push(f.creditCardId); }
  if (f.source) { conditions.push('source = ?'); params.push(f.source); }
  if (f.recurringId) { conditions.push('recurring_id = ?'); params.push(f.recurringId); }
  if (f.installmentsOnly) conditions.push('installment_group_id IS NOT NULL');
  if (f.excludeInstallments) conditions.push('installment_group_id IS NULL');
  if (f.categories?.length) {
    conditions.push(`category IN (${f.categories.map(() => '?').join(', ')})`);
    params.push(...f.categories);
  }
  if (f.excludeCategories?.length) {
    conditions.push(`category NOT IN (${f.excludeCategories.map(() => '?').join(', ')})`);
    params.push(...f.excludeCategories);
  }

  return { where: conditions.join(' AND '), params };
}

export interface CurrencyTotals { ARS: number; USD: number }

/** SUM(amount) per currency for an arbitrary filter. */
export function sumByCurrency(db: SqlDatabase, f: TransactionFilter): CurrencyTotals {
  const { where, params } = buildTransactionWhere(f);
  const rows = db.prepare(`
    SELECT currency, COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    WHERE ${where}
    GROUP BY currency
  `).all(...params) as Array<{ currency: string; total: number }>;

  const out: CurrencyTotals = { ARS: 0, USD: 0 };
  for (const row of rows) {
    if (row.currency === 'ARS' || row.currency === 'USD') out[row.currency] = row.total;
  }
  return out;
}

export interface MonthlyBalanceByCurrency {
  ARS: { income: number; expenses: number; balance: number };
  USD: { income: number; expenses: number; balance: number };
}

/** income / expenses / balance per currency for an arbitrary filter. */
export function sumIncomeExpenseByCurrency(
  db: SqlDatabase,
  f: Omit<TransactionFilter, 'type'>,
): MonthlyBalanceByCurrency {
  const { where, params } = buildTransactionWhere(f);
  const rows = db.prepare(`
    SELECT currency,
           COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
    FROM finance_transactions
    WHERE ${where}
    GROUP BY currency
  `).all(...params) as Array<{ currency: string; income: number; expenses: number }>;

  const result: MonthlyBalanceByCurrency = {
    ARS: { income: 0, expenses: 0, balance: 0 },
    USD: { income: 0, expenses: 0, balance: 0 },
  };
  for (const row of rows) {
    if (row.currency === 'ARS' || row.currency === 'USD') {
      result[row.currency].income = row.income;
      result[row.currency].expenses = row.expenses;
      result[row.currency].balance = row.income - row.expenses;
    }
  }
  return result;
}

export interface CategoryTotals { category: string; ARS: number; USD: number }

/** SUM(amount) grouped by category + currency for an arbitrary filter. */
export function aggregateByCategory(db: SqlDatabase, f: TransactionFilter): CategoryTotals[] {
  const { where, params } = buildTransactionWhere(f);
  const rows = db.prepare(`
    SELECT category, currency, COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    WHERE ${where}
    GROUP BY category, currency
    ORDER BY category ASC
  `).all(...params) as Array<{ category: string; currency: string; total: number }>;

  const map = new Map<string, CategoryTotals>();
  for (const row of rows) {
    let entry = map.get(row.category);
    if (!entry) {
      entry = { category: row.category, ARS: 0, USD: 0 };
      map.set(row.category, entry);
    }
    if (row.currency === 'ARS' || row.currency === 'USD') entry[row.currency] += row.total;
  }
  return Array.from(map.values());
}

/**
 * Single source of truth for the monthly balance (income - expense per currency).
 * Only balance-impacting rows count: credit-card purchases (impacts_balance=0) are
 * excluded until the statement is paid, and soft-deleted rows never count.
 */
export function computeMonthlyBalance(db: SqlDatabase, month: string): MonthlyBalanceByCurrency {
  const { start, end } = monthRange(month);
  // Transfers between own accounts are not income nor expense — see TRANSFER_CATEGORY.
  return sumIncomeExpenseByCurrency(db, {
    start, end, balanceScope: 'impacting', excludeCategories: [TRANSFER_CATEGORY],
  });
}

/**
 * THE definition of "what did I spend on category X".
 *
 * Every live expense counts, including card purchases whose statement has not
 * landed yet (`balanceScope: 'all'`); the auto-generated `Pago Tarjeta` row is
 * excluded so card spending is not counted twice.
 *
 * This is what the dashboard wheel draws, and — deliberately — what a budget is
 * measured against. A budget bar that disagreed with the wheel drawn 40px above
 * it would make the user distrust both numbers, so both go through this one
 * function. `finance.budgets.test.ts` compares the two outputs and fails if they
 * ever drift.
 */
export function categorySpendFilter(range: { start: string; end: string }): TransactionFilter {
  return {
    ...range,
    type: 'expense',
    balanceScope: 'all',
    // Card payments would double-count card spend; transfers are not spend at all.
    excludeCategories: [CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY],
  };
}

/** Category spend for a range, using {@link categorySpendFilter}. */
export function computeCategorySpend(
  db: SqlDatabase,
  range: { start: string; end: string },
): CategoryTotals[] {
  return aggregateByCategory(db, categorySpendFilter(range));
}

/**
 * Named, explicit answer to "how much did I spend?", so the UI never has to
 * guess which of the three historical definitions a number came from.
 */
export function computeExpenseBreakdown(
  db: SqlDatabase,
  range: { start: string; end: string },
): ExpenseBreakdownByCurrency {
  const base = { ...range, type: 'expense' as const, excludeCategories: [CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY] };

  const total = sumByCurrency(db, { ...base, balanceScope: 'all' });
  const pendingCard = sumByCurrency(db, { ...base, balanceScope: 'pending' });
  const installments = sumByCurrency(db, { ...base, balanceScope: 'impacting', installmentsOnly: true });
  const direct = sumByCurrency(db, { ...base, balanceScope: 'impacting', excludeInstallments: true });
  const cardPayments = sumByCurrency(db, {
    ...range,
    type: 'expense',
    balanceScope: 'all',
    categories: [CARD_PAYMENT_CATEGORY],
  });

  const build = (c: 'ARS' | 'USD'): ExpenseBreakdown => ({
    total: total[c],
    direct: direct[c],
    installments: installments[c],
    pendingCard: pendingCard[c],
    cardPayments: cardPayments[c],
  });

  return { ARS: build('ARS'), USD: build('USD') };
}

// ── Recurring generation ───────────────────────────────────────────────────

/**
 * Deterministic transaction id so two devices generating the same recurring
 * transaction for the same month converge on one row instead of syncing two.
 */
export function recurringTransactionId(recurringId: string, month: string): string {
  return `recurring:${recurringId}:${month}`;
}

export interface RecurringTemplate {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  category: string;
  billingDay: number;
  /** One of {@link RECURRING_FREQUENCIES}; anything else behaves as `monthly`. */
  frequency: string;
  createdAt: string;
  /** Account every generated instance inherits. `null` = none. */
  accountId?: string | null;
  /** `YYYY-MM` the cadence is anchored on; `null` = month of `createdAt`. */
  anchorMonth?: string | null;
  /** Medio de pago de cada instancia generada. `null` = sin opinión: se infiere. */
  paymentMethod?: string | null;
}

/**
 * The month a template's cadence counts from: the explicit `anchor_month` the
 * user chose, else the (UTC) month of `created_at` — the pre-column behaviour.
 */
export function recurringAnchorMonth(rec: { createdAt?: string | null; anchorMonth?: string | null }): string {
  if (isValidMonthString(rec.anchorMonth)) return rec.anchorMonth;
  return (rec.createdAt ?? '').slice(0, 7);
}

/** Every cadence the `frequency` TEXT column supports, with its month interval. */
export const RECURRING_FREQUENCY_MONTHS: Record<string, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  four_monthly: 4,
  semiannual: 6,
  annual: 12,
};

export const RECURRING_FREQUENCIES = Object.keys(RECURRING_FREQUENCY_MONTHS);

/** Month interval for a frequency; unknown/legacy values behave as monthly. */
export function frequencyIntervalMonths(frequency: string | null | undefined): number {
  return RECURRING_FREQUENCY_MONTHS[frequency ?? 'monthly'] ?? 1;
}

/** Signed whole months from `fromMonth` to `toMonth` (both `YYYY-MM`). */
export function monthDiff(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Does a recurring template bill in `month`?
 *
 * The anchor is the month the template was created: the first charge lands that
 * same month (exactly how monthly templates always behaved) and then every
 * `interval` months. A bimonthly created in 2026-08 bills 08, 10, 12, 02…
 * An invalid anchor (hand-edited data) falls back to "always due" so a broken
 * timestamp can only ever over-generate one idempotent row, never silently
 * starve a template.
 */
export function isRecurringDueInMonth(
  frequency: string | null | undefined,
  anchorMonth: string,
  month: string,
): boolean {
  const interval = frequencyIntervalMonths(frequency);
  if (interval === 1) return true;
  if (!isValidMonthString(anchorMonth) || !isValidMonthString(month)) return true;
  const diff = monthDiff(anchorMonth, month);
  return diff >= 0 && diff % interval === 0;
}

/**
 * Materialises every active recurring template into a transaction for `month`.
 *
 * Idempotent in three ways, which together kill the "ghost recurring" bugs:
 *  - deterministic id + `INSERT OR IGNORE` → no cross-device duplicates,
 *    and a row the user soft-deleted is never resurrected;
 *  - the guard looks at soft-deleted rows too (`includeDeleted`);
 *  - deleted templates (`deleted_at IS NOT NULL`) are skipped entirely.
 *
 * Runs inside a single SQLite transaction so a failure halfway leaves nothing behind.
 */
export function generateRecurringForMonth(
  db: SqlDatabase,
  month: string,
  opts: {
    /** Dollar venta rate to freeze on the generated rows (`fx_rate`).
     *  `null`/omitted = not available right now; backfill can fill it later. */
    fxRate?: number | null;
  } = {},
): number {
  if (!isValidMonthString(month)) return 0;

  const actives = db.prepare(`
    SELECT id, name, type, amount, currency, category, billing_day AS billingDay,
           frequency, created_at AS createdAt,
           account_id AS accountId, anchor_month AS anchorMonth,
           payment_method AS paymentMethod
    FROM finance_recurring
    WHERE deleted_at IS NULL AND active = 1
  `).all() as RecurringTemplate[];

  if (actives.length === 0) return 0;

  const { start, end } = monthRange(month);

  const existsStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM finance_transactions
    WHERE source = 'recurring' AND recurring_id = ? AND date >= ? AND date < ?
  `);

  // account_id is inherited from the template: a generated rent that belongs
  // to no account never moved the chest, so "Total en cuentas" stayed at the
  // starting balance while the month said −$200.000.
  /**
   * `payment_method` era la constante `'cash'`: la plantilla no tenía dónde
   * guardar el medio, así que las 17 filas de efectivo de la base real las
   * inventó este INSERT, no una persona. Ahora sale de la plantilla, y si la
   * plantilla no opina, del historial del usuario.
   */
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source,
       account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recurring', 1, NULL, 0, ?, NULL, NULL, 1, ?, ?, ?, ?, ?)
  `);

  // Una sola vez por corrida, y solo si hace falta: la moda del historial no
  // cambia entre dos plantillas del mismo mes.
  let inferredMethod: string | null = null;
  const methodFor = (rec: RecurringTemplate): string => {
    const own = typeof rec.paymentMethod === 'string' && rec.paymentMethod.trim() !== ''
      ? rec.paymentMethod.trim() : null;
    if (own) return own;
    if (inferredMethod === null) inferredMethod = getEntryDefaults(db, RESERVED_CATEGORIES).paymentMethod;
    return inferredMethod;
  };

  const now = nowIso();
  const today = todayDateString();
  const fxRate = typeof opts.fxRate === 'number' && Number.isFinite(opts.fxRate) && opts.fxRate > 0
    ? opts.fxRate
    : null;

  const run = db.transaction(() => {
    let generated = 0;
    for (const rec of actives) {
      // Non-monthly cadences only bill on their own months, anchored on the
      // user's anchor month (else the month the template was created).
      if (!isRecurringDueInMonth(rec.frequency, recurringAnchorMonth(rec), month)) continue;

      // Guard includes soft-deleted rows on purpose: if the user deleted this
      // month's instance by hand, do not bring it back next launch.
      const existing = existsStmt.get(rec.id, start, end) as { c: number };
      if (existing.c > 0) continue;

      const date = dateInMonthClamped(month, rec.billingDay ?? 1);
      const result = insertStmt.run(
        recurringTransactionId(rec.id, month),
        rec.type,
        rec.amount,
        rec.currency ?? 'ARS',
        rec.category ?? 'Otros',
        rec.name,
        date,
        methodFor(rec),
        rec.id,
        fxRate,
        fxRate === null ? null : fxRateSourceFor(date, today),
        rec.accountId ?? null,
        now,
        now,
      );
      if (result.changes > 0) generated++;
    }
    return generated;
  });

  return run();
}

// ── Budgets ────────────────────────────────────────────────────────────────

/**
 * A monthly spending limit for one category.
 *
 * The category name is the primary key: budgets are an attribute of the slices
 * the expense wheel already draws, not an entity of their own.
 */
export interface BudgetRow {
  category: string;
  monthlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategoryStatus {
  category: string;
  limit: number;
  /** ARS spend for the month, from {@link computeCategorySpend}. */
  spent: number;
  /** `spent / limit * 100`, unclamped — over 100 means the limit was blown. */
  pct: number;
}

export interface BudgetStatus {
  month: string;
  categories: BudgetCategoryStatus[];
  totalLimit: number;
  totalSpent: number;
}

const EMPTY_BUDGET_STATUS = (month: string): BudgetStatus => ({
  month, categories: [], totalLimit: 0, totalSpent: 0,
});

/** Live budgets, cheapest category first is meaningless — alphabetical is stable. */
export function listBudgets(db: SqlDatabase): BudgetRow[] {
  return db.prepare(`
    SELECT category, monthly_limit AS monthlyLimit,
           created_at AS createdAt, updated_at AS updatedAt
    FROM finance_budgets
    WHERE deleted_at IS NULL
    ORDER BY category ASC
  `).all() as BudgetRow[];
}

/**
 * Sets (or clears) the monthly limit for a category.
 *
 * `limit === null` is a soft delete, so the removal travels through sync; a row
 * that comes back is revived by clearing `deleted_at` rather than inserting a
 * duplicate (the category is the primary key, so there can only ever be one).
 */
export function setBudget(
  db: SqlDatabase,
  category: unknown,
  limit: unknown,
): { ok: true; category: string; monthlyLimit: number | null } | { ok: false; reason: string } {
  const name = parseNonEmptyString(category);
  if (name === null) return { ok: false, reason: 'invalid_category' };
  if (RESERVED_CATEGORIES.includes(name as (typeof RESERVED_CATEGORIES)[number])) {
    return { ok: false, reason: 'reserved_category' };
  }

  const now = nowIso();

  if (limit === null || limit === undefined || limit === '') {
    db.prepare(`
      UPDATE finance_budgets SET deleted_at = ?, updated_at = ? WHERE category = ?
    `).run(now, now, name);
    return { ok: true, category: name, monthlyLimit: null };
  }

  const amount = parsePositiveAmount(limit);
  if (amount === null) return { ok: false, reason: 'invalid_amount' };

  db.prepare(`
    INSERT INTO finance_budgets (category, monthly_limit, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(category) DO UPDATE SET
      monthly_limit = excluded.monthly_limit,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(name, amount, now, now);

  return { ok: true, category: name, monthlyLimit: amount };
}

/**
 * Budget vs. reality for one month.
 *
 * Only categories that HAVE a budget appear: a category without a limit is not
 * "at 0%", it is simply not being watched, and printing it as a full green bar
 * would be a lie. Spend comes from {@link computeCategorySpend} — the very same
 * aggregation the wheel is drawn from.
 *
 * ARS only, like the wheel: adding pesos to dollars would mean inventing an
 * exchange rate, and a budget built on an invented rate is worse than none.
 */
export function computeBudgetStatus(db: SqlDatabase, month: string): BudgetStatus {
  if (!isValidMonthString(month)) return EMPTY_BUDGET_STATUS(month);

  const budgets = listBudgets(db);
  if (budgets.length === 0) return EMPTY_BUDGET_STATUS(month);

  const spendByCategory = new Map(
    computeCategorySpend(db, monthRange(month)).map((c) => [c.category, c.ARS]),
  );

  const categories: BudgetCategoryStatus[] = budgets.map((b) => {
    // round2: the wheel's SUM is clean, but a budget is COMPARED against it.
    const spent = round2(spendByCategory.get(b.category) ?? 0);
    return {
      category: b.category,
      limit: b.monthlyLimit,
      spent,
      pct: b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0,
    };
  });

  return {
    month,
    categories,
    totalLimit: round2(categories.reduce((sum, c) => sum + c.limit, 0)),
    totalSpent: round2(categories.reduce((sum, c) => sum + c.spent, 0)),
  };
}

/**
 * Did the month close inside every limit the user set?
 *
 * Requires at least one budget — a month with nothing to respect cannot be
 * "respected", and paying 100 XP for having configured nothing would make the
 * reward worthless.
 */
export function isBudgetMonthMet(status: BudgetStatus): boolean {
  if (status.categories.length === 0) return false;
  return status.categories.every((c) => round2(c.spent) <= round2(c.limit));
}

// ── Dollar rate (frozen fx_rate) ───────────────────────────────────────────

export const DOLLAR_API_URL = 'https://dolarapi.com/v1/dolares';

/** Casa preferida para congelar cotizaciones. Stored in app_state `fx_house`. */
export const DEFAULT_FX_HOUSE = 'blue';

/** Rate cache is fresh for one hour — dolarapi updates a few times a day. */
export const RATE_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

export interface DollarApiRate {
  casa: string;
  nombre?: string;
  compra?: number;
  venta: number;
  fechaActualizacion?: string;
}

/** Preferred dollar house for freezing rates. Defensive: a missing app_state
 *  table (bare test db) just means the default. */
export function getFxHouse(db: SqlDatabase): string {
  try {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'fx_house'").get() as { value: string } | undefined;
    const value = row?.value?.trim();
    return value ? value : DEFAULT_FX_HOUSE;
  } catch {
    return DEFAULT_FX_HOUSE;
  }
}

export function setFxHouse(db: SqlDatabase, house: unknown): { ok: true; house: string } | { ok: false; reason: string } {
  const value = parseNonEmptyString(house);
  if (value === null) return { ok: false, reason: 'invalid_house' };
  db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('fx_house', ?)").run(value.toLowerCase());
  return { ok: true, house: value.toLowerCase() };
}

/** The `dollar_cache` row `dollar:getRates` also uses — one cache, two readers. */
export function readDollarRatesCache(
  db: SqlDatabase,
): { rates: DollarApiRate[]; updatedAt: string } | null {
  try {
    const row = db.prepare('SELECT data, updated_at FROM dollar_cache WHERE id = ?').get('rates') as
      { data: string; updated_at: string } | undefined;
    if (!row) return null;
    const rates = JSON.parse(row.data) as DollarApiRate[];
    if (!Array.isArray(rates)) return null;
    return { rates, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function writeDollarRatesCache(db: SqlDatabase, rates: DollarApiRate[]): void {
  db.prepare(`
    INSERT OR REPLACE INTO dollar_cache (id, data, updated_at)
    VALUES ('rates', ?, datetime('now'))
  `).run(JSON.stringify(rates));
}

/** Venta rate for a house, falling back to `blue`, then the first entry. */
export function rateFromRates(rates: DollarApiRate[], house: string): number | null {
  const pick = rates.find((r) => r.casa === house) ?? rates.find((r) => r.casa === DEFAULT_FX_HOUSE) ?? rates[0];
  const venta = pick?.venta;
  return typeof venta === 'number' && Number.isFinite(venta) && venta > 0 ? venta : null;
}

/**
 * Age of a cache stamp in milliseconds. Handles both SQLite `datetime('now')`
 * ("2026-08-31 14:12:01", UTC) and ISO stamps. Unparseable → Infinity (stale).
 */
export function cacheAgeMs(updatedAt: string, nowMs: number = Date.now()): number {
  const iso = updatedAt.includes('T') ? updatedAt : `${updatedAt.replace(' ', 'T')}Z`;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, nowMs - t);
}

export interface RateFetchOptions {
  /** Injectable for tests. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
  maxAgeMs?: number;
  /** Hard cap on how long a fetch may hold up a write path. */
  timeoutMs?: number;
  nowMs?: number;
}

/**
 * Current venta rate for a house, cache-first:
 *  1. cache younger than `maxAgeMs` (1h) → no network at all;
 *  2. otherwise fetch dolarapi (bounded by `timeoutMs`) and refresh the cache;
 *  3. fetch failed → whatever stale cache exists;
 *  4. nothing anywhere → `null`.
 *
 * NEVER throws: a missing rate must not block registering a transaction.
 */
export async function getCurrentRate(
  db: SqlDatabase,
  house: string,
  opts: RateFetchOptions = {},
): Promise<number | null> {
  const maxAgeMs = opts.maxAgeMs ?? RATE_CACHE_MAX_AGE_MS;
  const cached = readDollarRatesCache(db);

  if (cached && cacheAgeMs(cached.updatedAt, opts.nowMs) < maxAgeMs) {
    return rateFromRates(cached.rates, house);
  }

  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const response = await fetchFn(DOLLAR_API_URL, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    if (response.ok) {
      const rates = await response.json() as DollarApiRate[];
      if (Array.isArray(rates) && rates.length > 0) {
        try { writeDollarRatesCache(db, rates); } catch { /* cache write is best-effort */ }
        return rateFromRates(rates, house);
      }
    }
  } catch {
    // Offline / timeout — fall through to the stale cache.
  }

  return cached ? rateFromRates(cached.rates, house) : null;
}

/**
 * Fills `fx_rate` on every live transaction that has none, with the best rate
 * available today. One pass, idempotent: rows that already carry a frozen rate
 * are never touched, so running it twice changes nothing.
 *
 * The rows are stamped `fx_rate_source = 'backfill'` (or `'day'` when the row
 * is dated today — then today's rate IS its rate): before the column existed
 * this pass turned an honest `~US$ 74` into a false-precision `US$ 74` on a
 * two-year-old row. Prefer {@link backfillFxRatesHistorical}, which asks the
 * historical series first and only falls back to this.
 *
 * `updated_at` is bumped on purpose — without it, last-write-wins sync would
 * never carry the backfilled value to the other devices.
 */
export function backfillFxRates(db: SqlDatabase, rate: number, today: string = todayDateString()): number {
  const parsed = parsePositiveAmount(rate);
  if (parsed === null) return 0;
  const result = db.prepare(`
    UPDATE finance_transactions
    SET fx_rate = ?, fx_rate_source = CASE WHEN date = ? THEN 'day' ELSE 'backfill' END, updated_at = ?
    WHERE fx_rate IS NULL AND deleted_at IS NULL
  `).run(parsed, today, nowIso());
  return result.changes;
}

// ── Historical rates (argentinadatos) ──────────────────────────────────────

export const HISTORICAL_RATE_API_BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';

/** `…/dolares/{casa}/{YYYY/MM/DD}` — one quote per house per day. */
export function historicalRateUrl(house: string, date: string): string {
  return `${HISTORICAL_RATE_API_BASE}/${encodeURIComponent(house)}/${date.replace(/-/g, '/')}`;
}

/** Cache row id in `dollar_cache` for one house/day. Historical data never changes: no TTL. */
function historicalCacheId(house: string, date: string): string {
  return `fxhist:${house}:${date}`;
}

export function readHistoricalRateCache(db: SqlDatabase, house: string, date: string): number | null {
  try {
    const row = db.prepare('SELECT data FROM dollar_cache WHERE id = ?').get(historicalCacheId(house, date)) as
      { data: string } | undefined;
    if (!row) return null;
    const value = Number(JSON.parse(row.data));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeHistoricalRateCache(db: SqlDatabase, house: string, date: string, rate: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO dollar_cache (id, data, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(historicalCacheId(house, date), JSON.stringify(rate));
}

/** The API answers `{ casa, compra, venta, fecha }` (or a list of them). */
export function parseHistoricalRateResponse(json: unknown): number | null {
  const pick = Array.isArray(json) ? json[json.length - 1] : json;
  const venta = (pick as { venta?: unknown } | null)?.venta;
  return typeof venta === 'number' && Number.isFinite(venta) && venta > 0 ? venta : null;
}

/**
 * Venta rate of `house` on `date` (`YYYY-MM-DD`), cache-first, network second
 * (bounded by `timeoutMs`, 3 s by default), never throws.
 *
 * Weekends and holidays have no quote, so up to `lookback` previous days are
 * tried — a Saturday purchase was priced at Friday's close. The result is
 * cached under the ORIGINAL date.
 *
 * `offline: true` means the network itself failed (timeout, DNS, no fetch):
 * the caller should stop asking for other dates in this run. A clean "no data"
 * (404, empty body) is not offline.
 */
export async function getHistoricalRate(
  db: SqlDatabase,
  house: string,
  date: string,
  opts: RateFetchOptions & { lookback?: number } = {},
): Promise<{ rate: number | null; offline: boolean }> {
  const cached = readHistoricalRateCache(db, house, date);
  if (cached !== null) return { rate: cached, offline: false };

  const fetchFn = opts.fetchFn ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return { rate: null, offline: true };
  const lookback = Math.max(0, Math.min(opts.lookback ?? 3, 7));

  for (let back = 0; back <= lookback; back++) {
    const probe = addDaysToDate(date, -back);
    try {
      const response = await fetchFn(historicalRateUrl(house, probe), {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
      if (!response.ok) continue; // no quote that day — try the day before
      const rate = parseHistoricalRateResponse(await response.json());
      if (rate === null) continue;
      try { writeHistoricalRateCache(db, house, date, rate); } catch { /* best-effort */ }
      return { rate, offline: false };
    } catch {
      return { rate: null, offline: true };
    }
  }
  return { rate: null, offline: false };
}

export interface HistoricalBackfillResult {
  /** Rows that got a rate, by any means. */
  updated: number;
  /** Rows stamped `'day'` (rate of their own date). */
  exact: number;
  /** Rows stamped `'backfill'` (today's rate pasted over an old row). */
  approx: number;
}

/**
 * Backfill that respects the calendar: every live row without a frozen rate
 * gets the rate of ITS OWN DATE from the historical series (stamped `'day'`),
 * and only the dates the series could not answer fall back to today's rate
 * (stamped `'backfill'`, which keeps the `~` on screen).
 *
 * Bounded: at most `maxDates` distinct dates per run (newest first), and the
 * first network failure ends the historical pass — offline means offline for
 * every date, no point in 60 timeouts in a row. Never throws.
 */
export async function backfillFxRatesHistorical(
  db: SqlDatabase,
  opts: RateFetchOptions & {
    house: string;
    /** Today's rate for the fallback pass; `null` = no fallback (rows stay NULL). */
    currentRate: number | null;
    maxDates?: number;
    today?: string;
  },
): Promise<HistoricalBackfillResult> {
  const today = opts.today ?? todayDateString();
  const maxDates = Math.max(1, Math.min(opts.maxDates ?? 60, 365));
  const now = nowIso();

  const dates = db.prepare(`
    SELECT DISTINCT date FROM finance_transactions
    WHERE fx_rate IS NULL AND deleted_at IS NULL AND date < ?
    ORDER BY date DESC
    LIMIT ?
  `).all(today, maxDates) as Array<{ date: string }>;

  const stampDay = db.prepare(`
    UPDATE finance_transactions
    SET fx_rate = ?, fx_rate_source = 'day', updated_at = ?
    WHERE fx_rate IS NULL AND deleted_at IS NULL AND date = ?
  `);

  let exact = 0;
  for (const { date } of dates) {
    const { rate, offline } = await getHistoricalRate(db, opts.house, date, opts);
    if (offline) break;
    if (rate === null) continue;
    exact += stampDay.run(rate, now, date).changes;
  }

  let approx = 0;
  if (opts.currentRate !== null) {
    // Rows dated today are stamped 'day' inside backfillFxRates itself.
    const before = (db.prepare(
      "SELECT COUNT(*) AS c FROM finance_transactions WHERE fx_rate IS NULL AND deleted_at IS NULL AND date = ?",
    ).get(today) as { c: number }).c;
    const changed = backfillFxRates(db, opts.currentRate, today);
    exact += Math.min(before, changed);
    approx = Math.max(0, changed - before);
  }

  return { updated: exact + approx, exact, approx };
}

// ── Inflation (INDEC IPC) ──────────────────────────────────────────────────

/**
 * IPC nivel general NACIONAL, ÍNDICE mensual base dic-2016 (not the monthly
 * variation): `latestIndex / monthIndex` gives the cumulative coefficient in
 * one division. Verified against apis.datos.gob.ar (monthly, 2016-12 → today).
 */
export const IPC_SERIES_ID = '148.3_INIVELNAL_DICI_M_26';

export const IPC_API_URL =
  `https://apis.datos.gob.ar/series/api/series/?ids=${IPC_SERIES_ID}&format=json&limit=1000`;

/** Monthly data: refetching more than once a day buys nothing. */
export const IPC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** datos.gob.ar payload → clean series. Tolerates nulls (unpublished months). */
export function parseIpcApiResponse(json: unknown): IpcSeriesPoint[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const series: IpcSeriesPoint[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [date, value] = row as [unknown, unknown];
    if (typeof date !== 'string' || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    if (!/^\d{4}-\d{2}/.test(date)) continue;
    series.push({ month: date.slice(0, 7), index: value });
  }
  return series;
}

export function readIpcSeriesCache(
  db: SqlDatabase,
): { series: IpcSeriesPoint[]; updatedAt: string } | null {
  try {
    const row = db.prepare('SELECT data, updated_at FROM dollar_cache WHERE id = ?').get('ipc') as
      { data: string; updated_at: string } | undefined;
    if (!row) return null;
    const series = JSON.parse(row.data) as IpcSeriesPoint[];
    if (!Array.isArray(series) || series.length === 0) return null;
    return { series, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function writeIpcSeriesCache(db: SqlDatabase, series: IpcSeriesPoint[]): void {
  db.prepare(`
    INSERT OR REPLACE INTO dollar_cache (id, data, updated_at)
    VALUES ('ipc', ?, datetime('now'))
  `).run(JSON.stringify(series));
}

/**
 * IPC series, same cache philosophy as {@link getCurrentRate}: fresh cache →
 * no network; stale → fetch and refresh; offline → stale cache; nothing →
 * `null`. Never throws, never blocks anything critical.
 */
export async function getIpcSeries(
  db: SqlDatabase,
  opts: RateFetchOptions = {},
): Promise<IpcSeriesPoint[] | null> {
  const maxAgeMs = opts.maxAgeMs ?? IPC_CACHE_MAX_AGE_MS;
  const cached = readIpcSeriesCache(db);

  if (cached && cacheAgeMs(cached.updatedAt, opts.nowMs) < maxAgeMs) {
    return cached.series;
  }

  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const response = await fetchFn(IPC_API_URL, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (response.ok) {
      const series = parseIpcApiResponse(await response.json());
      if (series.length > 0) {
        try { writeIpcSeriesCache(db, series); } catch { /* best-effort */ }
        return series;
      }
    }
  } catch {
    // Offline — fall through.
  }

  return cached ? cached.series : null;
}

// ── Valued view (USD / ARS de hoy) ─────────────────────────────────────────

export interface ValuedAggregates {
  balance: { income: number; expenses: number; balance: number };
  /** Six months of expenses ending on the requested month, converted. */
  monthlyExpenses: number[];
  categories: Array<{ category: string; value: number }>;
  /** True when any converted amount used a fallback (current rate / nominal). */
  approx: boolean;
}

export interface ValuedView {
  month: string;
  house: string;
  currentRate: number | null;
  /** `null` when no rate exists at all — dollars cannot be computed honestly. */
  usd: ValuedAggregates | null;
  /** `null` when the IPC series is unreachable and uncached. */
  arsToday: (ValuedAggregates & { latestIpcMonth: string }) | null;
  /**
   * Expenses vs previous month, valued in pesos (dollar rows converted at
   * their own frozen rate) — nominal and inflation-adjusted.
   * `realPct` is `null` whenever either month's IPC index is not published yet;
   * `realPending` then says so (as opposed to "no series at all"), so the UI
   * can print "sin dato del INDEC todavía" instead of a number that is just the
   * nominal figure wearing a different label.
   */
  trend: { nominalPct: number | null; realPct: number | null; realPending: boolean };
}

interface FxRow { amount: number; currency: string; fxRate: number | null; fxRateSource?: string | null }

/**
 * Sum of rows re-expressed in ONE currency, each with its own frozen rate.
 *
 * Symmetric by construction (see `convertRowToCurrency`): a peso row counts in
 * the dollar total divided by its rate, a dollar row counts in the peso total
 * multiplied by the same rate. A row that cannot be converted at all (no frozen
 * rate, no current rate) is left out and flips `approx` — a total that silently
 * dropped rows without saying so is exactly the bug this replaces.
 *
 * `round2` because these totals are compared (against budgets, against the
 * previous month) and `+=` over hundreds of rows leaves binary noise.
 */
function sumIn(
  rows: FxRow[],
  target: ValuationCurrency,
  currentRate: number | null,
): { total: number; approx: boolean } {
  let total = 0;
  let approx = false;
  for (const row of rows) {
    const converted = convertRowToCurrency(row, target, currentRate);
    if (converted === null) { approx = true; continue; }
    total += converted.value;
    if (converted.approx) approx = true;
  }
  return { total: round2(total), approx };
}

/**
 * The dashboard, re-expressed. Same row-selection definitions as the nominal
 * handlers on purpose (`impacting` for balances and the sparkline,
 * {@link categorySpendFilter} for the wheel) so switching mode changes the
 * unit, never which transactions count.
 *
 * BOTH currencies count in BOTH views — that is the whole point of a "valued"
 * view, and the asymmetry it fixes: these aggregates used to filter
 * `currency = 'ARS'`, so a salary collected in dollars was not converted, it
 * was EXCLUDED, and someone paid in dollars saw that money nowhere on the peso
 * side. Now every row is re-expressed with ITS OWN frozen `fx_rate`
 * (`amount / rate` going to dollars, `amount * rate` coming back to pesos); a
 * row without a frozen rate falls back to `currentRate` and flips `approx`,
 * identically in both directions.
 *
 * USD: every amount in dollars. ARS de hoy: every amount first in the pesos of
 * its own date, then times the cumulative IPC coefficient of its month (all
 * rows of a month share it) — dollars have no IPC, so the conversion has to
 * happen before the inflation, never after.
 */
export function computeValuedView(
  db: SqlDatabase,
  month: string,
  ctx: { currentRate: number | null; house: string; series: IpcSeriesPoint[] | null },
): ValuedView {
  const { start, end } = monthRange(month);
  const coefs = buildIpcCoefficients(ctx.series);

  // One row-level query per aggregate the dashboard shows. Transfers between
  // own accounts are excluded exactly like in the nominal handlers. NO currency
  // filter: `currency` travels with each row and the conversion happens per row.
  const balanceRows = db.prepare(`
    SELECT type, amount, currency, fx_rate AS fxRate, fx_rate_source AS fxRateSource
    FROM finance_transactions
    WHERE deleted_at IS NULL AND date >= ? AND date < ?
      AND impacts_balance = 1 AND category <> ?
  `).all(start, end, TRANSFER_CATEGORY) as Array<{ type: string } & FxRow>;

  const sparkStart = monthRange(addMonthsToMonth(month, -5)).start;
  const sparkRows = db.prepare(`
    SELECT amount, currency, fx_rate AS fxRate, fx_rate_source AS fxRateSource, SUBSTR(date, 1, 7) AS m
    FROM finance_transactions
    WHERE deleted_at IS NULL AND date >= ? AND date < ?
      AND type = 'expense' AND impacts_balance = 1 AND category <> ?
  `).all(sparkStart, end, TRANSFER_CATEGORY) as Array<{ m: string } & FxRow>;

  const catWhere = buildTransactionWhere(categorySpendFilter({ start, end }));
  const catRows = db.prepare(`
    SELECT category, amount, currency, fx_rate AS fxRate, fx_rate_source AS fxRateSource
    FROM finance_transactions
    WHERE ${catWhere.where}
  `).all(...catWhere.params) as Array<{ category: string } & FxRow>;

  const sparkMonths: string[] = [];
  for (let i = 5; i >= 0; i--) sparkMonths.push(addMonthsToMonth(month, -i));

  const incomeRows = balanceRows.filter((r) => r.type === 'income');
  const expenseRows = balanceRows.filter((r) => r.type === 'expense');
  const catMap = new Map<string, FxRow[]>();
  for (const r of catRows) {
    const list = catMap.get(r.category) ?? [];
    list.push(r);
    catMap.set(r.category, list);
  }

  // ── USD ──
  let usd: ValuedAggregates | null = null;
  if (ctx.currentRate !== null && ctx.currentRate > 0) {
    const income = sumIn(incomeRows, 'USD', ctx.currentRate);
    const expenses = sumIn(expenseRows, 'USD', ctx.currentRate);
    const spark = sparkMonths.map((m) => sumIn(sparkRows.filter((r) => r.m === m), 'USD', ctx.currentRate));
    let approx = income.approx || expenses.approx || spark.some((s) => s.approx);
    const categories = Array.from(catMap.entries()).map(([category, rows]) => {
      const sum = sumIn(rows, 'USD', ctx.currentRate);
      if (sum.approx) approx = true;
      return { category, value: sum.total };
    }).sort((a, b) => b.value - a.value);

    usd = {
      balance: {
        income: income.total,
        expenses: expenses.total,
        balance: round2(income.total - expenses.total),
      },
      monthlyExpenses: spark.map((s) => s.total),
      categories,
      approx,
    };
  }

  // ── Pesos of each row's own date ──
  // Shared by "ARS de hoy" and by the trend: a dollar row becomes the pesos it
  // was worth the day it was written (× its frozen rate), which is precisely
  // the figure the IPC coefficient of that month knows how to inflate.
  const arsIncome = sumIn(incomeRows, 'ARS', ctx.currentRate);
  const arsExpenses = sumIn(expenseRows, 'ARS', ctx.currentRate);
  const arsSpark = sparkMonths.map((m) => sumIn(sparkRows.filter((r) => r.m === m), 'ARS', ctx.currentRate));

  // ── ARS de hoy ──
  let arsToday: (ValuedAggregates & { latestIpcMonth: string }) | null = null;
  if (coefs) {
    const monthDetail = coefficientDetail(coefs, month);
    const monthCoef = monthDetail?.coef ?? null;
    const applyCoef = (nominal: number, coef: number | null) =>
      round2(coef === null ? nominal : nominal * coef);
    // Approximate when the month predates the series AND when its index is
    // not published yet: the current month's "today's pesos" are nominal pesos
    // wearing a coefficient of 1 that INDEC has not confirmed. A dollar row
    // converted with a fallback (or non-`day`) rate is approximate too.
    let approx = monthDetail === null || monthDetail.assumed
      || arsIncome.approx || arsExpenses.approx;

    const income = applyCoef(arsIncome.total, monthCoef);
    const expenses = applyCoef(arsExpenses.total, monthCoef);

    const monthlyExpenses = sparkMonths.map((m, i) => {
      const detail = coefficientDetail(coefs, m);
      if (detail === null || detail.assumed || arsSpark[i].approx) approx = true;
      return applyCoef(arsSpark[i].total, detail?.coef ?? null);
    });

    const categories = Array.from(catMap.entries())
      .map(([category, rows]) => {
        const sum = sumIn(rows, 'ARS', ctx.currentRate);
        if (sum.approx) approx = true;
        return { category, value: applyCoef(sum.total, monthCoef) };
      })
      .sort((a, b) => b.value - a.value);

    arsToday = {
      balance: { income, expenses, balance: round2(income - expenses) },
      monthlyExpenses,
      categories,
      approx,
      latestIpcMonth: coefs.latestMonth,
    };
  }

  // ── Trend (nominal + real) ──
  // Both months in pesos, dollar rows included at their own frozen rate: the
  // comparison has to be between two totals built the same way, and the current
  // month's total now counts the dollars.
  const prevMonth = addMonthsToMonth(month, -1);
  const prevRange = monthRange(prevMonth);
  const currExpenses = arsExpenses.total;
  const prevRows = db.prepare(`
    SELECT amount, currency, fx_rate AS fxRate, fx_rate_source AS fxRateSource
    FROM finance_transactions
    WHERE deleted_at IS NULL AND date >= ? AND date < ?
      AND type = 'expense' AND impacts_balance = 1 AND category <> ?
  `).all(prevRange.start, prevRange.end, TRANSFER_CATEGORY) as FxRow[];
  const prevExpenses = sumIn(prevRows, 'ARS', ctx.currentRate).total;
  // An ASSUMED coefficient (index not published yet) is passed as null: with
  // both months at 1 the "real" figure was the nominal one, every month,
  // because the current month never has an index when it is on screen.
  const currDetail = coefs ? coefficientDetail(coefs, month) : null;
  const prevDetail = coefs ? coefficientDetail(coefs, prevMonth) : null;
  const exactCoef = (d: { coef: number; assumed: boolean } | null) => (d && !d.assumed ? d.coef : null);
  const realPending = !!coefs && !!(currDetail?.assumed || prevDetail?.assumed);
  const { nominalPct, realPct } = nominalAndRealTrend(
    currExpenses,
    prevExpenses,
    exactCoef(currDetail),
    exactCoef(prevDetail),
  );

  return {
    month, house: ctx.house, currentRate: ctx.currentRate, usd, arsToday,
    trend: { nominalPct, realPct, realPending },
  };
}

// ── Upcoming timeline ("Próximas batallas", 30 días) ───────────────────────

export interface UpcomingItem {
  kind: 'installment' | 'recurring' | 'card_due';
  /** `YYYY-MM-DD` the money leaves the pocket. */
  date: string;
  label: string;
  amount: number;
  currency: 'ARS' | 'USD';
  /** Transaction / recurring / statement id, per kind. */
  refId: string;
  /** Extra context: "3/6" for an instalment, the period for a card due. */
  detail?: string;
}

export interface UpcomingTimeline {
  from: string;
  /** Exclusive upper bound. */
  to: string;
  items: UpcomingItem[];
  totals: { ARS: number; USD: number };
}

/** `dateStr + days`, calendar-correct (UTC math, no DST surprises). */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Everything that leaves the pocket in the next `days` days, ordered by date:
 *
 *  - `installment`: real instalment rows already scheduled inside the window;
 *  - `recurring`:   active expense templates projected onto the months the
 *                   window touches, respecting their frequency. If the month's
 *                   row was already generated, the REAL row wins (its date and
 *                   amount); a soft-deleted instance means the user cancelled
 *                   that charge, so nothing is shown;
 *  - `card_due`:    pending card statements whose due date (`due_day`) falls in
 *                   the window. Due month convention: the statement for period
 *                   M is due on `due_day` of M when `due_day > closing_day`,
 *                   otherwise on `due_day` of M+1. Cards without `due_day` are
 *                   silent here.
 */
export function computeUpcomingTimeline(
  db: SqlDatabase,
  fromDate: string,
  days = 30,
): UpcomingTimeline {
  const span = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 90) : 30;
  const to = addDaysToDate(fromDate, span);
  const items: UpcomingItem[] = [];

  const pushCurrency = (currency: string): 'ARS' | 'USD' => currency === 'USD' ? 'USD' : 'ARS';

  // 1. Instalments already written in the window.
  const installmentRows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.currency,
           t.installment_number AS installmentNumber,
           g.total_installments AS totalInstallments,
           g.description AS groupDescription
    FROM finance_transactions t
    JOIN finance_installment_groups g ON g.id = t.installment_group_id
    WHERE t.deleted_at IS NULL AND t.type = 'expense'
      AND t.installment_group_id IS NOT NULL
      AND t.date >= ? AND t.date < ?
  `).all(fromDate, to) as Array<{
    id: string; date: string; description: string; amount: number; currency: string;
    installmentNumber: number | null; totalInstallments: number; groupDescription: string;
  }>;

  for (const row of installmentRows) {
    items.push({
      kind: 'installment',
      date: row.date,
      label: row.groupDescription || row.description,
      amount: row.amount,
      currency: pushCurrency(row.currency),
      refId: row.id,
      detail: row.installmentNumber != null ? `${row.installmentNumber}/${row.totalInstallments}` : undefined,
    });
  }

  // 2. Recurring expenses projected onto the window's months.
  const templates = db.prepare(`
    SELECT id, name, amount, currency, billing_day AS billingDay,
           frequency, created_at AS createdAt, anchor_month AS anchorMonth
    FROM finance_recurring
    WHERE deleted_at IS NULL AND active = 1 AND type = 'expense'
  `).all() as Array<{
    id: string; name: string; amount: number; currency: string;
    billingDay: number; frequency: string; createdAt: string; anchorMonth: string | null;
  }>;

  if (templates.length > 0) {
    const months: string[] = [];
    for (let m = fromDate.slice(0, 7); m <= to.slice(0, 7); m = addMonthsToMonth(m, 1)) months.push(m);

    const existsStmt = db.prepare(`
      SELECT id, date, amount, currency, deleted_at AS deletedAt
      FROM finance_transactions
      WHERE source = 'recurring' AND recurring_id = ? AND date >= ? AND date < ?
      LIMIT 1
    `);

    for (const rec of templates) {
      for (const m of months) {
        if (!isRecurringDueInMonth(rec.frequency, recurringAnchorMonth(rec), m)) continue;
        const range = monthRange(m);
        const existing = existsStmt.get(rec.id, range.start, range.end) as
          { id: string; date: string; amount: number; currency: string; deletedAt: string | null } | undefined;
        if (existing?.deletedAt) continue; // the user cancelled this charge
        const date = existing ? existing.date : dateInMonthClamped(m, rec.billingDay ?? 1);
        if (date < fromDate || date >= to) continue;
        items.push({
          kind: 'recurring',
          date,
          label: rec.name,
          amount: existing ? existing.amount : rec.amount,
          currency: pushCurrency(existing ? existing.currency : rec.currency),
          refId: rec.id,
        });
      }
    }
  }

  // 3. Card statements due inside the window.
  const statements = db.prepare(`
    SELECT s.id, s.period_month AS periodMonth,
           s.calculated_amount AS ars, s.calculated_amount_usd AS usd,
           c.name AS cardName, c.closing_day AS closingDay, c.due_day AS dueDay
    FROM finance_credit_card_statements s
    JOIN finance_credit_cards c ON c.id = s.credit_card_id AND c.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.status = 'pending' AND c.due_day IS NOT NULL
  `).all() as Array<{
    id: string; periodMonth: string; ars: number; usd: number;
    cardName: string; closingDay: number; dueDay: number;
  }>;

  for (const s of statements) {
    const dueMonth = s.dueDay > s.closingDay ? s.periodMonth : addMonthsToMonth(s.periodMonth, 1);
    const date = dateInMonthClamped(dueMonth, s.dueDay);
    if (date < fromDate || date >= to) continue;
    if (s.ars > 0) {
      items.push({ kind: 'card_due', date, label: s.cardName, amount: s.ars, currency: 'ARS', refId: s.id, detail: s.periodMonth });
    }
    if (s.usd > 0) {
      items.push({ kind: 'card_due', date, label: s.cardName, amount: s.usd, currency: 'USD', refId: s.id, detail: s.periodMonth });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));

  const totals = { ARS: 0, USD: 0 };
  for (const item of items) totals[item.currency] += item.amount;

  return { from: fromDate, to, items, totals };
}

// ── Accounts (cuentas y billeteras) ────────────────────────────────────────

export type AccountKind = 'cash' | 'bank' | 'wallet';

export const ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'bank', 'wallet'];

/**
 * Deterministic id of the seeded «Efectivo» account. Fixed on purpose: two
 * devices that run the v17 migration in parallel create the very same row, so
 * last-write-wins sync collapses them instead of shipping a duplicate wallet
 * to every machine.
 */
export const DEFAULT_CASH_ACCOUNT_ID = 'account-cash-default';

export interface FinanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  initialBalance: number;
  accountOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWithBalance extends FinanceAccount {
  /** `initial_balance` + income − expenses of its live, balance-impacting rows. */
  balance: number;
  /**
   * How many live, balance-impacting rows point at this account. Zero means the
   * account has never been used — which is a different thing from an account
   * that was used and happens to sit at zero, and the chest hides the former.
   */
  movements: number;
}

export interface AccountsOverview {
  accounts: AccountWithBalance[];
  /** Sum of balances of live ARS accounts — what the chest should print. */
  totalArs: number;
  totalUsd: number;
}

/** Live accounts, user order first, then creation order. */
export function listAccounts(db: SqlDatabase): FinanceAccount[] {
  return db.prepare(`
    SELECT id, name, kind, currency, initial_balance AS initialBalance,
           account_order AS accountOrder,
           created_at AS createdAt, updated_at AS updatedAt
    FROM finance_accounts
    WHERE deleted_at IS NULL
    ORDER BY account_order ASC, created_at ASC
  `).all() as FinanceAccount[];
}

/**
 * Net movement per account: income − expenses of live, balance-impacting rows,
 * in the account's OWN currency (a USD row filed under an ARS account cannot
 * honestly be added to pesos, so it simply does not count).
 *
 * Transfers DO count here — that is the whole point of `impacts_balance = 1`
 * on their legs: money left one account and landed in another. They are only
 * excluded from income/expense *aggregations* (see TRANSFER_CATEGORY).
 *
 * The JOIN also resolves dangling links on read: a transaction whose account
 * has not synced in yet (or was soft-deleted) belongs to no visible account.
 */
export function computeAccountDeltas(db: SqlDatabase): Map<string, number> {
  const rows = db.prepare(`
    SELECT t.account_id AS accountId,
           COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS delta
    FROM finance_transactions t
    JOIN finance_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND t.impacts_balance = 1 AND t.currency = a.currency
    GROUP BY t.account_id
  `).all() as Array<{ accountId: string; delta: number }>;
  return new Map(rows.map((r) => [r.accountId, r.delta]));
}

/** The chest, opened: every live account with its real balance, plus totals per currency. */
/** Live, balance-impacting rows per account. Same filter as the deltas. */
export function computeAccountMovements(db: SqlDatabase): Map<string, number> {
  const rows = db.prepare(`
    SELECT t.account_id AS accountId, COUNT(*) AS n
    FROM finance_transactions t
    JOIN finance_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND t.impacts_balance = 1 AND t.currency = a.currency
    GROUP BY t.account_id
  `).all() as Array<{ accountId: string; n: number }>;
  return new Map(rows.map((r) => [r.accountId, r.n]));
}

export function computeAccountsOverview(db: SqlDatabase): AccountsOverview {
  const deltas = computeAccountDeltas(db);
  const movements = computeAccountMovements(db);
  const accounts: AccountWithBalance[] = listAccounts(db).map((a) => ({
    ...a,
    balance: a.initialBalance + (deltas.get(a.id) ?? 0),
    movements: movements.get(a.id) ?? 0,
  }));
  let totalArs = 0;
  let totalUsd = 0;
  for (const a of accounts) {
    if (a.currency === 'ARS') totalArs += a.balance;
    else if (a.currency === 'USD') totalUsd += a.balance;
  }
  return { accounts, totalArs, totalUsd };
}

export interface SaveAccountInput {
  id?: string;
  name: unknown;
  kind: unknown;
  currency?: unknown;
  initialBalance?: unknown;
  order?: unknown;
}

function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

/**
 * Creates or updates an account. `id` present and existing → update (reviving a
 * soft-deleted row instead of duplicating it); otherwise insert. `INSERT OR
 * IGNORE` so a deterministic id arriving twice (seed + sync) stays one row.
 */
export function saveAccount(
  db: SqlDatabase,
  input: SaveAccountInput,
): { ok: true; id: string } | { ok: false; reason: string } {
  const name = parseNonEmptyString(input?.name);
  if (name === null) return { ok: false, reason: 'invalid_name' };
  if (!isAccountKind(input?.kind)) return { ok: false, reason: 'invalid_kind' };
  const currency = input?.currency === undefined ? 'ARS' : input.currency;
  if (currency !== 'ARS' && currency !== 'USD') return { ok: false, reason: 'invalid_currency' };
  const initialBalance = input?.initialBalance === undefined ? 0 : Number(input.initialBalance);
  if (!Number.isFinite(initialBalance)) return { ok: false, reason: 'invalid_amount' };
  const order = input?.order === undefined ? 0 : Number(input.order);
  if (!Number.isInteger(order)) return { ok: false, reason: 'invalid_order' };

  const now = nowIso();
  const id = input.id ?? genId();

  const existing = db.prepare('SELECT id FROM finance_accounts WHERE id = ?').get(id) as { id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE finance_accounts
      SET name = ?, kind = ?, currency = ?, initial_balance = ?, account_order = ?,
          deleted_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(name, input.kind, currency, initialBalance, order, now, id);
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO finance_accounts
        (id, name, kind, currency, initial_balance, account_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, input.kind, currency, initialBalance, order, now, now);
  }
  return { ok: true, id };
}

/**
 * Soft delete. The account's transactions keep their `account_id` untouched —
 * they are history, and the read-side JOIN already leaves them out of every
 * balance the moment the account is gone.
 */
export function softDeleteAccount(
  db: SqlDatabase,
  id: string,
): { ok: true } | { ok: false; reason: string } {
  const now = nowIso();
  const res = db.prepare(
    'UPDATE finance_accounts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(now, now, id);
  if (res.changes === 0) return { ok: false, reason: 'account_not_found' };
  return { ok: true };
}

export interface TransferInput {
  fromId: unknown;
  toId: unknown;
  amount: unknown;
  /** `YYYY-MM-DD`; required — the IPC handler defaults it to today. */
  date: unknown;
  /** Frozen venta rate for the two legs; `null` when none is available. */
  fxRate?: number | null;
}

/**
 * Moves money between two of the user's own accounts by writing TWO live
 * transactions (an expense on the source, an income on the destination) that
 * share a `transfer_group_id` and the reserved `Transferencia` category.
 *
 * Semantics, spelled out:
 *  - `impacts_balance = 1` on both legs → each account's balance moves;
 *  - `TRANSFER_CATEGORY` → excluded from month income/expense totals, the
 *    wheel, budgets and the valued view — a transfer is not an economic event;
 *  - both accounts must share a currency: converting between ARS and USD would
 *    mean inventing an exchange rate inside a bookkeeping move;
 *  - no XP: nobody earned anything by moving their own money around (see
 *    `src/modules/finance/utils/rpg-events.ts`).
 */
export function transferBetweenAccounts(
  db: SqlDatabase,
  input: TransferInput,
): { ok: true; transferGroupId: string; expenseId: string; incomeId: string } | { ok: false; reason: string } {
  const amount = parsePositiveAmount(input?.amount);
  if (amount === null) return { ok: false, reason: 'invalid_amount' };
  if (!isValidDateString(input?.date)) return { ok: false, reason: 'invalid_date' };
  const fromId = parseNonEmptyString(input?.fromId);
  const toId = parseNonEmptyString(input?.toId);
  if (fromId === null || toId === null) return { ok: false, reason: 'account_not_found' };
  if (fromId === toId) return { ok: false, reason: 'same_account' };

  const getAccount = db.prepare(
    'SELECT id, name, currency FROM finance_accounts WHERE id = ? AND deleted_at IS NULL'
  );
  const from = getAccount.get(fromId) as { id: string; name: string; currency: string } | undefined;
  const to = getAccount.get(toId) as { id: string; name: string; currency: string } | undefined;
  if (!from || !to) return { ok: false, reason: 'account_not_found' };
  if (from.currency !== to.currency) return { ok: false, reason: 'transfer_currency_mismatch' };

  const now = nowIso();
  const transferGroupId = genId();
  const expenseId = genId();
  const incomeId = genId();
  const fxRate = typeof input.fxRate === 'number' && Number.isFinite(input.fxRate) && input.fxRate > 0
    ? input.fxRate
    : null;

  const fxRateSource = fxRate === null ? null : fxRateSourceFor(input.date);

  const insert = db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source, account_id,
       transfer_group_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'transfer', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?, ?, ?, ?, ?)
  `);

  const trx = db.transaction(() => {
    insert.run(
      expenseId, 'expense', amount, from.currency, TRANSFER_CATEGORY,
      `Transferencia a ${to.name}`, input.date, fxRate, fxRateSource, from.id, transferGroupId, now, now,
    );
    insert.run(
      incomeId, 'income', amount, to.currency, TRANSFER_CATEGORY,
      `Transferencia desde ${from.name}`, input.date, fxRate, fxRateSource, to.id, transferGroupId, now, now,
    );
  });
  trx();

  return { ok: true, transferGroupId, expenseId, incomeId };
}
