import React from 'react';
import { SealRosette } from './CodexSealIcons';

/**
 * The collectible seal MATRICES — the designs pressed into the Códice's wax.
 *
 * The default (free, day-one) matrix is the eight-point rosette
 * (`SealRosette`). Each entry here is a SHOP variant (shared/shop-catalog.ts):
 * once bought, the player chooses which matrix stamps their days. Buying is
 * additive — the rosette is never taken away and no existing design is gated.
 *
 * All follow the CodexIcons pattern exactly (24×24 grid, 1.2 stroke,
 * `currentColor`, baseline nudge) and keep the outer ring of the rosette, so
 * every matrix reads as the SAME wax seal wearing a different device —
 * heraldry, not clip-art.
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

/** El Ciervo — a stag's antlered brow. */
export function SealStag(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      {/* head */}
      <path d="M12 12.4 L10.6 14.6 L12 17 L13.4 14.6 Z" strokeWidth=".8" />
      {/* antlers */}
      <path d="M10.8 12.6 C10 10.8 8.4 10.4 8 8.2 M8.9 10.6 L7.4 10.2 M9.6 12 L8.2 12.2" strokeWidth=".8" />
      <path d="M13.2 12.6 C14 10.8 15.6 10.4 16 8.2 M15.1 10.6 L16.6 10.2 M14.4 12 L15.8 12.2" strokeWidth=".8" />
      {/* eyes */}
      <circle cx="11.2" cy="13.6" r=".4" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="13.6" r=".4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** La Torre — a keep with merlons, on a mound. */
export function SealTower(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      {/* merlons */}
      <path d="M9.4 8.6 V7.2 H10.8 V8.6 H13.2 V7.2 H14.6 V8.6" strokeWidth=".8" />
      {/* body */}
      <path d="M9.8 8.6 V15.2 H14.2 V8.6" strokeWidth=".8" />
      {/* door + arrow slit */}
      <path d="M12 15.2 V13.4 A.9 .9 0 0 1 12 13.4" strokeWidth=".7" />
      <path d="M11.2 15.2 V13.6 A .8 .8 0 0 1 12.8 13.6 V15.2" strokeWidth=".7" />
      <path d="M12 10 V11.4" strokeWidth=".7" />
      {/* mound */}
      <path d="M8 16.8 C9.4 15.9 14.6 15.9 16 16.8" strokeWidth=".8" />
    </svg>
  );
}

/** La Luna — waxing crescent with a lodestar. */
export function SealCrescent(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      {/* crescent */}
      <path d="M13.4 6.9 A5.6 5.6 0 1 0 13.4 17.1 A4.5 4.5 0 1 1 13.4 6.9 Z" strokeWidth=".8" fill="currentColor" fillOpacity=".08" />
      {/* lodestar */}
      <path d="M15.6 10.6 L16 11.7 L17.1 12.1 L16 12.5 L15.6 13.6 L15.2 12.5 L14.1 12.1 L15.2 11.7 Z" strokeWidth=".6" />
    </svg>
  );
}

/** La Sierpe — a serpent coiled through itself. */
export function SealSerpent(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      {/* body: an S winding across the field */}
      <path d="M8.2 15.4 C8.2 13.4 10.4 13.2 12 12.6 C14 11.9 15.4 11.2 15.4 9.6 C15.4 8.2 13.8 7.6 12.6 8.3" strokeWidth=".9" />
      <path d="M8.6 16.2 C10.2 17.3 13.2 17 14.4 15.6" strokeWidth=".9" />
      {/* head + tongue */}
      <path d="M14.4 15.6 C15.2 14.8 15 13.9 14.2 13.7 C13.5 13.5 12.9 14 13 14.8" strokeWidth=".8" />
      <path d="M14.6 14.4 L15.6 14.1 M15.6 14.1 L16.2 14.4 M15.6 14.1 L16 13.5" strokeWidth=".6" />
      {/* eye */}
      <circle cx="14" cy="14.3" r=".35" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** El Roble — an oak, crown and roots. */
export function SealOak(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      {/* crown */}
      <path d="M12 7.2 C9.3 7.2 8 9 8.4 10.7 C7.4 11.9 8.6 13.4 10 13.2 C10.6 14 12 14.2 12 14.2 C12 14.2 13.4 14 14 13.2 C15.4 13.4 16.6 11.9 15.6 10.7 C16 9 14.7 7.2 12 7.2 Z" strokeWidth=".8" />
      {/* trunk */}
      <path d="M12 14.2 V16.6 M12 12 V14.2 M12 12 L10.9 10.9 M12 13 L13.1 11.9" strokeWidth=".8" />
      {/* roots */}
      <path d="M9.6 16.6 C10.8 16.2 13.2 16.2 14.4 16.6" strokeWidth=".8" />
    </svg>
  );
}

/** El Sol Radiante — the sun in splendour. */
export function SealSun(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.1" strokeWidth=".9" fill="currentColor" fillOpacity=".1" />
      {/* straight rays */}
      <path d="M12 5.8 V7.6 M12 16.4 V18.2 M5.8 12 H7.6 M16.4 12 H18.2" strokeWidth=".8" />
      {/* wavy rays (the splendour) */}
      <path d="M7.9 7.9 L9.2 9.2 M16.1 7.9 L14.8 9.2 M7.9 16.1 L9.2 14.8 M16.1 16.1 L14.8 14.8" strokeWidth=".7" />
      {/* face hint: the die-cut dot */}
      <circle cx="12" cy="12" r=".6" fill="currentColor" fillOpacity=".25" stroke="none" />
    </svg>
  );
}

/**
 * Matrix per shop item id. Anything unknown (or null — nothing equipped)
 * falls back to the free rosette, so a stale equip can never blank the wax.
 */
export const SEAL_STYLE_ICONS: Record<string, (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  seal_stag: SealStag,
  seal_tower: SealTower,
  seal_crescent: SealCrescent,
  seal_serpent: SealSerpent,
  seal_oak: SealOak,
  seal_sun: SealSun,
};

export function sealStyleIcon(id: string | null | undefined, size = 24): React.JSX.Element {
  const Icon = (id && SEAL_STYLE_ICONS[id]) || SealRosette;
  return <Icon width={size} height={size} />;
}
