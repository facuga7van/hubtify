import React from 'react';

export function Flourish(props: React.SVGProps<SVGSVGElement>) {
  const { color = 'var(--ink-faded)', ...rest } = props as React.SVGProps<SVGSVGElement> & { color?: string };
  return (
    <svg
      viewBox="0 0 200 12"
      preserveAspectRatio="none"
      style={{ display: 'block' }}
      {...rest}
    >
      <path d="M0 6 Q 40 0 80 6 T 160 6 L 200 6" stroke={color} strokeWidth="0.7" fill="none" opacity=".6" />
      <path d="M80 6 q 6 -6 12 0 t 12 0" stroke={color} strokeWidth="0.8" fill="none" />
      <circle cx="100" cy="6" r="1.6" fill={color} />
      <circle cx="78" cy="6" r="0.8" fill={color} />
      <circle cx="122" cy="6" r="0.8" fill={color} />
    </svg>
  );
}

export function QBDivider(props: React.SVGProps<SVGSVGElement>) {
  const { color = 'var(--ink-faded)', ...rest } = props as React.SVGProps<SVGSVGElement> & { color?: string };
  return (
    <svg
      width="28"
      height="16"
      viewBox="0 0 28 16"
      fill="none"
      {...rest}
    >
      <path d="M14 1 L18 8 L14 15 L10 8 Z" stroke={color} strokeWidth="0.8" fill="none" />
      <circle cx="14" cy="8" r="1.2" fill={color} />
      <path d="M2 8 L8 8 M20 8 L26 8" stroke={color} strokeWidth="0.7" />
    </svg>
  );
}

interface CornerBracketProps extends React.SVGProps<SVGSVGElement> {
  position?: 'tl' | 'tr' | 'bl' | 'br';
}

const cornerTransforms: Record<string, string> = {
  tl: 'none',
  tr: 'scaleX(-1)',
  bl: 'scaleY(-1)',
  br: 'scale(-1,-1)',
};

export function CornerBracket({ position = 'tl', style, ...props }: CornerBracketProps) {
  const transform = cornerTransforms[position];
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      style={{ ...style, transform: transform === 'none' ? undefined : transform }}
      {...props}
    >
      {/* iron corner piece */}
      <path d="M2 2 L32 2 L32 6 L6 6 L6 32 L2 32 Z" fill="#2a1d0e" opacity=".78" />
      <path d="M8 8 L24 8 L24 10 L10 10 L10 24 L8 24 Z" fill="#a88a3c" opacity=".55" />
      <path d="M2 2 L10 2 L2 10 Z" fill="#5a3a20" />
      {/* screw dots */}
      <circle cx="16" cy="16" r="1.3" fill="#a88a3c" />
      <circle cx="28" cy="4" r="1.2" fill="#a88a3c" />
      <circle cx="4" cy="28" r="1.2" fill="#a88a3c" />
      {/* filigree */}
      <path d="M10 10 Q 20 12 26 6 M10 10 Q 12 20 6 26" stroke="#a88a3c" strokeWidth="0.6" fill="none" opacity=".7" />
    </svg>
  );
}

export function TopRule(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 700 14"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
      {...props}
    >
      <line x1="0" y1="4" x2="700" y2="4" stroke="var(--ink-faded)" strokeWidth="0.6" />
      <line x1="0" y1="10" x2="700" y2="10" stroke="var(--ink-faded)" strokeWidth="0.4" />
      <g transform="translate(350,7)" fill="var(--rubric)">
        <path d="M-10 0 L0 -6 L10 0 L0 6 Z" opacity=".9" />
        <circle cx="0" cy="0" r="1.5" fill="var(--parch-0)" />
      </g>
      <g fill="var(--ink-faded)">
        <circle cx="300" cy="7" r="1" />
        <circle cx="400" cy="7" r="1" />
        <circle cx="260" cy="7" r="0.7" />
        <circle cx="440" cy="7" r="0.7" />
      </g>
    </svg>
  );
}
