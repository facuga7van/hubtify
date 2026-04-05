import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonthNavigator } from './shared/MonthNavigator';
import { DollarChip } from './shared/DollarChip';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { CoinStatCard } from './shared/CoinStatCard';
import { BalanceBar } from './shared/BalanceBar';
import { DonutChart } from './shared/DonutChart';

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

const COLORS = ['#C9A84C', '#A68A3E', '#5C3A1E', '#3B2314', '#6B3A2A', '#4A2D1A', '#E0C068', '#8B6F47', '#cd853f', '#bc8f8f'];

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Icons (inline SVG) ──

const SwordIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m11 19-6-6" /><path d="m5 21-2-2" /><path d="m8 16-4 4" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ChainIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const ScaleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" /><path d="M5 6l7-3 7 3" />
    <path d="M2 15l3-9 3 9a5 5 0 0 1-6 0z" /><path d="M16 15l3-9 3 9a5 5 0 0 1-6 0z" />
  </svg>
);

const CreditCardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const ChestIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" /><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
    <path d="M3 8h18v8H3z" /><circle cx="12" cy="12" r="2" />
  </svg>
);

// ── Component ──

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rangeMode, setRangeMode] = useState<'month' | 'quarter' | 'year' | 'all'>('month');

  const [balance, setBalance] = useState<MonthlyBalance | null>(null);
  const [prevBalance, setPrevBalance] = useState<MonthlyBalance | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loans, setLoans] = useState<LoanSummary>({ lent: 0, borrowed: 0 });
  const [installmentCount, setInstallmentCount] = useState(0);
  const [pendingCC, setPendingCC] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in');
  const isFirstLoad = useRef(true);

  // Fetch month-dependent data
  useEffect(() => {
    const fetchData = async () => {
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

      setLoading(false);
      setFadeState('in');
      isFirstLoad.current = false;
    };

    fetchData();
  }, [month, rangeMode]);

  // Fetch static data (projection, loans, installment count)
  const loadStaticData = useCallback(() => {
    window.api.financeGetProjection(3).then((data) => setProjection(data as ProjectionMonth[]));
    window.api.financeGetActiveLoanSummary().then((data) => setLoans(data as LoanSummary));
    window.api.financeGetInstallmentGroups().then((data) => setInstallmentCount((data as unknown[]).length));
    window.api.financeGetCreditCardStatements({ status: 'pending' }).then((data) => {
      const total = (data as Array<{ calculatedAmount: number }>).reduce((sum, s) => sum + s.calculatedAmount, 0);
      setPendingCC(total);
    });
  }, []);

  useEffect(() => { loadStaticData(); }, [loadStaticData]);

  // Auto-generate recurring transactions for the current month (idempotent)
  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(month);
  }, []);

  // Auto-generate credit card statements for the current month (idempotent)
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
    const handler = () => { loadStaticData(); isFirstLoad.current = true; };
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
      color: COLORS[i % COLORS.length],
    }));

  // Projection bar max
  const projMax = Math.max(...projection.map((p) => p.total), 1);

  const hasUsd = balance ? (balance.USD.income > 0 || balance.USD.expenses > 0) : false;
  const netLoans = loans.lent - loans.borrowed;

  // ── Skeleton ──

  if (loading && isFirstLoad.current) {
    return (
      <div className="coin-dashboard coin-dashboard--loading">
        <div className="coin-dashboard__header">
          {rangeMode === 'month' && <MonthNavigator month={month} onChange={setMonth} compact />}
          <select
            className="rpg-select"
            value={rangeMode}
            onChange={(e) => setRangeMode(e.target.value as typeof rangeMode)}
            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
          >
            <option value="month">{t('coinify.range_month')}</option>
            <option value="quarter">{t('coinify.range_quarter')}</option>
            <option value="year">{t('coinify.range_year')}</option>
            <option value="all">{t('coinify.range_all')}</option>
          </select>
          <DollarChip />
        </div>
        <div className="coin-skeleton coin-skeleton--card" style={{ height: 120 }} />
        <div className="coin-stats-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="coin-skeleton coin-skeleton--card" />
          ))}
        </div>
        <div className="coin-skeleton coin-skeleton--chart" />
        <div className="coin-bottom-grid">
          <div className="coin-skeleton coin-skeleton--card" style={{ height: 100 }} />
          <div className="coin-skeleton coin-skeleton--card" style={{ height: 100 }} />
        </div>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="coin-dashboard">
      {/* Header */}
      <div className="coin-dashboard__header">
        {rangeMode === 'month' && <MonthNavigator month={month} onChange={setMonth} compact />}
        <select
          className="rpg-select"
          value={rangeMode}
          onChange={(e) => setRangeMode(e.target.value as typeof rangeMode)}
          style={{ fontSize: '0.8rem', padding: '4px 8px' }}
        >
          <option value="month">{t('coinify.range_month')}</option>
          <option value="quarter">{t('coinify.range_quarter')}</option>
          <option value="year">{t('coinify.range_year')}</option>
          <option value="all">{t('coinify.range_all')}</option>
        </select>
        <DollarChip />
      </div>

      <div
        className={`coin-dashboard__content ${
          fadeState === 'out' ? 'coin-dashboard__content--fade-out' : 'coin-dashboard__content--fade-in'
        }`}
      >
        {/* Hero: Cofre del Mes */}
        {balance && (
          <div className="coin-hero">
            <div className="coin-hero__row">
              <div className="coin-hero__icon">
                <ChestIcon />
              </div>
              <div className="coin-hero__numbers">
                <AnimatedNumber
                  value={balance.ARS.balance}
                  className={`coin-hero__balance ${
                    balance.ARS.balance >= 0 ? 'coin-hero__balance--positive' : 'coin-hero__balance--negative'
                  }`}
                />
                {hasUsd && (
                  <AnimatedNumber
                    value={balance.USD.balance}
                    locale="en-US"
                    className="coin-hero__balance-usd"
                  />
                )}
              </div>
            </div>
            <BalanceBar income={balance.ARS.income} expenses={balance.ARS.expenses} />
            {trendPct !== null && (
              <div className={`coin-hero__trend ${trendPct <= 0 ? 'coin-hero__trend--up' : 'coin-hero__trend--down'}`}>
                <span className="coin-hero__trend-arrow">{trendPct <= 0 ? '\u25BC' : '\u25B2'}</span>
                <span>
                  {Math.abs(trendPct)}% {trendPct <= 0 ? t('coinify.lessThanLastMonth') : t('coinify.moreThanLastMonth')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Stat Cards */}
        {balance && (
          <div className="coin-stats-grid">
            <CoinStatCard
              icon={<SwordIcon />}
              label={t('coinify.expense')}
              value={balance.ARS.expenses}
              color="red"
            />
            <CoinStatCard
              icon={<ShieldIcon />}
              label={t('coinify.income')}
              value={balance.ARS.income}
              color="green"
            />
            <CoinStatCard
              icon={<ChainIcon />}
              label={t('coinify.activeInstallments')}
              value={installmentCount}
              color="gold"
              prefix=""
            />
            <CoinStatCard
              icon={<CreditCardIcon />}
              label={t('coinify.pendingCC')}
              value={pendingCC}
              color="red"
            />
            <CoinStatCard
              icon={<ScaleIcon />}
              label={t('coinify.netDebts')}
              value={netLoans}
              color={netLoans >= 0 ? 'green' : 'red'}
            />
          </div>
        )}

        {/* Donut: Categories */}
        <DonutChart data={donutData} title={t('coinify.byCategory')} />

        {/* Bottom Grid: Projection + Loans */}
        <div className="coin-bottom-grid">
          {/* Projection */}
          <div className="rpg-card coin-projection">
            <div className="rpg-card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              {t('coinify.nextBattles')}
            </div>
            {projection.length > 0 ? (
              <div className="coin-projection__bar-wrap">
                {projection.map((p) => {
                  const pct = (p.total / projMax) * 100;
                  const label = new Date(p.month + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                  return (
                    <div key={p.month} className="coin-projection__row" title={`${t('coinify.installments')}: $${p.installments.toLocaleString('es-AR')} | ${t('coinify.recurringLabel')}: $${p.recurring.toLocaleString('es-AR')}`}>
                      <span className="coin-projection__month-label">{label}</span>
                      <div className="coin-projection__bar">
                        <div className="coin-projection__bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="coin-projection__value">${p.total.toLocaleString('es-AR')}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="coin-empty">{t('coinify.noData')}</p>
            )}
          </div>

          {/* Loans Summary */}
          <div className="rpg-card coin-loans-summary" onClick={() => navigate('/finance/loans')}>
            <div className="rpg-card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {t('coinify.alliancesAndDebts')}
            </div>
            {loans.lent === 0 && loans.borrowed === 0 ? (
              <div className="coin-loans-summary__empty">
                <ShieldIcon />
                <span>{t('coinify.noActiveDebts')}</span>
              </div>
            ) : (
              <div>
                <div className="coin-loans-summary__row">
                  <span className="coin-loans-summary__label">{t('coinify.owed')}</span>
                  <span className="coin-loans-summary__value coin-loans-summary__value--green">
                    ${loans.lent.toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="coin-loans-summary__row">
                  <span className="coin-loans-summary__label">{t('coinify.owing')}</span>
                  <span className="coin-loans-summary__value coin-loans-summary__value--red">
                    ${loans.borrowed.toLocaleString('es-AR')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="coin-quick-actions">
          <button className="rpg-button" onClick={() => navigate('/finance/transactions?type=expense')}>
            <SwordIcon /> + {t('coinify.expense')}
          </button>
          <button className="rpg-button" onClick={() => navigate('/finance/transactions?type=income')}>
            <ShieldIcon /> + {t('coinify.income')}
          </button>
        </div>
      </div>
    </div>
  );
}
