import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonthNavigator } from './shared/MonthNavigator';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { Section, Gauge, Cartouche } from '../../../shared/components/codex/CodexPrimitives';
import { SparklineChart } from '../../../shared/components/charts';
import { Scale, Key, Compass, ArrowUp, ArrowDown, ChevronRight, Pencil, CrossMark, Checkmark } from '../../../shared/components/icons';
import { useToast } from '../../../shared/components/useToast';
import HelpBubble from '../../../shared/components/HelpBubble';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import { formatCurrency, formatCurrencyCompact, currencyPrefix } from '../utils/format';
import { sliceAngles, sliceShape, ringArc } from '../utils/wheel-paths';
import { projectionCoords } from '../utils/projection-scale';
import {
  getExpenseBreakdown,
  getExpenseBreakdownForRange,
  getBudgetStatus,
  setBudget,
  hasBudgetSupport,
  getAccountsOverview,
  hasAccountsSupport,
  type AccountsOverview,
  type ExpenseBreakdownByCurrency,
  type BudgetStatus,
} from '../utils/api-ext';
import AccountManager from './shared/AccountManager';
import { AccountKindGlyph } from './shared/AccountGlyphs';
import { ensureRecurringGenerated, resetRecurringGuard, realCurrentMonth } from '../utils/ensure-recurring';
import { checkBudgetMonthClose, resetBudgetGuards } from '../utils/budget-guards';
import { playCoinClink } from '../../../shared/audio';
import {
  FX_HOUSE_EVENT,
  getUpcoming,
  getValuedView,
  hasUpcomingSupport,
  hasValuedViewSupport,
  useDisplayMode,
  type UpcomingTimeline,
  type ValuedView,
} from '../utils/display-mode';

// ── Types ──

interface CurrencyBalance {
  income: number;
  expenses: number;
  balance: number;
}

interface MonthlyBalance {
  ARS: CurrencyBalance;
  USD: CurrencyBalance;
}

interface CategoryBreakdown {
  category: string;
  ARS: number;
  USD: number;
}

interface ProjectionMonth {
  month: string;
  installments: number;
  recurring: number;
  total: number;
  ARS?: { installments: number; recurring: number; total: number };
  USD?: { installments: number; recurring: number; total: number };
}

interface LoanSideSummary {
  lent: number;
  borrowed: number;
  lentPending: number;
  borrowedPending: number;
}

interface LoanSummary {
  ARS: LoanSideSummary;
  USD: LoanSideSummary;
  /** Legacy flat ARS fields, kept by the backend for older consumers. */
  lent: number;
  borrowed: number;
}

const EMPTY_LOAN_SIDE: LoanSideSummary = { lent: 0, borrowed: 0, lentPending: 0, borrowedPending: 0 };
const EMPTY_LOANS: LoanSummary = { ARS: EMPTY_LOAN_SIDE, USD: EMPTY_LOAN_SIDE, lent: 0, borrowed: 0 };

type RangeMode = 'month' | 'quarter' | 'year' | 'all';

/** The oldest / newest month the "Todo" range can reach. */
const ALL_START_MONTH = '1970-01';
const ALL_END_MONTH = '2999-12';

// ── Helpers ──

const CATEGORY_COLORS = ['#6b4a2b', '#7a1e1e', '#556b3c', '#a88a3c', '#8a6a3d', '#3a2513', '#5c3a1e', '#4a3520', '#cd853f', '#bc8f8f'];

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getPrevMonth(month: string): string {
  return addMonths(month, -1);
}

/** "agosto 2026" / "August 2026" — for prose, not for a header. */
function monthLabel(month: string, language: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(y, m - 1).toLocaleDateString(language === 'en' ? 'en-US' : 'es', { month: 'long' });
  return `${name} ${y}`;
}

/** Inclusive [start, end] month pair for the selected range mode. */
function rangeBounds(month: string, mode: RangeMode): { startMonth: string; endMonth: string } {
  if (mode === 'month') return { startMonth: month, endMonth: month };
  // A quarter is three months, ending on the navigated month.
  if (mode === 'quarter') return { startMonth: addMonths(month, -2), endMonth: month };
  if (mode === 'year') {
    const y = month.split('-')[0];
    return { startMonth: `${y}-01`, endMonth: `${y}-12` };
  }
  return { startMonth: ALL_START_MONTH, endMonth: ALL_END_MONTH };
}

// ── Inline SVGs ──

