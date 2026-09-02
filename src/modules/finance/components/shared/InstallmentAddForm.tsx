import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../../shared/components/useToast';
import type { Currency, PaymentMethod } from '../../types';
import { CategorySelect } from './CategorySelect';
import { CreditCardSelect } from './CreditCardSelect';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './AccountSelect';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { formatCurrency } from '../../utils/format';
import { splitTotalIntoInstallments, installmentAmountsFromTotal } from '../../utils/split-total';
import { todayDateString } from '../../../../../shared/date-utils';

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
  const { toast } = useToast();
  // Local date, not UTC: a plan created at 22:00 ART used to start tomorrow.
  const today = todayDateString();

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Otros');
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debit');
  const [creditCardId, setCreditCardId] = useState('');
  // Pocket every instalment leaves (non-card plans). '' = unresolved default;
  // hidden and unsent while the accounts bridge is not wired.
  const [accountValue, setAccountValue] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstAmount, setFirstAmount] = useState('');
  const [lastAmount, setLastAmount] = useState('');
  const [customLastAmount, setCustomLastAmount] = useState(false);
  /**
   * Cómo se escribe la plata: el precio de la cuota, o el total financiado.
   * Comprar en cuotas se piensa casi siempre por el total («la heladera salió
   * 900 mil en 12»), y obligaba a sacar la división a mano antes de cargarla.
   */
  const [amountMode, setAmountMode] = useState<'installment' | 'total'>('installment');
  const [submitting, setSubmitting] = useState(false);

  /** Vista previa de la división mientras se escribe. */
  const totalSplit = useMemo(() => {
    if (amountMode !== 'total') return null;
    return splitTotalIntoInstallments(parseFloat(firstAmount), parseInt(installmentCount, 10));
  }, [amountMode, installmentCount, firstAmount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const count = parseInt(installmentCount, 10);
    const typed = parseFloat(firstAmount);
    // En modo total, lo tipeado es el total: se divide acá y la última cuota
    // se lleva el resto del redondeo.
    const split = amountMode === 'total' ? splitTotalIntoInstallments(typed, count) : null;
    const first = split ? split.per : typed;
    const last = split ? split.last : (lastAmount ? parseFloat(lastAmount) : first);
    if (!description || !count || !first) return;
    if (count < 1 || count > 120) {
      toast({ type: 'warning', message: t('coinify.validationInstallmentCount', 'Las cuotas deben ser entre 1 y 120') });
      return;
    }
    if (typed > 999_999_999) {
      toast({ type: 'warning', message: t('coinify.validationAmountTooLarge', 'El monto es demasiado grande') });
      return;
    }

    setSubmitting(true);
    try {
      const amounts = first === last
        ? undefined
        : split
          // Total repartido: todas iguales menos la última, que absorbe el resto.
          ? installmentAmountsFromTotal(typed, count) ?? undefined
          : computeLinearAmounts(first, last, count);

      const useAccount = accountsSupported && paymentMethod !== 'credit_card';
      if (useAccount) rememberLastAccountId(accountValue === '' ? NO_ACCOUNT : accountValue);

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
        // A card plan touches no account until its statements are paid; any
        // other plan takes money out of this pocket on every instalment.
        ...(useAccount ? { accountId: accountIdForSubmit(accountValue) } : {}),
      });

      setDescription('');
      setCreditCardId('');
      setInstallmentCount('');
      setFirstAmount('');
      setLastAmount('');
      onCreated();
    } catch (err) {
      console.error('[InstallmentAddForm] financeCreateInstallmentGroup failed:', err);
      toast({ type: 'warning', message: t('coinify.createError', 'Error al crear') });
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
          {/* Los tres controles de esta fila no tenían nombre accesible: un
              lector de pantalla anunciaba «combo» y nada más. Mismos rótulos
              que en la carga rápida. */}
          <select className="rpg-select" value={currency} aria-label="ARS / USD" onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select className="rpg-select" value={paymentMethod}
            aria-label={t('coinify.paymentMethod', 'Medio de pago')}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="debit">{t('coinify.debit', 'Debito')}</option>
            <option value="credit_card">{t('coinify.creditCard', 'Tarjeta')}</option>
            <option value="transfer">{t('coinify.transfer', 'Transferencia')}</option>
            <option value="cash">{t('coinify.cash', 'Efectivo')}</option>
          </select>
          <input
            className="rpg-input"
            type="date"
            aria-label={t('coinify.startDate', 'Fecha de la primera cuota')}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {paymentMethod === 'credit_card' ? (
          <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
        ) : (
          <div className="coin-quick-add-form__row">
            <AccountSelect value={accountValue} onChange={setAccountValue} onSupported={setAccountsSupported} />
          </div>
        )}

        <div className="coin-quick-add-form__row">
          <RpgNumberInput
            value={installmentCount}
            onChange={setInstallmentCount}
            min={1}
            max={120}
            step={1}
            placeholder={t('coinify.installmentCount', 'Cuotas')}
            aria-label={t('coinify.installmentCount', 'Cuotas')}
            /* `.rpg-number` reserva 26 px de relleno a cada lado para sus
               flechas: con 90 px el rótulo entraba a los empujones y al número
               le quedaban ~20 px. */
            style={{ minWidth: 116 }}
            required
          />
          <RpgNumberInput
            value={firstAmount}
            onChange={setFirstAmount}
            min={0}
            step={1}
            placeholder={amountMode === 'total'
              ? t('coinify.totalAmountPlaceholder', 'Monto total $')
              : customLastAmount
                ? t('coinify.firstAmount', '1ra cuota $')
                : t('coinify.installmentAmount', 'Monto cuota $')}
            aria-label={t('coinify.installmentAmount', 'Monto cuota $')}
            required
          />
        </div>

        {/* Qué número estás escribiendo. Una compra en cuotas se piensa por el
            total («salió 900 mil en 12»), y antes había que dividir a mano. */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--gold-dark)', borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start' }} role="group" aria-label={t('coinify.amountModeLabel', 'Qué monto estás cargando')}>
          <button
            type="button"
            style={{ padding: '4px 12px', border: 0, cursor: 'pointer', fontFamily: 'IM Fell English SC, serif', fontSize: 'var(--fs-label)', background: amountMode === 'installment' ? 'var(--gold)' : 'transparent', color: amountMode === 'installment' ? 'var(--leather-dark)' : 'var(--ink-soft)' }}
            aria-pressed={amountMode === 'installment'}
            onClick={() => setAmountMode('installment')}
          >
            {t('coinify.amountModeInstallment', 'Monto de la cuota')}
          </button>
          <button
            type="button"
            style={{ padding: '4px 12px', border: 0, cursor: 'pointer', fontFamily: 'IM Fell English SC, serif', fontSize: 'var(--fs-label)', background: amountMode === 'total' ? 'var(--gold)' : 'transparent', color: amountMode === 'total' ? 'var(--leather-dark)' : 'var(--ink-soft)' }}
            aria-pressed={amountMode === 'total'}
            onClick={() => setAmountMode('total')}
          >
            {t('coinify.amountModeTotal', 'Monto total')}
          </button>
        </div>

        {totalSplit && (
          <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }} role="status">
            {t('coinify.totalSplitHint', '{{count}} cuotas de {{per}}', {
              count: parseInt(installmentCount, 10),
              per: formatCurrency(totalSplit.per, { currency }),
            })}
            {totalSplit.last !== totalSplit.per && (
              <> · {t('coinify.totalSplitLast', 'la última, {{last}}', {
                last: formatCurrency(totalSplit.last, { currency }),
              })}</>
            )}
          </p>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--fs-label)' }}>
          {/* Apagado el riel era `--parch-1` sobre una tarjeta de pergamino:
              se veía sólo la perilla blanca flotando, sin pista de que fuera
              un interruptor. */}
          <div style={{
            width: 32, height: 18, borderRadius: 9, position: 'relative',
            background: customLastAmount ? 'var(--gold)' : 'var(--parch-3)',
            border: '1px solid var(--gold-dark)',
            boxSizing: 'border-box',
            transition: 'background 0.2s ease',
          }}>
            <div style={{
              position: 'absolute', top: 1, left: customLastAmount ? 15 : 1,
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff',
              transition: 'left 0.2s ease',
            }} />
          </div>
          <input
            type="checkbox"
            checked={customLastAmount}
            onChange={(e) => {
              setCustomLastAmount(e.target.checked);
              if (!e.target.checked) setLastAmount('');
            }}
            style={{ display: 'none' }}
          />
          {t('coinify.customLastAmount', 'Última cuota diferente')}
        </label>

        <div style={{
          overflow: 'hidden',
          maxHeight: customLastAmount ? 60 : 0,
          opacity: customLastAmount ? 1 : 0,
          transition: 'max-height 0.3s ease, opacity 0.2s ease',
        }}>
          <RpgNumberInput
            value={lastAmount}
            onChange={setLastAmount}
            min={0}
            step={1}
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
