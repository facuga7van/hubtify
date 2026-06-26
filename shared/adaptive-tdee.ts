// Pure helper for the ADAPTIVE (data-derived) TDEE estimate.
// No Electron / DB / React imports here so the main process, the renderer and
// the tests can all share the exact same math.
//
// WHY THIS EXISTS
// The static TDEE (Mifflin-St Jeor BMR × activity factor) is only an ESTIMATE.
// Two people with identical stats can have very different real expenditures
// (NEAT, metabolic adaptation, logging accuracy). The real number, however, can
// be INFERRED from the energy-balance identity: over a span of D days, the change
// in stored body energy equals intake minus expenditure. So if we know how much
// the user ate (logged intake) and how their body mass moved (smoothed weight
// trend), we can solve for the average daily expenditure — their REAL TDEE.
//
// This is an INSIGHT only. It never recalibrates the user's goal automatically
// and never touches the day-close XP/HP math. The renderer surfaces it and lets
// the user APPLY it manually if they want.

import { smoothWeightSeries } from './weight-trend';
import type { WeightPoint } from './weight-trend';

export interface IntakeDay {
  date: string; // YYYY-MM-DD
  calories: number; // total kcal logged that day
}

export type AdaptiveConfidence = 'insufficient' | 'low' | 'medium' | 'high';

export interface AdaptiveTdeeEstimate {
  /** Estimated real daily expenditure in kcal, or null when data is insufficient. */
  tdee: number | null;
  confidence: AdaptiveConfidence;
  /** Actual elapsed days the estimate spans (first → last weigh-in). */
  windowDays: number;
  /** Number of days with logged intake used in the average. */
  sampleDays: number;
  /** Number of weigh-ins used to derive the weight trend. */
  weightSamples: number;
  /** Average daily intake over the logged days in the window, or null. */
  intakeAvg: number | null;
  /** Smoothed weight change across the window (negative = lost), kg, or null. */
  deltaKg: number | null;
}

/**
 * Energy density of body-mass change.
 *
 * 1 kg of mixed body tissue lost/gained is worth ~7700 kcal. This is the classic
 * field constant (the "3500 kcal per pound" rule scaled to kg: 3500 × 2.2046 ≈
 * 7716, rounded to 7700). It mixes fat (~9000 kcal/kg) with the lean/water that
 * moves with it, which is why it's lower than pure fat. It is an APPROXIMATION —
 * good enough for a multi-week average, which is exactly the timescale we use it on.
 */
export const KCAL_PER_KG = 7700;

/**
 * How far back the data collection window reaches (days). Six weeks is a balance:
 * long enough to gather a real weight-trend signal through day-to-day water/sodium
 * noise AND enough weekly weigh-ins to reach high confidence, yet short enough that
 * the estimate reflects the user's CURRENT routine rather than ancient history.
 * (The estimate itself only spans the first→last weigh-in inside this window.)
 */
export const ADAPTIVE_LOOKBACK_DAYS = 42;

/**
 * Minimum bar to produce ANY estimate (the `low` tier). Below this we return null
 * rather than invent a number from too little signal:
 *  - 2 weigh-ins (you can't measure a change with one point),
 *  - a span of at least 10 days (a shorter span makes noise dominate the Δweight),
 *  - 5 logged intake days,
 *  - 40% logging coverage of the span (so the average isn't built from a handful
 *    of cherry-picked days while the rest of the window is blank).
 */
export const MIN_WEIGHT_SAMPLES = 2;
export const MIN_SPAN_DAYS = 10;
export const MIN_LOGGED_DAYS = 5;
export const MIN_COVERAGE = 0.4;

