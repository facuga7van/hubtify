import { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { ambientOrbs, brewComplete, statsShimmer } from '../../../shared/animations/cauldron';
import {
  playCauldronStart,
  playCauldronCycleEnd,
  playCauldronWarning,
  playCauldronPause,
  playCauldronResume,
} from '../../../shared/audio';
import HelpBubble from '../../../shared/components/HelpBubble';
import { BookPage } from '../../../shared/components/codex/BookPage';
import {
  Section,
  Rune,
  Tick,
  Gauge,
  Cartouche,
} from '../../../shared/components/codex/CodexPrimitives';
import { Cauldron as CauldronIcon, Flame, Potion } from '../../../shared/components/icons/CodexIcons';
import { CastleBarChart } from '../../../shared/components/charts/CastleBarChart';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronStats,
  CauldronSession,
  CauldronSessionEndResult,
  CauldronWeeklyFocusDay,
} from '../../../../shared/types';

/* -- Flavor / ingredient array sizes (used to cycle with %) -- */

const FLAVOR_SIZES = { work: 7, break: 5, longBreak: 4, idle: 3, paused: 2 };
const INGREDIENT_COUNT = 12;

/* -- Inline Sub-Components ----------------------------------- */

function CyclePreviewBar({ preset }: { preset: CauldronPreset | Partial<CauldronPreset> }) {
  const cycles = preset.cyclesBeforeLong || 4;
  const segments: { type: 'work' | 'break' | 'long-break'; minutes: number }[] = [];
  for (let i = 0; i < cycles; i++) {
    segments.push({ type: 'work', minutes: preset.workMinutes || 25 });
    if (i < cycles - 1) {
      segments.push({ type: 'break', minutes: preset.breakMinutes || 5 });
    } else {
      segments.push({ type: 'long-break', minutes: preset.longBreakMinutes || 15 });
    }
  }
  const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);

  return (
    <div className="cauldron-cycle-preview">
      {segments.map((seg, i) => (
        <div
          key={i}
          className={`cauldron-cycle-segment ${seg.type}`}
          style={{ flex: seg.minutes / totalMinutes }}
        />
      ))}
    </div>
  );
}

