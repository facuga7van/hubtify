/**
 * The two moments a budget speaks up, and the localStorage guards that keep each
 * of them to exactly one appearance.
 *
 * Design rule this file exists to enforce: **a budget nags at most once, and only
 * ever congratulates.** A limit blown is mentioned once, on the load that
 * crossed it, with no HP damage. A month missed is mentioned NEVER — the new
 * month starts clean, with no post-mortem of the failure.
 */

import { getBudgetStatus } from './api-ext';
import { emitBudgetMonthMet } from './rpg-events';

/** One flag per category-month, so "you blew Delivery" is said once, not per load. */
const OVERFLOW_KEY = (month: string, category: string) =>
  `coinify_budget_overflow:${month}:${category}`;

/** The last month the dashboard was opened in — the month-rollover detector. */
const LAST_SEEN_MONTH_KEY = 'coinify_budget_last_seen_month';

/** One flag per closed month, so the celebration cannot fire twice. */
const MONTH_MET_KEY = (month: string) => `coinify_budget_month_met:${month}`;

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // localStorage unavailable — worst case the message repeats. Never fatal.
  }
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Called right after a manual expense is saved.
 *
 * @returns the category name when THIS load is the one that crossed its monthly
 *          limit and the crossing has not been announced yet; `null` otherwise
 *          (no budget, still inside it, already said, or no bridge).
 */
export async function checkBudgetOverflow(
  month: string,
  category: string,
): Promise<string | null> {
  const key = OVERFLOW_KEY(month, category);
  if (readFlag(key)) return null;

  const status = await getBudgetStatus(month);
  // Un main viejo (o un handler que devuelve otra forma) hacía explotar esto
  // con «Cannot read properties of undefined (reading 'find')».
  const entry = Array.isArray(status?.categories)
    ? status.categories.find((c) => c.category === category)
    : undefined;
  if (!entry || entry.spent <= entry.limit) return null;

  writeFlag(key);
  return category;
}

/**
 * Month-close check, run when the dashboard mounts — the same "did the month
 * roll over?" trick `ensure-recurring` uses, comparing against the last month
 * this browser profile saw.
 *
 * If the PREVIOUS month had at least one budget and every budgeted category
 * closed inside its limit, `BUDGET_MONTH_MET` is emitted (100 XP) and the caller
 * gets the month + the XP actually granted, for the celebration.
 *
 * If it was not met, this returns `null` and says nothing. That silence is the
 * feature: no summary of the failure, no "you were 12% over on Delivery". The
 * month is over, and the new one starts clean.
 *
 * @returns `{ month, xpGained }` on a met month, `null` on anything else.
 */
export async function checkBudgetMonthClose(
  currentMonth: string,
): Promise<{ month: string; xpGained: number } | null> {
  let lastSeen: string | null = null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_MONTH_KEY);
  } catch {
    // ignore
  }

  // Always record the visit, whatever the outcome, so this runs once a month.
  try {
    localStorage.setItem(LAST_SEEN_MONTH_KEY, currentMonth);
  } catch {
    // ignore
  }

  if (lastSeen === currentMonth) return null;

  const closedMonth = addMonths(currentMonth, -1);
  if (readFlag(MONTH_MET_KEY(closedMonth))) return null;

  const status = await getBudgetStatus(closedMonth);
  // No bridge, or a month with nothing to respect: a month cannot be "kept
  // inside" limits that were never set, and paying 100 XP for an empty
  // configuration would make the reward worthless.
  if (!status || !Array.isArray(status.categories) || status.categories.length === 0) return null;
  if (!status.categories.every((c) => c.spent <= c.limit)) return null;

  writeFlag(MONTH_MET_KEY(closedMonth));

  const result = await emitBudgetMonthMet(closedMonth);
  // The engine de-duplicates on ref_id = month anyway, so a failed emission that
  // leaves the flag set costs at most one missed celebration, never double XP.
  if (!result) return null;

  return { month: closedMonth, xpGained: result.xpGained };
}

/**
 * Switching accounts means every guard above belongs to somebody else's data:
 * the other account may have budgets this one does not, and its month-close was
 * never evaluated on this machine.
 */
export function resetBudgetGuards(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('coinify_budget_overflow:') || key.startsWith('coinify_budget_month_met:'))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) localStorage.removeItem(key);
    localStorage.removeItem(LAST_SEEN_MONTH_KEY);
  } catch {
    // ignore
  }
}
