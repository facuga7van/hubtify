import React from 'react';

/**
 * Two glyphs the Codex needed that `shared/components/icons/CodexIcons.tsx`
 * does not carry. They follow that file's pattern exactly (24×24 grid, 1.2
 * stroke, `currentColor`, baseline nudge) so they sit optically with the rest
 * of the family; they live here rather than there only because this pass owns
 * `src/hub/**` and not `src/shared/components/**`. Move them into CodexIcons
 * whenever that file is next opened — nothing else has to change.
 *
 * The nav item for Logros reuses `Chalice` from CodexIcons: a footed cup IS the
 * trophy, and adding a ninth cup-shaped glyph to the family would only blur it.
 */

/** Inline SVGs sit on the text baseline; this drops them to optical centre. */
const ALIGN: React.CSSProperties = { verticalAlign: '-0.125em' };

const defaults: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: ALIGN,
};

/** The matrix pressed into the wax — an eight-point rosette in a ring. */
export function SealRosette(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.5" strokeDasharray="1.6 2" strokeWidth=".7" />
      <path d="M12 5.5 V18.5 M5.5 12 H18.5" strokeWidth=".8" />
      <path d="M7.4 7.4 L16.6 16.6 M16.6 7.4 L7.4 16.6" strokeWidth=".8" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" fillOpacity=".18" />
    </svg>
  );
}

/** An achievement medallion: disc on a pair of ribbons. */
export function Medallion(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* ribbons */}
      <path d="M8.5 3 L10.6 9 M15.5 3 L13.4 9" />
      <path d="M8.5 3 H15.5" strokeWidth=".8" />
      {/* disc */}
      <circle cx="12" cy="15" r="6" fill="currentColor" fillOpacity=".06" />
      <circle cx="12" cy="15" r="3.4" strokeWidth=".7" />
      <path d="M12 12.4 L12.8 14.2 L14.7 14.4 L13.3 15.7 L13.7 17.6 L12 16.6 L10.3 17.6 L10.7 15.7 L9.3 14.4 L11.2 14.2 Z" strokeWidth=".7" />
    </svg>
  );
}
