import { memo, useMemo, type SVGProps } from 'react';

export interface CauldronSVGProps {
  progress: number;
  sessionType: 'work' | 'break' | 'long_break' | 'idle';
  paused: boolean;
  clipId: string;
  /**
   * ¿Puede moverse el caldero? En `false` el dibujo queda quieto: sin un solo
   * `<animate>` SMIL y sin el filtro de resplandor sobre las llamas.
   *
   * Existe por dos motivos distintos que llegan al mismo lugar:
   *  - `prefers-reduced-motion`. El CSS y GSAP ya lo respetaban; este SVG no,
   *    y son 20 animaciones en bucle infinito durante 25 minutos.
   *  - El emulador de Android, que rasteriza por software y se cae entero
   *    (CAU-03). En un teléfono con GPU de verdad esto no pasa.
   */
  animated: boolean;
}

/** Un `<animate>` que no existe cuando el caldero tiene que quedarse quieto. */
function Anim({ on, ...rest }: SVGProps<SVGElement> & { on: boolean }) {
  return on ? <animate {...rest} /> : null;
}

function CauldronSVGComponent({ progress, sessionType, paused, clipId, animated }: CauldronSVGProps) {
  const liquidColors = {
    work: { top: '#7a1e1e', mid: '#5a1414', deep: '#3a0e0e', glow: 'rgba(122,30,30,0.7)' },
    // Mirrors --moss / --moss-dark / one step below, kept in sync with theme.css.
    break: { top: '#40522c', mid: '#2e3c20', deep: '#1f2a15', glow: 'rgba(64,82,44,0.7)' },
    long_break: { top: '#a88a3c', mid: '#8a7030', deep: '#6a5520', glow: 'rgba(168,138,60,0.8)' },
    idle: { top: '#3a2513', mid: '#2a1d0e', deep: '#1a0f08', glow: 'rgba(58,37,19,0.4)' },
  };
  const c = liquidColors[sessionType] || liquidColors.idle;

  const rimY = 155;
  const floorY = 288;
  const fillY = floorY - (floorY - rimY) * Math.max(0, Math.min(1, progress));
  const fillH = floorY - fillY;

  const bubbles = useMemo(
    () =>
      Array.from({ length: 7 }).map(() => ({
        cx: 120 + Math.random() * 160,
        r: 4 + Math.random() * 6,
        dur: 2.5 + Math.random() * 2,
        delay: Math.random() * 3,
      })),
    []
  );

  const active = sessionType !== 'idle';

  return (
    <svg className="cauldron-svg" viewBox="0 0 400 360" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${clipId}-liquidGrad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c.top} />
          <stop offset="60%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.deep} />
        </linearGradient>
        <linearGradient id={`${clipId}-ironGrad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4a4038" />
          <stop offset="35%" stopColor="#2b2420" />
          <stop offset="75%" stopColor="#1a1510" />
          <stop offset="100%" stopColor="#0f0a06" />
        </linearGradient>
        <linearGradient id={`${clipId}-rimGrad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#5a4f45" />
          <stop offset="50%" stopColor="#3a302a" />
          <stop offset="100%" stopColor="#1c1612" />
        </linearGradient>
        <radialGradient id={`${clipId}-ironShine`} cx="30%" cy="35%" r="60%">
          <stop offset="0%" stopColor="rgba(255,220,170,0.22)" />
          <stop offset="45%" stopColor="rgba(255,220,170,0.08)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id={`${clipId}-liquidShine`} cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id={`${clipId}-embersGrad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f5c842" />
          <stop offset="35%" stopColor="#e8861e" />
          <stop offset="70%" stopColor="#c43a1a" />
          <stop offset="100%" stopColor="#5a1a0a" />
        </linearGradient>
        <linearGradient id={`${clipId}-flameGrad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fad461" />
          <stop offset="40%" stopColor="#e07418" />
          <stop offset="80%" stopColor="#a82a10" />
          <stop offset="100%" stopColor="#4a1208" />
        </linearGradient>
        <clipPath id={`${clipId}-insideClip`}>
          <path d="M 76 160 C 76 274, 160 310, 200 310 C 240 310, 324 274, 324 160 Z" />
        </clipPath>
        <filter id={`${clipId}-softGlow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Ground shadow */}
      <ellipse
        cx="200"
        cy="340"
        rx="150"
        ry="14"
        fill="rgba(0,0,0,0.35)"
        filter={`url(#${clipId}-softGlow)`}
      />

      {/* Legs */}
      <g>
        <path d="M 108 268 L 96 332 L 88 338 L 122 338 L 118 332 Z" fill="#1a1510" />
        <path d="M 108 268 L 102 305" fill="none" stroke="#2a2018" strokeWidth="1.5" />
        <ellipse cx="105" cy="338" rx="17" ry="3" fill="#0f0a06" />
        <path d="M 192 310 L 186 332 L 180 338 L 220 338 L 214 332 L 208 310 Z" fill="#1a1510" />
        <path d="M 200 310 L 200 338" fill="none" stroke="#2a2018" strokeWidth="1.5" />
        <ellipse cx="200" cy="338" rx="20" ry="3" fill="#0f0a06" />
        <path d="M 292 268 L 304 332 L 312 338 L 278 338 L 282 332 Z" fill="#1a1510" />
        <path d="M 292 268 L 298 305" fill="none" stroke="#2a2018" strokeWidth="1.5" />
        <ellipse cx="295" cy="338" rx="17" ry="3" fill="#0f0a06" />
      </g>

      {/* Fire & logs under cauldron */}
      {active && (
        <g>
          {/* Logs */}
          <rect x="110" y="318" width="180" height="10" rx="4" fill="#3a2414" />
          <rect x="120" y="328" width="160" height="8" rx="3" fill="#2a1810" />
          <rect x="140" y="316" width="120" height="6" rx="3" fill="#4a2e18" opacity="0.7" transform="rotate(-8 200 319)" />

          {/* Main flame (center, tall) */}
          <g filter={animated ? `url(#${clipId}-softGlow)` : undefined}>
            <path
              d="M185 322 Q 190 290, 200 306 Q 210 290, 215 322 Q 215 336, 200 336 Q 185 336, 185 322 Z"
              fill={`url(#${clipId}-embersGrad)`}
              opacity="0.95"
            >
              <Anim
                on={animated}
                attributeName="d"
                dur="0.8s"
                repeatCount="indefinite"
                values="
                  M185 322 Q 190 290, 200 306 Q 210 290, 215 322 Q 215 336, 200 336 Q 185 336, 185 322 Z;
                  M187 322 Q 194 294, 200 304 Q 208 292, 213 322 Q 213 336, 200 336 Q 187 336, 187 322 Z;
                  M185 322 Q 190 290, 200 306 Q 210 290, 215 322 Q 215 336, 200 336 Q 185 336, 185 322 Z
                "
              />
            </path>
          </g>

          {/* Left flame (shorter) */}
          <path
            d="M155 326 Q 160 306, 168 318 Q 172 308, 178 326 Q 178 336, 166 336 Q 155 336, 155 326 Z"
            fill={`url(#${clipId}-flameGrad)`}
            opacity="0.85"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="1.1s"
              repeatCount="indefinite"
              values="
                M155 326 Q 160 306, 168 318 Q 172 308, 178 326 Q 178 336, 166 336 Q 155 336, 155 326 Z;
                M157 326 Q 163 310, 168 316 Q 174 306, 176 326 Q 176 336, 166 336 Q 157 336, 157 326 Z;
                M155 326 Q 160 306, 168 318 Q 172 308, 178 326 Q 178 336, 166 336 Q 155 336, 155 326 Z
              "
            />
          </path>

          {/* Right flame (shorter) */}
          <path
            d="M222 326 Q 226 308, 234 318 Q 238 306, 245 326 Q 245 336, 234 336 Q 222 336, 222 326 Z"
            fill={`url(#${clipId}-flameGrad)`}
            opacity="0.85"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="1.3s"
              begin="0.3s"
              repeatCount="indefinite"
              values="
                M222 326 Q 226 308, 234 318 Q 238 306, 245 326 Q 245 336, 234 336 Q 222 336, 222 326 Z;
                M224 326 Q 230 310, 234 316 Q 240 308, 243 326 Q 243 336, 234 336 Q 224 336, 224 326 Z;
                M222 326 Q 226 308, 234 318 Q 238 306, 245 326 Q 245 336, 234 336 Q 222 336, 222 326 Z
              "
            />
          </path>

          {/* Glow under pot */}
          <ellipse cx="200" cy="320" rx="55" ry="10" fill="#e07418" opacity="0.2">
            <Anim on={animated} attributeName="opacity" values="0.12;0.28;0.12" dur="2s" repeatCount="indefinite" />
          </ellipse>

          {/* Ember sparks */}
          <circle cx="170" cy="328" r="3" fill="#f5a020" opacity="0.9">
            <Anim on={animated} attributeName="opacity" values="0.5;1;0.5" dur="1.3s" repeatCount="indefinite" />
          </circle>
          <circle cx="230" cy="330" r="2.5" fill="#e07418" opacity="0.8">
            <Anim on={animated} attributeName="opacity" values="0.4;0.9;0.4" dur="1.1s" begin="0.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="326" r="2" fill="#f5c842" opacity="0.7">
            <Anim on={animated} attributeName="opacity" values="0.3;0.85;0.3" dur="0.9s" begin="0.7s" repeatCount="indefinite" />
          </circle>
          <circle cx="190" cy="332" r="1.5" fill="#c43a1a" opacity="0.6">
            <Anim on={animated} attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" begin="0.2s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      {/* Main pot body */}
      <path
        d="M 60 150 C 60 285, 160 328, 200 328 C 240 328, 340 285, 340 150 L 330 150 C 330 275, 240 315, 200 315 C 160 315, 70 275, 70 150 Z"
        fill={`url(#${clipId}-ironGrad)`}
      />
      <path
        d="M 70 150 C 70 275, 160 315, 200 315 C 240 315, 330 275, 330 150 Z"
        fill={`url(#${clipId}-ironGrad)`}
      />
      <path
        d="M 74 155 C 74 274, 160 310, 200 310 C 240 310, 326 274, 326 155 Z"
        fill="#0a0604"
      />

      {/* Liquid (clipped) */}
      <g clipPath={`url(#${clipId}-insideClip)`}>
        {progress > 0.005 && (
          <>
            <rect
              x="60"
              y={fillY}
              width="280"
              height={fillH + 20}
              fill={`url(#${clipId}-liquidGrad)`}
            >
              {active && !paused && (
                <Anim
                on={animated}
                  attributeName="y"
                  values={`${fillY};${fillY - 1.5};${fillY}`}
                  dur="3s"
                  repeatCount="indefinite"
                />
              )}
            </rect>
            <path
              d={`M 60 ${fillY} Q 100 ${fillY - 3}, 140 ${fillY} T 220 ${fillY} T 300 ${fillY} T 340 ${fillY} L 340 ${fillY + 6} L 60 ${fillY + 6} Z`}
              fill={c.top}
              opacity="0.95"
            >
              {active && !paused && (
                <Anim
                on={animated}
                  attributeName="d"
                  dur="2.4s"
                  repeatCount="indefinite"
                  values={`
                    M 60 ${fillY} Q 100 ${fillY - 3}, 140 ${fillY} T 220 ${fillY} T 300 ${fillY} T 340 ${fillY} L 340 ${fillY + 6} L 60 ${fillY + 6} Z;
                    M 60 ${fillY} Q 100 ${fillY + 2}, 140 ${fillY - 2} T 220 ${fillY + 1} T 300 ${fillY - 1} T 340 ${fillY} L 340 ${fillY + 6} L 60 ${fillY + 6} Z;
                    M 60 ${fillY} Q 100 ${fillY - 3}, 140 ${fillY} T 220 ${fillY} T 300 ${fillY} T 340 ${fillY} L 340 ${fillY + 6} L 60 ${fillY + 6} Z
                  `}
                />
              )}
            </path>
            <ellipse
              cx="200"
              cy={fillY + 2}
              rx="95"
              ry="5"
              fill={`url(#${clipId}-liquidShine)`}
              className="cauldron-liquid-glow"
            />
            {active &&
              !paused &&
              fillH > 20 &&
              bubbles.map((b, i) => (
                <circle
                  key={i}
                  cx={b.cx}
                  cy={floorY - 10}
                  r={b.r}
                  fill="rgba(255,255,255,0.35)"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth="1"
                >
                  <Anim
                on={animated}
                    attributeName="cy"
                    values={`${floorY - 10};${fillY + 4}`}
                    dur={`${b.dur}s`}
                    begin={`${b.delay}s`}
                    repeatCount="indefinite"
                  />
                  <Anim
                on={animated}
                    attributeName="opacity"
                    values="0;0.8;0.8;0"
                    keyTimes="0;0.15;0.85;1"
                    dur={`${b.dur}s`}
                    begin={`${b.delay}s`}
                    repeatCount="indefinite"
                  />
                  <Anim
                on={animated}
                    attributeName="r"
                    values={`${b.r * 0.5};${b.r}`}
                    dur={`${b.dur}s`}
                    begin={`${b.delay}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              ))}
            <rect
              x="60"
              y={fillY - 2}
              width="280"
              height="8"
              fill={c.top}
              opacity="0.6"
              filter={animated ? `url(#${clipId}-softGlow)` : undefined}
            />
          </>
        )}
      </g>

      {/* Rim */}
      <ellipse
        cx="200"
        cy="150"
        rx="140"
        ry="18"
        fill={`url(#${clipId}-rimGrad)`}
        stroke="#0a0604"
        strokeWidth="1.5"
      />
      <ellipse cx="200" cy="150" rx="132" ry="13" fill="#0a0604" />
      <ellipse
        cx="200"
        cy="150"
        rx="132"
        ry="13"
        fill={progress > 0.01 ? c.deep : '#0a0604'}
        opacity={progress > 0.01 ? 0.8 : 1}
      />

      {/* Iron shine */}
      <path
        d="M 70 150 C 70 275, 160 315, 200 315 C 240 315, 330 275, 330 150 Z"
        fill={`url(#${clipId}-ironShine)`}
      />

      {/* Rivets */}
      {[80, 130, 200, 270, 320].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={150} r={4} fill="#2a2018" stroke="#0a0604" strokeWidth="1" />
          <circle cx={x} cy={149} r={1.5} fill="rgba(255,220,170,0.4)" />
        </g>
      ))}

      {/* Handles */}
      <path d="M 65 170 C 32 172, 28 210, 68 218" fill="none" stroke="#1a1510" strokeWidth="7" strokeLinecap="round" />
      <path d="M 65 170 C 36 172, 32 210, 68 218" fill="none" stroke="#3a3028" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="65" cy="170" r="3.5" fill="#2a2018" stroke="#0a0604" strokeWidth="1" />
      <circle cx="68" cy="218" r="3.5" fill="#2a2018" stroke="#0a0604" strokeWidth="1" />
      <path d="M 335 170 C 368 172, 372 210, 332 218" fill="none" stroke="#1a1510" strokeWidth="7" strokeLinecap="round" />
      <path d="M 335 170 C 364 172, 368 210, 332 218" fill="none" stroke="#3a3028" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="335" cy="170" r="3.5" fill="#2a2018" stroke="#0a0604" strokeWidth="1" />
      <circle cx="332" cy="218" r="3.5" fill="#2a2018" stroke="#0a0604" strokeWidth="1" />

      {/* Outer outline */}
      <path
        d="M 60 150 C 60 285, 160 328, 200 328 C 240 328, 340 285, 340 150"
        fill="none"
        stroke="#000"
        strokeWidth="1.2"
        opacity="0.6"
      />

      {/* Decorative iron bands */}
      <path d="M 78 210 C 100 235, 300 235, 322 210" fill="none" stroke="#0a0604" strokeWidth="1.5" opacity="0.6" />
      <path d="M 78 212 C 100 237, 300 237, 322 212" fill="none" stroke="rgba(255,220,170,0.12)" strokeWidth="1" />

      {/* Foreground flames — in front of pot, rooted at ground (y≈338) */}
      {active && (
        <g>
          {/* Front-left flame — tall, licking up pot side */}
          <path
            d="M130 316 Q 136 280, 146 300 Q 150 274, 160 316 Q 160 338, 145 338 Q 130 338, 130 316 Z"
            fill={`url(#${clipId}-flameGrad)`}
            opacity="0.65"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="1.0s"
              repeatCount="indefinite"
              values="
                M130 316 Q 136 280, 146 300 Q 150 274, 160 316 Q 160 338, 145 338 Q 130 338, 130 316 Z;
                M133 316 Q 139 286, 146 296 Q 153 278, 158 316 Q 158 338, 145 338 Q 133 338, 133 316 Z;
                M130 316 Q 136 280, 146 300 Q 150 274, 160 316 Q 160 338, 145 338 Q 130 338, 130 316 Z
              "
            />
            <Anim on={animated} attributeName="opacity" values="0.55;0.75;0.55" dur="1.4s" repeatCount="indefinite" />
          </path>

          {/* Front-right flame — big */}
          <path
            d="M240 312 Q 246 272, 256 296 Q 260 266, 270 312 Q 270 338, 255 338 Q 240 338, 240 312 Z"
            fill={`url(#${clipId}-embersGrad)`}
            opacity="0.6"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="1.2s"
              begin="0.4s"
              repeatCount="indefinite"
              values="
                M240 312 Q 246 272, 256 296 Q 260 266, 270 312 Q 270 338, 255 338 Q 240 338, 240 312 Z;
                M243 312 Q 249 278, 256 292 Q 263 270, 267 312 Q 267 338, 255 338 Q 243 338, 243 312 Z;
                M240 312 Q 246 272, 256 296 Q 260 266, 270 312 Q 270 338, 255 338 Q 240 338, 240 312 Z
              "
            />
            <Anim on={animated} attributeName="opacity" values="0.5;0.7;0.5" dur="1.6s" begin="0.2s" repeatCount="indefinite" />
          </path>

          {/* Front-center tongue */}
          <path
            d="M190 320 Q 194 296, 200 310 Q 206 294, 210 320 Q 210 338, 200 338 Q 190 338, 190 320 Z"
            fill="#e07418"
            opacity="0.45"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="0.85s"
              begin="0.6s"
              repeatCount="indefinite"
              values="
                M190 320 Q 194 296, 200 310 Q 206 294, 210 320 Q 210 338, 200 338 Q 190 338, 190 320 Z;
                M192 320 Q 196 300, 200 308 Q 207 298, 208 320 Q 208 338, 200 338 Q 192 338, 192 320 Z;
                M190 320 Q 194 296, 200 310 Q 206 294, 210 320 Q 210 338, 200 338 Q 190 338, 190 320 Z
              "
            />
            <Anim on={animated} attributeName="opacity" values="0.35;0.55;0.35" dur="1.1s" repeatCount="indefinite" />
          </path>

          {/* Extra small left-inner flame */}
          <path
            d="M148 324 Q 152 306, 158 318 Q 162 304, 168 324 Q 168 338, 158 338 Q 148 338, 148 324 Z"
            fill={`url(#${clipId}-flameGrad)`}
            opacity="0.5"
          >
            <Anim
                on={animated}
              attributeName="d"
              dur="1.3s"
              begin="0.8s"
              repeatCount="indefinite"
              values="
                M148 324 Q 152 306, 158 318 Q 162 304, 168 324 Q 168 338, 158 338 Q 148 338, 148 324 Z;
                M150 324 Q 154 310, 158 316 Q 164 308, 166 324 Q 166 338, 158 338 Q 150 338, 150 324 Z;
                M148 324 Q 152 306, 158 318 Q 162 304, 168 324 Q 168 338, 158 338 Q 148 338, 148 324 Z
              "
            />
          </path>
        </g>
      )}
    </svg>
  );
}

/**
 * The stage re-renders on every 1 s tick. Without this comparator React
 * re-created ~150 SVG nodes each second, which restarted the SMIL animations on
 * the wave and all seven bubbles — the liquid visibly stuttered. Only a change
 * the eye can see (1 % of progress, phase, paused) is worth a repaint.
 */
const CauldronSVG = memo(
  CauldronSVGComponent,
  (a, b) =>
    Math.round(a.progress * 100) === Math.round(b.progress * 100) &&
    a.sessionType === b.sessionType &&
    a.paused === b.paused &&
    a.clipId === b.clipId &&
    a.animated === b.animated,
);

export default CauldronSVG;
