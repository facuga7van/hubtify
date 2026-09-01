/**
 * The live equivalent of the amount being typed, in the OTHER currency, using
 * the venta rate of the preferred house.
 *
 * Why it exists: the rate a transaction carries forever (`fx_rate`) is frozen
 * the instant it is saved, from the house the user chose in the DollarChip. Up
 * to now that number was invisible until after the write — you typed «1450 USD»
 * and found out what it meant in pesos on the next screen. This shows the whole
 * sentence BEFORE saving, house included:
 *
 *     US$ 1,450 ≈ $ 2.240.250 · cripto
 *
 * It is deliberately a read-only hint, never a second input: the row stores the
 * amount in ITS currency plus the rate, and letting the user edit the converted
 * figure would invite two sources of truth for one number.
 *
 * Styling is inline on purpose — `coinify.css` is owned elsewhere right now —
 * and uses the canonical theme tokens so it inherits the parchment palette.
 */

import { useTranslation } from 'react-i18next';
import { convertRowToCurrency } from '../../utils/valuation';
import { useCurrentFxRate } from '../../utils/display-mode';
import { formatCurrency } from '../../utils/format';
import type { Currency } from '../../types';

interface AmountWithCurrencyProps {
  /** The amount as the input holds it (a raw string is fine). */
  amount: number | string;
  currency: Currency;
  /**
   * Also show the dollar equivalent of a PESO amount. Off by default: the
   * peso is the app's home currency, and a permanent «≈ US$ 3» under every
   * expense is noise. The conversion itself is symmetric either way.
   */
  showForArs?: boolean;
}

/** `1450`, `'1450'`, `'1.450,50'` → a positive finite number, or null. */
function parseAmount(value: number | string): number | null {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function AmountWithCurrency({ amount, currency, showForArs = false }: AmountWithCurrencyProps) {
  const { t } = useTranslation();
  const { rate, house } = useCurrentFxRate();

  const parsed = parseAmount(amount);
  const target: Currency = currency === 'USD' ? 'ARS' : 'USD';

  if (parsed === null) return null;
  if (currency !== 'USD' && !showForArs) return null;

  const style: React.CSSProperties = {
    fontFamily: 'var(--ff-accent)',
    fontSize: 'var(--fs-label)',
    color: 'var(--ink-faded)',
    marginTop: 2,
  };

  if (rate === null) {
    // Offline with an empty cache. Say so: the alta still goes through, the
    // row is just saved without a frozen rate until the backfill runs.
    return (
      <div style={style} aria-live="polite">
        {t('coinify.fxNoRate', 'Sin cotización disponible — se guarda sin convertir')}
      </div>
    );
  }

  // Nothing is frozen yet, so the row has no rate of its own: the current one
  // is what will be written, which is exactly what the preview must show.
  const converted = convertRowToCurrency({ amount: parsed, currency, fxRate: null }, target, rate);
  if (converted === null) return null;

  const decimals = target === 'USD' ? 2 : 0;

  return (
    <div
      style={style}
      aria-live="polite"
      title={t('coinify.fxEquivalentHint', {
        defaultValue: 'Cotización {{house}} de hoy: US$ 1 = $ {{rate}}. Se congela al guardar.',
        house,
        rate: formatCurrency(rate, { currency: 'ARS', decimals: 0 }).replace('$ ', ''),
      })}
    >
      {formatCurrency(parsed, { currency, decimals: currency === 'USD' ? 2 : 0 })}
      {' ≈ '}
      {formatCurrency(converted.value, { currency: target, decimals })}
      {' · '}
      {house}
    </div>
  );
}

export default AmountWithCurrency;
