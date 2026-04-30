import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySelect } from './CategorySelect';
import { CreditCardSelect } from './CreditCardSelect';
import { useToast } from '../../../../shared/components/useToast';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import type { TransactionType, PaymentMethod, Currency } from '../../types';
import { ChevronUp, ChevronDown } from '../../../../shared/components/icons';

interface CategoryMapping {
  merchantPattern: string;
  category: string;
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
    creditCardId?: string;
  }) => void;
  defaultType?: TransactionType;
}

export function QuickAddForm({ onSubmit, defaultType = 'expense' }: QuickAddFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Otros');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today);
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [installments, setInstallments] = useState(1);
  const [creditCardId, setCreditCardId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Category mappings for auto-suggestion
  const [mappings, setMappings] = useState<CategoryMapping[]>([]);
  const userOverrode = useRef(false);

  const loadMappings = useCallback(() => {
    window.api.financeGetCategoryMappings().then((data) => {
      setMappings(data as CategoryMapping[]);
    });
  }, []);

  useEffect(() => { loadMappings(); }, [loadMappings]);

  useEffect(() => {
    const handler = () => loadMappings();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadMappings]);

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

    onSubmit({
      type,
      amount: parsed,
      category,
      description,
      date,
      currency,
      paymentMethod,
      installments: paymentMethod === 'credit_card' ? installments : 1,
      creditCardId: paymentMethod === 'credit_card' ? creditCardId : undefined,
    });

    setAmount('');
    setDescription('');
    setInstallments(1);
    setCreditCardId('');
    userOverrode.current = false;
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card coin-quick-add-form coin-quick-add-form--open">
      <div className="coin-quick-add-form__title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8M8 14h8" />
        </svg>
        {t('coinify.quickAdd')}
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
        <RpgNumberInput value={amount} onChange={setAmount}
          placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} required />
        <CategorySelect value={category} onChange={handleCategoryChange} />
      </div>

      <div className="coin-quick-add-form__row">
        <input type="text" value={description} onChange={handleDescriptionChange}
          placeholder={t('coinify.description')} className="rpg-input" style={{ flex: 1 }} />
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
        <span style={{ marginLeft: 4, fontSize: '0.8em' }}>{showAdvanced ? <ChevronUp /> : <ChevronDown />}</span>
      </button>

      {/* Advanced fields */}
      {showAdvanced && (
        <div className="coin-quick-add-form__advanced">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rpg-input" style={{ flex: 1 }} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
            className="rpg-select" style={{ width: 80 }}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="rpg-select" style={{ flex: 1 }}>
            <option value="cash">{t('coinify.cash')}</option>
            <option value="debit">{t('coinify.debit')}</option>
            <option value="transfer">{t('coinify.transfer')}</option>
            <option value="credit_card">{t('coinify.creditCard')}</option>
          </select>
          {paymentMethod === 'credit_card' && (
            <>
              <label style={{ fontSize: 'var(--fs-label)', whiteSpace: 'nowrap' }}>{t('coinify.installments')}</label>
              <RpgNumberInput value={String(installments)}
                onChange={(v) => setInstallments(Math.max(1, parseInt(v) || 1))}
                style={{ width: 60 }} min={1} />
              <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
            </>
          )}
        </div>
      )}

      {/* Submit */}
      <button type="submit" className="rpg-button" style={{ width: '100%' }}>{t('coinify.add')}</button>
    </form>
  );
}
