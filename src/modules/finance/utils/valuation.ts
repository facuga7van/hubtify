/**
 * Pure valuation math for the ARS → USD → "ARS de hoy" display modes.
 *
 * This file is deliberately environment-free (no `window`, no `electron`, no
 * database): it is imported both by the renderer (per-row conversion in the
 * ledger) and by `electron/modules/finance.balance.ts` (aggregate conversion
 * for the dashboard), so the two can never disagree on the arithmetic.
 *
 * ── The three modes ────────────────────────────────────────────────────────
 *  `ars`       — nominal pesos, exactly as recorded. The historical default.
 *  `usd`       — every ARS amount re-expressed in dollars using ITS OWN frozen
 *                `fx_rate` (the venta rate the day it was recorded). A row
 *                without a frozen rate falls back to the CURRENT rate and is
 *                flagged approximate (`~`). USD rows pass through untouched.
 *  `ars-today` — every ARS amount re-expressed in today's pesos multiplying by
 *                the cumulative INDEC IPC coefficient since its month
 *                (latestIndex / monthIndex). Months newer than the latest
 *                published index (IPC lags ~1 month) count as today's pesos
 *                (coefficient 1); months older than the series are left nominal
 *                and flagged.
 */

export type DisplayMode = 'ars' | 'usd' | 'ars-today';

export const DISPLAY_MODES: readonly DisplayMode[] = ['ars', 'usd', 'ars-today'];

/**
 * Next mode in the ARS → USD → ARS de hoy cycle. When the inflation series is
 * not reachable (bridge not wired, or the API never answered), `ars-today`
 * would be a button that lies, so the cycle skips it.
 */
export function nextDisplayMode(mode: DisplayMode, opts: { inflationAvailable: boolean }): DisplayMode {
  if (mode === 'ars') return 'usd';
  if (mode === 'usd') return opts.inflationAvailable ? 'ars-today' : 'ars';
  return 'ars';
}

// ── IPC (inflation) coefficients ───────────────────────────────────────────

/** One monthly point of the INDEC IPC index (nivel general nacional). */
export interface IpcSeriesPoint {
  /** `YYYY-MM`. */
  month: string;
  /** Index value, base dic-2016 = 100. */
  index: number;
}

export interface IpcCoefficients {
  /** `YYYY-MM` of the newest published index. */
  latestMonth: string;
  /** month → cumulative coefficient to `latestMonth` (latestIndex / monthIndex). */
  byMonth: Map<string, number>;
}

/**
 * Cumulative coefficient per month: multiplying a nominal amount of `month` by
 * `byMonth.get(month)` re-expresses it in pesos of `latestMonth`.
 * Returns `null` for an empty or invalid series.
 */
export function buildIpcCoefficients(series: IpcSeriesPoint[] | null | undefined): IpcCoefficients | null {
  if (!series || series.length === 0) return null;
  const clean = series.filter((p) => /^\d{4}-\d{2}$/.test(p.month) && Number.isFinite(p.index) && p.index > 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted[sorted.length - 1];
  const byMonth = new Map<string, number>();
  for (const p of sorted) byMonth.set(p.month, latest.index / p.index);
  return { latestMonth: latest.month, byMonth };
}

/**
 * Coefficient for one month.
 *  - month within the series → its cumulative coefficient;
 *  - month after the latest index (the IPC lags) → 1 (already today's pesos);
 *  - month before the series starts → `null` (no honest number exists).
 */
export function coefficientForMonth(coefs: IpcCoefficients, month: string): number | null {
  const exact = coefs.byMonth.get(month);
  if (exact !== undefined) return exact;
  if (month > coefs.latestMonth) return 1;
  return null;
}

// ── Conversions ────────────────────────────────────────────────────────────

export interface ConvertedAmount {
  value: number;
  currency: 'ARS' | 'USD';
  /** True when the conversion used a fallback (current rate / nominal pesos). */
  approx: boolean;
}

/**
 * ARS → USD with the row's own frozen rate, falling back to the current rate.
 * Returns `null` when neither rate exists (the amount cannot be expressed in
 * dollars at all — show it nominal instead of inventing a number).
 */
export function convertArsToUsd(
  amount: number,
  fxRate: number | null | undefined,
  currentRate: number | null | undefined,
): { value: number; approx: boolean } | null {
  const own = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
  const fallback = typeof currentRate === 'number' && Number.isFinite(currentRate) && currentRate > 0 ? currentRate : null;
  const rate = own ?? fallback;
  if (rate === null) return null;
  return { value: amount / rate, approx: own === null };
}

/**
 * ARS of `month` → pesos of the latest IPC month. A month older than the series
 * stays nominal and is flagged approximate.
 */
export function convertArsToToday(
  amount: number,
  month: string,
  coefs: IpcCoefficients | null,
): { value: number; approx: boolean } {
  if (!coefs) return { value: amount, approx: true };
  const coef = coefficientForMonth(coefs, month);
  if (coef === null) return { value: amount, approx: true };
  return { value: amount * coef, approx: false };
}

/**
 * How one transaction amount reads under a display mode.
 * USD rows are never touched: they are already hard currency.
 */
export function convertTransactionAmount(
  tx: { amount: number; currency: string; fxRate?: number | null; date: string },
  mode: DisplayMode,
  ctx: { currentRate: number | null; coefs: IpcCoefficients | null },
): ConvertedAmount {
  if (tx.currency === 'USD' || mode === 'ars') {
    return { value: tx.amount, currency: tx.currency === 'USD' ? 'USD' : 'ARS', approx: false };
  }
  if (mode === 'usd') {
    const usd = convertArsToUsd(tx.amount, tx.fxRate ?? null, ctx.currentRate);
    if (usd === null) return { value: tx.amount, currency: 'ARS', approx: true };
    return { value: usd.value, currency: 'USD', approx: usd.approx };
  }
  const today = convertArsToToday(tx.amount, tx.date.slice(0, 7), ctx.coefs);
  return { value: today.value, currency: 'ARS', approx: today.approx };
}

// ── Trend ──────────────────────────────────────────────────────────────────

/**
 * "% vs mes anterior", nominal and real.
 *
 * Real: both months are re-expressed in the same (latest) pesos before
 * comparing, so a month whose spending only kept pace with inflation shows
 * ~0% real, not the inflation itself. `realPct` is `null` when either month
 * lacks a coefficient.
 */
export function nominalAndRealTrend(
  currExpenses: number,
  prevExpenses: number,
  currCoef: number | null,
  prevCoef: number | null,
): { nominalPct: number | null; realPct: number | null } {
  // `|| 0` erases Math.round's negative zero — nobody wants to read "-0%".
  const nominalPct = prevExpenses > 0
    ? Math.round(((currExpenses - prevExpenses) / prevExpenses) * 100) || 0
    : null;
  let realPct: number | null = null;
  if (prevExpenses > 0 && currCoef !== null && prevCoef !== null) {
    const currReal = currExpenses * currCoef;
    const prevReal = prevExpenses * prevCoef;
    if (prevReal > 0) realPct = Math.round(((currReal - prevReal) / prevReal) * 100) || 0;
  }
  return { nominalPct, realPct };
}
