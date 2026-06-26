import { describe, it, expect } from 'vitest';
import {
  estimateAdaptiveTdee,
  KCAL_PER_KG,
  MIN_LOGGED_DAYS,
} from '../../shared/adaptive-tdee';
import type { IntakeDay } from '../../shared/adaptive-tdee';
import type { WeightPoint } from '../../shared/weight-trend';

const BASE = '2026-01-05';

function addDays(base: string, n: number): string {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Daily intake at a constant value for days [0, n) starting at BASE. */
function flatIntake(kcal: number, days: number, startOffset = 0): IntakeDay[] {
  return Array.from({ length: days }, (_, i) => ({ date: addDays(BASE, startOffset + i), calories: kcal }));
}

/** Two weigh-ins `spanDays` apart, chosen so the SMOOTHED delta equals `smoothedDelta`. */
function twoWeighIns(startKg: number, smoothedDelta: number, spanDays: number): WeightPoint[] {
  // With the EMA seeded at the first point and only two points, the smoothed delta
  // is alpha*(raw1 - raw0); default alpha is 0.4, so raw delta = smoothedDelta/0.4.
  const rawDelta = smoothedDelta / 0.4;
  return [
    { date: BASE, weightKg: startKg },
    { date: addDays(BASE, spanDays), weightKg: startKg + rawDelta },
  ];
}

describe('estimateAdaptiveTdee — energy balance math', () => {
  it('matches the spec example: 2000 kcal, -0.5 kg over 14 days → ~2275', () => {
    const weights = twoWeighIns(80, -0.5, 14);
    const intake = flatIntake(2000, 15); // days 0..14, fully covering the span
    const r = estimateAdaptiveTdee(intake, weights);
    expect(r.tdee).toBe(2275);
    expect(r.deltaKg).toBeCloseTo(-0.5, 6);
    expect(r.windowDays).toBe(14);
    expect(r.intakeAvg).toBe(2000);
    expect(r.confidence).not.toBe('insufficient');
  });

  it('deficit: losing weight ⇒ real TDEE above intake', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 15), twoWeighIns(82, -0.6, 14));
    expect(r.tdee).not.toBeNull();
    expect(r.tdee as number).toBeGreaterThan(2000);
  });

  it('surplus: gaining weight ⇒ real TDEE below intake', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 15), twoWeighIns(70, +0.5, 14));
    // 2000 - (0.5 * 7700)/14 = 1725
    expect(r.tdee).toBe(1725);
    expect(r.tdee as number).toBeLessThan(2000);
  });

  it('stable weight ⇒ real TDEE ≈ intake', () => {
    const r = estimateAdaptiveTdee(flatIntake(2200, 15), twoWeighIns(75, 0, 14));
    expect(r.tdee).toBe(2200);
  });

  it('uses the documented 7700 kcal/kg constant', () => {
    // One full kg lost over 10 days at 1800 kcal → 1800 + 7700/10 = 2570.
    const r = estimateAdaptiveTdee(flatIntake(1800, 11), twoWeighIns(90, -1, 10));
    expect(r.tdee).toBe(Math.round(1800 + (1 * KCAL_PER_KG) / 10));
  });
});

describe('estimateAdaptiveTdee — insufficient data', () => {
  it('returns null with a single weigh-in', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 15), [{ date: BASE, weightKg: 80 }]);
    expect(r.tdee).toBeNull();
    expect(r.confidence).toBe('insufficient');
    expect(r.weightSamples).toBe(1);
  });

  it('returns null with no weigh-ins at all', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 15), []);
    expect(r.tdee).toBeNull();
    expect(r.weightSamples).toBe(0);
  });

  it('returns null when the span is too short to trust the Δweight', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 6), twoWeighIns(80, -0.4, 5));
    expect(r.tdee).toBeNull();
    expect(r.confidence).toBe('insufficient');
  });

  it('returns null when too few days are logged', () => {
    // Valid weights and span, but only 3 logged days over 30.
    const weights: WeightPoint[] = [
      { date: BASE, weightKg: 80 },
      { date: addDays(BASE, 14), weightKg: 79.5 },
      { date: addDays(BASE, 28), weightKg: 79 },
    ];
    const intake: IntakeDay[] = [
      { date: addDays(BASE, 2), calories: 2000 },
      { date: addDays(BASE, 10), calories: 2100 },
      { date: addDays(BASE, 20), calories: 1900 },
    ];
    const r = estimateAdaptiveTdee(intake, weights);
    expect(r.sampleDays).toBe(3);
    expect(r.sampleDays).toBeLessThan(MIN_LOGGED_DAYS);
    expect(r.tdee).toBeNull();
  });
});

describe('estimateAdaptiveTdee — handling of unlogged days', () => {
  it('excludes zero-calorie / unlogged days from the average', () => {
    const intake: IntakeDay[] = [
      ...flatIntake(2000, 14),
      { date: addDays(BASE, 14), calories: 0 }, // an unlogged day inside the span
    ];
    const r = estimateAdaptiveTdee(intake, twoWeighIns(80, -0.5, 14));
    // The 0 day must not drag the average below 2000.
    expect(r.intakeAvg).toBe(2000);
    expect(r.sampleDays).toBe(14);
  });

  it('ignores logged days outside the weigh-in span', () => {
    // Days before the first weigh-in shouldn't count toward the average/coverage.
    const intake: IntakeDay[] = [
      { date: addDays(BASE, -3), calories: 9000 }, // way before the span
      ...flatIntake(2000, 15),
    ];
    const r = estimateAdaptiveTdee(intake, twoWeighIns(80, -0.5, 14));
    expect(r.intakeAvg).toBe(2000);
    expect(r.sampleDays).toBe(15);
  });
});

describe('estimateAdaptiveTdee — confidence scales with the sample', () => {
  it('low: minimal valid evidence (2 weigh-ins, ~2 weeks)', () => {
    const r = estimateAdaptiveTdee(flatIntake(2000, 15), twoWeighIns(80, -0.4, 14));
    expect(r.confidence).toBe('low');
  });

  it('medium: 3 weigh-ins over ~18 days with solid coverage', () => {
    const weights: WeightPoint[] = [
      { date: BASE, weightKg: 80 },
      { date: addDays(BASE, 9), weightKg: 79.7 },
      { date: addDays(BASE, 18), weightKg: 79.4 },
    ];
    const intake = flatIntake(2000, 14); // 14 of 19 days logged
    const r = estimateAdaptiveTdee(intake, weights);
    expect(r.confidence).toBe('medium');
  });

  it('high: 4 weigh-ins over ~4 weeks with near-full coverage', () => {
    const weights: WeightPoint[] = [
      { date: BASE, weightKg: 80 },
      { date: addDays(BASE, 9), weightKg: 79.6 },
      { date: addDays(BASE, 18), weightKg: 79.2 },
      { date: addDays(BASE, 27), weightKg: 78.8 },
    ];
    const intake = flatIntake(2000, 28); // every day of the span logged
    const r = estimateAdaptiveTdee(intake, weights);
    expect(r.confidence).toBe('high');
    expect(r.weightSamples).toBe(4);
  });
});
