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
 *
 * The `1` of an unpublished month is an ASSUMPTION, not data — use
 * {@link coefficientDetail} wherever the difference matters (the "real" trend,
 * the `~` mark).
 */
export function coefficientForMonth(coefs: IpcCoefficients, month: string): number | null {
  return coefficientDetail(coefs, month)?.coef ?? null;
}

/**
 * Same as {@link coefficientForMonth}, but says whether the number is an index
 * INDEC actually published (`assumed: false`) or the placeholder `1` of a month
 * the IPC has not reached yet (`assumed: true`).
 *
 * The current month never has an index (INDEC publishes mid next month), and
 * the previous one only after the ~12th. Treating that placeholder as data made
 * "real +X%" ALWAYS equal the nominal figure for the month on screen.
 */
export function coefficientDetail(
  coefs: IpcCoefficients,
  month: string,
): { coef: number; assumed: boolean } | null {
  const exact = coefs.byMonth.get(month);
  if (exact !== undefined) return { coef: exact, assumed: false };
  if (month > coefs.latestMonth) return { coef: 1, assumed: true };
  return null;
}

// ── Frozen-rate provenance ─────────────────────────────────────────────────

/**
 * Where a row's `fx_rate` came from (`finance_transactions.fx_rate_source`):
 *  `day`      — the rate of the transaction's own date. The only exact one.
 *  `process`  — the rate of the day a PROCESS wrote the row (import, recurring
 *               generation, statement payment, a manual entry with a past date).
 *  `backfill` — today's rate pasted over an old row because the historical
 *               series was not reachable.
 * `null` is legacy data (pre-column) and reads as exact so the whole history is
 * not flagged at once.
 */
export type FxRateSource = 'day' | 'process' | 'backfill';

