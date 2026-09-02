/**
 * Geometry of the expense wheel (Dashboard's CategoryWheel), kept pure so it
 * can be tested without an SVG.
 *
 * COIN-01: with a single category the slice went from 0 % to 100 % and the
 * path came out as `M cx cy L x y A r r 0 1 1 x' y' Z` with x' ≈ x: an SVG arc
 * whose start and end coincide draws NOTHING, so the wheel showed two thin
 * circumferences and no ring. A slice that covers the whole wheel is a circle;
 * a ring arc that covers the whole wheel is two half-turns.
 */

export interface WheelGeometry {
  cx: number;
  cy: number;
  r: number;
}

export interface WheelAngles {
  /** Radians, 0 = 3 o'clock; slices start at 12 o'clock. */
  start: number;
  end: number;
  /** Share of the total, 0–100, unrounded. */
  pct: number;
}

export type SliceShape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; d: string }
  | { kind: 'empty' };

const TAU = Math.PI * 2;
/** Above this share the arc's ends meet and the SVG arc collapses. */
export const FULL_SLICE_PCT = 99.99;
const FULL_SPAN = TAU * (FULL_SLICE_PCT / 100);

const point = (g: WheelGeometry, radius: number, a: number): [number, number] =>
  [g.cx + Math.cos(a) * radius, g.cy + Math.sin(a) * radius];

/** Cumulative angles for each value, in order, starting at 12 o'clock. */
export function sliceAngles(values: number[], total: number): WheelAngles[] {
  let acc = 0;
  return values.map((v) => {
    const pct = total > 0 ? (v / total) * 100 : 0;
    const start = (acc / 100) * TAU - Math.PI / 2;
    acc += pct;
    const end = (acc / 100) * TAU - Math.PI / 2;
    return { start, end, pct };
  });
}

/** Filled wedge from the centre, or a full circle when it covers everything. */
export function sliceShape(g: WheelGeometry, start: number, end: number): SliceShape {
  const span = end - start;
  if (span <= 0) return { kind: 'empty' };
  if (span >= FULL_SPAN) return { kind: 'circle', cx: g.cx, cy: g.cy, r: g.r };
  const [x1, y1] = point(g, g.r, start);
  const [x2, y2] = point(g, g.r, end);
  const large = span > Math.PI ? 1 : 0;
  return { kind: 'path', d: `M${g.cx} ${g.cy} L${x1} ${y1} A${g.r} ${g.r} 0 ${large} 1 ${x2} ${y2} Z` };
}

/** Stroke-only arc between two angles; a full turn becomes two half-turns. */
export function ringArc(g: WheelGeometry, radius: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 0) return '';
  if (span >= FULL_SPAN) {
    const [x1, y1] = point(g, radius, a0);
    const [xm, ym] = point(g, radius, a0 + Math.PI);
    return `M${x1} ${y1} A${radius} ${radius} 0 1 1 ${xm} ${ym} A${radius} ${radius} 0 1 1 ${x1} ${y1}`;
  }
  const [x1, y1] = point(g, radius, a0);
  const [x2, y2] = point(g, radius, a1);
  const large = span > Math.PI ? 1 : 0;
  return `M${x1} ${y1} A${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}