function ChestGlyph() {
  return (
    <svg width="86" height="86" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Wood grain gradient */}
        <linearGradient id="chestWood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6b4c2a" />
          <stop offset="30%" stopColor="#5a3e20" />
          <stop offset="70%" stopColor="#4a3218" />
          <stop offset="100%" stopColor="#3a2510" />
        </linearGradient>
        {/* Lid gradient (slightly lighter) */}
        <linearGradient id="chestLid" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7a5c34" />
          <stop offset="40%" stopColor="#6b4c2a" />
          <stop offset="100%" stopColor="#4a3218" />
        </linearGradient>
        {/* Iron band gradient */}
        <linearGradient id="chestIron" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4a4038" />
          <stop offset="50%" stopColor="#2b2420" />
          <stop offset="100%" stopColor="#1a1510" />
        </linearGradient>
        {/* Gold lock gradient */}
        <radialGradient id="chestGold" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#d4a84e" />
          <stop offset="50%" stopColor="#a88a3c" />
          <stop offset="100%" stopColor="#6a5520" />
        </radialGradient>
        {/* Wood shine */}
        <radialGradient id="chestShine" cx="30%" cy="25%" r="70%">
          <stop offset="0%" stopColor="rgba(255,220,170,0.18)" />
          <stop offset="50%" stopColor="rgba(255,220,170,0.06)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        {/* Soft glow filter */}
        <filter id="chestGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Clip for elements inside the lid curve */}
        <clipPath id="chestLidClip">
          <path d="M 28 100 L 28 72 Q 28 38 100 38 Q 172 38 172 72 L 172 100 Z" />
        </clipPath>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="100" cy="178" rx="72" ry="8" fill="rgba(0,0,0,0.25)" filter="url(#chestGlow)" />

      {/* ── CHEST BODY ── */}
      <rect x="28" y="100" width="144" height="72" rx="3" fill="url(#chestWood)" stroke="#1a1510" strokeWidth="1.5" />
      {/* Wood shine overlay */}
      <rect x="28" y="100" width="144" height="72" rx="3" fill="url(#chestShine)" />

      {/* Wood plank lines */}
      <g stroke="#2a1d10" strokeWidth="0.6" opacity="0.5">
        <line x1="32" y1="124" x2="168" y2="124" />
        <line x1="32" y1="148" x2="168" y2="148" />
        {/* Vertical grain */}
        <line x1="60" y1="102" x2="58" y2="170" />
        <line x1="100" y1="102" x2="100" y2="170" />
        <line x1="140" y1="102" x2="142" y2="170" />
      </g>

      {/* ── CHEST LID ── */}
      <path
        d="M 28 100 L 28 72 Q 28 38 100 38 Q 172 38 172 72 L 172 100 Z"
        fill="url(#chestLid)" stroke="#1a1510" strokeWidth="1.5"
      />
      <path
        d="M 28 100 L 28 72 Q 28 38 100 38 Q 172 38 172 72 L 172 100 Z"
        fill="url(#chestShine)"
      />

      {/* Lid plank curves */}
      <g stroke="#2a1d10" strokeWidth="0.6" opacity="0.4">
        <path d="M 32 80 Q 100 62 168 80" fill="none" />
        <path d="M 34 92 Q 100 80 166 92" fill="none" />
      </g>

      {/* ── IRON BANDS (vertical straps — lid portion, clipped to curve) ── */}
      <g clipPath="url(#chestLidClip)">
        <rect x="44" y="30" width="10" height="70" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="0.8" />
        <rect x="44" y="30" width="4" height="70" fill="rgba(255,220,170,0.06)" />
        <rect x="146" y="30" width="10" height="70" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="0.8" />
        <rect x="146" y="30" width="4" height="70" fill="rgba(255,220,170,0.06)" />
      </g>

      {/* ── IRON BANDS (vertical straps — body portion) ── */}
      <rect x="44" y="100" width="10" height="72" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="0.8" />
      <rect x="44" y="100" width="4" height="72" fill="rgba(255,220,170,0.06)" />
      <rect x="146" y="100" width="10" height="72" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="0.8" />
      <rect x="146" y="100" width="4" height="72" fill="rgba(255,220,170,0.06)" />

      {/* ── IRON BANDS (horizontal) ── */}
      <rect x="24" y="96" width="152" height="10" rx="2" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="1" />
      <rect x="24" y="96" width="152" height="4" fill="rgba(255,220,170,0.08)" rx="1" />
      <rect x="24" y="160" width="152" height="10" rx="2" fill="url(#chestIron)" stroke="#0a0604" strokeWidth="1" />
      <rect x="24" y="160" width="152" height="4" fill="rgba(255,220,170,0.08)" rx="1" />

      {/* ── RIVETS (on lid — clipped) ── */}
      {[[49, 58], [49, 78], [151, 58], [151, 78]].map(([x, y], i) => (
        <g key={`rl-${i}`} clipPath="url(#chestLidClip)">
          <circle cx={x} cy={y} r={3} fill="#2a2018" stroke="#0a0604" strokeWidth="0.8" />
          <circle cx={x - 0.5} cy={y - 0.8} r={1.2} fill="rgba(255,220,170,0.35)" />
        </g>
      ))}
      {/* ── RIVETS (on body — band intersections + edges) ── */}
      {[
        [49, 101], [151, 101], [49, 132], [151, 132], [49, 165], [151, 165],
        [30, 101], [76, 101], [124, 101], [170, 101],
        [30, 165], [76, 165], [124, 165], [170, 165],
      ].map(([x, y], i) => (
        <g key={`rb-${i}`}>
          <circle cx={x} cy={y} r={3} fill="#2a2018" stroke="#0a0604" strokeWidth="0.8" />
          <circle cx={x - 0.5} cy={y - 0.8} r={1.2} fill="rgba(255,220,170,0.35)" />
        </g>
      ))}

      {/* ── LOCK PLATE ── */}
      <rect x="82" y="90" width="36" height="30" rx="4" fill="url(#chestGold)" stroke="#4a3520" strokeWidth="1.2" />
      <rect x="84" y="91" width="14" height="7" rx="2" fill="rgba(255,255,220,0.25)" />
      {/* Keyhole */}
      <circle cx="100" cy="100" r="4" fill="#1a0f08" stroke="#4a3520" strokeWidth="0.8" />
      <rect x="98" y="103" width="4" height="7" rx="1" fill="#1a0f08" stroke="#4a3520" strokeWidth="0.6" />

      {/* ── DECORATIVE COINS scattered ── */}
      {[
        { cx: 22, cy: 180, r: 5 },
        { cx: 34, cy: 184, r: 4 },
        { cx: 14, cy: 184, r: 3.5 },
        { cx: 174, cy: 182, r: 5 },
        { cx: 184, cy: 186, r: 3.5 },
      ].map((coin, i) => (
        <g key={i}>
          <circle cx={coin.cx} cy={coin.cy} r={coin.r} fill="url(#chestGold)" stroke="#4a3520" strokeWidth="0.6" />
          <circle cx={coin.cx - 0.5} cy={coin.cy - 1} r={coin.r * 0.4} fill="rgba(255,255,220,0.3)" />
        </g>
      ))}

      {/* ── SPARKLE accents ── */}
      <g stroke="#a88a3c" strokeWidth="1" opacity="0.7">
        <path d="M18 30 L18 38 M14 34 L22 34" />
        <path d="M178 24 L178 30 M175 27 L181 27" />
        <circle cx="186" cy="40" r="1" fill="#a88a3c" />
        <circle cx="12" cy="42" r="0.8" fill="#a88a3c" />
      </g>
    </svg>
  );
}

function ChestClickable({ onToggle }: { onToggle?: () => void }) {
  const [bounce, setBounce] = useState(false);

  const handleClick = () => {
    playCoinClink();
    setBounce(true);
    setTimeout(() => setBounce(false), 500);
    // Opens the chest into its account rows once the accounts bridge is wired.
    onToggle?.();
  };

  return (
    <button
      type="button"
      className={`coin-chest-btn${bounce ? ' coin-chest-btn--bounce' : ''}`}
      onClick={handleClick}
      aria-label="Treasure chest"
    >
      <ChestGlyph />
    </button>
  );
}

/**
 * The expense wheel — and, since phase 2, the budget too.
 *
 * A category with a monthly limit gets a thin outer ring spanning exactly its
 * own slice, filled with the share of the limit already spent. Same slice, same
 * angle, one extra stroke: the budget is not a second screen, it is an attribute
 * of the picture that was already there. Over the limit, the ring goes full and
 * turns `--rubric`.
 *
 * `budgetPct` is keyed by category label and is UNCLAMPED (120 means 20% over).
 */
