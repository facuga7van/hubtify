/**
 * COIN-01 (QA 0.9.0): the expense wheel with a single category drew nothing.
 * See docs/superpowers/plans/2026-09-02-mobile-qa-0.9.0.md.
 */
import { describe, expect, it } from 'vitest';
import { sliceAngles, sliceShape, ringArc, FULL_SLICE_PCT } from '../../../src/modules/finance/utils/wheel-paths';

const G = { cx: 70, cy: 70, r: 54 };
const TAU = Math.PI * 2;

describe('sliceAngles', () => {
  it('starts at 12 o\'clock and accumulates in order', () => {
    const [a, b] = sliceAngles([25, 75], 100);
    expect(a.start).toBeCloseTo(-Math.PI / 2);
    expect(a.end).toBeCloseTo(0);
    expect(a.pct).toBe(25);
    expect(b.start).toBeCloseTo(0);
    expect(b.end).toBeCloseTo(TAU - Math.PI / 2);
    expect(b.pct).toBe(75);
  });

  it('a 0 % value is a zero-span slice, not a NaN', () => {
    const [zero, rest] = sliceAngles([0, 50], 50);
    expect(zero.start).toBe(zero.end);
    expect(zero.pct).toBe(0);
    expect(rest.pct).toBe(100);
  });
});

describe('sliceShape', () => {
  it('one segment at 100 % is a circle, not a collapsed arc', () => {
    const [only] = sliceAngles([11_500], 11_500);
    expect(sliceShape(G, only.start, only.end)).toEqual({ kind: 'circle', cx: 70, cy: 70, r: 54 });
  });

  it(`a segment above ${FULL_SLICE_PCT} % is still a circle (float noise)`, () => {
    const [big, tiny] = sliceAngles([999_999, 1], 1_000_000);
    expect(sliceShape(G, big.start, big.end).kind).toBe('circle');
    expect(sliceShape(G, tiny.start, tiny.end).kind).toBe('path');
  });

  it('two segments are two wedges with the large-arc flag on the bigger one', () => {
    const [a, b] = sliceAngles([30, 70], 100);
    const sa = sliceShape(G, a.start, a.end);
    const sb = sliceShape(G, b.start, b.end);
    expect(sa.kind).toBe('path');
    expect(sb.kind).toBe('path');
    if (sa.kind !== 'path' || sb.kind !== 'path') throw new Error('unreachable');
    expect(sa.d.startsWith('M70 70 L70 16 A54 54 0 0 1 ')).toBe(true);
    expect(sb.d).toMatch(/A54 54 0 1 1 /);
    // Both wedges close back to the centre.
    expect(sa.d.endsWith(' Z')).toBe(true);
    expect(sb.d.endsWith(' Z')).toBe(true);
    // b ends where a started: the ring is closed.
    const endOfB = sb.d.match(/A54 54 0 1 1 ([-\d.]+) ([-\d.]+) Z$/)!;
    expect(parseFloat(endOfB[1])).toBeCloseTo(70, 5);
    expect(parseFloat(endOfB[2])).toBeCloseTo(16, 5);
  });

  it('a 0 % segment is empty: nothing to draw, nothing to stroke', () => {
    const [zero] = sliceAngles([0, 40], 40);
    expect(sliceShape(G, zero.start, zero.end)).toEqual({ kind: 'empty' });
  });
});

describe('ringArc', () => {
  it('a full turn becomes two half-turn arcs that meet at the start point', () => {
    const [only] = sliceAngles([1], 1);
    const d = ringArc(G, 62, only.start, only.end);
    expect(d.match(/A62 62 0 1 1 /g)?.length).toBe(2);
    expect(d.startsWith('M70 8 ')).toBe(true);
    expect(d.endsWith(' 70 8')).toBe(true);
  });

  it('a partial arc is a single arc segment', () => {
    const [a] = sliceAngles([1, 3], 4);
    const d = ringArc(G, 62, a.start, a.end);
    expect(d.match(/A62 62/g)?.length).toBe(1);
    expect(d).toMatch(/^M70 8 A62 62 0 0 1 132 70(\.0*\d*)?$/);
  });

  it('a zero span is an empty path', () => {
    expect(ringArc(G, 62, 1, 1)).toBe('');
  });
});
