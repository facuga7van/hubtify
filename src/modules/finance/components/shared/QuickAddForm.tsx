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
    <form onSubmit={handleSubmit} className="rpg-card p-4 space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setType('expense')}
          className={`rpg-btn-sm flex-1 ${type === 'expense' ? 'rpg-btn-active' : ''}`}>
          {t('coinify.expense')}
        </button>
        <button type="button" onClick={() => setType('income')}
          className={`rpg-btn-sm flex-1 ${type === 'income' ? 'rpg-btn-active' : ''}`}>
          {t('coinify.income')}
        </button>
      </div>

      <div className="flex gap-2">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={t('coinify.amount')} className="rpg-input flex-1" min="0" step="0.01" required />
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="rpg-select w-20">
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
        </select>
      </div>

      <CategorySelect value={category} onChange={setCategory} />

      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder={t('coinify.description')} className="rpg-input" />

      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rpg-input" />

      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} className="rpg-select">
        <option value="cash">{t('coinify.cash')}</option>
        <option value="debit">{t('coinify.debit')}</option>
        <option value="transfer">{t('coinify.transfer')}</option>
        <option value="credit_card">{t('coinify.creditCard')}</option>
      </select>

      {paymentMethod === 'credit_card' && (
        <div className="flex items-center gap-2">
          <label className="text-sm">{t('coinify.installments')}</label>
          <input type="number" value={installments}
            onChange={(e) => setInstallments(Math.max(1, parseInt(e.target.value) || 1))}
            className="rpg-input w-20" min="1" />
        </div>
      )}

      <button type="submit" className="rpg-button w-full">{t('coinify.add')}</button>
    </form>
  );
}
