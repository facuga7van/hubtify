import React from 'react';

const defaults: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function Sword(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Blade with width */}
      <path d="M20.5 3 L14 9.5 L13 10.5 L14.5 12 L21 5.5 L22 3 Z" fill="currentColor" fillOpacity=".06" />
      {/* Fuller (center groove) */}
      <path d="M21 3.5 L13.5 11" />
      {/* Crossguard with knobs */}
      <path d="M10.5 13.5 L16 8" strokeWidth="1.5" />
      <circle cx="10" cy="14" r=".7" fill="currentColor" fillOpacity=".2" />
      <circle cx="16.5" cy="7.5" r=".7" fill="currentColor" fillOpacity=".2" />
      {/* Grip with wraps */}
      <path d="M10.5 13.5 L5.5 18.5" />
      <path d="M9 15 L7.5 16.5 M8.5 15.5 L7 17" strokeWidth=".7" />
      {/* Pommel */}
      <circle cx="5" cy="19" r="1.5" />
    </svg>
  );
}

export function Shield(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Outer shield */}
      <path d="M12 3 L4 6 V12 C4 17 8 20 12 22 C16 20 20 17 20 12 V6 Z" />
      {/* Inner border */}
      <path d="M12 5 L6 7.5 V12 C6 16 9 18.5 12 20 C15 18.5 18 16 18 12 V7.5 Z" fill="currentColor" fillOpacity=".06" />
      {/* Chevron heraldic charge */}
      <path d="M7 14 L12 9 L17 14" strokeWidth="1.4" />
      {/* Top rivet */}
      <circle cx="12" cy="5.5" r=".7" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

export function Potion(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M10 3 H14 V6 H10 Z" />
      <path d="M9 6 H15 L17 10 C18 13 17 17 14 19 H10 C7 17 6 13 7 10 Z" />
      <path d="M9 14 H15" />
    </svg>
  );
}

export function Coin(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Outer rim */}
      <circle cx="12" cy="12" r="8" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="5.5" />
      {/* Crown emblem center */}
      <path d="M9.5 13 L10.5 10 L12 12 L13.5 10 L14.5 13 Z" fill="currentColor" fillOpacity=".1" />
      {/* Cardinal rim dots */}
      <circle cx="12" cy="4.5" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="12" cy="19.5" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="4.5" cy="12" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="19.5" cy="12" r=".6" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

export function Scroll(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Main body */}
      <path d="M6 5 C6 3 7 2 9 2 H18 C17 3 17 4 17 5 V19 C17 21 16 22 14 22 H6 C7 21 7 20 7 19 V5" />
      {/* Top roll with curl */}
      <path d="M6 5 C6 7 7 7.5 9 7.5 H17" />
      <path d="M6 5 C5.5 4 5 3.5 5.5 3" strokeWidth=".8" />
      {/* Bottom roll curl */}
      <path d="M17 19 C17.5 20 18 20.5 17.5 21" strokeWidth=".8" />
      {/* Text lines */}
      <path d="M9 11 H14 M9 13.5 H13 M9 16 H11" />
      {/* Wax seal */}
      <circle cx="15" cy="18" r="1.3" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth=".8" />
    </svg>
  );
}

export function Chalice(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6 4 H18 L16 11 C16 14 14 15 12 15 C10 15 8 14 8 11 Z" />
      <path d="M12 15 V20 M8 20 H16" />
    </svg>
  );
}

export function Flame(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3 C 13 7 17 8 17 13 A 5 5 0 0 1 7 13 C 7 10 9 9 10 7 C 11 9 11 10 12 11 C 13 9 12 6 12 3Z" />
    </svg>
  );
}

export function Heart(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 21 C 5 16 3 12 3 8 A 4 4 0 0 1 12 6 A 4 4 0 0 1 21 8 C 21 12 19 16 12 21Z" />
    </svg>
  );
}

export function Herb(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Central stem */}
      <path d="M12 21c0-6 0-10 0-14" />
      {/* Left leaf */}
      <path d="M12 13 Q8 11 6 7 Q10 8 12 11" fill="currentColor" fillOpacity=".1" />
      {/* Right leaf */}
      <path d="M12 10 Q16 8 18 5 Q14 6 12 9" fill="currentColor" fillOpacity=".1" />
      {/* Leaf veins */}
      <path d="M12 12l-3-3M12 9.5l3-2.5" strokeWidth=".5" />
    </svg>
  );
}

export function Crown(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Crown body with fill accent */}
      <path d="M3 18 L4 8 L9 13 L12 6 L15 13 L20 8 L21 18 Z" fill="currentColor" fillOpacity=".06" />
      {/* Band */}
      <path d="M3 18 H21" strokeWidth="1.4" />
      <path d="M4 16 H20" strokeWidth=".6" />
      {/* Point tips */}
      <circle cx="4" cy="8" r="1" fill="currentColor" fillOpacity=".15" />
      <circle cx="20" cy="8" r="1" fill="currentColor" fillOpacity=".15" />
      <circle cx="12" cy="6" r="1" fill="currentColor" fillOpacity=".15" />
      {/* Band jewels */}
      <circle cx="8" cy="17" r=".7" fill="currentColor" fillOpacity=".2" />
      <circle cx="12" cy="17" r=".7" fill="currentColor" fillOpacity=".2" />
      <circle cx="16" cy="17" r=".7" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

