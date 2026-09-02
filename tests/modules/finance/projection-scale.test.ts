/**
 * COIN-NaN (QA 0.9.1): the projection chart with every month at 0 divided
 * 0/0 and emitted NaN into eight SVG attributes per visit.
 * See docs/superpowers/plans/2026-09-02-mobile-qa-0.9.1.md.
 */
import { describe, expect, it } from 'vitest';
import { projectionCoords } from '../../../src/modules/finance/utils/projection-scale';

const W = 280, H = 100;

describe('projectionCoords', () => {
  it('all zeros: no NaN, every point on the baseline', () => {
    const coords = projectionCoords([0, 0, 0], W, H);
    expect(coords).toHaveLength(3);
    for (const [x, y] of coords) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    expect(coords.map(([x]) => x)).toEqual([0, W / 2, W]);
  });

  it('a flat non-zero series is finite too (max === min)', () => {
    const coords = projectionCoords([1500, 1500, 1500], W, H);
    for (const [, y] of coords) expect(Number.isFinite(y)).toBe(true);
    // Same value → same height.
    expect(coords[0][1]).toBe(coords[1][1]);
    expect(coords[1][1]).toBe(coords[2][1]);
  });

  it('normal values keep the scale: higher value → smaller y, within the box', () => {
    const coords = projectionCoords([1000, 2000, 1500], W, H);
    expect(coords[1][1]).toBeLessThan(coords[0][1]);
    expect(coords[2][1]).toBeLessThan(coords[0][1]);
    expect(coords[2][1]).toBeGreaterThan(coords[1][1]);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
    // Padded range (15 % above max, 15 % below min), as the chart always drew.
    const max = 2000 * 1.15, min = 1000 * 0.85;
    expect(coords[1][1]).toBeCloseTo(H - ((2000 - min) / (max - min)) * H);
  });

  it('a single point sits at x = 0 without dividing by zero', () => {
    const [[x, y]] = projectionCoords([500], W, H);
    expect(x).toBe(0);
    expect(Number.isFinite(y)).toBe(true);
  });

  it('empty input → empty output', () => {
    expect(projectionCoords([], W, H)).toEqual([]);
  });
});
