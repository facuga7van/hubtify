import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Rune } from '../../../shared/components/codex';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { currencyPrefix } from '../utils/format';

export default function DashboardWidget() {
  const { t } = useTranslation();
  const [total, setTotal] = useState<number | null>(null);
  const [loansCount, setLoansCount] = useState(0);
  const [balance, setBalance] = useState<{ income: number; expenses: number } | null>(null);

  const loadData = useCallback(() => {
    window.api.financeGetMonthlyTotal().then(setTotal).catch((err) => console.warn('[DashboardWidget] financeGetMonthlyTotal failed:', err));
    window.api.financeGetActiveLoansCount().then(setLoansCount).catch((err) => console.warn('[DashboardWidget] financeGetActiveLoansCount failed:', err));
    // Get monthly balance for income/expense breakdown
    window.api.financeGetMonthlyBalance().then((b) => {
      const data = b as { ARS?: { income: number; expenses: number }; USD?: { income: number; expenses: number } } | null;
      if (data) {
        // Sum across currencies
        const income = (data.ARS?.income ?? 0) + (data.USD?.income ?? 0);
        const expenses = (data.ARS?.expenses ?? 0) + (data.USD?.expenses ?? 0);
        setBalance({ income, expenses });
      }
    }).catch((err) => console.warn('[DashboardWidget] financeGetMonthlyBalance failed:', err));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  const income = balance?.income ?? 0;
  const expenses = balance?.expenses ?? 0;
  const balanceNet = income - expenses;
  const spendPct = income > 0 ? Math.round((expenses / income) * 100) : 0;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);

  return (
    <div>
      <div style={{ margin: '6px 0 10px' }}>
        {/* Income row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginBottom: 4 }}>
          <span className="qb-hand">{t('coinify.income', 'Ingreso')}</span>
          <span className="qb-numeral" style={{ fontSize: 'var(--fs-body)', color: 'var(--moss)' }}>
            {total !== null ? (
              <AnimatedNumber value={income} prefix={currencyPrefix()} />
            ) : (
              <span style={{ opacity: 0.4 }}>---</span>
            )}
          </span>
        </div>

        {/* Expense row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginBottom: 4 }}>
          <span className="qb-hand">{t('coinify.expense', 'Gasto')}</span>
          <span className="qb-numeral" style={{ fontSize: 'var(--fs-body)', color: 'var(--rubric)' }}>
            {total !== null ? (
              <AnimatedNumber value={expenses} prefix={currencyPrefix()} />
            ) : (
              <span style={{ opacity: 0.4 }}>---</span>
            )}
          </span>
        </div>

        {/* Gauge */}
        <Gauge value={spendPct} max={100} tone="gold" showPips={true} />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginTop: 4, color: 'var(--ink-faded)' }}>
          <span>
            {t('coinify.thisMonth', 'este mes')} &middot;{' '}
            {total !== null ? (
              <AnimatedNumber value={balanceNet} prefix={currencyPrefix()} />
            ) : '---'}
          </span>
          <span>{monthPct}% {t('coinify.ofTheMonth', 'del mes')}</span>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          {loansCount > 0
            ? `${loansCount} ${t('coinify.activeLoans', 'préstamos activos')}`
            : t('coinify.thisMonth', 'este mes')}
        </span>
        <Rune>{monthPct}%</Rune>
      </div>
    </div>
  );
}
