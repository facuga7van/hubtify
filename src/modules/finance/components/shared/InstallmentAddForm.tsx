import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Currency, PaymentMethod } from '../../types';
import { CategorySelect } from './CategorySelect';
import { CreditCardSelect } from './CreditCardSelect';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';

interface Props {
  onCreated: () => void;
}

function computeLinearAmounts(first: number, last: number, count: number): number[] {
  if (count <= 1) return [first];
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((first + step * i) * 100) / 100
  );
}

export default function InstallmentAddForm({ onCreated }: Props) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Otros');
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debit');
  const [creditCardId, setCreditCardId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstAmount, setFirstAmount] = useState('');
  const [lastAmount, setLastAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const count = parseInt(installmentCount, 10);
    const first = parseFloat(firstAmount);
    const last = lastAmount ? parseFloat(lastAmount) : first;
    if (!description || !count || !first) return;

    setSubmitting(true);
    try {
      const amounts = first === last
        ? undefined
        : computeLinearAmounts(first, last, count);

      await window.api.financeCreateInstallmentGroup({
        description,
        totalAmount: amounts ? amounts.reduce((a, b) => a + b, 0) : first * count,
        installmentCount: count,
        installmentAmount: first,
        installmentAmounts: amounts,
        currency,
        category,
        startDate,
        paymentMethod,
        creditCardId: paymentMethod === 'credit_card' ? creditCardId : undefined,
      });

      setDescription('');
      setCreditCardId('');
      setInstallmentCount('');
      setFirstAmount('');
      setLastAmount('');
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card coin-quick-add-form">
      <div className="coin-quick-add-form__title">
        {t('coinify.addInstallment', 'Nueva cuota')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="coin-quick-add-form__row">
          <input
            className="rpg-input"
            style={{ flex: 1 }}
            placeholder={t('coinify.description', 'Descripcion')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <CategorySelect value={category} onChange={setCategory} />
        </div>

        <div className="coin-quick-add-form__row">
          <select className="rpg-select" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select className="rpg-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="debit">{t('coinify.debit', 'Debito')}</option>
            <option value="credit_card">{t('coinify.creditCard', 'Tarjeta')}</option>
            <option value="transfer">{t('coinify.transfer', 'Transferencia')}</option>
            <option value="cash">{t('coinify.cash', 'Efectivo')}</option>
          </select>
          <input
            className="rpg-input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {paymentMethod === 'credit_card' && (
          <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
        )}

        <div className="coin-quick-add-form__row">
          <RpgNumberInput
            value={installmentCount}
            onChange={setInstallmentCount}
            min={1}
            max={120}
            step={1}
            placeholder={t('coinify.installmentCount', 'Cuotas')}
            required
          />
          <RpgNumberInput
            value={firstAmount}
            onChange={setFirstAmount}
            min={0}
            step={100}
            placeholder={t('coinify.firstAmount', '1ra cuota $')}
            required
          />
          <RpgNumberInput
            value={lastAmount}
            onChange={setLastAmount}
            min={0}
            step={100}
            placeholder={t('coinify.lastAmount', 'Ultima cuota $')}
          />
        </div>

        <button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? '...' : t('coinify.createInstallments', 'Crear cuotas')}
        </button>
      </div>
    </form>
  );
}
