/**
 * Recurring generation used to run on *every* mount of the dashboard and the
 * ledger — the app wrote rows to the database just because you opened a screen,
 * and the totals then moved on their own on the next visit.
 *
 * This runs it at most once per calendar month per account, de-duplicates
 * concurrent callers, and tells the caller whether anything was actually
 * written so the screen can refresh instead of showing a stale total.
 */

const STORAGE_KEY = 'coinify_recurring_generated_month';

let inflight: Promise<boolean> | null = null;

/**
 * @returns `true` when this call generated the month's recurring rows (the
 *          caller should reload), `false` when it was already done.
 */
export function ensureRecurringGenerated(month: string): Promise<boolean> {
  try {
    if (localStorage.getItem(STORAGE_KEY) === month) return Promise.resolve(false);
  } catch {
    // localStorage unavailable — fall through and generate.
  }

  if (inflight) return inflight;

  inflight = window.api
    .financeGenerateRecurringForMonth(month)
    .then(() => {
      try {
        localStorage.setItem(STORAGE_KEY, month);
      } catch {
        // ignore
      }
      return true;
    })
    .catch((err: unknown) => {
      console.error('[finance] financeGenerateRecurringForMonth failed:', err);
      return false;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Switching accounts means the other account may not have its month generated. */
export function resetRecurringGuard(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** `YYYY-MM` for the real current month (never the navigated one). */
export function realCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
