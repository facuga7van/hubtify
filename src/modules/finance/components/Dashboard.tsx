import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonthNavigator } from './shared/MonthNavigator';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { Section, Gauge, Rune, Cartouche } from '../../../shared/components/codex/CodexPrimitives';
import { SparklineChart } from '../../../shared/components/charts';
import { Scale, Key, Compass } from '../../../shared/components/icons';
import { useToast } from '../../../shared/components/useToast';
import HelpBubble from '../../../shared/components/HelpBubble';
import { formatCurrency, currencyPrefix } from '../utils/format';
import { playCoinClink } from '../../../shared/audio';

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
}

interface LoanSummary {
  lent: number;
  borrowed: number;
}

// ── Helpers ──

const CATEGORY_COLORS = ['#6b4a2b', '#7a1e1e', '#556b3c', '#a88a3c', '#8a6a3d', '#3a2513', '#5c3a1e', '#4a3520', '#cd853f', '#bc8f8f'];

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toRoman(n: number): string {
  const numerals: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let result = '';
  for (const [val, sym] of numerals) {
    while (n >= val) { result += sym; n -= val; }
  }
  return result;
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

function ChestClickable() {
  const [bounce, setBounce] = useState(false);

  const handleClick = () => {
    playCoinClink();
    setBounce(true);
    setTimeout(() => setBounce(false), 500);
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

function CategoryWheel({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  if (data.length === 0 || total === 0) return null;

  let acc = 0;
  const r = 54, cx = 70, cy = 70;
  return (
    <svg viewBox="0 0 140 140" style={{ width: '100%', maxWidth: 160, display: 'block', margin: '0 auto' }}>
      {data.map((d, i) => {
        const pct = (d.value / total) * 100;
        const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
        acc += pct;
        const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(start) * r, y1 = cy + Math.sin(start) * r;
        const x2 = cx + Math.cos(end) * r, y2 = cy + Math.sin(end) * r;
        const large = (end - start) > Math.PI ? 1 : 0;
        return <path key={i} d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={d.color} opacity=".75" stroke="var(--parch-1)" strokeWidth="1.5" />;
      })}
      <circle cx={cx} cy={cy} r="28" fill="rgba(245,231,192,.9)" stroke="var(--ink)" strokeWidth="0.8" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11" fontFamily="'IM Fell English SC',serif" fill="var(--rubric)">TOTAL</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="16" fontFamily="'UnifrakturCook',serif" fill="var(--ink)">{formatCurrency(total)}</text>
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--ink-faded)" strokeWidth="0.5" />
    </svg>
  );
}

function ProjectionChart({ data }: { data: ProjectionMonth[] }) {
  if (data.length === 0) return null;

  const pts = data.map((d) => d.total);
  const max = Math.max(...pts) * 1.15;
  const min = Math.min(...pts) * 0.85;
  const w = 280, h = 100;

  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return [x, y];
  });
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
          <text x={p[0]} y={p[1] - 6} textAnchor="middle" fontSize="9" fontFamily="'UnifrakturCook',serif" fill="var(--ink)">{formatCurrency(pts[i])}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Component ──

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rangeMode, setRangeMode] = useState<'month' | 'quarter' | 'year' | 'all'>('month');
  const [refreshKey, setRefreshKey] = useState(0);

  const [balance, setBalance] = useState<MonthlyBalance | null>(null);
  const [prevBalance, setPrevBalance] = useState<MonthlyBalance | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loans, setLoans] = useState<LoanSummary>({ lent: 0, borrowed: 0 });
  const [installmentCount, setInstallmentCount] = useState(0);
  const [pendingCC, setPendingCC] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState<number[]>([]);
  const [prevSummary, setPrevSummary] = useState<{ income: number; expenses: number; month: string } | null>(null);
  const [showPrevComparison, setShowPrevComparison] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in');
  const isFirstLoad = useRef(true);

  // Fetch month-dependent data
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
          const [bal, prev, cats] = await Promise.all([
            window.api.financeGetMonthlyBalance(month) as Promise<MonthlyBalance>,
            window.api.financeGetMonthlyBalance(prevMonth) as Promise<MonthlyBalance>,
            window.api.financeGetCategoryBreakdown(month) as Promise<CategoryBreakdown[]>,
          ]);
          setBalance(bal);
          setPrevBalance(prev);
          setCategories(cats);
        } else {
          let startMonth: string;
          let endMonth: string;

          if (rangeMode === 'quarter') {
            const [y, m] = month.split('-').map(Number);
            const start = new Date(y, m - 3, 1);
            startMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
            endMonth = month;
          } else if (rangeMode === 'year') {
            const y = month.split('-')[0];
            startMonth = `${y}-01`;
            endMonth = `${y}-12`;
          } else {
            startMonth = '2020-01';
            endMonth = '2099-12';
          }

          const [bal, cats] = await Promise.all([
            window.api.financeGetBalanceForRange(startMonth, endMonth) as Promise<MonthlyBalance>,
            window.api.financeGetCategoryBreakdownForRange(startMonth, endMonth) as Promise<CategoryBreakdown[]>,
          ]);
          setBalance(bal);
          setPrevBalance(null);
          setCategories(cats);
        }

        isFirstLoad.current = false;
      } catch {
        setFadeState('in');
      } finally {
        setLoading(false);
        setFadeState('in');
      }
    };

    fetchData();
  }, [month, rangeMode, refreshKey]);

  // Fetch static data
  const loadStaticData = useCallback(() => {
    window.api.financeGetProjection(3).then((data) => setProjection(data as ProjectionMonth[]));
    window.api.financeGetActiveLoanSummary().then((data) => setLoans(data as LoanSummary));
    window.api.financeGetInstallmentGroups().then((data) => setInstallmentCount((data as unknown[]).length));
    window.api.financeGetCreditCardStatements({ status: 'pending' }).then((data) => {
      const total = (data as Array<{ calculatedAmount: number }>).reduce((sum, s) => sum + s.calculatedAmount, 0);
      setPendingCC(total);
    });
    window.api.financeGetMonthlyExpenses().then((data) => setMonthlyExpenses(data));
    window.api.financeGetPreviousMonthSummary().then((data) => setPrevSummary(data));
  }, []);

  useEffect(() => { loadStaticData(); }, [loadStaticData]);

  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(month);
  }, []);

  useEffect(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGetCreditCards().then((cards) => {
      for (const card of cards as Array<{ id: string }>) {
        window.api.financeGenerateStatement(card.id, currentMonth);
      }
    });
  }, []);

  useEffect(() => {
    const handler = () => { loadStaticData(); isFirstLoad.current = true; setRefreshKey(k => k + 1); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadStaticData]);

  // Trend calculation
  const trendPct = (() => {
    if (!balance || !prevBalance) return null;
    const currExpenses = balance.ARS.expenses;
    const prevExpenses = prevBalance.ARS.expenses;
    if (prevExpenses === 0) return null;
    return Math.round(((currExpenses - prevExpenses) / prevExpenses) * 100);
  })();

  // Donut data
  const donutData = categories
    .filter((c) => c.ARS > 0)
    .map((c, i) => ({
      label: c.category,
      value: c.ARS,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));

  const donutTotal = donutData.reduce((sum, d) => sum + d.value, 0);

  // Projection months
  const projMonthLabels = projection.map((p) => {
    const [, mo] = p.month.split('-').map(Number);
    return new Date(2024, mo - 1).toLocaleDateString('es', { month: 'short' }).toUpperCase().slice(0, 3);
  });

  const hasUsd = balance ? (balance.USD.income > 0 || balance.USD.expenses > 0) : false;

  // Month label for the header
  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    const monthName = new Date(y, m - 1).toLocaleDateString('es', { month: 'long' }).toUpperCase();
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
      onChange={(e) => setRangeMode(e.target.value as typeof rangeMode)}
    >
      <option value="month">{t('coinify.range_month')}</option>
      <option value="quarter">{t('coinify.range_quarter')}</option>
      <option value="year">{t('coinify.range_year')}</option>
      <option value="all">{t('coinify.range_all')}</option>
    </select>
  );

  // ── Skeleton ──

  if (loading && isFirstLoad.current) {
    return (
      <div className="coin-dashboard coin-dashboard--loading">
        <div className="coin-dashboard__header">
          {rangeMode === 'month' && <MonthNavigator month={month} onChange={setMonth} compact />}
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
        {rangeMode === 'month' && <MonthNavigator month={month} onChange={setMonth} compact />}
        {rangeModeSelect}
        <button
          className="rpg-button coin-export-btn"
          onClick={handleExportCsv}
          title={t('coinify.exportCsv', 'Exportar CSV')}
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
        {balance && (
          <div className="coin-top-grid">
            {/* Treasure chest panel */}
            <div className="coin-chest-panel">
              <HelpBubble text={t('coinify.chestHelp', 'Balance neto del mes: ingresos menos gastos. El porcentaje compara con el mes anterior y la línea muestra la tendencia de los últimos 6 meses.')} />
              <ChestClickable />
              <div className="coin-chest-panel__info">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                  {t('coinify.treasureChest', 'COFRE DEL TESORO')} · {monthLabel}
                </div>
                <div className="coin-chest-panel__balance">
                  <AnimatedNumber
                    value={balance.ARS.balance}
                    prefix={currencyPrefix()}
                    className={`coin-chest-panel__amount ${balance.ARS.balance >= 0 ? 'coin-chest-panel__amount--positive' : 'coin-chest-panel__amount--negative'}`}
                  />
                </div>
                {hasUsd && (
                  <div className="qb-hand" style={{ fontSize: 'var(--fs-label)' }}>
                    <AnimatedNumber value={balance.USD.balance} prefix="U$S " locale="en-US" className="coin-chest-panel__usd" />
                  </div>
                )}
                <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', marginTop: 2, color: 'var(--ink-soft)' }}>
                  {trendPct !== null && (
                    <span>
                      saldo del mes {'\u2014'}{' '}
                      <span style={{ color: trendPct <= 0 ? 'var(--moss)' : 'var(--rubric)' }}>
                        {trendPct <= 0 ? '\u2191' : '\u2193'} {Math.abs(trendPct)}%
                      </span>{' '}
                      {trendPct <= 0 ? t('coinify.lessThanLastMonth') : t('coinify.moreThanLastMonth')}
                    </span>
                  )}
                </div>
                {monthlyExpenses.length >= 2 && (
                  <div style={{ marginTop: 4 }}>
                    <SparklineChart data={monthlyExpenses} width={120} height={24} color="var(--rubric)" showArea />
                    <span className="qb-small-caps" style={{ fontSize: '0.55rem', color: 'var(--ink-faded)', marginLeft: 4 }}>
                      {t('coinify.last6Months', '6 meses')}
                    </span>
                  </div>
                )}
              </div>
              <div className="coin-chest-panel__vertical">TESORO</div>
            </div>

            {/* Income card */}
            <div className="coin-summary-card">
              <HelpBubble text={t('coinify.incomeHelp', 'Total de ingresos registrados en el mes seleccionado.')} />
              <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--moss)' }}>
                {t('coinify.income').toUpperCase()}
              </div>
              <div className="coin-summary-card__value coin-summary-card__value--sage">
                <AnimatedNumber value={balance.ARS.income} prefix={currencyPrefix()} />
              </div>
              <Gauge value={balance.ARS.income} max={Math.max(balance.ARS.income, balance.ARS.expenses) * 1.2 || 1} tone="sage" showPips={false} />
            </div>

            {/* Expenses card */}
            <div className="coin-summary-card">
              <HelpBubble text={t('coinify.expensesHelp', 'Total de gastos del mes. Incluye cuotas activas y saldo pendiente de tarjetas de crédito.')} />
              <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                {t('coinify.expense').toUpperCase()}
              </div>
              <div className="coin-summary-card__value coin-summary-card__value--rubric">
                <AnimatedNumber value={balance.ARS.expenses} prefix={currencyPrefix()} />
              </div>
              <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>
                {installmentCount} {t('coinify.activeInstallments').toLowerCase()} {'\u00B7'} TC {formatCurrency(pendingCC)}
              </div>
              <Gauge value={balance.ARS.expenses} max={Math.max(balance.ARS.income, balance.ARS.expenses) * 1.2 || 1} tone="rubric" showPips={false} />
            </div>
          </div>
        )}

        {/* ── C8: Month vs Previous Comparison ── */}
        {rangeMode === 'month' && prevSummary && balance && (
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
                  label={t('coinify.prevIncome', 'Ingreso anterior')}
                  value={formatCurrency(prevSummary.income)}
                  foot={`${formatCurrency(balance.ARS.income)} ${t('coinify.currentLabel', 'actual')}`}
                  tone="sage"
                />
                <Cartouche
                  label={t('coinify.prevExpenses', 'Gasto anterior')}
                  value={formatCurrency(prevSummary.expenses)}
                  foot={`${formatCurrency(balance.ARS.expenses)} ${t('coinify.currentLabel', 'actual')}`}
                  tone="rubric"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Middle: Ledger + Category Chart ── */}
        <div className="coin-middle-grid">
          {/* Category breakdown */}
          <Section title={t('coinify.expenseBreakdown', 'REPARTO DEL GASTO')} icon={<Scale width="12" height="12" style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('coinify.categoryHelp', 'Distribución de gastos por categoría. Tocá una porción para ver el detalle.')} />}>
            <CategoryWheel data={donutData} total={donutTotal} />
            {donutData.length > 0 && (
              <div className="coin-category-legend">
                {donutData.map((c, i) => (
                  <div key={i} className="coin-category-legend__row">
                    <span className="coin-category-legend__swatch" style={{ background: c.color }} />
                    <span className="qb-hand">{c.label}</span>
                    <span className="qb-numeral coin-category-legend__amount">{formatCurrency(c.value)}</span>
                    <span className="qb-small-caps coin-category-legend__pct">{Math.round((c.value / donutTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            {donutData.length === 0 && (
              <div className="coin-empty-codex">{t('coinify.noExpensesThisMonth')}</div>
            )}
          </Section>
        </div>

        {/* ── Bottom: Loans + Projection ── */}
        <div className="coin-bottom-grid">
          {/* Loans & Debts */}
          <Section title={t('coinify.alliancesAndDebts').toUpperCase()} icon={<Key width="12" height="12" style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('coinify.loansHelp', 'Resumen de préstamos activos: lo que te deben y lo que debés.')} />}>
            <div className="coin-loan-mini-grid">
              <div className="coin-loan-mini coin-loan-mini--sage">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--moss)' }}>
                  {t('coinify.owed').toUpperCase()}
                </div>
                <div style={{ fontFamily: "'UnifrakturCook',serif", fontSize: 'var(--fs-accent)', color: 'var(--moss)' }}>
                  {formatCurrency(loans.lent)}
                </div>
              </div>
              <div className="coin-loan-mini coin-loan-mini--rubric">
                <div className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
                  {t('coinify.owing').toUpperCase()}
                </div>
                <div style={{ fontFamily: "'UnifrakturCook',serif", fontSize: 'var(--fs-accent)', color: 'var(--rubric)' }}>
                  {formatCurrency(loans.borrowed)}
                </div>
              </div>
            </div>
            <div
              className="coin-loan-mini__link"
              onClick={() => navigate('/finance/loans')}
            >
              <span className="qb-small-caps">{t('coinify.loans')} {'\u25B7'}</span>
            </div>
          </Section>

          {/* Projection */}
          <Section title={t('coinify.nextBattles').toUpperCase()} icon={<Compass width="12" height="12" style={{ color: 'var(--rubric)' }} />} rightSlot={<HelpBubble variant="inline" text={t('coinify.projectionHelp', 'Proyección a 3 meses de cuotas y gastos recurrentes. Ayuda a planificar el flujo de fondos.')} />}>
            {projection.length > 0 ? (
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
    </div>
  );
}
