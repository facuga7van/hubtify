import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../../shared/components/useToast';
import type { Currency, PaymentMethod } from '../../types';
import { CategorySelect } from './CategorySelect';
import { CreditCardSelect } from './CreditCardSelect';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './AccountSelect';
import { AmountModeToggle, useAmountModePlaceholder } from './AmountModeToggle';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { splitTotalIntoInstallments, installmentAmountsFromTotal } from '../../utils/split-total';
import type { AmountMode } from '../../utils/installment-payload';
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
  /** Semilla hasta que conteste `finance:getEntryDefaults` con la moda real. */
  const [category, setCategory] = useState('Otros');
  const [currency, setCurrency] = useState<Currency>('ARS');
  /**
   * Arrancaba en `'debit'` — constante, y el único medio con el que NO se puede
   * comprar en cuotas. En la base real hay 4 planes cargados a mano: **3 con
   * tarjeta, 1 por transferencia, cero en débito**. Ahora lo dice el historial
   * de PLANES (`installmentPaymentMethod`), que es otra pregunta que la moda del
   * gasto suelto: esa da `transfer`, y sobre planes es la minoritaria.
   */
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  /** El usuario ya tocó el select: la inferencia no le pisa la elección. */
  const methodTouched = useRef(false);
  const userOverrodeCategory = useRef(false);
  const [creditCardId, setCreditCardId] = useState('');
  // Pocket every instalment leaves (non-card plans). '' = unresolved default;
  // hidden and unsent while there are no live accounts.
  const [accountValue, setAccountValue] = useState('');
  const [seedAccountId, setSeedAccountId] = useState<string | null>(null);
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
  const [amountMode, setAmountMode] = useState<AmountMode>('installment');
  const [submitting, setSubmitting] = useState(false);

  const amountPlaceholder = useAmountModePlaceholder(amountMode, customLastAmount);

  /**
   * Los defaults del alta, inferidos del historial. Este formulario ni siquiera
   * llamaba al canal, que ya existía y ya lo usaba la carga rápida.
   */
  const loadEntryDefaults = useCallback(() => {
    // Canal nuevo: en un binding viejo simplemente no está, y el fallback vale.
    const api = window.api as Partial<typeof window.api>;
    if (typeof api.financeGetEntryDefaults !== 'function') return;
    api.financeGetEntryDefaults()
      .then((defaults) => {
        if (!defaults) return;
        if (!methodTouched.current) {
          const method = defaults.installmentPaymentMethod;
          if (method === 'cash' || method === 'debit' || method === 'transfer' || method === 'credit_card') {
            setPaymentMethod(method);
          }
          if (defaults.currency === 'ARS' || defaults.currency === 'USD') setCurrency(defaults.currency);
        }
        setSeedAccountId(defaults.accountId ?? null);
        if (!userOverrodeCategory.current && defaults.category) setCategory(defaults.category);
      })
      .catch(() => { /* el fallback ya está puesto */ });
  }, []);

  useEffect(() => { loadEntryDefaults(); }, [loadEntryDefaults]);

  useEffect(() => {
    // Otra cuenta, otro historial: lo que el usuario tocó acá ya no aplica.
    const handler = () => {
      methodTouched.current = false;
      userOverrodeCategory.current = false;
      loadEntryDefaults();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadEntryDefaults]);

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
          <CategorySelect value={category} onChange={(c) => { userOverrodeCategory.current = true; setCategory(c); }} />
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
            onChange={(e) => { methodTouched.current = true; setPaymentMethod(e.target.value as PaymentMethod); }}>
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
            <AccountSelect value={accountValue} onChange={setAccountValue} onSupported={setAccountsSupported} seedAccountId={seedAccountId} />
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
            placeholder={amountPlaceholder}
            aria-label={amountPlaceholder}
            required
          />
        </div>

        {/* Qué número estás escribiendo. Una compra en cuotas se piensa por el
            total («salió 900 mil en 12»), y antes había que dividir a mano. */}
        <AmountModeToggle
          mode={amountMode}
          onChange={setAmountMode}
          typedAmount={firstAmount}
          installmentCount={parseInt(installmentCount, 10)}
          currency={currency}
        />

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
