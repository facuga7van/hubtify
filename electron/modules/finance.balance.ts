import type Database from 'better-sqlite3';
import type { ExpenseBreakdown, ExpenseBreakdownByCurrency } from '../../shared/types';

export type { ExpenseBreakdown, ExpenseBreakdownByCurrency };

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
export function generateRecurringForMonth(db: Database.Database, month: string): number {
  if (!isValidMonthString(month)) return 0;

  const actives = db.prepare(`
    SELECT id, name, type, amount, currency, category, billing_day AS billingDay
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
       import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'recurring', 1, NULL, 0, ?, NULL, NULL, 1, ?, ?)
  `);

  const now = nowIso();

  const run = db.transaction(() => {
    let generated = 0;
    for (const rec of actives) {
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
        now,
        now,
      );
      if (result.changes > 0) generated++;
    }
    return generated;
  });

  return run();
}
