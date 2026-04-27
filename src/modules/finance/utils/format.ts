/**
 * Unified currency formatting for the Finance (Coinify) module.
 *
 * ARS amounts use the RPG dagger symbol (\u2020) as prefix.
 * USD amounts use the dollar sign ($) as prefix with a " USD" suffix.
 * Number formatting is locale-aware (es-AR for ARS, en-US for USD).
 */

export type FormatCurrencyOpts = {
  /** Number of decimal places (default: 0) */
  decimals?: number;
  /** Show +/- sign (default: false). When true, positive amounts get a '+' prefix */
  showSign?: boolean;
  /** Currency code — determines symbol and locale (default: 'ARS') */
  currency?: 'ARS' | 'USD';
};

/**
 * Format a currency amount with the appropriate symbol.
 *
 * - ARS: `\u2020 1.234` (dagger prefix, es-AR locale)
 * - USD: `$ 1,234 USD` (dollar prefix, en-US locale, USD suffix)
 *
 * Negative amounts are rendered as `-\u2020 1.234`.
 * With `showSign`, positive amounts get `+\u2020 1.234`.
 */
export function formatCurrency(amount: number, opts?: FormatCurrencyOpts): string {
  const { decimals = 0, showSign = false, currency = 'ARS' } = opts ?? {};

  const isUsd = currency === 'USD';
  const locale = isUsd ? 'en-US' : 'es-AR';
  const symbol = isUsd ? '$' : '\u2020';

  const formatted = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = amount < 0 ? '-' : showSign && amount > 0 ? '+' : '';
  const suffix = isUsd ? ' USD' : '';

  return `${sign}${symbol} ${formatted}${suffix}`;
}

/**
 * Returns the prefix string for AnimatedNumber components.
 * ARS: `\u2020 ` (dagger + space)
 * USD: `U$S ` (peso-dollar + space)
 */
export function currencyPrefix(currency: 'ARS' | 'USD' = 'ARS'): string {
  return currency === 'USD' ? 'U$S ' : '\u2020 ';
}
