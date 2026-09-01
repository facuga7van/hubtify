import React from 'react';
import {
  Book,
  Chalice,
  Crown,
  Lantern,
  Map,
  Platter,
  Potion,
  Sword,
} from '../../shared/components/icons';

/**
 * The óbolo — the coin that is SPENT (XP is what is earned). Follows the
 * CodexIcons pattern exactly (24×24 grid, 1.2 stroke, `currentColor`, baseline
 * nudge); it lives here rather than in `shared/components/icons` only because
 * this pass owns `src/hub/**`. Move it into CodexIcons whenever that file is
 * next opened — nothing else has to change.
 *
 * Design: an archaic hand-struck coin — slightly uneven planchet, hammered
 * edge, and the classic quadratum incusum (the punched square of early Greek
 * obols) as the reverse mark. Distinct from SealRosette on purpose: the seal
 * is wax, this is metal.
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

export function Obolus(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* planchet — hand-struck, so not quite round */}
      <path d="M12 3.6 C16.5 3.4 20.4 7.3 20.4 12 C20.4 16.7 16.7 20.5 12 20.4 C7.3 20.3 3.6 16.6 3.6 12 C3.6 7.4 7.5 3.8 12 3.6 Z" />
      {/* hammered edge */}
      <circle cx="12" cy="12" r="7.2" strokeWidth=".5" strokeDasharray="1 2.4" />
      {/* quadratum incusum — the punched square */}
      <path d="M12 7.4 L16.6 12 L12 16.6 L7.4 12 Z" fill="currentColor" fillOpacity=".08" strokeWidth=".8" />
      <path d="M12 7.4 V16.6 M7.4 12 H16.6" strokeWidth=".6" />
      {/* die flaw — the maker's nick */}
      <circle cx="12" cy="12" r=".6" fill="currentColor" fillOpacity=".2" stroke="none" />
    </svg>
  );
}

/**
 * The icons a reward may wear, keyed by the token stored in `rewards.icon`.
 * All existing CodexIcons — no emoji, ever. Unknown/absent tokens fall back
 * to the óbolo itself.
 */
export const REWARD_ICONS: Record<string, (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  sword: Sword,
  platter: Platter,
  book: Book,
  chalice: Chalice,
  potion: Potion,
  lantern: Lantern,
  map: Map,
  crown: Crown,
};

export const REWARD_ICON_NAMES = Object.keys(REWARD_ICONS);

export function rewardIcon(name: string | null | undefined, size = 18): React.JSX.Element {
  const Icon = (name && REWARD_ICONS[name]) || Obolus;
  return <Icon width={size} height={size} />;
}