function CauldronSVGComponent({
  progress,
  sessionType,
  paused,
  clipId,
}: {
  progress: number;
  sessionType: 'work' | 'break' | 'long_break' | 'idle';
  paused: boolean;
  clipId: string;
}) {
  const liquidColors = {
    work: { top: '#7a1e1e', mid: '#5a1414', deep: '#3a0e0e', glow: 'rgba(122,30,30,0.7)' },
    break: { top: '#556b3c', mid: '#3d4d2a', deep: '#2a3a1a', glow: 'rgba(85,107,60,0.7)' },
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
          <g filter={`url(#${clipId}-softGlow)`}>
            <path
              d="M185 322 Q 190 290, 200 306 Q 210 290, 215 322 Q 215 336, 200 336 Q 185 336, 185 322 Z"
              fill={`url(#${clipId}-embersGrad)`}
              opacity="0.95"
            >
              <animate
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
            <animate
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
            <animate
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
            <animate attributeName="opacity" values="0.12;0.28;0.12" dur="2s" repeatCount="indefinite" />
          </ellipse>

          {/* Ember sparks */}
          <circle cx="170" cy="328" r="3" fill="#f5a020" opacity="0.9">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="1.3s" repeatCount="indefinite" />
          </circle>
          <circle cx="230" cy="330" r="2.5" fill="#e07418" opacity="0.8">
            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.1s" begin="0.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="326" r="2" fill="#f5c842" opacity="0.7">
            <animate attributeName="opacity" values="0.3;0.85;0.3" dur="0.9s" begin="0.7s" repeatCount="indefinite" />
          </circle>
          <circle cx="190" cy="332" r="1.5" fill="#c43a1a" opacity="0.6">
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" begin="0.2s" repeatCount="indefinite" />
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
                <animate
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
                <animate
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
                  <animate
                    attributeName="cy"
                    values={`${floorY - 10};${fillY + 4}`}
                    dur={`${b.dur}s`}
                    begin={`${b.delay}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;0.8;0.8;0"
                    keyTimes="0;0.15;0.85;1"
                    dur={`${b.dur}s`}
                    begin={`${b.delay}s`}
                    repeatCount="indefinite"
                  />
                  <animate
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
              filter={`url(#${clipId}-softGlow)`}
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
            <animate
              attributeName="d"
              dur="1.0s"
              repeatCount="indefinite"
              values="
                M130 316 Q 136 280, 146 300 Q 150 274, 160 316 Q 160 338, 145 338 Q 130 338, 130 316 Z;
                M133 316 Q 139 286, 146 296 Q 153 278, 158 316 Q 158 338, 145 338 Q 133 338, 133 316 Z;
                M130 316 Q 136 280, 146 300 Q 150 274, 160 316 Q 160 338, 145 338 Q 130 338, 130 316 Z
              "
            />
            <animate attributeName="opacity" values="0.55;0.75;0.55" dur="1.4s" repeatCount="indefinite" />
          </path>

          {/* Front-right flame — big */}
          <path
            d="M240 312 Q 246 272, 256 296 Q 260 266, 270 312 Q 270 338, 255 338 Q 240 338, 240 312 Z"
            fill={`url(#${clipId}-embersGrad)`}
            opacity="0.6"
          >
            <animate
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
            <animate attributeName="opacity" values="0.5;0.7;0.5" dur="1.6s" begin="0.2s" repeatCount="indefinite" />
          </path>

          {/* Front-center tongue */}
          <path
            d="M190 320 Q 194 296, 200 310 Q 206 294, 210 320 Q 210 338, 200 338 Q 190 338, 190 320 Z"
            fill="#e07418"
            opacity="0.45"
          >
            <animate
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
            <animate attributeName="opacity" values="0.35;0.55;0.35" dur="1.1s" repeatCount="indefinite" />
          </path>

          {/* Extra small left-inner flame */}
          <path
            d="M148 324 Q 152 306, 158 318 Q 162 304, 168 324 Q 168 338, 158 338 Q 148 338, 148 324 Z"
            fill={`url(#${clipId}-flameGrad)`}
            opacity="0.5"
          >
            <animate
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

/* -- Main Component ------------------------------------------ */

export default function CauldronPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const clipId = useId();

  /* -- State -- */
  const [presets, setPresets] = useState<CauldronPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const [stats, setStats] = useState<CauldronStats>({ today: 0, week: 0, total: 0 });
  const [editingPreset, setEditingPreset] = useState<Partial<CauldronPreset> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [flavorIdx, setFlavorIdx] = useState(0);
  const [xpToast, setXpToast] = useState<{ show: boolean; amount: number; desc: string }>({
    show: false,
    amount: 0,
    desc: '',
  });
  const [sessions, setSessions] = useState<(CauldronSession & { presetName?: string | null })[]>([]);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [weeklyFocus, setWeeklyFocus] = useState<CauldronWeeklyFocusDay[]>([]);

  /* -- Refs -- */
  const timerContainerRef = useRef<HTMLDivElement>(null);
  const orbsTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const prevTodayRef = useRef(0);
  const statsRef = useRef<HTMLDivElement>(null);
  const warningFiredRef = useRef(false);

  /* -- Data loaders -- */
  const loadPresets = useCallback(() => {
    window.api.cauldronGetPresets().then((p) => {
      setPresets(p);
      setSelectedPresetId((prev) => {
        if (!prev && p.length > 0) return p[0].id;
        return prev;
      });
    });
  }, []);

  const loadStats = useCallback(() => {
    window.api.cauldronGetStats().then((s) => setStats(s));
  }, []);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => {
      setTimerState(s);
      if (s.presetId) setSelectedPresetId(s.presetId);
    });
  }, []);

  const loadSessions = useCallback((offset = 0) => {
    window.api.cauldronGetSessions(offset, 20).then((result) => {
      if (offset === 0) {
        setSessions(result.sessions as (CauldronSession & { presetName?: string | null })[]);
      } else {
        setSessions((prev) => [...prev, ...(result.sessions as (CauldronSession & { presetName?: string | null })[])]);
      }
      setSessionsHasMore(result.hasMore);
      setSessionsOffset(offset + result.sessions.length);
    });
  }, []);

  const loadWeeklyFocus = useCallback(() => {
    window.api.cauldronGetWeeklyFocusTime().then((data) => setWeeklyFocus(data));
  }, []);

  /* -- Mount: load everything -- */
  useEffect(() => {
    loadPresets();
    loadStats();
    loadState();
    loadSessions(0);
    loadWeeklyFocus();
  }, [loadPresets, loadStats, loadState, loadSessions, loadWeeklyFocus]);

  /* -- Account switch reload -- */
  useEffect(() => {
    const handler = () => {
      loadPresets();
      loadStats();
      loadState();
      loadSessions(0);
      loadWeeklyFocus();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadPresets, loadStats, loadState, loadSessions, loadWeeklyFocus]);

  /* -- Subscribe to tick events -- */
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => {
      setTimerState(state);
      if (state.remainingMs <= 10000 && !warningFiredRef.current) {
        warningFiredRef.current = true;
        playCauldronWarning();
      }
    });
    return cleanup;
  }, []);

  /* -- Subscribe to session end events -- */
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd((result: CauldronSessionEndResult) => {
      warningFiredRef.current = false;

      if (result.sessionType === 'work' && result.completed) {
        if (timerContainerRef.current) brewComplete(timerContainerRef.current);

        if (result.nextType === null) {
          playCauldronCycleEnd();
        } else {
          playCauldronWarning();
        }

        window.api
          .processRpgEvent({
            type: 'POMODORO_COMPLETED',
            moduleId: 'cauldron',
            payload: { xp: 20, hp: 0 },
            timestamp: Date.now(),
          })
          .then(() => {
            window.dispatchEvent(new Event('rpg:statsChanged'));
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          });

        toast({ type: 'xp', message: t('cauldron.pomodoroComplete', 'Brew complete!') });
        setXpToast({ show: true, amount: 20, desc: t('cauldron.pomodoroComplete', 'Brew complete!') });
      } else if (result.sessionType !== 'work' && result.completed) {
        playCauldronWarning();
      }
      loadStats();
      loadSessions(0);
      loadWeeklyFocus();
    });
    return cleanup;
  }, [toast, t, loadStats, loadSessions, loadWeeklyFocus]);

  /* -- XP toast auto-dismiss -- */
  useEffect(() => {
    if (!xpToast.show) return;
    const id = setTimeout(() => setXpToast((prev) => ({ ...prev, show: false })), 2800);
    return () => clearTimeout(id);
  }, [xpToast.show]);

  /* -- Derived state -- */
  const isIdle = !timerState || timerState.status === 'idle';
  const isRunning = timerState?.status === 'work' || timerState?.status === 'on_break';
  const isPaused = timerState?.status === 'work_paused' || timerState?.status === 'break_paused';

  /* -- Timer display calculations -- */
  const remainingSeconds = timerState ? Math.ceil(timerState.remainingMs / 1000) : 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progress =
    timerState && timerState.totalMs > 0 ? 1 - timerState.remainingMs / timerState.totalMs : 0;

  const sessionType: 'work' | 'break' | 'long_break' | 'idle' =
    timerState && !isIdle ? timerState.sessionType : 'idle';

  const sessionTypeClass =
    sessionType === 'work'
      ? 'work'
      : sessionType === 'long_break'
        ? 'long_break'
        : sessionType === 'break'
          ? 'break'
          : '';

  const segmentLabel = isIdle
    ? t('cauldron.readyToBrew', 'Ready to Brew')
    : sessionType === 'work'
      ? t('cauldron.brewing', 'Brewing\u2026')
      : sessionType === 'break'
        ? t('cauldron.resting', 'Resting\u2026')
        : t('cauldron.grandRest', 'Grand Rest\u2026');

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null;

  /* -- GSAP: ambient orbs when timer active -- */
  useEffect(() => {
    if (!isIdle && timerContainerRef.current && !orbsTimelineRef.current) {
      orbsTimelineRef.current = ambientOrbs(timerContainerRef.current);
    } else if (isIdle && orbsTimelineRef.current) {
      orbsTimelineRef.current.kill();
      orbsTimelineRef.current = null;
    }
    return () => {
      orbsTimelineRef.current?.kill();
      orbsTimelineRef.current = null;
    };
  }, [isIdle]);

  /* -- GSAP: stats shimmer on today change -- */
  useEffect(() => {
    if (stats.today > prevTodayRef.current && statsRef.current) {
      statsShimmer(statsRef.current);
    }
    prevTodayRef.current = stats.today;
  }, [stats.today]);

  /* -- Flavor text rotation -- */
  useEffect(() => {
    if (isIdle) return;
    if (isPaused) return;
    const id = setInterval(() => setFlavorIdx((i) => i + 1), 4500);
    return () => clearInterval(id);
  }, [isIdle, isPaused, sessionType]);

  const flavorText = useMemo(() => {
    if (isIdle) return t(`cauldron.flavor.idle.${flavorIdx % FLAVOR_SIZES.idle}`);
    if (isPaused) return t(`cauldron.flavor.paused.${flavorIdx % FLAVOR_SIZES.paused}`);
    const key =
      sessionType === 'work' ? 'work' : sessionType === 'break' ? 'break' : 'longBreak';
    return t(`cauldron.flavor.${key}.${flavorIdx % FLAVOR_SIZES[key]}`);
  }, [isIdle, isPaused, sessionType, flavorIdx, t]);

  /* -- Timer control handlers -- */
  const handleStart = async () => {
    if (!selectedPresetId) return;
    setEditingPreset(null);
    try {
      const state = await window.api.cauldronStart(selectedPresetId);
      setTimerState(state);
      playCauldronStart();
      setFlavorIdx(0);
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  };

  const handlePause = async () => {
    const state = await window.api.cauldronPause();
    setTimerState(state);
    playCauldronPause();
  };

  const handleResume = async () => {
    const state = await window.api.cauldronResume();
    setTimerState(state);
    playCauldronResume();
  };

  const handleSkip = async () => {
    const state = await window.api.cauldronSkip();
    setTimerState(state);
  };

  const handleStop = async () => {
    await window.api.cauldronStop();
    setTimerState(null);
    playCauldronPause();
  };

  /* -- Preset handlers -- */
  const handleCreatePreset = () => {
    setEditingPreset({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLong: 4,
      name: '',
    });
    setIsCreating(true);
  };

  const handleEditPreset = (preset: CauldronPreset) => {
    setEditingPreset({ ...preset });
    setIsCreating(false);
  };

  const handleDeletePreset = async (id: string) => {
    const confirmed = await confirm({
      message: t('cauldron.presets.deleteConfirm', 'Delete this recipe? This cannot be undone.'),
      danger: true,
    });
    if (!confirmed) return;
    await window.api.cauldronDeletePreset(id);
    if (selectedPresetId === id) setSelectedPresetId(null);
    setEditingPreset(null);
    loadPresets();
  };

  const handleSavePreset = async () => {
    if (!editingPreset || !editingPreset.name?.trim()) return;
    const payload: Record<string, unknown> = {
      name: editingPreset.name.trim(),
      workMinutes: editingPreset.workMinutes,
      breakMinutes: editingPreset.breakMinutes,
      longBreakMinutes: editingPreset.longBreakMinutes,
      cyclesBeforeLong: editingPreset.cyclesBeforeLong,
    };
    if (editingPreset.id) payload.id = editingPreset.id;
    try {
      await window.api.cauldronUpsertPreset(payload);
      loadPresets();
      setEditingPreset(null);
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  };

  /* -- Ingredient list for right panel -- */
  const totalCycles = timerState?.totalCycles || selectedPreset?.cyclesBeforeLong || 4;
  const completedCycles = timerState ? timerState.currentCycle - 1 : 0;
  const ingredientItems = useMemo(() => {
    return Array.from({ length: Math.min(totalCycles, INGREDIENT_COUNT) }, (_, i) =>
      t(`cauldron.ingredientNames.${i}`)
    );
  }, [totalCycles, t]);

  /* -- Phase Rune tone -- */
  const phaseTone: 'rubric' | 'sage' | 'gold' | 'ink' =
    sessionType === 'work'
      ? 'rubric'
      : sessionType === 'break'
        ? 'sage'
        : sessionType === 'long_break'
          ? 'gold'
          : 'ink';

  const phaseRuneLabel = isIdle
    ? t('cauldron.idle', 'Idle')
    : sessionType === 'work'
      ? t('cauldron.work', 'Focus')
      : sessionType === 'break'
        ? t('cauldron.break', 'Break')
        : t('cauldron.longBreak', 'Long Break');

  /* -- Render -- */
  return (
    <BookPage
      eyebrow="CALDERO"
      title={t('cauldron.title', 'The Cauldron')}
      subtitle={t(
        'cauldron.subtitle',
        'Brew focus. Rest deliberately. Earn experience for every potion completed.'
      )}
      className="cauldron-book"
    >
      {/* === Active recipe meta === */}
      {selectedPreset && (
        <div className="cauldron-recipe-meta">
          <span className="qb-eyebrow">
            {t('cauldron.recipe', 'RECIPE')} &middot; {selectedPreset.name}
          </span>
          <span className="cauldron-recipe-detail">
            {selectedPreset.workMinutes}m {t('cauldron.work', 'Focus').toLowerCase()} &middot;{' '}
            {selectedPreset.breakMinutes}m {t('cauldron.break', 'Break').toLowerCase()} &middot;{' '}
            {selectedPreset.longBreakMinutes}m{' '}
            {t('cauldron.longBreak', 'Long Break').toLowerCase()} &middot; &times;
            {selectedPreset.cyclesBeforeLong}
          </span>
        </div>
      )}

      {/* === Preset pills === */}
      <div className="cauldron-presets" role="tablist" aria-label={t('cauldron.presets.title', 'Presets')}>
        <HelpBubble variant="inline" text={t('cauldron.presetsHelp', 'Recetas definen tiempos de trabajo, descanso y ciclos. Podés crear recetas personalizadas.')} />
        {presets.map((p) => (
          <button
            key={p.id}
            className={`cauldron-preset-pill${selectedPresetId === p.id ? ' selected' : ''}`}
            onClick={() => setSelectedPresetId(p.id)}
            role="tab"
            aria-selected={selectedPresetId === p.id}
          >
            <span className="cauldron-preset-name">{p.name}</span>
            <span className="cauldron-preset-config">
              {p.workMinutes}m &middot; {p.breakMinutes}m &middot; {p.cyclesBeforeLong}&times;
            </span>
          </button>
        ))}
        <button className="cauldron-preset-pill add" onClick={handleCreatePreset}>
          + {t('cauldron.presets.createRecipe', 'New Recipe')}
        </button>
        {selectedPreset && !selectedPreset.isDefault && (
          <button
            className="cauldron-edit-btn"
            onClick={() => handleEditPreset(selectedPreset)}
          >
            {t('cauldron.presets.editRecipe', 'Edit Recipe')}
          </button>
        )}
      </div>

      {/* === Timer Hero (2-column grid) === */}
      <section className="cauldron-timer-hero" data-tour="cauldron">
        {/* -- Left Column: Cauldron Stage -- */}
        <div
          ref={timerContainerRef}
          className={`cauldron-stage${!isIdle ? ' active' : ''}`}
        >
          {/* Visual wrapper — positions particles relative to cauldron */}
          <div className="cauldron-visual">
            <CauldronSVGComponent
              progress={isIdle ? 0 : progress}
              sessionType={sessionType}
              paused={!!isPaused}
              clipId={clipId}
            />

            {/* Embers float up from under cauldron */}
            <div className="cauldron-embers">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="cauldron-ember" />
              ))}
            </div>

            {/* Steam rises from cauldron rim */}
            {isRunning && (
              <div className="cauldron-steam-wrap">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="cauldron-steam" />
                ))}
              </div>
            )}
          </div>

          {/* Session label as Rune tag */}
          <Rune tone={phaseTone}>{segmentLabel}</Rune>

          {/* Time remaining in Fraktur */}
          <div className="cauldron-time-remaining">{timeDisplay}</div>

          {/* Cycle dots */}
          {timerState && !isIdle && (
            <div className="cauldron-cycles">
              {Array.from({ length: timerState.totalCycles }).map((_, i) => {
                const isDone = i + 1 < timerState.currentCycle;
                const isCurrent = i + 1 === timerState.currentCycle;
                const workMin = selectedPreset?.workMinutes ?? 25;
                const dotTitle = isDone
                  ? `${String(workMin).padStart(2, '0')}:00`
                  : isCurrent
                    ? segmentLabel
                    : undefined;
                return (
                  <div
                    key={i}
                    className={`cauldron-cycle-dot${isDone ? ' done' : isCurrent ? ' current' : ''}`}
                    title={dotTitle}
                  />
                );
              })}
              <span className="cauldron-cycle-cap">
                {timerState.currentCycle}/{timerState.totalCycles}
              </span>
            </div>
          )}

          {/* Flavor text */}
          <div className="cauldron-flavor" key={`${flavorIdx}-${sessionType}`}>
            {flavorText}
          </div>
        </div>

        {/* -- Right Column: Now Brewing + Ingredients -- */}
        <div className="cauldron-right-panel">
          {/* Now Brewing card */}
          <Section
            title={t('cauldron.nowBrewing', 'Now Brewing')}
            icon={<CauldronIcon width={16} height={16} />}
            rightSlot={<><HelpBubble variant="inline" text={t('cauldron.nowBrewingHelp', 'Sesión activa de pomodoro. Muestra el temporizador, la receta y el ciclo actual.')} /><Rune tone={phaseTone}>{phaseRuneLabel}</Rune></>}
          >
            {selectedPreset ? (
              <>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.recipe', 'Recipe')}</span>
                  <span className="cauldron-kv-value">{selectedPreset.name}</span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.work', 'Focus')}</span>
                  <span className="cauldron-kv-value rubric">{selectedPreset.workMinutes}:00</span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.break', 'Break')}</span>
                  <span className="cauldron-kv-value sage">{selectedPreset.breakMinutes}:00</span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.longBreak', 'Long Break')}</span>
                  <span className="cauldron-kv-value gold">
                    {selectedPreset.longBreakMinutes}:00
                  </span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">
                    {t('cauldron.presets.cycles', 'Cycles')}
                  </span>
                  <span className="cauldron-kv-value">
                    {completedCycles} / {totalCycles}
                  </span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.reward', 'Reward')}</span>
                  <span className="cauldron-kv-value gold">+20 XP</span>
                </div>

                {/* Phase Progress Gauge */}
                <div className="cauldron-progress-row">
                  <Gauge
                    value={Math.round(progress * 100)}
                    max={100}
                    tone={phaseTone}
                    label={`${Math.round(progress * 100)}%`}
                    showPips
                  />
                </div>

                {/* Controls */}
                <div className="cauldron-controls">
                  {isIdle && (
                    <button className="cauldron-btn cauldron-btn--primary" onClick={handleStart} disabled={!selectedPresetId}>
                      <Flame width={14} height={14} /> {t('cauldron.startBrew', 'Start Brew')}
                    </button>
                  )}
                  {isRunning && (
                    <>
                      <button className="cauldron-btn" onClick={handlePause}>
                        {t('cauldron.pause', 'Pause')}
                      </button>
                      <button className="cauldron-btn" onClick={handleSkip}>
                        {t('cauldron.skip', 'Skip')}
                      </button>
                      <button className="cauldron-btn cauldron-btn--danger" onClick={handleStop}>
                        {t('cauldron.stop', 'Stop')}
                      </button>
                    </>
                  )}
                  {isPaused && (
                    <>
                      <button className="cauldron-btn cauldron-btn--primary" onClick={handleResume}>
                        {t('cauldron.resume', 'Resume')}
                      </button>
                      <button className="cauldron-btn cauldron-btn--danger" onClick={handleStop}>
                        {t('cauldron.stop', 'Stop')}
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="cauldron-kv-value">
                {t('cauldron.noBrewInProgress', 'No brew in progress')}
              </div>
            )}
          </Section>

          {/* Ingredients card */}
          <Section
            title={t('cauldron.ingredients', 'Ingredients')}
            icon={<Potion width={16} height={16} />}
            rightSlot={<HelpBubble variant="inline" text={t('cauldron.ingredientsHelp', 'Ciclos completados de la sesión. Cada ingrediente representa un pomodoro terminado.')} />}
          >
            <ul className="cauldron-ingredients">
              {ingredientItems.map((name, i) => (
                <li key={i} className={i < completedCycles ? 'done' : ''}>
                  <Tick checked={i < completedCycles} />
                  <span className={i < completedCycles ? 'cauldron-ingredient-done' : ''}>{name}</span>
                </li>
              ))}
            </ul>
            <div className="cauldron-ingredient-note">
              {t('cauldron.ingredientNote', 'Each completed cycle adds an ingredient to the recipe.')}
            </div>
          </Section>
        </div>
      </section>

      {/* === Statistics === */}
      <Section title={t('cauldron.stats.title', 'Brewing Log')} icon={<Flame width={14} height={14} />} rightSlot={<HelpBubble variant="inline" text={t('cauldron.statsHelp', 'Sesiones completadas: hoy, esta semana y total histórico. Cada ciclo completado otorga XP.')} />}>
        <div className="cauldron-stats-grid" ref={statsRef}>
          <Cartouche
            label={t('cauldron.stats.today', 'Today')}
            value={stats.today}
            icon={<CauldronIcon width={14} height={14} />}
          />
          <Cartouche
            label={t('cauldron.stats.week', 'This Week')}
            value={stats.week}
          />
          <Cartouche
            label={t('cauldron.stats.total', 'Total')}
            value={stats.total}
          />
          <Cartouche
            label={t('cauldron.stats.streak', 'Streak')}
            value={stats.today > 0 ? `${stats.today}` : '0'}
            icon={stats.today > 0 ? <Flame width={14} height={14} /> : undefined}
          />
        </div>
      </Section>

      {/* === Weekly Focus Chart === */}
      <Section
        title={t('cauldron.weeklyFocus.title', 'Weekly Focus')}
        icon={<CauldronIcon width={14} height={14} />}
        rightSlot={<HelpBubble variant="inline" text={t('cauldron.weeklyFocusHelp', 'Ciclos completados por día en la última semana. Visualizá tu consistencia de enfoque.')} />}
      >
        {weeklyFocus.length > 0 && weeklyFocus.some((d) => d.value > 0) ? (
          <CastleBarChart
            data={weeklyFocus.map((d) => ({
              label: d.label,
              value: d.value,
              status: 'ok' as const,
            }))}
            height={200}
            themed
          />
        ) : (
          <div className="cauldron-empty-state">
            {t('cauldron.history.noSessions', 'No sessions recorded yet.')}
          </div>
        )}
      </Section>

      {/* === Session History === */}
      <Section
        title={t('cauldron.history.title', 'Session History')}
        icon={<Potion width={14} height={14} />}
        rightSlot={
          <>
            <HelpBubble variant="inline" text={t('cauldron.historyHelp', 'Registro de sesiones completadas con fecha, receta utilizada y ciclos logrados.')} />
            <button
              className="cauldron-collapse-toggle"
              onClick={() => setHistoryOpen((prev) => !prev)}
              aria-expanded={historyOpen}
            >
              {historyOpen ? '\u25B2' : '\u25BC'}
            </button>
          </>
        }
      >
        {historyOpen && (
          <>
            {sessions.length === 0 ? (
              <div className="cauldron-empty-state">
                {t('cauldron.history.noSessions', 'No sessions recorded yet.')}
              </div>
            ) : (
              <ul className="cauldron-session-list">
                {sessions.map((s) => {
                  const date = new Date(s.startedAt);
                  const dateStr = date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });
                  const timeStr = date.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <li key={s.id} className="cauldron-session-item">
                      <span className="cauldron-session-date">
                        {dateStr} &middot; {timeStr}
                      </span>
                      <span className="cauldron-session-detail">
                        {s.durationMinutes} {t('cauldron.weeklyFocus.unit', 'min')} &middot;{' '}
                        {s.presetName ?? t('cauldron.history.unknownPreset', 'Unknown recipe')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {sessionsHasMore && (
              <button
                className="cauldron-btn cauldron-load-more"
                onClick={() => loadSessions(sessionsOffset)}
              >
                {t('cauldron.history.loadMore', 'Load more')}
              </button>
            )}
          </>
        )}
      </Section>

      {/* === XP Toast === */}
      <div className={`cauldron-xp-toast${xpToast.show ? ' show' : ''}`}>
        <div>
          <div className="cauldron-xp-label">{t('cauldron.questReward', 'Quest Reward')}</div>
          <div className="cauldron-xp-amount">+{xpToast.amount} XP</div>
        </div>
        <div className="cauldron-xp-desc">{xpToast.desc}</div>
      </div>

      {/* === Preset Editor Modal === */}
      {editingPreset && createPortal(
        <div className="cauldron-modal-overlay" onClick={() => setEditingPreset(null)}>
          <div
            className="cauldron-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cauldron-modal-head">
              <h2 className="cauldron-modal-title">
                {isCreating
                  ? t('cauldron.presets.createRecipe', 'Forge New Brew')
                  : t('cauldron.presets.editRecipe', 'Edit Brew')}
              </h2>
              <HelpBubble text={t('cauldron.editPresetHelp', 'Ciclos antes del descanso largo: tras N ciclos seguidos, se activa el descanso largo.')} />
              <button
                className="cauldron-modal-close"
                onClick={() => setEditingPreset(null)}
                aria-label={t('common.close', 'Close')}
              >
                {'\u2715'}
              </button>
            </div>
            <div className="cauldron-form-grid">
              <div className="full">
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.name', 'Brew Name')}
                </label>
                <input
                  className="cauldron-input"
                  value={editingPreset.name || ''}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, name: e.target.value })
                  }
                  maxLength={32}
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.workMin', 'Work (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="180"
                  value={editingPreset.workMinutes || 25}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      workMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.breakMin', 'Break (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="60"
                  value={editingPreset.breakMinutes || 5}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      breakMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.longBreakMin', 'Long Break (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="120"
                  value={editingPreset.longBreakMinutes || 15}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      longBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.cycles', 'Cycles')}
                </label>
                <select
                  className="cauldron-select cauldron-mono"
                  value={editingPreset.cyclesBeforeLong || 4}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      cyclesBeforeLong: parseInt(e.target.value, 10),
                    })
                  }
                >
                  {[2, 3, 4, 5, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <CyclePreviewBar preset={editingPreset as CauldronPreset} />
            <div className="cauldron-modal-actions">
              {!isCreating && editingPreset.id && !editingPreset.isDefault && (
                <button
                  className="cauldron-btn cauldron-btn--danger"
                  onClick={() => handleDeletePreset(editingPreset.id!)}
                >
                  {t('cauldron.presets.delete', 'Discard Recipe')}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="cauldron-btn" onClick={() => setEditingPreset(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                className="cauldron-btn cauldron-btn--primary"
                onClick={handleSavePreset}
                disabled={!editingPreset.name?.trim()}
              >
                {t('common.save', 'Save Brew')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </BookPage>
  );
}
