import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Rune } from '../../../shared/components/codex';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { CategorySelect } from './shared/CategorySelect';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './shared/AccountSelect';
import { currencyPrefix, formatCurrency } from '../utils/format';
import { unwrap, failureMessage } from '../utils/api-ext';
import { useToast } from '../../../shared/components/useToast';
import { todayDateString } from '../../../../shared/date-utils';
import { emitMovementLogged } from '../utils/rpg-events';
import { checkBudgetOverflow } from '../utils/budget-guards';
import { subscribeQuickCreate, revealWidget } from '../../../hub/widgets/quick-create';

export default function DashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loansCount, setLoansCount] = useState(0);
  const [balance, setBalance] = useState<{ income: number; expenses: number; usdIncome?: number; usdExpenses?: number } | null>(null);
  // Es el primer número que ve el usuario al abrir la app. Antes las tres
  // lecturas eran promesas sueltas con `console.warn` por `catch`: si el puente
  // fallaba, el widget se quedaba con «---» PARA SIEMPRE y nadie se enteraba.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Quick-add form state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickType, setQuickType] = useState<'expense' | 'income'>('expense');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickDesc, setQuickDesc] = useState('');
  // The shortcut used to hard-code "Otros", quietly wrecking the category
  // breakdown the dashboard shows two panels away.
  const [quickCategory, setQuickCategory] = useState('Otros');
  const [quickPayment, setQuickPayment] = useState<'cash' | 'debit' | 'transfer' | 'credit_card'>('cash');
  // '' = unresolved; the AccountSelect picks the default (last used / Efectivo).
  const [quickAccount, setQuickAccount] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(() => {
    setLoadError(false);
    Promise.all([
      // El total del mes no se pinta acá, pero es la primera lectura que se
      // rompe cuando el puente no está: va en el mismo `Promise.all` para que
      // el widget se entere y lo diga.
      window.api.financeGetMonthlyTotal(),
      window.api.financeGetActiveLoansCount(),
      window.api.financeGetMonthlyBalance(),
    ]).then(([, count, b]) => {
      setLoansCount(count);
      const data = b as { ARS?: { income: number; expenses: number }; USD?: { income: number; expenses: number } } | null;
      if (data) {
        // ARS only — this widget renders a single peso-prefixed figure, and adding
        // USD 300 to ARS 300.000 as "300.300" was the first number the user saw on
        // opening the app. USD gets its own line when present (see render below).
        setBalance({
          income: data.ARS?.income ?? 0,
          expenses: data.ARS?.expenses ?? 0,
          usdIncome: data.USD?.income ?? 0,
          usdExpenses: data.USD?.expenses ?? 0,
        });
      }
      setLoading(false);
    }).catch((err) => {
      console.error('[DashboardWidget] load failed:', err);
      setLoadError(true);
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  // "Anotá un gasto" from the dashboard's empty state opens THIS form, in the
  // hub, instead of navigating to /finance and leaving the user to find it.
  useEffect(() => subscribeQuickCreate('expense', () => {
    setQuickType('expense');
    setShowQuickAdd(true);
    revealWidget(rootRef.current);
  }), []);

  const income = balance?.income ?? 0;
  const expenses = balance?.expenses ?? 0;
  const balanceNet = income - expenses;
  const usdNet = (balance?.usdIncome ?? 0) - (balance?.usdExpenses ?? 0);
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
      const result = await unwrap(window.api.financeAddTransaction({
        type: quickType,
        amount,
        description: quickDesc.trim() || (quickType === 'expense' ? t('coinify.quickExpense', 'Gasto rápido') : t('coinify.quickIncome', 'Ingreso rápido')),
        // Local date, not UTC: everything logged after 21:00 in Argentina used
        // to be filed under tomorrow.
        date: todayDateString(),
        category: quickCategory || 'Otros',
        currency: 'ARS',
        paymentMethod: quickPayment,
        // Absent while the accounts bridge is not wired — the backend then
        // applies its own cash→«Efectivo» default. Card purchases never belong
        // to an account (the statement payment will).
        ...(accountsSupported
          ? { accountId: quickPayment === 'credit_card' ? null : accountIdForSubmit(quickAccount) }
          : {}),
      }));
      if (!result.ok) {
        toast({ type: 'warning', message: failureMessage(result.reason, t) });
        return;
      }

      // The manual act of logging a movement pays XP. Import, automatic
      // recurring generation, statement payments and edits deliberately do not —
      // see `utils/rpg-events.ts`. The new row's id is the event's ref, so a
      // later delete from the ledger can reverse exactly this XP.
      const rpg = await emitMovementLogged(quickType, result.value);
      const xpSuffix = rpg ? ` · +${rpg.xpGained} XP` : '';
      toast({
        type: 'coin',
        message: `${formatCurrency(quickType === 'expense' ? -amount : amount, { currency: 'ARS', decimals: 2, showSign: true })}${xpSuffix}`,
        details: { transactionType: quickType },
      });

      if (quickType === 'expense') {
        const blown = await checkBudgetOverflow(todayDateString().slice(0, 7), quickCategory || 'Otros');
        if (blown) {
          toast({
            type: 'warning',
            message: t('coinify.budgetOverflow', '{{category}}: te pasaste del límite del mes', { category: blown }),
          });
        }
      }

      // Reset
      if (accountsSupported) rememberLastAccountId(quickAccount === '' ? NO_ACCOUNT : quickAccount);
      setQuickAmount('');
      setQuickDesc('');
      setShowQuickAdd(false);
      loadData();
      window.dispatchEvent(new Event('finance:dataChanged'));
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
    <div ref={rootRef}>
      {loadError ? (
        /* Un fallo de carga se dice. Antes se quedaba en «---», que el ojo lee
           como «todavía cargando» y nunca deja de leer así. */
        <div className="coin-widget-error">
          <p className="coin-widget-error__text">{t('coinify.loadError', 'Error al cargar datos')}</p>
          <button className="rpg-button rpg-btn-sm" onClick={() => { setLoading(true); loadData(); }}>
            {t('common.tryAgain', 'Intentar de nuevo')}
          </button>
        </div>
      ) : loading ? (
        <div style={{ margin: '6px 0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="coin-skeleton coin-skeleton--bar" />
          <div className="coin-skeleton coin-skeleton--bar" />
          <div className="coin-skeleton coin-skeleton--bar" style={{ height: 10 }} />
        </div>
      ) : (
      <div style={{ margin: '6px 0 10px' }}>
        {/* Income row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginBottom: 4 }}>
          <span className="qb-hand">{t('coinify.income', 'Ingreso')}</span>
          <span className="qb-numeral" style={{ fontSize: 'var(--fs-body)', color: 'var(--moss)' }}>
            <AnimatedNumber value={income} prefix={currencyPrefix()} />
          </span>
        </div>

        {/* Expense row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginBottom: 4 }}>
          <span className="qb-hand">{t('coinify.expense', 'Gasto')}</span>
          <span className="qb-numeral" style={{ fontSize: 'var(--fs-body)', color: 'var(--rubric)' }}>
            <AnimatedNumber value={expenses} prefix={currencyPrefix()} />
          </span>
        </div>

        {/* Gauge */}
        <Gauge value={spendPct} max={100} tone="gold" showPips={true} />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-label)', marginTop: 4, color: 'var(--ink-faded)' }}>
          <span>
            {t('coinify.thisMonth', 'este mes')} &middot;{' '}
            <AnimatedNumber value={balanceNet} prefix={currencyPrefix()} />
            {usdNet !== 0 && (
              <span style={{ opacity: 0.75, marginLeft: 6 }}>
                {usdNet > 0 ? '+' : '−'}US$ {Math.abs(usdNet).toLocaleString('es-AR')}
              </span>
            )}
          </span>
          <span>{monthPct}% {t('coinify.ofTheMonth', 'del mes')}</span>
        </div>
      </div>
      )}

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

          {/* Category + payment method: without them this shortcut filed every
              entry under "Otros" in cash. */}
          <div className="coin-dash-quick__meta-row">
            <CategorySelect value={quickCategory} onChange={setQuickCategory} />
            <select
              className="rpg-select"
              value={quickPayment}
              aria-label={t('coinify.paymentMethod', 'Medio de pago')}
              onChange={(e) => setQuickPayment(e.target.value as typeof quickPayment)}
            >
              <option value="cash">{t('coinify.cash', 'Efectivo')}</option>
              <option value="debit">{t('coinify.debit', 'Débito')}</option>
              <option value="transfer">{t('coinify.transfer', 'Transferencia')}</option>
              <option value="credit_card">{t('coinify.creditCard', 'Tarjeta de crédito')}</option>
            </select>
          </div>

          {/* Which pocket the money leaves / enters. Renders nothing while the
              accounts bridge is not wired. */}
          {quickPayment !== 'credit_card' && (
            <div className="coin-dash-quick__meta-row">
              <AccountSelect value={quickAccount} onChange={setQuickAccount} onSupported={setAccountsSupported} />
            </div>
          )}

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
