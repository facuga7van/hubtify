import type Database from 'better-sqlite3';
import type { ExpenseBreakdown, ExpenseBreakdownByCurrency } from '../../shared/types';
import {
  buildIpcCoefficients,
  coefficientForMonth,
  convertArsToUsd,
  nominalAndRealTrend,
  type IpcCoefficients,
  type IpcSeriesPoint,
} from '../../src/modules/finance/utils/valuation';

export type { ExpenseBreakdown, ExpenseBreakdownByCurrency };
export type { IpcCoefficients, IpcSeriesPoint };

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

/** Categories the app writes on its own. The user may see them in reports but
 *  must never be able to file a manual transaction under one. */
export const RESERVED_CATEGORIES = [CARD_PAYMENT_CATEGORY, CARD_TAX_CATEGORY] as const;

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
export function sumByCurrency(db: Database.Database, f: TransactionFilter): CurrencyTotals {
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
  db: Database.Database,
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
export function aggregateByCategory(db: Database.Database, f: TransactionFilter): CategoryTotals[] {
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
export function computeMonthlyBalance(db: Database.Database, month: string): MonthlyBalanceByCurrency {
  const { start, end } = monthRange(month);
  return sumIncomeExpenseByCurrency(db, { start, end, balanceScope: 'impacting' });
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
    excludeCategories: [CARD_PAYMENT_CATEGORY],
  };
}

/** Category spend for a range, using {@link categorySpendFilter}. */
export function computeCategorySpend(
  db: Database.Database,
  range: { start: string; end: string },
): CategoryTotals[] {
  return aggregateByCategory(db, categorySpendFilter(range));
}

/**
 * Named, explicit answer to "how much did I spend?", so the UI never has to
 * guess which of the three historical definitions a number came from.
 */
export function computeExpenseBreakdown(
  db: Database.Database,
  range: { start: string; end: string },
): ExpenseBreakdownByCurrency {
  const base = { ...range, type: 'expense' as const, excludeCategories: [CARD_PAYMENT_CATEGORY] };

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
  db: Database.Database,
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
           frequency, created_at AS createdAt
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

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, credit_card_id, impacts_balance, fx_rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'recurring', 1, NULL, 0, ?, NULL, NULL, 1, ?, ?, ?)
  `);

  const now = nowIso();
  const fxRate = typeof opts.fxRate === 'number' && Number.isFinite(opts.fxRate) && opts.fxRate > 0
    ? opts.fxRate
    : null;

  const run = db.transaction(() => {
    let generated = 0;
    for (const rec of actives) {
      // Non-monthly cadences only bill on their own months, anchored on the
      // month the template was created (see isRecurringDueInMonth).
      if (!isRecurringDueInMonth(rec.frequency, (rec.createdAt ?? '').slice(0, 7), month)) continue;

      // Guard includes soft-deleted rows on purpose: if the user deleted this
      // month's instance by hand, do not bring it back next launch.
      const existing = existsStmt.get(rec.id, start, end) as { c: number };
      if (existing.c > 0) continue;

      const result = insertStmt.run(
        recurringTransactionId(rec.id, month),
        rec.type,
        rec.amount,
        rec.currency ?? 'ARS',
        rec.category ?? 'Otros',
        rec.name,
        dateInMonthClamped(month, rec.billingDay ?? 1),
        rec.id,
        fxRate,
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
export function listBudgets(db: Database.Database): BudgetRow[] {
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
  db: Database.Database,
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
export function computeBudgetStatus(db: Database.Database, month: string): BudgetStatus {
  if (!isValidMonthString(month)) return EMPTY_BUDGET_STATUS(month);

  const budgets = listBudgets(db);
  if (budgets.length === 0) return EMPTY_BUDGET_STATUS(month);

  const spendByCategory = new Map(
    computeCategorySpend(db, monthRange(month)).map((c) => [c.category, c.ARS]),
  );

  const categories: BudgetCategoryStatus[] = budgets.map((b) => {
    const spent = spendByCategory.get(b.category) ?? 0;
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
    totalLimit: categories.reduce((sum, c) => sum + c.limit, 0),
    totalSpent: categories.reduce((sum, c) => sum + c.spent, 0),
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
  return status.categories.every((c) => c.spent <= c.limit);
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
export function getFxHouse(db: Database.Database): string {
  try {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'fx_house'").get() as { value: string } | undefined;
    const value = row?.value?.trim();
    return value ? value : DEFAULT_FX_HOUSE;
  } catch {
    return DEFAULT_FX_HOUSE;
  }
}

export function setFxHouse(db: Database.Database, house: unknown): { ok: true; house: string } | { ok: false; reason: string } {
  const value = parseNonEmptyString(house);
  if (value === null) return { ok: false, reason: 'invalid_house' };
  db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('fx_house', ?)").run(value.toLowerCase());
  return { ok: true, house: value.toLowerCase() };
}

/** The `dollar_cache` row `dollar:getRates` also uses — one cache, two readers. */
export function readDollarRatesCache(
  db: Database.Database,
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

export function writeDollarRatesCache(db: Database.Database, rates: DollarApiRate[]): void {
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
  db: Database.Database,
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
 * `updated_at` is bumped on purpose — without it, last-write-wins sync would
 * never carry the backfilled value to the other devices.
 */
export function backfillFxRates(db: Database.Database, rate: number): number {
  const parsed = parsePositiveAmount(rate);
  if (parsed === null) return 0;
  const result = db.prepare(`
    UPDATE finance_transactions
    SET fx_rate = ?, updated_at = ?
    WHERE fx_rate IS NULL AND deleted_at IS NULL
  `).run(parsed, nowIso());
  return result.changes;
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
  db: Database.Database,
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

export function writeIpcSeriesCache(db: Database.Database, series: IpcSeriesPoint[]): void {
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
  db: Database.Database,
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
  /** Expenses vs previous month, ARS impacting — nominal and inflation-adjusted. */
  trend: { nominalPct: number | null; realPct: number | null };
}

interface FxRow { amount: number; fxRate: number | null }

/** Sum of ARS rows in dollars, each with its own frozen rate. */
function sumUsd(rows: FxRow[], currentRate: number): { total: number; approx: boolean } {
  let total = 0;
  let approx = false;
  for (const row of rows) {
    const usd = convertArsToUsd(row.amount, row.fxRate, currentRate);
    if (usd === null) { approx = true; continue; }
    total += usd.value;
    if (usd.approx) approx = true;
  }
  return { total, approx };
}

/**
 * The dashboard, re-expressed. Same row-selection definitions as the nominal
 * handlers on purpose (`impacting` for balances and the sparkline,
 * {@link categorySpendFilter} for the wheel) so switching mode changes the
 * unit, never which transactions count.
 *
 * USD: each ARS amount uses ITS OWN frozen `fx_rate`; a row without one uses
 * `currentRate` and flips `approx`. ARS de hoy: nominal per-month totals times
 * the cumulative IPC coefficient of their month (all rows of a month share it).
 */
export function computeValuedView(
  db: Database.Database,
  month: string,
  ctx: { currentRate: number | null; house: string; series: IpcSeriesPoint[] | null },
): ValuedView {
  const { start, end } = monthRange(month);
  const coefs = buildIpcCoefficients(ctx.series);

  // One row-level query per aggregate the dashboard shows.
  const balanceRows = db.prepare(`
    SELECT type, amount, fx_rate AS fxRate
    FROM finance_transactions
    WHERE deleted_at IS NULL AND date >= ? AND date < ?
      AND impacts_balance = 1 AND currency = 'ARS'
  `).all(start, end) as Array<{ type: string; amount: number; fxRate: number | null }>;

  const sparkStart = monthRange(addMonthsToMonth(month, -5)).start;
  const sparkRows = db.prepare(`
    SELECT amount, fx_rate AS fxRate, SUBSTR(date, 1, 7) AS m
    FROM finance_transactions
    WHERE deleted_at IS NULL AND date >= ? AND date < ?
      AND type = 'expense' AND impacts_balance = 1 AND currency = 'ARS'
  `).all(sparkStart, end) as Array<{ amount: number; fxRate: number | null; m: string }>;

  const catWhere = buildTransactionWhere({ ...categorySpendFilter({ start, end }), currency: 'ARS' });
  const catRows = db.prepare(`
    SELECT category, amount, fx_rate AS fxRate
    FROM finance_transactions
    WHERE ${catWhere.where}
  `).all(...catWhere.params) as Array<{ category: string; amount: number; fxRate: number | null }>;

  const sparkMonths: string[] = [];
  for (let i = 5; i >= 0; i--) sparkMonths.push(addMonthsToMonth(month, -i));

  // ── USD ──
  let usd: ValuedAggregates | null = null;
  if (ctx.currentRate !== null && ctx.currentRate > 0) {
    const income = sumUsd(balanceRows.filter((r) => r.type === 'income'), ctx.currentRate);
    const expenses = sumUsd(balanceRows.filter((r) => r.type === 'expense'), ctx.currentRate);
    const spark = sparkMonths.map((m) => sumUsd(sparkRows.filter((r) => r.m === m), ctx.currentRate!));
    const catMap = new Map<string, FxRow[]>();
    for (const r of catRows) {
      const list = catMap.get(r.category) ?? [];
      list.push(r);
      catMap.set(r.category, list);
    }
    let approx = income.approx || expenses.approx || spark.some((s) => s.approx);
    const categories = Array.from(catMap.entries()).map(([category, rows]) => {
      const sum = sumUsd(rows, ctx.currentRate!);
      if (sum.approx) approx = true;
      return { category, value: sum.total };
    }).sort((a, b) => b.value - a.value);

    usd = {
      balance: {
        income: income.total,
        expenses: expenses.total,
        balance: income.total - expenses.total,
      },
      monthlyExpenses: spark.map((s) => s.total),
      categories,
      approx,
    };
  }

  // ── ARS de hoy ──
  let arsToday: (ValuedAggregates & { latestIpcMonth: string }) | null = null;
  if (coefs) {
    const monthCoef = coefficientForMonth(coefs, month);
    const applyCoef = (nominal: number, coef: number | null) => coef === null ? nominal : nominal * coef;
    let approx = monthCoef === null;

    const nominalIncome = balanceRows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const nominalExpenses = balanceRows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const income = applyCoef(nominalIncome, monthCoef);
    const expenses = applyCoef(nominalExpenses, monthCoef);

    const monthlyExpenses = sparkMonths.map((m) => {
      const coef = coefficientForMonth(coefs, m);
      if (coef === null) approx = true;
      const nominal = sparkRows.filter((r) => r.m === m).reduce((s, r) => s + r.amount, 0);
      return applyCoef(nominal, coef);
    });

    const catTotals = new Map<string, number>();
    for (const r of catRows) catTotals.set(r.category, (catTotals.get(r.category) ?? 0) + r.amount);
    const categories = Array.from(catTotals.entries())
      .map(([category, nominal]) => ({ category, value: applyCoef(nominal, monthCoef) }))
      .sort((a, b) => b.value - a.value);

    arsToday = {
      balance: { income, expenses, balance: income - expenses },
      monthlyExpenses,
      categories,
      approx,
      latestIpcMonth: coefs.latestMonth,
    };
  }

  // ── Trend (nominal + real) ──
  const prevMonth = addMonthsToMonth(month, -1);
  const currExpenses = balanceRows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const prevExpenses = sumByCurrency(db, {
    ...monthRange(prevMonth),
    type: 'expense',
    currency: 'ARS',
    balanceScope: 'impacting',
  }).ARS;
  const trend = nominalAndRealTrend(
    currExpenses,
    prevExpenses,
    coefs ? coefficientForMonth(coefs, month) : null,
    coefs ? coefficientForMonth(coefs, prevMonth) : null,
  );

  return { month, house: ctx.house, currentRate: ctx.currentRate, usd, arsToday, trend };
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
  db: Database.Database,
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
           frequency, created_at AS createdAt
    FROM finance_recurring
    WHERE deleted_at IS NULL AND active = 1 AND type = 'expense'
  `).all() as Array<{
    id: string; name: string; amount: number; currency: string;
    billingDay: number; frequency: string; createdAt: string;
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
        if (!isRecurringDueInMonth(rec.frequency, (rec.createdAt ?? '').slice(0, 7), m)) continue;
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