function CategoryWheel({
  data,
  total,
  budgetPct,
  currency = 'ARS',
}: {
  data: { label: string; value: number; color: string }[];
  total: number;
  budgetPct?: Map<string, number>;
  /** Unit the centre total prints in (the slices are unitless shares). */
  currency?: 'ARS' | 'USD';
}) {
  if (data.length === 0 || total === 0) return null;

  const r = 54, cx = 70, cy = 70;
  const geom = { cx, cy, r };
  const ringR = 62;
  const centreLabel = formatCurrencyCompact(total, currency);
  // The hole is 56px across; shrink the type once the label outgrows it.
  const centreFontSize = centreLabel.length <= 8 ? 16 : centreLabel.length <= 11 ? 13 : 11;
  // COIN-01: the geometry lives in utils/wheel-paths — a single 100 % slice
  // used to be an arc whose ends met, which SVG draws as nothing.
  const angles = sliceAngles(data.map((d) => d.value), total);

  return (
    <svg viewBox="0 0 140 140" style={{ width: '100%', maxWidth: 160, display: 'block', margin: '0 auto' }}>
      {data.map((d, i) => {
        const { start, end } = angles[i];
        const shape = sliceShape(geom, start, end);
        if (shape.kind === 'empty') return null;

        const bPct = budgetPct?.get(d.label);
        const hasBudget = bPct !== undefined;
        const filled = hasBudget ? Math.min(bPct, 100) / 100 : 0;
        const over = hasBudget && bPct > 100;
        const sliceAttrs = { fill: d.color, opacity: '.75', stroke: 'var(--parch-1)', strokeWidth: '1.5' };

        return (
          <g key={i}>
            {shape.kind === 'circle'
              ? <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...sliceAttrs} />
              : <path d={shape.d} {...sliceAttrs} />}
            {hasBudget && (
              <>
                {/* Track: how much of this slice's ring is "the limit". */}
                <path d={ringArc(geom, ringR, start, end)} fill="none" stroke="var(--ink-faded)" strokeWidth="2" opacity=".35" strokeLinecap="butt" />
                {filled > 0 && (
                  <path
                    d={ringArc(geom, ringR, start, start + (end - start) * filled)}
                    fill="none"
                    stroke={over ? 'var(--rubric)' : 'var(--moss)'}
                    strokeWidth="2.5"
                    strokeLinecap="butt"
                  />
                )}
              </>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="28" fill="rgba(245,231,192,.9)" stroke="var(--ink)" strokeWidth="0.8" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11" fontFamily="'IM Fell English SC',serif" fill="var(--rubric)">TOTAL</text>
      {/* Abbreviated and size-clamped: the raw grouped number is wider than the
          hole and used to print straight over the slices. */}
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontSize={centreFontSize}
        fontFamily="'UnifrakturCook',serif"
        fill="var(--ink)"
      >
        <title>{formatCurrency(total, { currency })}</title>
        {centreLabel}
      </text>
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--ink-faded)" strokeWidth="0.5" />
    </svg>
  );
}

function ProjectionChart({ data }: { data: ProjectionMonth[] }) {
  if (data.length === 0) return null;

  const pts = data.map((d) => d.total);
  const w = 280, h = 100;

  // Pure (projection-scale.ts): a flat series — every month at 0 for a user
  // without movements — used to normalise as 0/0 and paint NaN into the SVG.
  const coords = projectionCoords(pts, w, h);
  const d = coords.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h + 10}`} style={{ width: '100%' }}>
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1="0" y1={h * f} x2={w} y2={h * f} stroke="rgba(74,55,32,.2)" strokeWidth="0.5" strokeDasharray="2 3" />
      ))}
      <path d={d + ` L${w} ${h} L0 ${h} Z`} fill="rgba(74,55,32,.1)" />
      <path d={d} stroke="var(--ink)" strokeWidth="1.2" fill="none" />
      {coords.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill={i < 1 ? 'var(--moss)' : 'var(--rubric)'} stroke="var(--ink)" strokeWidth="0.7" />
          {/* First and last points sit on the viewBox edge — anchoring them
              'middle' clipped half of each number away. */}
          <text
            x={p[0]}
            y={p[1] - 6}
            textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}
            fontSize="9"
            fontFamily="'UnifrakturCook',serif"
            fill="var(--ink)"
          >
            {formatCurrencyCompact(pts[i], 'ARS')}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Component ──

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [refreshKey, setRefreshKey] = useState(0);

  const [balance, setBalance] = useState<MonthlyBalance | null>(null);
  const [prevBalance, setPrevBalance] = useState<MonthlyBalance | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [breakdown, setBreakdown] = useState<ExpenseBreakdownByCurrency | null>(null);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loans, setLoans] = useState<LoanSummary>(EMPTY_LOANS);
  const [installmentCount, setInstallmentCount] = useState(0);
  const [pendingCC, setPendingCC] = useState<{ ARS: number; USD: number }>({ ARS: 0, USD: 0 });
  const [monthlyExpenses, setMonthlyExpenses] = useState<number[]>([]);
  const [showPrevComparison, setShowPrevComparison] = useState(false);
  /** Budget vs. reality for the navigated month. `null` = no budgets, or no bridge. */
  const [budgets, setBudgets] = useState<BudgetStatus | null>(null);
  /** ARS → USD → ARS de hoy — cycled from the DollarChip in the header. */
  const mode = useDisplayMode();
  /** Valued dashboard (USD / ARS de hoy / real trend). `null` = bridge not wired. */
  const [valued, setValued] = useState<ValuedView | null>(null);
  /** 30-day money-out timeline. `null` = bridge not wired (old chart shows). */
  const [upcoming, setUpcoming] = useState<UpcomingTimeline | null>(null);
  /** The chest, opened: per-account balances. `null` = bridge not wired. */
  const [accountsOverview, setAccountsOverview] = useState<AccountsOverview | null>(null);
  /**
   * Whether the chest shows its rows. NOT sticky: the list floats over the
   * content instead of pushing it (clicking the chest used to shove the whole
   * column down), and a remembered floating panel would sit on top of the
   * wheel forever. The collapsed strip already carries the total at a glance.
   */
  const [chestOpen, setChestOpen] = useState(false);
  const chestPanelRef = useRef<HTMLDivElement | null>(null);
  const [showAccountManager, setShowAccountManager] = useState(false);
  /** Category whose limit is being typed inline in the legend. */
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in');
  const isFirstLoad = useRef(true);

  const { startMonth, endMonth } = useMemo(() => rangeBounds(month, rangeMode), [month, rangeMode]);

  // Fetch range-dependent data
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!isFirstLoad.current) {
          setFadeState('out');
          await new Promise((r) => setTimeout(r, 150));
        }
        setLoading(true);

        if (rangeMode === 'month') {
          const prevMonth = getPrevMonth(month);
          const [bal, prev, cats, bd] = await Promise.all([
            window.api.financeGetMonthlyBalance(month) as Promise<MonthlyBalance>,
            window.api.financeGetMonthlyBalance(prevMonth) as Promise<MonthlyBalance>,
            window.api.financeGetCategoryBreakdown(month) as Promise<CategoryBreakdown[]>,
            getExpenseBreakdown(month),
          ]);
          setBalance(bal);
          setPrevBalance(prev);
          setCategories(cats);
          setBreakdown(bd);
        } else {
          const [bal, cats, bd] = await Promise.all([
            window.api.financeGetBalanceForRange(startMonth, endMonth) as Promise<MonthlyBalance>,
            window.api.financeGetCategoryBreakdownForRange(startMonth, endMonth) as Promise<CategoryBreakdown[]>,
            getExpenseBreakdownForRange(startMonth, endMonth),
          ]);
          setBalance(bal);
          setPrevBalance(null);
          setCategories(cats);
          setBreakdown(bd);
        }

        isFirstLoad.current = false;
      } catch (err) {
        console.error('[Dashboard] loadDashboard failed:', err);
        toast({ type: 'warning', message: t('coinify.loadError', 'Error al cargar datos') });
        setFadeState('in');
      } finally {
        setLoading(false);
        setFadeState('in');
      }
    };

    fetchData();
  }, [month, rangeMode, startMonth, endMonth, refreshKey]);

  /**
   * The month these secondary panels answer for. "Todo" has no meaningful anchor
   * (its range ends in the year 2999), so it falls back to the real current month;
   * every other range anchors on the last month it covers.
   */
  const anchorMonth = rangeMode === 'all' ? realCurrentMonth() : endMonth;

  /**
   * Panels that follow the navigated period. They used to be hard-anchored to
   * today while sitting under a header naming a different month.
   *
   * `financeGetCreditCardStatements({ status: 'pending' })` is the one deliberate
   * exception: an unpaid statement is a present-tense debt, not a historical
   * figure, so it stays "as of today" — and the copy says so instead of leaving a
   * rune to explain it.
   */
  const loadPeriodData = useCallback((forMonth: string) => {
    window.api.financeGetProjection(3, forMonth).then((data) => setProjection(data as ProjectionMonth[])).catch((err) => console.error('[Dashboard] financeGetProjection failed:', err));
    window.api.financeGetActiveLoanSummary(forMonth).then((data) => setLoans({ ...EMPTY_LOANS, ...(data as LoanSummary) })).catch((err) => console.error('[Dashboard] financeGetActiveLoanSummary failed:', err));
    window.api.financeGetInstallmentGroups(forMonth).then((data) => setInstallmentCount((data as unknown[]).length)).catch((err) => console.error('[Dashboard] financeGetInstallmentGroups failed:', err));
    window.api.financeGetCreditCardStatements({ status: 'pending' }).then((data) => {
      const rows = data as Array<{ calculatedAmount?: number; calculatedAmountUsd?: number }>;
      setPendingCC({
        ARS: rows.reduce((sum, s) => sum + (s.calculatedAmount ?? 0), 0),
        USD: rows.reduce((sum, s) => sum + (s.calculatedAmountUsd ?? 0), 0),
      });
    }).catch((err) => console.error('[Dashboard] financeGetCreditCardStatements failed:', err));
    window.api.financeGetMonthlyExpenses(forMonth).then((data) => setMonthlyExpenses(data)).catch((err) => console.error('[Dashboard] financeGetMonthlyExpenses failed:', err));
  }, []);

  useEffect(() => { loadPeriodData(anchorMonth); }, [loadPeriodData, anchorMonth, refreshKey]);

  /**
   * Valued view: the same dashboard in USD (each amount with its own frozen
   * rate) and in today's pesos. Loaded for the monthly view even in ARS mode —
   * the «nominal · real» trend footer lives in it.
   */
  useEffect(() => {
    if (rangeMode !== 'month' || !hasValuedViewSupport()) { setValued(null); return; }
    let cancelled = false;
    getValuedView(month).then((view) => { if (!cancelled) setValued(view); });
    return () => { cancelled = true; };
  }, [month, rangeMode, refreshKey]);

  // A new preferred house means every converted figure is stale: the chip
  // showed the new rate while the dashboard kept the old conversion.
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener(FX_HOUSE_EVENT, handler);
    return () => window.removeEventListener(FX_HOUSE_EVENT, handler);
  }, []);

  /** «Próximas batallas» as a 30-day timeline (falls back to the old chart). */
  useEffect(() => {
    if (!hasUpcomingSupport()) { setUpcoming(null); return; }
    let cancelled = false;
    getUpcoming(30).then((data) => { if (!cancelled) setUpcoming(data); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  /**
   * The chest's real content: every live account with its balance. Refreshes
   * with the rest of the dashboard and whenever the account manager writes.
   */
  const loadAccountsOverview = useCallback(() => {
    if (!hasAccountsSupport()) { setAccountsOverview(null); return; }
    getAccountsOverview().then(setAccountsOverview);
  }, []);

  useEffect(() => { loadAccountsOverview(); }, [loadAccountsOverview, refreshKey]);

  /**
   * Una cuenta que nunca se usó y está en cero no dice nada: es la semilla que
   * crea la migración, y verla ahí sin explicación era justamente lo que hacía
   * imposible entender para qué sirve el cofre. Una cuenta USADA que quedó en
   * cero sí se muestra — ese cero es información. `movements` puede no venir de
   * un main viejo: en ese caso no escondemos nada.
   */
  const visibleAccounts = useMemo(
    () => (accountsOverview?.accounts ?? []).filter((a) => (a.movements ?? 1) > 0 || a.balance !== 0),
    [accountsOverview],
  );
  /** El total es siempre la suma de las filas que ves, nunca de filas ocultas. */
  const visibleTotals = useMemo(() => {
    let ars = 0, usd = 0;
    for (const a of visibleAccounts) {
      if (a.currency === 'USD') usd += a.balance; else ars += a.balance;
    }
    return { ars, usd };
  }, [visibleAccounts]);

  useEffect(() => {
    const handler = () => loadAccountsOverview();
    window.addEventListener('finance:accountsChanged', handler);
    window.addEventListener('finance:dataChanged', handler);
    return () => {
      window.removeEventListener('finance:accountsChanged', handler);
      window.removeEventListener('finance:dataChanged', handler);
    };
  }, [loadAccountsOverview]);

  const toggleChest = useCallback(() => setChestOpen((open) => !open), []);

  // Se cierra como cualquier desplegable: click afuera o Escape. Sin esto un
  // panel flotante te tapa el contenido y no hay forma obvia de sacarlo.
  useEffect(() => {
    if (!chestOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!chestPanelRef.current?.contains(e.target as Node)) setChestOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChestOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [chestOpen]);

  /**
   * Budgets are a monthly promise, so they only speak in the monthly view — a
   * "50.000 limit" drawn over a whole year's spending would be a lie by three
   * quarters.
   */
  // Budgets are an ARS promise: drawn over converted numbers they would lie,
  // so the whole budget UI only speaks in nominal-ARS mode.
  const budgetsApply = rangeMode === 'month' && hasBudgetSupport() && mode === 'ars';

  const loadBudgets = useCallback((forMonth: string, apply: boolean) => {
    if (!apply) { setBudgets(null); return; }
    getBudgetStatus(forMonth)
      .then(setBudgets)
      .catch((err) => console.error('[Dashboard] getBudgetStatus failed:', err));
  }, []);

  useEffect(() => { loadBudgets(month, budgetsApply); }, [loadBudgets, month, budgetsApply, refreshKey]);

  /**
   * The month-close reward — the one big payout Coinify has.
   *
   * Detected the way `ensure-recurring` detects a new month: comparing against
   * the last month this profile saw. If the month that just closed had budgets
   * and respected every one of them, 100 XP and a celebration. If it did not:
   * nothing at all. No message, no summary of the failure. The new month starts
   * clean — that silence is a deliberate design rule, not an oversight.
   */
  useEffect(() => {
    let cancelled = false;
    checkBudgetMonthClose(realCurrentMonth())
      .then((met) => {
        if (!met || cancelled) return;
        toast({
          type: 'xp',
          message: t('coinify.budgetMonthMet', 'Libro Mayor Cerrado: {{month}} dentro del presupuesto', {
            month: monthLabel(met.month, i18n.language),
          }),
          details: { xp: met.xpGained },
        });
      })
      .catch((err) => console.error('[Dashboard] checkBudgetMonthClose failed:', err));
    return () => { cancelled = true; };
    // Once per mount: the guard inside does the real "once per month" work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Recurring generation used to run on every mount, writing rows the freshly
   * fetched totals did not include — the number then moved on its own next
   * visit. Now it runs at most once per month and refreshes when it wrote.
   * Statement generation is gone entirely: reads recalculate pending statements.
   */
  useEffect(() => {
    let cancelled = false;
    ensureRecurringGenerated(realCurrentMonth()).then((generated) => {
      if (generated && !cancelled) setRefreshKey((k) => k + 1);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = () => {
      resetRecurringGuard();
      // The other account has its own budgets, and its month-close was never
      // evaluated on this machine.
      resetBudgetGuards();
      setEditingBudget(null);
      isFirstLoad.current = true;
      setRefreshKey(k => k + 1);
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, []);

  // Expense trend vs the previous month. Purely expenses — never the net balance.
  const trendPct = (() => {
    if (!balance || !prevBalance) return null;
    const currExpenses = balance.ARS.expenses;
    const prevExpenses = prevBalance.ARS.expenses;
    if (prevExpenses === 0) return null;
    return Math.round(((currExpenses - prevExpenses) / prevExpenses) * 100);
  })();

  /**
   * The valued lens over the dashboard. Only the monthly view converts (a
   * "quarter in dollars of which day?" has no honest answer), and only once the
   * bridge is wired; everything else falls back to nominal ARS.
   */
  const valuedData = rangeMode === 'month' && mode !== 'ars'
    ? (mode === 'usd' ? valued?.usd : valued?.arsToday) ?? null
    : null;
  const displayCurrency: 'ARS' | 'USD' = valuedData && mode === 'usd' ? 'USD' : 'ARS';
  const displayDecimals = displayCurrency === 'USD' ? 2 : 0;
  const approxMark = valuedData?.approx ? '~' : '';
  /** Balance figures the top cards print — converted when the lens is on. */
  const shownBalance = valuedData?.balance ?? (balance ? balance.ARS : null);
  const shownSpark = valuedData ? valuedData.monthlyExpenses : monthlyExpenses;

  // Donut data. The wheel is a single-currency picture on purpose — slicing a
  // circle by "pesos plus dollars" would be inventing an exchange rate.
  const donutData = (valuedData
    ? valuedData.categories.filter((c) => c.value > 0).map((c) => ({ category: c.category, value: c.value }))
    : categories.filter((c) => c.ARS > 0).map((c) => ({ category: c.category, value: c.ARS }))
  ).map((c, i) => ({
    label: c.category,
    value: c.value,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const donutTotal = donutData.reduce((sum, d) => sum + d.value, 0);

  /** category → status, for the legend rows and the wheel's outer rings. */
  const budgetByCategory = useMemo(() => {
    const map = new Map<string, { limit: number; spent: number; pct: number }>();
    for (const c of budgets?.categories ?? []) {
      map.set(c.category, { limit: c.limit, spent: c.spent, pct: c.pct });
    }
    return map;
  }, [budgets]);

  const budgetPct = useMemo(() => {
    const map = new Map<string, number>();
    for (const [cat, b] of budgetByCategory) map.set(cat, b.pct);
    return map;
  }, [budgetByCategory]);

  /**
   * Legend rows = the wheel's slices, plus any budgeted category that happens to
   * have spent nothing this month. Without that second group a budget could
   * become uneditable the moment it started working perfectly, which would be a
   * cruel joke.
   */
  const legendRows = useMemo(() => {
    const rows = donutData.map((d) => ({ ...d, inWheel: true }));
    if (!budgetsApply) return rows;
    const shown = new Set(rows.map((r) => r.label));
    for (const [cat] of budgetByCategory) {
      if (!shown.has(cat)) rows.push({ label: cat, value: 0, color: 'var(--ink-faded)', inWheel: false });
    }
    return rows;
  }, [donutData, budgetByCategory, budgetsApply]);

  const openBudgetEditor = (category: string) => {
    setEditingBudget(category);
    setBudgetDraft(String(budgetByCategory.get(category)?.limit ?? ''));
  };

  /** `limit === null` clears the budget. Reloads so the wheel and the bars agree. */
  const commitBudget = async (category: string, limit: number | null) => {
    const res = await setBudget(category, limit);
    setEditingBudget(null);
    if (res && res.ok === false) {
      toast({ type: 'warning', message: t('coinify.saveError', 'Error al guardar') });
      return;
    }
    loadBudgets(month, budgetsApply);
  };

  /**
   * Categories the wheel cannot show: everything spent there was in dollars.
   * They used to vanish without a trace, so a month whose biggest expense was a
   * USD subscription looked like a month with no such category at all. One
   * discreet line names them without pretending the two currencies add up.
   */
  const usdOnlyCategories = categories.filter((c) => !(c.ARS > 0) && c.USD > 0);
  const usdOnlyTotal = usdOnlyCategories.reduce((sum, c) => sum + c.USD, 0);

  // Projection months
  const projMonthLabels = projection.map((p) => {
    const [, mo] = p.month.split('-').map(Number);
    return new Date(2024, mo - 1).toLocaleDateString('es', { month: 'short' }).toUpperCase().slice(0, 3);
  });

  const hasUsd = balance ? (balance.USD.income > 0 || balance.USD.expenses > 0) : false;

  /**
   * Header label for the period actually being summed. It used to always print
   * the navigated month, so "Año" showed "AGOSTO 2026" over the whole year's
   * numbers.
   */
  const periodLabel = (() => {
    const shortMonth = (m: string) =>
      new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1)
        .toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'es', { month: 'short' })
        .toUpperCase()
        .replace('.', '')
        .slice(0, 3);

    if (rangeMode === 'all') return t('coinify.range_all', 'Todo').toUpperCase();
    if (rangeMode === 'year') return month.slice(0, 4);
    if (rangeMode === 'quarter') {
      return `${shortMonth(startMonth)}–${shortMonth(endMonth)} ${endMonth.slice(0, 4)}`;
    }
    const [y, m] = month.split('-').map(Number);
    const monthName = new Date(y, m - 1)
      .toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'es', { month: 'long' })
      .toUpperCase();
    return `${monthName} ${y}`;
  })();

  const handleExportCsv = async () => {
    const result = await window.api.financeExportCsv(month);
    if (result.canceled) return;
    if (result.error === 'no_data') {
      toast({ type: 'warning', message: t('coinify.exportNoData', 'No hay datos para exportar') });
      return;
    }
    if (result.success) {
      toast({ type: 'success', message: t('coinify.exportSuccess', 'CSV exportado ({{count}} registros)', { count: result.count }) });
    } else {
      toast({ type: 'warning', message: t('coinify.exportError', 'Error al exportar') });
    }
  };

  const rangeModeSelect = (
    <select
      className="rpg-select coin-range-select"
      value={rangeMode}
      aria-label={t('coinify.rangeMode', 'Período')}
      onChange={(e) => setRangeMode(e.target.value as RangeMode)}
    >
      <option value="month">{t('coinify.range_month')}</option>
      <option value="quarter">{t('coinify.range_quarter')}</option>
      <option value="year">{t('coinify.range_year')}</option>
      <option value="all">{t('coinify.range_all')}</option>
    </select>
  );

  /**
   * Every range except "Todo" is navigable. Month and quarter step by month
   * (the quarter ends on the navigated month); year steps by year.
   */
  const periodNav = (() => {
    if (rangeMode === 'all') {
      return <span className="coin-month-nav__label">{periodLabel}</span>;
    }
    if (rangeMode === 'year') {
      return (
        <div className="coin-month-nav">
          <button
            className="rpg-button coin-month-nav__btn tap-target"
            aria-label={t('coinify.prevYear', 'Año anterior')}
            title={t('coinify.prevYear', 'Año anterior')}
            onClick={() => setMonth(addMonths(month, -12))}
          >&lt;</button>
          <span className="coin-month-nav__label">{periodLabel}</span>
          <button
            className="rpg-button coin-month-nav__btn tap-target"
            aria-label={t('coinify.nextYear', 'Año siguiente')}
            title={t('coinify.nextYear', 'Año siguiente')}
            onClick={() => setMonth(addMonths(month, 12))}
          >&gt;</button>
        </div>
      );
    }
    return <MonthNavigator month={month} onChange={setMonth} compact />;
  })();

  // ── Skeleton ──

  if (loading && isFirstLoad.current) {
    return (
      <div className="coin-dashboard coin-dashboard--loading">
        <div className="coin-dashboard__header">
          {periodNav}
          {rangeModeSelect}
        </div>
        <div className="coin-skeleton coin-skeleton--card" style={{ height: 120 }} />
        <div className="coin-top-grid">
          <div className="coin-skeleton coin-skeleton--card" />
          <div className="coin-skeleton coin-skeleton--card" />
        </div>
        <div className="coin-skeleton coin-skeleton--chart" />
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="coin-dashboard" data-tour="finance">
      {/* Header */}
      <div className="coin-dashboard__header">
        {periodNav}
        {rangeModeSelect}
        {/* The export handler takes ONE month; outside the monthly view the
            toast used to say "N records" of a file that only held the month. */}
        <button
          className="rpg-button coin-export-btn"
          onClick={handleExportCsv}
          disabled={rangeMode !== 'month'}
          aria-label={t('coinify.exportCsv', 'Exportar CSV')}
          title={rangeMode === 'month'
            ? t('coinify.exportCsv', 'Exportar CSV')
            : t('coinify.exportCsvMonthOnly', 'El CSV exporta el mes navegado: elegí «Mes» en el período')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          CSV
        </button>
      </div>

      <div
        className={`coin-dashboard__content ${
          fadeState === 'out' ? 'coin-dashboard__content--fade-out' : 'coin-dashboard__content--fade-in'
        }`}
      >
        {/* ── Top: Treasure Chest + Income + Expenses ── */}
        {balance && shownBalance && (
          <div className="coin-top-grid">
            {/* Treasure chest panel */}
            <div className="coin-chest-panel" ref={chestPanelRef}>
              <HelpBubble text={accountsOverview
                ? t('coinify.chestHelpAccounts', 'Balance neto del mes arriba. Click en el cofre: tus cuentas con su saldo real (saldo inicial + movimientos). Click en una cuenta: sus movimientos.')
                : t('coinify.chestHelp', 'Balance neto del mes: ingresos menos gastos. El porcentaje compara con el mes anterior y la línea muestra la tendencia de los últimos 6 meses.')} />
              <ChestClickable onToggle={accountsOverview ? toggleChest : undefined} />
              <div className="coin-chest-panel__info">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                  {t('coinify.treasureChest', 'COFRE DEL TESORO')} · {periodLabel}
                </div>
                <div className="coin-chest-panel__balance">
                  <AnimatedNumber
                    value={shownBalance.balance}
                    prefix={approxMark + currencyPrefix(displayCurrency)}
                    locale={displayCurrency === 'USD' ? 'en-US' : undefined}
                    className={`coin-chest-panel__amount ${shownBalance.balance >= 0 ? 'coin-chest-panel__amount--positive' : 'coin-chest-panel__amount--negative'}`}
                  />
                </div>
                {hasUsd && (
                  <div className="qb-hand" style={{ fontSize: 'var(--fs-label)' }}>
                    <AnimatedNumber value={balance.USD.balance} prefix={currencyPrefix('USD')} locale="en-US" className="coin-chest-panel__usd" />
                  </div>
                )}
                <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', marginTop: 2, color: 'var(--ink-soft)' }}>
                  {trendPct !== null && (
                    <span>
                      {t('coinify.monthExpenses', 'gasto del mes')} {'\u2014'}{' '}
                      <span style={{ color: trendPct <= 0 ? 'var(--moss)' : 'var(--rubric)' }}>
                        {/* The arrow is the direction of spending, so "less" points down. */}
                        {trendPct <= 0
                          ? <ArrowDown style={{ width: '0.75em', height: '0.75em' }} />
                          : <ArrowUp style={{ width: '0.75em', height: '0.75em' }} />
                        }{' '}{Math.abs(trendPct)}%
                      </span>{' '}
                      {/* Las dos cadenas empezaban con «%», y la línea ya
                          imprime el suyo arriba: se leía «↓ 12% % menos que
                          el mes pasado». */}
                      {trendPct <= 0
                        ? t('coinify.lessThanLastMonth', 'menos que el mes pasado')
                        : t('coinify.moreThanLastMonth', 'más que el mes pasado')}
                      {/* Inflation-adjusted twin: a month that only kept pace
                          with the IPC reads ~0% real, not the inflation. When
                          the month's index is not published yet there is NO
                          real figure \u2014 the old code printed the nominal one
                          twice and called the second "real". */}
                      {rangeMode === 'month' && valued && (valued.trend.realPct != null || valued.trend.realPending) && (
                        <span
                          title={t('coinify.realTrendHint', 'Ajustado por inflaci\u00f3n (IPC INDEC): ambos meses expresados en pesos de hoy')}
                        >
                          {' '}({t('coinify.nominalLabel', 'nominal')} {trendPct > 0 ? '+' : ''}{trendPct}%{' \u00b7 '}
                          {valued.trend.realPct != null ? (
                            <span style={{ color: valued.trend.realPct <= 0 ? 'var(--moss)' : 'var(--rubric)' }}>
                              {t('coinify.realLabel', 'real')} {valued.trend.realPct > 0 ? '+' : ''}{valued.trend.realPct}%
                            </span>
                          ) : (
                            <span style={{ color: 'var(--ink-faded)' }}>
                              {t('coinify.realLabel', 'real')}: {t('coinify.realPendingIpc', 'sin dato del INDEC todav\u00eda')}
                            </span>
                          )})
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {shownSpark.length >= 2 && (
                  <div style={{ marginTop: 4 }}>
                    {/* In USD each month is converted at its own frozen rates —
                        this line finally stops climbing monotonically. */}
                    <SparklineChart data={shownSpark} width={120} height={24} color="var(--rubric)" showArea />
                    <span className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginLeft: 4 }}>
                      {t('coinify.last6Months', '6 meses')}{valuedData ? ` · ${approxMark}${displayCurrency === 'USD' ? 'USD' : t('coinify.modeArsToday', 'ARS hoy')}` : ''}
                    </span>
                  </div>
                )}

                {/* ── The chest, opened: one row per account, real balances ── */}
                {accountsOverview && (
                  chestOpen ? (
                    <div className="coin-account-list">
                      {visibleAccounts.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="coin-account-row"
                          onClick={() => navigate(`/finance/transactions?account=${a.id}`)}
                          title={t('coinify.accountRowHint', 'Ver los movimientos de {{name}}', { name: a.name })}
                        >
                          <span className="coin-account-row__icon"><AccountKindGlyph kind={a.kind} /></span>
                          <span className="coin-account-row__name qb-hand">{a.name}</span>
                          <span className={`coin-account-row__balance qb-numeral${a.balance < 0 ? ' coin-account-row__balance--negative' : ''}`}>
                            {formatCurrency(a.balance, { currency: a.currency })}
                          </span>
                        </button>
                      ))}
                      {/* The number that finally has to match MP + homebanking. */}
                      {visibleAccounts.length > 0 ? (
                        <div className="coin-account-total">
                          <span className="qb-small-caps">{t('coinify.accountsTotal', 'Total en cuentas')}</span>
                          <span className="qb-numeral">
                            {formatCurrency(visibleTotals.ars, { currency: 'ARS' })}
                            {visibleTotals.usd !== 0 && (
                              <> · {formatCurrency(visibleTotals.usd, { currency: 'USD' })}</>
                            )}
                          </span>
                        </div>
                      ) : (
                        <p className="coin-account-empty">
                          {t('coinify.accountsEmpty', 'Separá tu plata por dónde está —efectivo, banco, billetera— y el cofre te muestra cuánto hay en cada una.')}
                        </p>
                      )}
                      <button
                        type="button"
                        className="rpg-button coin-account-manage-btn"
                        onClick={() => setShowAccountManager(true)}
                      >
                        {t('coinify.manageAccounts', 'Gestionar cuentas')}
                      </button>
                    </div>
                  ) : (
                    visibleAccounts.length > 0 && (
                      <button type="button" className="coin-account-peek" onClick={toggleChest}>
                        <span className="qb-small-caps">
                          {t('coinify.accountsTotal', 'Total en cuentas')}{' '}
                          <span className="qb-numeral">{formatCurrency(visibleTotals.ars, { currency: 'ARS' })}</span>
                          {visibleTotals.usd !== 0 && (
                            <span className="qb-numeral"> · {formatCurrency(visibleTotals.usd, { currency: 'USD' })}</span>
                          )}
                        </span>
                      </button>
                    )
                  )
                )}
              </div>
              <div className="coin-chest-panel__vertical">TESORO</div>
            </div>

            {/* Income card */}
            <div className="coin-summary-card">
              <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--moss)' }}>
                {t('coinify.income').toUpperCase()}
              </div>
              <div className="coin-summary-card__value coin-summary-card__value--sage">
                <AnimatedNumber
                  value={shownBalance.income}
                  prefix={approxMark + currencyPrefix(displayCurrency)}
                  locale={displayCurrency === 'USD' ? 'en-US' : undefined}
                />
              </div>
              {/* Placeholder keeps this card's gauge level with the expense card's. */}
              <div className="coin-summary-card__note" aria-hidden="true">&nbsp;</div>
              <Gauge value={shownBalance.income} max={Math.max(shownBalance.income, shownBalance.expenses) * 1.2 || 1} tone="sage" showPips={false} />
            </div>

            {/* Expenses card */}
            <div className="coin-summary-card">
              <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                {t('coinify.expense').toUpperCase()}
              </div>
              <div className="coin-summary-card__value coin-summary-card__value--rubric">
                <AnimatedNumber
                  value={shownBalance.expenses}
                  prefix={approxMark + currencyPrefix(displayCurrency)}
                  locale={displayCurrency === 'USD' ? 'en-US' : undefined}
                />
              </div>
              {/* Where the number comes from, instead of a help bubble promising
                  a composition the figure did not actually have. */}
              <div className="coin-summary-card__note qb-hand">
                {valuedData ? (
                  // The nominal composition would mix units under a converted
                  // total — name the lens instead.
                  <>
                    {mode === 'usd'
                      ? t('coinify.modeUsdNote', 'en dólares — cada movimiento a su cotización congelada')
                      : t('coinify.modeArsTodayNote', 'en pesos de hoy — IPC INDEC hasta {{month}}', {
                        month: valued?.arsToday?.latestIpcMonth ?? '',
                      })}
                  </>
                ) : breakdown ? (
                  <>
                    {formatCurrency(breakdown.ARS.total, { currency: 'ARS' })}
                    {' = '}
                    {formatCurrency(breakdown.ARS.direct, { currency: 'ARS' })} {t('coinify.breakdownDirect', 'directo')}
                    {' + '}
                    {formatCurrency(breakdown.ARS.installments, { currency: 'ARS' })} {t('coinify.breakdownInstallments', 'cuotas')}
                    {' + '}
                    {formatCurrency(breakdown.ARS.pendingCard, { currency: 'ARS' })} {t('coinify.breakdownPendingCard', 'tarjeta pendiente')}
                  </>
                ) : (
                  <>
                    {installmentCount} {t('coinify.activeInstallments').toLowerCase()}
                    {' '}<span className="coin-separator">·</span>{' '}
                    {t('coinify.pendingCCToday', 'TC sin pagar al día de hoy')} {formatCurrency(pendingCC.ARS, { currency: 'ARS' })}
                  </>
                )}
              </div>
              <Gauge value={shownBalance.expenses} max={Math.max(shownBalance.income, shownBalance.expenses) * 1.2 || 1} tone="rubric" showPips={false} />
            </div>
          </div>
        )}

        {/* ── Month vs Previous Comparison ──
             Compares against the month before the *navigated* one, not the month
             before today. */}
        {rangeMode === 'month' && prevBalance && balance && (
          <div className="coin-comparison-toggle">
            <button
              className="rpg-button coin-comparison-toggle__btn"
              onClick={() => setShowPrevComparison((v) => !v)}
              style={{ fontSize: 'var(--fs-label)', padding: '2px 10px' }}
            >
              {showPrevComparison
                ? t('coinify.hideComparison', 'Ocultar comparativa')
                : t('coinify.showComparison', 'Comparar con mes anterior')}
            </button>
            {showPrevComparison && (
              <div className="coin-comparison-grid">
                <Cartouche
                  label={`${t('coinify.prevIncome', 'Ingreso anterior')} · ${getPrevMonth(month)}`}
                  value={formatCurrency(prevBalance.ARS.income, { currency: 'ARS' })}
                  foot={`${formatCurrency(balance.ARS.income, { currency: 'ARS' })} ${t('coinify.currentLabel', 'actual')}`}
                  tone="sage"
                />
                <Cartouche
                  label={`${t('coinify.prevExpenses', 'Gasto anterior')} · ${getPrevMonth(month)}`}
                  value={formatCurrency(prevBalance.ARS.expenses, { currency: 'ARS' })}
                  foot={`${formatCurrency(balance.ARS.expenses, { currency: 'ARS' })} ${t('coinify.currentLabel', 'actual')}`}
                  tone="rubric"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Middle: Ledger + Category Chart ── */}
        <div className="coin-middle-grid">
          {/* Category breakdown */}
          <Section title={t('coinify.expenseBreakdown', 'REPARTO DEL GASTO')} icon={<Scale width="12" height="12" style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('coinify.categoryHelp', 'Distribución de gastos por categoría. La leyenda de abajo muestra el monto y el porcentaje de cada una.')} />}>
            {/* One line, not another card: the month's budget in a sentence,
                right above the wheel it is drawn on. Only when there is at least
                one limit — an empty budget has nothing to say. */}
            {budgetsApply && budgets && budgets.categories.length > 0 && (
              <div className="coin-budget-summary">
                <div className="coin-budget-summary__line">
                  <span className="qb-small-caps">
                    {t('coinify.budgetMonthLine', 'Presupuesto del mes: {{spent}} de {{limit}}', {
                      spent: formatCurrency(budgets.totalSpent, { currency: 'ARS' }),
                      limit: formatCurrency(budgets.totalLimit, { currency: 'ARS' }),
                    })}
                  </span>
                  <HelpBubble variant="inline" text={t('coinify.budgetHint', 'Poné un límite mensual con el lápiz de cada categoría. Elegí 3 o 4 categorías, no todas.')} />
                </div>
                <Gauge
                  value={Math.min(budgets.totalSpent, budgets.totalLimit)}
                  max={budgets.totalLimit || 1}
                  tone={budgets.totalSpent > budgets.totalLimit ? 'rubric' : 'sage'}
                  showPips={false}
                />
              </div>
            )}

            <CategoryWheel data={donutData} total={donutTotal} budgetPct={budgetsApply ? budgetPct : undefined} currency={displayCurrency} />
            {legendRows.length > 0 && (
              <div className="coin-category-legend">
                {legendRows.map((c, i) => {
                  const budget = budgetByCategory.get(c.label);
                  const editing = editingBudget === c.label;
                  const over = budget ? budget.spent > budget.limit : false;
                  return (
                    <div key={i} className="coin-category-legend__item">
                      <div className="coin-category-legend__row">
                        <span className="coin-category-legend__swatch" style={{ background: c.color }} />
                        <span className="qb-hand coin-category-legend__label" title={c.label}>{c.label}</span>
                        <span className="qb-numeral coin-category-legend__amount">
                          {approxMark}{formatCurrency(c.value, { currency: displayCurrency, decimals: displayDecimals })}
                        </span>
                        <span className="qb-small-caps coin-category-legend__pct">
                          {donutTotal > 0 && c.inWheel ? `${Math.round((c.value / donutTotal) * 100)}%` : '—'}
                        </span>
                        {/* The whole budget UI: one pencil per legend row, shown
                            on hover or keyboard focus so the resting state of the
                            panel is exactly what it was before. */}
                        {budgetsApply && (
                          <button
                            type="button"
                            className={`coin-budget-pencil${budget ? ' coin-budget-pencil--set' : ''}`}
                            onClick={() => (editing ? setEditingBudget(null) : openBudgetEditor(c.label))}
                            aria-label={t('coinify.budgetEditLabel', 'Límite mensual de {{category}}', { category: c.label })}
                            title={t('coinify.budgetEditLabel', 'Límite mensual de {{category}}', { category: c.label })}
                          >
                            <Pencil width="10" height="10" />
                          </button>
                        )}
                      </div>

                      {budgetsApply && editing && (
                        <div className="coin-budget-edit">
                          <RpgNumberInput
                            value={budgetDraft}
                            onChange={setBudgetDraft}
                            min={0}
                            step={1000}
                            autoFocus
                            placeholder={t('coinify.budgetPlaceholder', 'Límite mensual')}
                            aria-label={t('coinify.budgetEditLabel', 'Límite mensual de {{category}}', { category: c.label })}
                            style={{ flex: 1 }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitBudget(c.label, parseFloat(budgetDraft) || null); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditingBudget(null); }
                            }}
                          />
                          <button
                            type="button"
                            className="rpg-button coin-budget-edit__btn"
                            onClick={() => commitBudget(c.label, parseFloat(budgetDraft) || null)}
                            aria-label={t('coinify.budgetSave', 'Guardar límite')}
                            title={t('coinify.budgetSave', 'Guardar límite')}
                          >
                            <Checkmark width="11" height="11" />
                          </button>
                          {budget && (
                            <button
                              type="button"
                              className="rpg-button coin-budget-edit__btn"
                              onClick={() => commitBudget(c.label, null)}
                              aria-label={t('coinify.budgetRemove', 'Quitar presupuesto')}
                              title={t('coinify.budgetRemove', 'Quitar presupuesto')}
                            >
                              <CrossMark width="11" height="11" />
                            </button>
                          )}
                        </div>
                      )}

                      {budgetsApply && budget && !editing && (
                        <div className={`coin-budget-row${over ? ' coin-budget-row--over' : ''}`}>
                          <span className="qb-numeral coin-budget-row__figures">
                            {formatCurrency(budget.spent, { currency: 'ARS' })} / {formatCurrency(budget.limit, { currency: 'ARS' })}
                          </span>
                          <span className="coin-budget-bar">
                            <span
                              className="coin-budget-bar__fill"
                              style={{ width: `${Math.min(budget.pct, 100)}%` }}
                            />
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {legendRows.length === 0 && usdOnlyCategories.length === 0 && (
              <div className="coin-empty-codex">{t('coinify.noExpensesThisMonth')}</div>
            )}
            {usdOnlyCategories.length > 0 && (
              <div
                className="coin-category-legend__usd-note"
                title={usdOnlyCategories
                  .map((c) => `${c.category}: ${formatCurrency(c.USD, { currency: 'USD' })}`)
                  .join(' · ')}
              >
                {t('coinify.usdOnlyCategories', '+ {{amount}} en {{count}} categorías sin gasto en pesos', {
                  amount: formatCurrency(usdOnlyTotal, { currency: 'USD' }),
                  count: usdOnlyCategories.length,
                })}
              </div>
            )}
          </Section>
        </div>

        {/* ── Bottom: Loans + Projection ── */}
        <div className="coin-bottom-grid">
          {/* Loans & Debts */}
          <Section
            title={t('coinify.alliancesAndDebts').toUpperCase()}
            icon={<Key width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={
              <HelpBubble variant="inline" text={t('coinify.loansHelp', 'Lo que te deben y lo que debés al cierre del período elegido arriba: préstamos tomados hasta esa fecha, menos los pagos registrados hasta esa fecha.')} />
            }
          >
            <div className="coin-loan-mini-grid">
              <div className="coin-loan-mini coin-loan-mini--sage">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--moss)' }}>
                  {t('coinify.owed').toUpperCase()}
                </div>
                {/* Pending = original amount minus partial payments. */}
                <div style={{ fontFamily: "'UnifrakturCook',serif", fontSize: 'var(--fs-accent)', color: 'var(--moss)' }}>
                  {formatCurrency(loans.ARS.lentPending, { currency: 'ARS' })}
                </div>
                {loans.USD.lentPending > 0 && (
                  <div className="qb-numeral coin-loan-mini__usd">
                    {formatCurrency(loans.USD.lentPending, { currency: 'USD' })}
                  </div>
                )}
              </div>
              <div className="coin-loan-mini coin-loan-mini--rubric">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                  {t('coinify.owing').toUpperCase()}
                </div>
                <div style={{ fontFamily: "'UnifrakturCook',serif", fontSize: 'var(--fs-accent)', color: 'var(--rubric)' }}>
                  {formatCurrency(loans.ARS.borrowedPending, { currency: 'ARS' })}
                </div>
                {loans.USD.borrowedPending > 0 && (
                  <div className="qb-numeral coin-loan-mini__usd">
                    {formatCurrency(loans.USD.borrowedPending, { currency: 'USD' })}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="rpg-button coin-loan-mini__link"
              onClick={() => navigate('/finance/loans')}
            >
              <span className="qb-small-caps">{t('coinify.loans')} <ChevronRight style={{ width: '0.7em', height: '0.7em' }} /></span>
            </button>
          </Section>

          {/* Próximas batallas: a 30-day money-out timeline (recurring charges,
              instalments and card due dates in one ordered list) once the
              bridge is wired; the 3-month projection chart until then. */}
          <Section
            title={t('coinify.nextBattles').toUpperCase()}
            icon={<Compass width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={
              <HelpBubble
                variant="inline"
                text={upcoming
                  ? t('coinify.upcomingHelp', 'Todo lo que sale del bolsillo en los próximos 30 días: recurrentes, cuotas y vencimientos de tarjeta, ordenado por fecha.')
                  : t('coinify.projectionHelp', 'Proyección a 3 meses de cuotas y gastos recurrentes, contada desde el período elegido arriba.')}
              />
            }
          >
            {upcoming ? (
              upcoming.items.length > 0 ? (
                <div className="coin-upcoming">
                  <div className="coin-upcoming__list">
                    {upcoming.items.map((item, i) => {
                      const [, m, d] = item.date.split('-');
                      const kindLabel = item.kind === 'installment'
                        ? t('coinify.upcomingInstallment', 'cuota')
                        : item.kind === 'card_due'
                          ? t('coinify.upcomingCardDue', 'vto. tarjeta')
                          : t('coinify.upcomingRecurring', 'recurrente');
                      return (
                        <div key={`${item.refId}-${item.currency}-${i}`} className={`coin-upcoming__row coin-upcoming__row--${item.kind}`}>
                          <span className="coin-upcoming__date qb-small-caps">{d}/{m}</span>
                          <span className="coin-upcoming__label qb-hand" title={item.label}>
                            {item.label}
                            {item.detail && item.kind === 'installment' && (
                              <span className="coin-upcoming__detail"> {item.detail}</span>
                            )}
                          </span>
                          <span className="coin-upcoming__kind qb-small-caps">{kindLabel}</span>
                          <span className="coin-upcoming__amount qb-numeral">
                            {formatCurrency(item.amount, { currency: item.currency })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="coin-upcoming__total">
                    <span className="qb-small-caps">{t('coinify.upcomingTotal', 'Total 30 días')}</span>
                    <span className="qb-numeral">
                      {formatCurrency(upcoming.totals.ARS, { currency: 'ARS' })}
                      {upcoming.totals.USD > 0 && <> · {formatCurrency(upcoming.totals.USD, { currency: 'USD' })}</>}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="coin-empty-codex">
                  {t('coinify.upcomingEmpty', 'Nada sale del bolsillo en los próximos 30 días')}
                </div>
              )
            ) : projection.length > 0 ? (
              <>
                <ProjectionChart data={projection} />
                <div className="coin-projection-labels">
                  {projMonthLabels.map((m, i) => (
                    <span key={i} className="qb-small-caps">{m}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="coin-empty-codex">{t('coinify.noData')}</div>
            )}
          </Section>
        </div>

        {/* Quick Actions */}
        <div className="coin-quick-actions" data-tour="finance-add">
          <button className="rpg-button" onClick={() => navigate('/finance/transactions?type=expense')}>
            + {t('coinify.expense')}
          </button>
          <button className="rpg-button" onClick={() => navigate('/finance/transactions?type=income')}>
            + {t('coinify.income')}
          </button>
        </div>
      </div>

      {showAccountManager && (
        <AccountManager
          onClose={() => setShowAccountManager(false)}
          onSaved={loadAccountsOverview}
        />
      )}
    </div>
  );
}
