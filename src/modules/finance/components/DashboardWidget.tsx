import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Rune } from '../../../shared/components/codex';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { currencyPrefix } from '../utils/format';
import { useToast } from '../../../shared/components/useToast';

export default function DashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [total, setTotal] = useState<number | null>(null);
  const [loansCount, setLoansCount] = useState(0);
  const [balance, setBalance] = useState<{ income: number; expenses: number } | null>(null);

  // Quick-add form state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickType, setQuickType] = useState<'expense' | 'income'>('expense');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickDesc, setQuickDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const handleQuickAdd = async () => {
    const amount = parseFloat(quickAmount);
    if (!Number.isFinite(amount) || amount <= 0 || submitting) return;
    setSubmitting(true);
    try {
      await window.api.financeAddTransaction({
        type: quickType,
        amount,
        description: quickDesc.trim() || (quickType === 'expense' ? 'Gasto rapido' : 'Ingreso rapido'),
        date: new Date().toISOString().slice(0, 10),
        category: 'Otros',
        currency: 'ARS',
        paymentMethod: 'cash',
      });
      toast({ type: 'coin', message: `${quickType === 'expense' ? '-' : '+'}$${amount.toFixed(2)}` });
      // Reset
      setQuickAmount('');
      setQuickDesc('');
      setShowQuickAdd(false);
      loadData();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } catch (err) {
      console.warn('[DashboardWidget] quickAdd failed:', err);
      toast({ type: 'warning', message: t('coinify.quickAddError', 'Error al registrar') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    }
  };

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

      {/* Quick-add toggle */}
      <div style={{ textAlign: 'center', marginTop: 6 }}>
        <button
          type="button"
          className="coin-dash-quick__toggle"
          onClick={() => setShowQuickAdd(!showQuickAdd)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {showQuickAdd
              ? <path d="M18 15l-6-6-6 6" />
              : <path d="M12 5v14M5 12h14" />}
          </svg>
          <span style={{ marginLeft: 4 }}>{t('coinify.quickAdd', 'Carga rapida')}</span>
        </button>
      </div>

      {/* Quick-add form */}
      {showQuickAdd && (
        <div className="coin-dash-quick">
          {/* Type toggle */}
          <div className="coin-dash-quick__type-row">
            <button
              type="button"
              className={`rpg-button coin-dash-quick__type-btn ${quickType === 'expense' ? 'coin-dash-quick__type-btn--active-expense' : ''}`}
              onClick={() => setQuickType('expense')}
            >
              {t('coinify.expense', 'Gasto')}
            </button>
            <button
              type="button"
              className={`rpg-button coin-dash-quick__type-btn ${quickType === 'income' ? 'coin-dash-quick__type-btn--active-income' : ''}`}
              onClick={() => setQuickType('income')}
            >
              {t('coinify.income', 'Ingreso')}
            </button>
          </div>

          {/* Amount input */}
          <input
            type="number"
            className="rpg-input"
            placeholder="$0.00"
            step="0.01"
            min="0"
            value={quickAmount}
            onChange={(e) => setQuickAmount(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            style={{ width: '100%' }}
          />

          {/* Description input */}
          <input
            type="text"
            className="rpg-input"
            placeholder={t('coinify.description', 'Descripcion...')}
            value={quickDesc}
            onChange={(e) => setQuickDesc(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            style={{ width: '100%' }}
          />

          {/* Submit button */}
          <button
            type="button"
            className="rpg-button"
            style={{ width: '100%' }}
            disabled={submitting || !quickAmount || parseFloat(quickAmount) <= 0}
            onClick={handleQuickAdd}
          >
            {submitting ? '...' : t('coinify.quickAddSubmit', 'Registrar')}
          </button>
        </div>
      )}

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
            ? `${loansCount} ${t('coinify.activeLoans', 'prestamos activos')}`
            : t('coinify.thisMonth', 'este mes')}
        </span>
        <Rune>{monthPct}%</Rune>
      </div>
    </div>
  );
}