const round = (v: number): number => Math.round(v);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Calendar days between two YYYY-MM-DD strings (noon-anchored to dodge DST). */
function daysBetween(aDate: string, bDate: string): number {
  const a = new Date(aDate + 'T12:00:00').getTime();
  const b = new Date(bDate + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / (1000 * 60 * 60 * 24);
}

const EMPTY: AdaptiveTdeeEstimate = {
  tdee: null,
  confidence: 'insufficient',
  windowDays: 0,
  sampleDays: 0,
  weightSamples: 0,
  intakeAvg: null,
  deltaKg: null,
};

/**
 * Grade the estimate's confidence from how much (and how dense) the evidence is.
 * Each tier requires MORE weigh-ins, a LONGER span, MORE logged days and BETTER
 * coverage. Mirrors the MacroFactor intuition that confidence climbs toward ~30
 * days of consistent data.
 */
function gradeConfidence(
  weightSamples: number,
  spanDays: number,
  sampleDays: number,
  coverage: number,
): AdaptiveConfidence {
  if (weightSamples >= 4 && spanDays >= 25 && sampleDays >= 21 && coverage >= 0.8) return 'high';
  if (weightSamples >= 3 && spanDays >= 14 && sampleDays >= 10 && coverage >= 0.6) return 'medium';
  if (
    weightSamples >= MIN_WEIGHT_SAMPLES &&
    spanDays >= MIN_SPAN_DAYS &&
    sampleDays >= MIN_LOGGED_DAYS &&
    coverage >= MIN_COVERAGE
  ) {
    return 'low';
  }
  return 'insufficient';
}

/**
 * Estimate the real daily expenditure (adaptive TDEE) from logged intake and a
 * body-weight series.
 *
 * Method (energy balance over the weigh-in span):
 *   1. Smooth the weight series (EMA, reused from weight-trend) so a single noisy
 *      weigh-in can't swing the result. The span is first → last weigh-in.
 *   2. ΔweightKg = smoothedTrend(last) − smoothedTrend(first).
 *   3. intakeAvg = mean of the LOGGED intake days that fall inside the span
 *      (days with no log are excluded — counting them as 0 would tank the average).
 *   4. TDEE_real = intakeAvg − (ΔweightKg × KCAL_PER_KG) / windowDays.
 *
 *   Sign check: ΔweightKg < 0 (lost weight) ⇒ you expended MORE than you ate ⇒
 *   TDEE_real > intakeAvg. Worked example from the spec: intakeAvg 2000, Δ −0.5 kg
 *   over 14 days ⇒ 2000 − (−0.5 × 7700)/14 = 2000 + 275 = 2275 kcal. ✓
 *
 * Returns `tdee: null` with `confidence: 'insufficient'` when the evidence is too
 * thin, while still reporting `sampleDays` / `weightSamples` so the UI can tell the
 * user exactly what's missing.
 */
export function estimateAdaptiveTdee(
  intake: IntakeDay[],
  weights: WeightPoint[],
): AdaptiveTdeeEstimate {
  // --- Weight trend over the available weigh-ins ---
  const validWeights = (weights ?? []).filter(
    (w): w is WeightPoint => !!w && typeof w.date === 'string' && Number.isFinite(w.weightKg),
  );
  const smoothed = smoothWeightSeries(validWeights);
  const weightSamples = smoothed.length;
  if (weightSamples < MIN_WEIGHT_SAMPLES) {
    return { ...EMPTY, weightSamples };
  }

  const first = smoothed[0];
  const last = smoothed[smoothed.length - 1];
  const windowDays = daysBetween(first.date, last.date);
  if (windowDays <= 0) {
    return { ...EMPTY, weightSamples };
  }
  const deltaKg = last.trend - first.trend;

  // --- Average intake over the logged days INSIDE the weigh-in span ---
  // Restricting to [first, last] keeps the intake average and the Δweight on the
  // same clock, which is what the energy-balance identity requires.
  const logged = (intake ?? []).filter(
    (d) =>
      !!d &&
      typeof d.date === 'string' &&
      Number.isFinite(d.calories) &&
      d.calories > 0 &&
      d.date >= first.date &&
      d.date <= last.date,
  );
  const sampleDays = logged.length;
  if (sampleDays === 0) {
    return { ...EMPTY, weightSamples, windowDays: round(windowDays), deltaKg: round1(deltaKg) };
  }

  const intakeAvg = logged.reduce((s, d) => s + d.calories, 0) / sampleDays;

  // Logging density across the span: guards against a 6-week window with only a
  // couple of logged days masquerading as a trustworthy average.
  const spanDaysInclusive = windowDays + 1; // both endpoints are real days
  const coverage = Math.min(1, sampleDays / spanDaysInclusive);
  const confidence = gradeConfidence(weightSamples, windowDays, sampleDays, coverage);

  const base = {
    windowDays: round(windowDays),
    sampleDays,
    weightSamples,
    intakeAvg: round(intakeAvg),
    deltaKg: round1(deltaKg),
  };

  if (confidence === 'insufficient') {
    return { ...base, tdee: null, confidence };
  }

  // TDEE_real = intake − stored-energy-change per day.
  const tdee = intakeAvg - (deltaKg * KCAL_PER_KG) / windowDays;
  return { ...base, tdee: round(tdee), confidence };
}
