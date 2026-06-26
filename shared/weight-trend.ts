// Pure helpers for smoothing a body-weight series and deriving its trend.
// No Electron / DB / React imports here so the main process, the renderer and
// the tests can all share the exact same math.
//
// WHY THIS EXISTS
// Raw body weight swings day to day (and week to week) from water, sodium and
// glycogen — not fat. Showing only the latest reading is demotivating: a +1 kg
// water bump after a salty meal reads as "failure" even mid-deficit. An
// exponential moving average (EMA) filters that noise and surfaces the REAL
// underlying trend, which is what we report instead.

export interface WeightPoint {
  date: string; // YYYY-MM-DD, expected sorted ascending by the caller
  weightKg: number;
}

export interface SmoothedWeightPoint {
  date: string;
  raw: number; // the original measured weight
  trend: number; // the EMA-smoothed weight at this point
}

export type WeightDirection = 'rising' | 'falling' | 'stable';

export interface WeightTrendSummary {
  direction: WeightDirection;
  /** Net smoothed change across the window (trendEnd - trendStart), kg. */
  deltaKg: number;
  /** Average smoothed rate of change, kg per week. */
  kgPerWeek: number;
  /** First smoothed value of the window. */
  trendStart: number;
  /** Last smoothed value — the best estimate of the "true" current weight. */
  trendEnd: number;
}

/**
 * Default EMA smoothing factor.
 *
 * The weight table stores ONE weigh-in per week (`nutrition_weekly_metrics`), so
 * a range holds very few points: ~4 in the 30d view, ~13 in 90d, ~52 in a year.
 * That rules out a long fixed window — it would lag badly on the short ranges and
 * barely react on a flat series. Too short and the water/sodium/glycogen noise
 * leaks straight through.
 *
 * We use alpha = 2 / (span + 1) with span = 4 → alpha = 0.4, i.e. a ~4-week
 * (≈1 month) effective window. That is long enough to absorb a typical multi-day
 * water swing yet short enough that, even with only 4 points, the trend still
 * tracks the recent direction. The EMA is seeded with the first observation.
 */
export const DEFAULT_WEIGHT_EMA_ALPHA = 0.4;

/**
 * Below this absolute weekly rate the trend reads as "stable": ~0.1 kg/week is
 * within normal measurement noise, so we don't claim a direction the data can't
 * support (and we avoid a punitive "you gained" message over pure noise).
 */
export const STABLE_KG_PER_WEEK = 0.1;

function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha <= 0) return DEFAULT_WEIGHT_EMA_ALPHA;
  return Math.min(1, alpha);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Calendar days between two YYYY-MM-DD strings (noon-anchored to dodge DST). */
function daysBetween(aDate: string, bDate: string): number {
  const a = new Date(aDate + 'T12:00:00').getTime();
  const b = new Date(bDate + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / (1000 * 60 * 60 * 24);
}

/**
 * Smooth a weight series with an exponential moving average.
 *
 * Each output point keeps both the `raw` reading (for faint markers) and the
 * `trend` value (for the headline line). Invalid / non-finite entries are
 * dropped. The EMA is seeded with the first valid reading so `trend[0] === raw[0]`.
 *
 * EMA recurrence: `ema_i = alpha * raw_i + (1 - alpha) * ema_{i-1}`.
 */
export function smoothWeightSeries(
  points: WeightPoint[],
  alpha: number = DEFAULT_WEIGHT_EMA_ALPHA,
): SmoothedWeightPoint[] {
  const a = clampAlpha(alpha);
  const valid = (points ?? []).filter(
    (p): p is WeightPoint => !!p && typeof p.date === 'string' && Number.isFinite(p.weightKg),
  );
  if (valid.length === 0) return [];

  const out: SmoothedWeightPoint[] = [];
  let ema = valid[0].weightKg;
  for (let i = 0; i < valid.length; i++) {
    const w = valid[i].weightKg;
    ema = i === 0 ? w : a * w + (1 - a) * ema;
    out.push({ date: valid[i].date, raw: w, trend: ema });
  }
  return out;
}

/**
 * Derive the trend direction and rate from a weight series.
 *
 * Returns `null` when there are fewer than 2 valid points (no trend can exist).
 * Direction and rate are computed from the SMOOTHED endpoints, not the raw
 * readings, so a single noisy weigh-in can't flip the verdict. The rate is
 * date-accurate (kg per actual week elapsed), tolerating skipped weeks.
 */
export function weightTrendSummary(
  points: WeightPoint[],
  alpha: number = DEFAULT_WEIGHT_EMA_ALPHA,
): WeightTrendSummary | null {
  const smoothed = smoothWeightSeries(points, alpha);
  if (smoothed.length < 2) return null;

  const first = smoothed[0];
  const last = smoothed[smoothed.length - 1];
  const deltaKg = last.trend - first.trend;
  const days = Math.max(1, daysBetween(first.date, last.date));
  const kgPerWeek = deltaKg / (days / 7);

  let direction: WeightDirection = 'stable';
  if (kgPerWeek > STABLE_KG_PER_WEEK) direction = 'rising';
  else if (kgPerWeek < -STABLE_KG_PER_WEEK) direction = 'falling';

  return {
    direction,
    deltaKg: round1(deltaKg),
    kgPerWeek: round2(kgPerWeek),
    trendStart: round1(first.trend),
    trendEnd: round1(last.trend),
  };
}
