import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySelect } from './CategorySelect';
import { CreditCardSelect } from './CreditCardSelect';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './AccountSelect';
import { AmountWithCurrency } from './AmountWithCurrency';
import { AmountModeToggle, useAmountModePlaceholder } from './AmountModeToggle';
import { useToast } from '../../../../shared/components/useToast';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import type { TransactionType, PaymentMethod, Currency } from '../../types';
import type { AmountMode } from '../../utils/installment-payload';
import { RESERVED_CATEGORIES } from '../../types';
import { ChevronUp, ChevronDown } from '../../../../shared/components/icons';
import { todayDateString } from '../../../../../shared/date-utils';

interface CategoryMapping {
  merchantPattern: string;
  category: string;
}

/** The last manual movement, as the ledger returns it. */
interface LastTransaction {
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  description: string;
  paymentMethod: PaymentMethod;
  creditCardId?: string | null;
  accountId?: string | null;
  source: string;
  installments?: number;
}

interface QuickAddFormProps {
  onSubmit: (data: {
    type: TransactionType;
    amount: number;
    category: string;
    description: string;
    date: string;
    currency: Currency;
    paymentMethod: PaymentMethod;
    installments: number;
    /** Si `amount` es el precio de UNA cuota o el total financiado. Sin esto,
     *  quien tipeaba el precio de vidriera creaba un plan N veces más grande. */
    amountMode: AmountMode;
    creditCardId?: string;
    /** Omitted while the accounts bridge is not wired (backend maps cash→Efectivo). */
    accountId?: string | null;
  }) => void;
  defaultType?: TransactionType;
}

/** The amount field, so "Repetir último" can hand the caret straight to it. */
const AMOUNT_INPUT_ID = 'coin-quick-add-amount';

