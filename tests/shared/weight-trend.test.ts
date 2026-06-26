import { describe, it, expect } from 'vitest';
import {
  smoothWeightSeries,
  weightTrendSummary,
  DEFAULT_WEIGHT_EMA_ALPHA,
  STABLE_KG_PER_WEEK,
} from '../../shared/weight-trend';
import type { WeightPoint } from '../../shared/weight-trend';

// Build a weekly series starting at a Monday, one point per week.
function weekly(weights: number[], startDate = '2026-01-05'): WeightPoint[] {
  return weights.map((weightKg, i) => {
    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + i * 7);
    const date = d.toISOString().slice(0, 10);
    return { date, weightKg };
  });
}

// Total variation: sum of absolute step-to-step changes. Lower = smoother.
function totalVariation(values: number[]): number {
  let tv = 0;
  for (let i = 1; i < values.length; i++) tv += Math.abs(values[i] - values[i - 1]);
  return tv;
}

describe('smoothWeightSeries — EMA math', () => {
  it('seeds the EMA with the first reading (trend[0] === raw[0])', () => {
    const out = smoothWeightSeries(weekly([80, 81, 82]));
    expect(out[0].trend).toBeCloseTo(80, 10);
    expect(out[0].raw).toBe(80);
  });

  it('matches the closed-form EMA recurrence for a known series', () => {
    const a = DEFAULT_WEIGHT_EMA_ALPHA; // 0.4
    const out = smoothWeightSeries(weekly([80, 82, 84]));
    const e0 = 80;
    const e1 = a * 82 + (1 - a) * e0; // 80.8
    const e2 = a * 84 + (1 - a) * e1; // 82.08
    expect(out[1].trend).toBeCloseTo(e1, 10);
    expect(out[2].trend).toBeCloseTo(e2, 10);
  });

  it('respects a custom alpha', () => {
    const out = smoothWeightSeries(weekly([80, 90]), 1); // alpha 1 → no smoothing
    expect(out[1].trend).toBeCloseTo(90, 10);
    const out2 = smoothWeightSeries(weekly([80, 90]), 0.5);
    expect(out2[1].trend).toBeCloseTo(85, 10);
  });

  it('falls back to the default alpha for invalid alpha values', () => {
    const ref = smoothWeightSeries(weekly([80, 82, 84]));
    for (const bad of [0, -1, NaN, Infinity]) {
      const out = smoothWeightSeries(weekly([80, 82, 84]), bad);
      expect(out.map((p) => p.trend)).toEqual(ref.map((p) => p.trend));
    }
  });

  it('keeps a flat series perfectly flat', () => {
    const out = smoothWeightSeries(weekly([75, 75, 75, 75]));
    for (const p of out) expect(p.trend).toBeCloseTo(75, 10);
  });

  it('drops non-finite / malformed entries', () => {
    const dirty = [
      { date: '2026-01-05', weightKg: 80 },
      { date: '2026-01-12', weightKg: NaN },
      { date: '2026-01-19', weightKg: 82 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
    ];
    const out = smoothWeightSeries(dirty);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.raw)).toEqual([80, 82]);
  });

  it('handles empty input', () => {
    expect(smoothWeightSeries([])).toEqual([]);
  });
});

describe('smoothWeightSeries — noise reduction', () => {
  it('reduces total variation of a noisy series (smoother than raw)', () => {
    const raw = [80, 81.5, 79.6, 81.2, 79.4, 80.9, 79.2, 80.6];
    const out = smoothWeightSeries(weekly(raw));
    const tvRaw = totalVariation(raw);
    const tvTrend = totalVariation(out.map((p) => p.trend));
    expect(tvTrend).toBeLessThan(tvRaw);
    // The EMA should kill the bulk of the chatter, not just a sliver of it.
    expect(tvTrend).toBeLessThan(tvRaw * 0.6);
  });

  it('attenuates an isolated spike instead of following it', () => {
    // Flat at 80, one +5 kg water spike, back to flat.
    const out = smoothWeightSeries(weekly([80, 80, 85, 80, 80]));
    const spike = out[2];
    // The trend at the spike sits far below the raw spike.
    expect(spike.trend).toBeLessThan(83);
    expect(spike.trend).toBeGreaterThan(80);
    // And it recovers toward baseline afterwards.
    expect(out[4].trend).toBeLessThan(spike.trend);
  });

  it('a late spike barely moves the trend rate vs the raw rate', () => {
    const series = weekly([80, 80, 80, 80, 85]); // last reading is a noisy bump
    const rawRate = (85 - 80) / ((series.length - 1)); // raw kg/week ≈ 1.25
    const smoothed = weightTrendSummary(series)!;
    expect(Math.abs(smoothed.kgPerWeek)).toBeLessThan(rawRate);
  });
});

describe('weightTrendSummary — direction & rate', () => {
  it('returns null for fewer than 2 valid points', () => {
    expect(weightTrendSummary([])).toBeNull();
    expect(weightTrendSummary(weekly([80]))).toBeNull();
  });

  it('detects a falling trend (cutting)', () => {
    const s = weightTrendSummary(weekly([82, 81.4, 80.9, 80.2, 79.6]))!;
    expect(s.direction).toBe('falling');
    expect(s.kgPerWeek).toBeLessThan(0);
    expect(s.deltaKg).toBeLessThan(0);
    expect(s.trendEnd).toBeLessThan(s.trendStart);
  });

  it('detects a rising trend (bulking)', () => {
    const s = weightTrendSummary(weekly([78, 78.6, 79.1, 79.9, 80.4]))!;
    expect(s.direction).toBe('rising');
    expect(s.kgPerWeek).toBeGreaterThan(0);
    expect(s.deltaKg).toBeGreaterThan(0);
  });

  it('reports stable for a flat series', () => {
    const s = weightTrendSummary(weekly([80, 80, 80, 80]))!;
    expect(s.direction).toBe('stable');
    expect(s.kgPerWeek).toBe(0);
    expect(Math.abs(s.kgPerWeek)).toBeLessThanOrEqual(STABLE_KG_PER_WEEK);
  });

  it('reports stable when noise stays within the threshold', () => {
    // Tiny back-and-forth wobble, no real trend.
    const s = weightTrendSummary(weekly([80, 80.1, 79.9, 80.05, 79.95]))!;
    expect(s.direction).toBe('stable');
  });

  it('computes a date-accurate weekly rate across a known span', () => {
    // 80 → 78 over exactly 4 weeks, alpha 1 (no smoothing) → -0.5 kg/week.
    const s = weightTrendSummary(weekly([80, 79.5, 79, 78.5, 78]), 1)!;
    expect(s.deltaKg).toBeCloseTo(-2, 5);
    expect(s.kgPerWeek).toBeCloseTo(-0.5, 5);
  });

  it('tolerates skipped weeks (uses real elapsed time)', () => {
    const points: WeightPoint[] = [
      { date: '2026-01-05', weightKg: 80 },
      { date: '2026-02-02', weightKg: 78 }, // 28 days later → 4 weeks
    ];
    const s = weightTrendSummary(points, 1)!;
    expect(s.kgPerWeek).toBeCloseTo(-0.5, 5);
  });
});