export function Skull(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 11 A 7 7 0 0 1 19 11 V16 H15 V20 H9 V16 H5Z" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <path d="M11 17 H13" />
    </svg>
  );
}

export function Compass(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3 L12 6 M12 18 L12 21 M3 12 L6 12 M18 12 L21 12" />
      <path d="M12 6 L15 15 L12 12 L9 15 Z" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

export function Key(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="7" cy="12" r="4" />
      <path d="M11 12 H21 M17 12 V15 M20 12 V14" />
    </svg>
  );
}

export function Quill(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M20 3 C 13 5 8 10 5 18 L3 21 L6 20 C14 18 19 13 21 4Z" />
      <path d="M5 18 L13 10" />
    </svg>
  );
}

export function Bread(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Loaf outline with bumps */}
      <path d="M4 10 Q 4 5 8 5 Q 10 3 12 5 Q 14 3 16 5 Q 20 5 20 10 L19 18 H5 Z" />
      {/* Crust line */}
      <path d="M5 11 Q 8 9 12 9 Q 16 9 19 11" strokeWidth=".8" />
      {/* Score marks */}
      <path d="M8 12 L9 16 M12 12 L12 16 M16 12 L15 16" />
      {/* Flour dots */}
      <circle cx="7" cy="7" r=".5" fill="currentColor" fillOpacity=".15" />
      <circle cx="15" cy="6" r=".5" fill="currentColor" fillOpacity=".15" />
      {/* Board base */}
      <path d="M4 18 H20" strokeWidth="1.4" />
    </svg>
  );
}

export function Meat(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6 18 C 3 15 3 10 6 8 C 9 5 14 5 17 8 L20 11 L17 14 C 14 17 9 17 6 18 L3 21" />
      <circle cx="16" cy="11" r="1" />
    </svg>
  );
}

export function Apple(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 7 C 9 4 4 5 4 11 C 4 17 8 21 12 21 C 16 21 20 17 20 11 C 20 5 15 4 12 7Z" />
      <path d="M12 7 C 12 5 13 3 15 3" />
    </svg>
  );
}

export function Fish(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 12 Q 8 6 14 12 Q 8 18 3 12Z" />
      <path d="M14 12 L20 8 V16 Z" />
      <circle cx="6" cy="11" r=".8" fill="currentColor" />
    </svg>
  );
}

export function Platter(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Dome cloche */}
      <path d="M6 13a6 6 0 0 1 12 0" fill="currentColor" fillOpacity=".06" />
      {/* Base plate */}
      <path d="M4 13h16" strokeWidth="1.4" />
      <path d="M5 13c0 2 3 4 7 4s7-2 7-4" />
      {/* Handle knob */}
      <circle cx="12" cy="7" r="1" fill="currentColor" fillOpacity=".15" />
    </svg>
  );
}

export function Cauldron(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Pot body */}
      <path d="M5 10 H19 L18 18 C 18 20 16 21 12 21 C 8 21 6 20 6 18 Z" />
      {/* Rim */}
      <path d="M4 10 H20" strokeWidth="1.5" />
      {/* Side handles */}
      <path d="M5 11 C 2 11 2 14 5 14" strokeWidth="1" />
      <path d="M19 11 C 22 11 22 14 19 14" strokeWidth="1" />
      {/* Steam wisps */}
      <path d="M9 7 Q 10 5 11 7 M13 6 Q 14 4 15 6 M11 5 Q 12 3 13 5" strokeWidth=".8" />
      {/* Bubbles */}
      <circle cx="10" cy="15" r=".8" fill="currentColor" fillOpacity=".1" />
      <circle cx="14" cy="16" r=".6" fill="currentColor" fillOpacity=".1" />
    </svg>
  );
}

export function Tower(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Main tower body */}
      <path d="M6 21 H18 V8 H6 Z" />
      {/* Battlements */}
      <path d="M5 8 H19 V6.5 H17 V4 H15 V6.5 H13 V4 H11 V6.5 H9 V4 H7 V6.5 H5 Z" />
      {/* Flag on top */}
      <path d="M13 4 V1 M13 1 L17 2.5 L13 4" fill="currentColor" fillOpacity=".1" />
      {/* Arched door */}
      <path d="M10 21 V16 Q 10 14 12 14 Q 14 14 14 16 V21" />
      {/* Arrow slit */}
      <path d="M12 9.5 V12" strokeWidth=".8" />
      {/* Stone lines */}
      <path d="M6 14 H10 M14 14 H18 M6 17 H10 M14 17 H18" strokeWidth=".4" />
    </svg>
  );
}

export function Scale(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3 V21 M7 21 H17" />
      <path d="M4 6 H20" />
      <path d="M4 6 L2 13 A 3 3 0 0 0 6 13 Z" />
      <path d="M20 6 L18 13 A 3 3 0 0 0 22 13 Z" />
    </svg>
  );
}

