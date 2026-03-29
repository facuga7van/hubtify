import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySelect } from './CategorySelect';
import type { TransactionType, PaymentMethod, Currency } from '../../types';

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
  }) => void;
  defaultType?: TransactionType;
}

export function QuickAddForm({ onSubmit, defaultType = 'expense' }: QuickAddFormProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];

  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Otros');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today);
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [installments, setInstallments] = useState(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;

    onSubmit({
      type,
      amount: parsed,
      category,
      description,
      date,
      currency,
      paymentMethod,
      installments: paymentMethod === 'credit_card' ? installments : 1,
    });

    setAmount('');
    setDescription('');
    setInstallments(1);
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card" style={{ marginBottom: 16, padding: 16 }}>
      <div className="rpg-card-title" style={{ marginBottom: 10 }}>💰 Carga rápida</div>

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => setType('expense')}
          className="rpg-button"
          style={{ flex: 1, opacity: type === 'expense' ? 1 : 0.4 }}>
          {t('coinify.expense')}
        </button>
        <button type="button" onClick={() => setType('income')}
          className="rpg-button"
          style={{ flex: 1, opacity: type === 'income' ? 1 : 0.4 }}>
          {t('coinify.income')}
        </button>
      </div>

      {/* Amount + currency */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={t('coinify.amount')} className="rpg-input" style={{ flex: 1 }} min="0" step="0.01" required />
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
          className="rpg-select" style={{ width: 80 }}>
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
        </select>
      </div>

      {/* Category */}
      <div style={{ marginBottom: 12 }}>
        <CategorySelect value={category} onChange={setCategory} />
      </div>

      {/* Description */}
      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder={t('coinify.description')} className="rpg-input" style={{ width: '100%', marginBottom: 12 }} />

      {/* Date */}
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
        className="rpg-input" style={{ width: '100%', marginBottom: 12 }} />

      {/* Payment method */}
      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
        className="rpg-select" style={{ width: '100%', marginBottom: 12 }}>
        <option value="cash">{t('coinify.cash')}</option>
        <option value="debit">{t('coinify.debit')}</option>
        <option value="transfer">{t('coinify.transfer')}</option>
        <option value="credit_card">{t('coinify.creditCard')}</option>
      </select>

      {/* Installments (conditional) */}
      {paymentMethod === 'credit_card' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={{ fontSize: '0.85rem' }}>{t('coinify.installments')}</label>
          <input type="number" value={installments}
            onChange={(e) => setInstallments(Math.max(1, parseInt(e.target.value) || 1))}
            className="rpg-input" style={{ width: 80 }} min="1" />
        </div>
      )}

      {/* Submit */}
      <button type="submit" className="rpg-button" style={{ width: '100%' }}>{t('coinify.add')}</button>
    </form>
  );
}
