import { useTranslation } from 'react-i18next';
import type { Currency } from '../../types';
import type { AmountMode } from '../../utils/installment-payload';
import { splitTotalIntoInstallments } from '../../utils/split-total';
import { formatCurrency } from '../../utils/format';

interface Props {
  mode: AmountMode;
  onChange: (mode: AmountMode) => void;
  /** Lo tipeado en el campo de monto, tal cual (string del input). */
  typedAmount: string;
  installmentCount: number;
  currency: Currency;
}

/**
 * «Monto» a secas era ambiguo en los tres formularios de cuotas: se
 * interpretaba como el monto DE LA CUOTA, y quien tipeaba el precio de vidriera
 * generaba un plan N veces más grande sin ningún aviso.
 *
 * El control nombra explícitamente qué número se está cargando y muestra el
 * reparto antes de guardar. El patrón ya existía en la pestaña Cuotas; acá está
 * extraído para que el libro mayor y Préstamos usen el mismo, en vez de tres
 * variantes distintas de la misma pregunta.
 */
export function AmountModeToggle({ mode, onChange, typedAmount, installmentCount, currency }: Props) {
  const { t } = useTranslation();
  const split = mode === 'total'
    ? splitTotalIntoInstallments(parseFloat(typedAmount), installmentCount)
    : null;

  return (
    <>
      <div
        className="coin-amount-mode"
        role="group"
        aria-label={t('coinify.amountModeLabel', 'Qué monto estás cargando')}
      >
        <button
          type="button"
          className={`coin-amount-mode__option ${mode === 'installment' ? 'coin-amount-mode__option--active' : ''}`}
          aria-pressed={mode === 'installment'}
          onClick={() => onChange('installment')}
        >
          {t('coinify.amountModeInstallment', 'Monto de la cuota')}
        </button>
        <button
          type="button"
          className={`coin-amount-mode__option ${mode === 'total' ? 'coin-amount-mode__option--active' : ''}`}
          aria-pressed={mode === 'total'}
          onClick={() => onChange('total')}
        >
          {t('coinify.amountModeTotal', 'Monto total')}
        </button>
      </div>

      {split && (
        <p className="coin-amount-mode__preview" role="status">
          {t('coinify.totalSplitHint', '{{count}} cuotas de {{per}}', {
            count: installmentCount,
            per: formatCurrency(split.per, { currency }),
          })}
          {split.last !== split.per && (
            <> · {t('coinify.totalSplitLast', 'la última, {{last}}', {
              last: formatCurrency(split.last, { currency }),
            })}</>
          )}
        </p>
      )}
    </>
  );
}

/** El rótulo del campo de monto, que nunca puede quedar en «Monto» a secas. */
export function useAmountModePlaceholder(mode: AmountMode, customLast = false): string {
  const { t } = useTranslation();
  if (mode === 'total') return t('coinify.totalAmountPlaceholder', 'Monto total $');
  if (customLast) return t('coinify.firstAmount', '1ra cuota $');
  return t('coinify.installmentAmount', 'Monto cuota $');
}