export function Bag(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M7 7 Q 7 3 12 3 Q 17 3 17 7" />
      <path d="M5 8 H19 L20 20 Q 20 21 19 21 H5 Q 4 21 4 20 Z" />
      <path d="M9 12 Q 12 15 15 12" />
    </svg>
  );
}

export function Dagger(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3 L10 15 L14 15 Z" />
      <path d="M8 15 H16 M11 15 V20 M9 20 H15" />
    </svg>
  );
}

export function Bow(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 5 C 14 5 19 10 19 19" />
      <path d="M5 5 L19 19" />
    </svg>
  );
}

export function Book(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 5 C 4 4 5 3 7 3 H20 V19 H7 C 5 19 4 20 4 21 Z" />
      <path d="M4 21 C 4 20 5 19 7 19" />
      <path d="M9 8 H16 M9 11 H14" />
    </svg>
  );
}

export function Map(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z" />
      <path d="M9 4 V18 M15 6 V20" />
    </svg>
  );
}

export function MoonCrescent(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Crescent moon */}
      <path d="M15 4a8 8 0 1 0 0 16 6 6 0 0 1 0-16Z" fill="currentColor" fillOpacity=".08" />
      {/* Stars */}
      <circle cx="18" cy="7" r=".7" fill="currentColor" fillOpacity=".2" />
      <circle cx="20" cy="12" r=".5" fill="currentColor" fillOpacity=".15" />
    </svg>
  );
}

export function NoonSun(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Sun disc */}
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity=".1" />
      {/* Long rays */}
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      {/* Diagonal rays */}
      <path d="M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2" strokeWidth=".8" />
    </svg>
  );
}

export function Lantern(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 2 V4 M10 4 H14 L14 6 H10Z" />
      <path d="M8 6 H16 L15 18 H9 Z" />
      <path d="M10 18 V21 H14 V18" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function Rune(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6 3 L6 21 M6 3 L18 12 L6 21" />
    </svg>
  );
}

export function GemRough(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Raw crystal body */}
      <path d="M8 21 L5 13 L12 3 L19 13 L16 21 Z" fill="currentColor" fillOpacity=".06" />
      {/* Center facet */}
      <path d="M12 3 V21" strokeWidth=".7" />
      {/* Side cleavage */}
      <path d="M5 13 L12 11 L19 13" strokeWidth=".7" />
      {/* Fracture detail */}
      <path d="M9 7 L11 12" strokeWidth=".4" />
    </svg>
  );
}

export function GemCut(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Octagonal outline */}
      <path d="M8 4 H16 L20 8 V16 L16 20 H8 L4 16 V8 Z" fill="currentColor" fillOpacity=".06" />
      {/* Table center */}
      <rect x="9.5" y="9.5" width="5" height="5" strokeWidth=".8" />
      {/* Diagonal facets */}
      <path d="M8 4 L9.5 9.5 M16 4 L14.5 9.5 M20 16 L14.5 14.5 M4 16 L9.5 14.5" strokeWidth=".6" />
      {/* Sparkle accent */}
      <circle cx="11" cy="7" r=".6" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

export function GemBrilliant(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Crown (top half) */}
      <path d="M4 12 L8 5 H16 L20 12" fill="currentColor" fillOpacity=".08" />
      {/* Table facet */}
      <path d="M8 5 H16" strokeWidth="1.4" />
      {/* Pavilion (bottom half) */}
      <path d="M4 12 L12 22 L20 12" fill="currentColor" fillOpacity=".04" />
      {/* Girdle */}
      <path d="M4 12 H20" />
      {/* Crown facets */}
      <path d="M10 5 L12 12 L14 5" strokeWidth=".7" />
      {/* Pavilion main facet */}
      <path d="M7 12 L12 18 L17 12" strokeWidth=".5" />
      {/* Sparkle rays */}
      <path d="M2 8 L4 9 M22 8 L20 9 M12 1 V3" strokeWidth=".7" />
      {/* Brilliance dots */}
      <circle cx="9" cy="8" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="15" cy="8" r=".5" fill="currentColor" fillOpacity=".15" />
    </svg>
  );
}

export function HelpSeal(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Question mark — calligraphic curve */}
      <path d="M8.5 8.5 C8.5 4.5 15.5 4.5 15.5 8.5 C15.5 11.5 12 11.5 12 14.5" strokeWidth="1.6" />
      {/* Ink dot */}
      <circle cx="12" cy="17.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function DawnSun(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Horizon line */}
      <path d="M3 16h18" strokeWidth="1.4" />
      {/* Half sun rising */}
      <path d="M8 16a4 4 0 0 1 8 0" fill="currentColor" fillOpacity=".12" />
      {/* Rays */}
      <path d="M12 8v2M7.5 10l1.2 1.5M16.5 10l-1.2 1.5M5 14l1.5.5M19 14l-1.5.5" strokeWidth=".8" />
    </svg>
  );
}

export function Dragon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 15 Q 6 10 10 12 Q 13 7 18 9 Q 22 8 21 13 Q 17 14 15 17 Q 10 20 3 15Z" />
      <circle cx="17" cy="11" r=".7" fill="currentColor" />
    </svg>
  );
}