export function QuickAddForm({ onSubmit, defaultType = 'expense' }: QuickAddFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Local date, not UTC: everything logged after 21:00 in Argentina used to be
  // filed under tomorrow — and on the 31st, under next month's budget.
  const today = todayDateString();

  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Otros');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today);
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [installments, setInstallments] = useState(1);
  const [amountMode, setAmountMode] = useState<AmountMode>('installment');
  const [creditCardId, setCreditCardId] = useState('');
  // '' = unresolved; the AccountSelect picks the default (last used / Efectivo).
  const [accountValue, setAccountValue] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastTx, setLastTx] = useState<LastTransaction | null>(null);

  // Category mappings for auto-suggestion
  const [mappings, setMappings] = useState<CategoryMapping[]>([]);
  const userOverrode = useRef(false);

  const loadMappings = useCallback(() => {
    window.api.financeGetCategoryMappings().then((data) => {
      setMappings(data as CategoryMapping[]);
    });
  }, []);

  /**
   * The last movement the user typed by hand, for "Repetir último".
   *
   * `limit` keeps this off the ledger-sized query the page already runs, and the
   * reserved categories are dropped here rather than in SQL: the newest `manual`
   * row is very often the statement payment the app wrote itself, and offering
   * to repeat *that* would be actively harmful.
   */
  const loadLastTransaction = useCallback(() => {
    window.api
      .financeGetTransactions({ source: 'manual', limit: 10 })
      .then((data) => {
        const rows = data as LastTransaction[];
        const candidate = rows.find(
          (r) => r.type === 'expense' && !RESERVED_CATEGORIES.includes(r.category),
        );
        setLastTx(candidate ?? null);
      })
      .catch((err) => console.error('[QuickAddForm] financeGetTransactions failed:', err));
  }, []);

  useEffect(() => { loadMappings(); loadLastTransaction(); }, [loadMappings, loadLastTransaction]);

  useEffect(() => {
    const handler = () => { loadMappings(); loadLastTransaction(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadMappings, loadLastTransaction]);

  // Auto-suggest category when description changes
  const suggestCategory = useCallback(
    (desc: string) => {
      if (!desc.trim() || mappings.length === 0) return null;
      const upper = desc.toUpperCase();
      for (const m of mappings) {
        if (upper.includes(m.merchantPattern.toUpperCase())) {
          return m.category;
        }
      }
      return null;
    },
    [mappings],
  );

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDescription(val);

    // Only auto-suggest if user hasn't manually picked a category
    if (!userOverrode.current) {
      const suggested = suggestCategory(val);
      if (suggested) {
        setCategory(suggested);
      }
    }
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    userOverrode.current = true;
  };

  /**
   * Loads the whole shape of the last expense — category, payment method, card,
   * description — and puts the caret in the amount field with the old number
   * selected, so the actual gesture is one click, type the price, Enter.
   */
  const handleRepeatLast = () => {
    if (!lastTx) return;
    setType(lastTx.type);
    setCategory(lastTx.category);
    setDescription(lastTx.description ?? '');
    setCurrency(lastTx.currency === 'USD' ? 'USD' : 'ARS');
    setPaymentMethod(lastTx.paymentMethod);
    setCreditCardId(lastTx.paymentMethod === 'credit_card' ? (lastTx.creditCardId ?? '') : '');
    if (accountsSupported) setAccountValue(lastTx.accountId ?? NO_ACCOUNT);
    setInstallments(1);
    setAmountMode('installment');
    setDate(today);
    setAmount(String(lastTx.amount));
    // The category came from history, not from the description matcher.
    userOverrode.current = true;

    requestAnimationFrame(() => {
      const el = document.getElementById(AMOUNT_INPUT_ID) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  };

  /** Cargar con tarjeta y más de una cuota no escribe un gasto: escribe un plan,
   *  y entonces el número tipeado necesita decir de qué monto habla. */
  const isInstallmentPlan = paymentMethod === 'credit_card' && installments > 1;
  const installmentPlaceholder = useAmountModePlaceholder(amountMode);
  const amountLabel = isInstallmentPlan ? installmentPlaceholder : t('coinify.amount');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    if (paymentMethod === 'credit_card' && !creditCardId) {
      toast({ type: 'warning', message: t('coinify.validationCreditCard', 'Seleccioná una tarjeta') });
      return;
    }

    if (accountsSupported) rememberLastAccountId(accountValue === '' ? NO_ACCOUNT : accountValue);

    onSubmit({
      type,
      amount: parsed,
      category,
      description,
      date,
      currency,
      paymentMethod,
      installments: paymentMethod === 'credit_card' ? installments : 1,
      // Solo un plan en cuotas puede estar en modo «total»; un gasto suelto es
      // siempre su propio monto.
      amountMode: isInstallmentPlan ? amountMode : 'installment',
      creditCardId: paymentMethod === 'credit_card' ? creditCardId : undefined,
      // Only when the selector is actually usable: absent, the backend applies
      // its own default mapping (cash → «Efectivo»). A card purchase never
      // belongs to an account — the statement payment will.
      ...(accountsSupported
        ? { accountId: paymentMethod === 'credit_card' ? null : accountIdForSubmit(accountValue) }
        : {}),
    });

    setAmount('');
    setDescription('');
    setInstallments(1);
    setAmountMode('installment');
    setCreditCardId('');
    userOverrode.current = false;
    // What was just written is the new "last one".
    loadLastTransaction();
  };

  const repeatTitle = lastTx
    ? `${lastTx.description || lastTx.category} · ${lastTx.category}`
    : '';

  return (
    <form onSubmit={handleSubmit} className="rpg-card coin-quick-add-form coin-quick-add-form--open">
      <div className="coin-quick-add-form__title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8M8 14h8" />
        </svg>
        {t('coinify.quickAdd')}
        {/* One click loads the shape of the last expense; only the amount is
            usually different, and it comes pre-selected to be typed over. */}
        {lastTx && (
          <button
            type="button"
            className="coin-quick-add-form__repeat"
            onClick={handleRepeatLast}
            title={`${t('coinify.repeatLastHint', 'Repetir el último gasto cargado a mano')}: ${repeatTitle}`}
          >
            {t('coinify.repeatLast', 'Repetir último')}
          </button>
        )}
      </div>

      {/* Type toggle */}
      <div className="coin-quick-add-form__type-row">
        <button type="button" onClick={() => setType('expense')}
          className={`rpg-button ${type === 'expense' ? 'rpg-btn-active' : ''}`}
          style={{ flex: 1 }}>
          {t('coinify.expense')}
        </button>
        <button type="button" onClick={() => setType('income')}
          className={`rpg-button ${type === 'income' ? 'rpg-btn-active' : ''}`}
          style={{ flex: 1 }}>
          {t('coinify.income')}
        </button>
      </div>

      {/* Primary: Amount + Category + Description */}
      <div className="coin-quick-add-form__amount-row">
        {/* El rótulo cambia con el modo: en un plan en cuotas «Monto» a secas
            era ambiguo y quien tipeaba el precio total creaba un plan N veces
            más grande, sin ningún aviso. */}
        <RpgNumberInput id={AMOUNT_INPUT_ID} value={amount} onChange={setAmount}
          aria-label={amountLabel}
          placeholder={amountLabel} style={{ flex: 1 }} min={0} step={0.01} required />
        <CategorySelect value={category} onChange={handleCategoryChange} />
      </div>

      {isInstallmentPlan && (
        <AmountModeToggle
          mode={amountMode}
          onChange={setAmountMode}
          typedAmount={amount}
          installmentCount={installments}
          currency={currency}
        />
      )}

      {/* What this amount is worth in the other currency, with the house that
          will be frozen on the row. Deliberately OUTSIDE «Más opciones»: the
          currency picker lives in there, so once USD is chosen and the panel is
          collapsed this line is the only thing still saying the amount is in
          dollars — and what they are worth today. */}
      <AmountWithCurrency amount={amount} currency={currency} />

      <div className="coin-quick-add-form__row">
        <input type="text" value={description} onChange={handleDescriptionChange}
          placeholder={t('coinify.description')} className="rpg-input" style={{ flex: 1 }} />
      </div>

      {/* How it was paid. This used to live behind "Más opciones", so the
          default — cash — was silently applied to card purchases and the
          statement never saw them. */}
      <div className="coin-quick-add-form__payment-row">
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          className="rpg-select coin-quick-add-form__payment"
          aria-label={t('coinify.paymentMethod', 'Medio de pago')}>
          <option value="cash">{t('coinify.cash')}</option>
          <option value="debit">{t('coinify.debit')}</option>
          <option value="transfer">{t('coinify.transfer')}</option>
          <option value="credit_card">{t('coinify.creditCard')}</option>
        </select>
        {/* Which pocket the money leaves / enters. Hidden (and harmless) while
            the accounts bridge is not wired. Card purchases do not touch any
            account until the statement is paid, so the picker steps aside. */}
        {paymentMethod !== 'credit_card' && (
          <AccountSelect value={accountValue} onChange={setAccountValue} onSupported={setAccountsSupported} />
        )}
        {paymentMethod === 'credit_card' && (
          <>
            <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
            <label className="coin-quick-add-form__installments-label" htmlFor="coin-quick-add-installments">
              {t('coinify.installments')}
            </label>
            <RpgNumberInput id="coin-quick-add-installments" value={String(installments)}
              onChange={(v) => setInstallments(Math.max(1, parseInt(v) || 1))}
              aria-label={t('coinify.installments')}
              style={{ width: 64 }} min={1} />
          </>
        )}
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        className="coin-quick-add-form__toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced
          ? t('coinify.lessOptions', 'Menos opciones')
          : t('coinify.moreOptions', 'Más opciones')}
        {/* Sin medidas los iconos salían a su tamaño por defecto (24×24) dentro
            de un renglón de 13 px: se veía una marca suelta colgando debajo del
            texto, recortada por el `overflow: hidden` del acordeón. */}
        {showAdvanced
          ? <ChevronUp width={10} height={10} />
          : <ChevronDown width={10} height={10} />}
      </button>

      {/* Advanced fields — date and currency, which almost always keep their
          defaults of "today, in pesos". */}
      {showAdvanced && (
        <div className="coin-quick-add-form__advanced">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            aria-label={t('coinify.colDate', 'Fecha')}
            className="rpg-input" style={{ flex: 1 }} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
            aria-label="ARS / USD"
            className="rpg-select" style={{ width: 80 }}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
      )}

      {/* Submit */}
      <button type="submit" className="rpg-button" style={{ width: '100%' }}>{t('coinify.add')}</button>
    </form>
  );
}