/** Does this provenance deserve to be shown WITHOUT the `~` mark? */
export function isExactFxSource(source: string | null | undefined): boolean {
  return source == null || source === 'day';
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
 *
 * `approx` is true when the current rate had to stand in, AND when the frozen
 * rate is not the rate of the transaction's own day (see {@link FxRateSource}):
 * a backfill that pasted today's rate over a two-year-old row is a frozen
 * number, not a frozen truth, and must keep its `~`.
 */
export function convertArsToUsd(
  amount: number,
  fxRate: number | null | undefined,
  currentRate: number | null | undefined,
  fxRateSource?: string | null,
): { value: number; approx: boolean } | null {
  const own = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
  const fallback = typeof currentRate === 'number' && Number.isFinite(currentRate) && currentRate > 0 ? currentRate : null;
  const rate = own ?? fallback;
  if (rate === null) return null;
  return { value: amount / rate, approx: own === null || !isExactFxSource(fxRateSource) };
}

/**
 * USD → ARS with the row's own frozen rate, falling back to the current rate.
 * The exact mirror of {@link convertArsToUsd}: same source of truth (the rate
 * frozen the day the row was written), same fallback, same `approx` rule — the
 * only difference is that it multiplies instead of dividing.
 *
 * The asymmetry it kills: a dollar income used to be EXCLUDED from every peso
 * aggregate instead of converted, so someone paid in dollars saw none of that
 * money on the peso side of the app.
 */
export function convertUsdToArs(
  amount: number,
  fxRate: number | null | undefined,
  currentRate: number | null | undefined,
  fxRateSource?: string | null,
): { value: number; approx: boolean } | null {
  const own = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
  const fallback = typeof currentRate === 'number' && Number.isFinite(currentRate) && currentRate > 0 ? currentRate : null;
  const rate = own ?? fallback;
  if (rate === null) return null;
  return { value: amount * rate, approx: own === null || !isExactFxSource(fxRateSource) };
}

/** The two currencies every finance figure can be expressed in. */
export type ValuationCurrency = 'ARS' | 'USD';

/** The minimum a row must carry to be re-expressed in the other currency. */
export interface FxConvertibleRow {
  amount: number;
  currency: string;
  fxRate?: number | null;
  fxRateSource?: string | null;
}

/**
 * One row re-expressed in `target`, whichever way it has to travel.
 *
 * The single entry point for currency conversion so ARS→USD and USD→ARS can
 * never drift apart: a row already in the target currency passes through exact
 * (no rate is involved, so nothing can be approximate), and anything else goes
 * through {@link convertArsToUsd} / {@link convertUsdToArs}. `null` means the
 * amount cannot be expressed in `target` at all — no frozen rate, no current
 * rate — and the caller must say so rather than invent a number.
 *
 * Anything other than `'USD'` is treated as pesos, matching the rest of the
 * module (`currency` is a free TEXT column; only 'ARS' and 'USD' are written).
 */
export function convertRowToCurrency(
  row: FxConvertibleRow,
  target: ValuationCurrency,
  currentRate: number | null | undefined,
): { value: number; approx: boolean } | null {
  const from: ValuationCurrency = row.currency === 'USD' ? 'USD' : 'ARS';
  if (from === target) return { value: row.amount, approx: false };
  return from === 'ARS'
    ? convertArsToUsd(row.amount, row.fxRate, currentRate, row.fxRateSource)
    : convertUsdToArs(row.amount, row.fxRate, currentRate, row.fxRateSource);
}

/**
 * ARS of `month` → pesos of the latest IPC month. A month older than the series
 * stays nominal and is flagged approximate; so is a month NEWER than the latest
 * published index (its coefficient of 1 is an assumption, not INDEC data).
 */
export function convertArsToToday(
  amount: number,
  month: string,
  coefs: IpcCoefficients | null,
): { value: number; approx: boolean } {
  if (!coefs) return { value: amount, approx: true };
  const detail = coefficientDetail(coefs, month);
  if (detail === null) return { value: amount, approx: true };
  return { value: amount * detail.coef, approx: detail.assumed };
}

/**
 * How one transaction amount reads under a display mode.
 *
 *  `ars`       — nominal, in the currency it was recorded in. A dollar row
 *                stays `US$ 50`: this mode promises no conversion at all, and
 *                the ledger prints the figure the user typed.
 *  `usd`       — everything in dollars: a peso row divided by its frozen rate,
 *                a dollar row untouched.
 *  `ars-today` — everything in today's pesos: a dollar row is FIRST brought to
 *                the pesos of its own date (× its frozen rate) and only then
 *                inflated by the IPC coefficient of its month. Doing it the
 *                other way round would inflate dollars, which have no IPC.
 *
 * Symmetry is the point: whatever `usd` does to a peso row, `ars-today` does
 * to a dollar row with the very same frozen rate.
 */
export function convertTransactionAmount(
  tx: { amount: number; currency: string; fxRate?: number | null; fxRateSource?: string | null; date: string },
  mode: DisplayMode,
  ctx: { currentRate: number | null; coefs: IpcCoefficients | null },
): ConvertedAmount {
  const isUsdRow = tx.currency === 'USD';
  if (mode === 'ars') {
    return { value: tx.amount, currency: isUsdRow ? 'USD' : 'ARS', approx: false };
  }
  if (mode === 'usd') {
    const usd = convertRowToCurrency(tx, 'USD', ctx.currentRate);
    if (usd === null) return { value: tx.amount, currency: 'ARS', approx: true };
    return { value: usd.value, currency: 'USD', approx: usd.approx };
  }
  const ars = convertRowToCurrency(tx, 'ARS', ctx.currentRate);
  // No rate anywhere: the dollars cannot become pesos, so they stay dollars
  // rather than being printed as a peso figure they are not.
  if (ars === null) return { value: tx.amount, currency: 'USD', approx: true };
  const today = convertArsToToday(ars.value, tx.date.slice(0, 7), ctx.coefs);
  return { value: today.value, currency: 'ARS', approx: ars.approx || today.approx };
}

// ── Trend ──────────────────────────────────────────────────────────────────

/**
 * "% vs mes anterior", nominal and real.
 *
 * Real: both months are re-expressed in the same (latest) pesos before
 * comparing, so a month whose spending only kept pace with inflation shows
 * ~0% real, not the inflation itself. `realPct` is `null` when either month
 * lacks a coefficient — callers must pass `null` for an ASSUMED coefficient
 * too (see {@link coefficientDetail}); an assumed 1 would print the nominal
 * figure twice and call one of them "real".
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
