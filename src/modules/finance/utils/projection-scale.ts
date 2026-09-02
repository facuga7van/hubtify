/**
 * Geometry of the Dashboard's ProjectionChart, kept pure so it can be tested
 * without an SVG.
 *
 * COIN-NaN (QA 0.9.1): with every month at 0 the chart had `max === min` and
 * normalised with `(v - min) / (max - min)` = 0/0, sending NaN into eight SVG
 * attributes on every visit to Coinify. A flat series has no vertical spread,
 * so the range falls back to 1 and every point lands at the same height.
 */

export type Point = [x: number, y: number];

/** 15 % of headroom above the max and below the min, as the chart always drew. */
const PAD = 0.15;

/**
 * Maps `values` onto a `w`×`h` box: x spread evenly across the width, y
 * inverted (SVG grows downwards) and scaled to the padded min–max range.
 */
export function projectionCoords(values: number[], w: number, h: number): Point[] {
  if (values.length === 0) return [];
  const max = Math.max(...values) * (1 + PAD);
  const min = Math.min(...values) * (1 - PAD);
  const range = max - min || 1;
  const lastIndex = values.length - 1 || 1;
  return values.map((v, i) => [(i / lastIndex) * w, h - ((v - min) / range) * h]);
}
