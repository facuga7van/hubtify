/**
 * Unified currency formatting for the Finance (Coinify) module.
 *
 * One notation per currency, everywhere:
 *   ARS -> `$ 1.234`    (es-AR grouping)
 *   USD -> `US$ 1,234`  (en-US grouping)
 *
 * `currency` is REQUIRED on purpose: several call sites used to omit it and
 * silently rendered USD amounts with the ARS symbol (and summed them together).
 * Making it mandatory turns that class of bug into a compile error.
 */

export type FormatCurrencyOpts = {
  /** Currency code — determines symbol and locale. Required. */
  currency: 'ARS' | 'USD';
  /** Number of decimal places (default: 0) */
  decimals?: number;
  /** Show +/- sign (default: false). When true, positive amounts get a '+' prefix */
  showSign?: boolean;
};

/** The symbol shown before the amount, per currency. */
export function currencySymbol(currency: 'ARS' | 'USD'): string {
  return currency === 'USD' ? 'US$' : '$';
}

/**
 * Format a currency amount with the appropriate symbol.
 *
 * Negative amounts are rendered as `-$ 1.234`.
 * With `showSign`, positive amounts get `+$ 1.234`.
 */
export function formatCurrency(amount: number, opts: FormatCurrencyOpts): string {
  const { decimals = 0, showSign = false, currency } = opts;

  const isUsd = currency === 'USD';
  const locale = isUsd ? 'en-US' : 'es-AR';
  const value = Number.isFinite(amount) ? amount : 0;

  const formatted = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = value < 0 ? '-' : showSign && value > 0 ? '+' : '';

  return `${sign}${currencySymbol(currency)} ${formatted}`;
}

/**
 * Compact form for tight spots (donut centre, chart labels) where the full
 * grouped number would overflow its container.
 *  1.234       -> `$ 1.234`
 *  1.234.567   -> `$ 1,23 M`
 */
export function formatCurrencyCompact(amount: number, currency: 'ARS' | 'USD'): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(value);
  const locale = currency === 'USD' ? 'en-US' : 'es-AR';
  const sign = value < 0 ? '-' : '';
  const sym = currencySymbol(currency);

  if (abs >= 1_000_000) {
    return `${sign}${sym} ${(abs / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })} M`;
  }
  if (abs >= 100_000) {
    return `${sign}${sym} ${(abs / 1_000).toLocaleString(locale, { maximumFractionDigits: 0 })} K`;
  }
  return formatCurrency(value, { currency });
}

/**
 * Returns the prefix string for AnimatedNumber components.
 * Same notation as {@link formatCurrency}: `$ ` / `US$ `.
 */
export function currencyPrefix(currency: 'ARS' | 'USD' = 'ARS'): string {
  return `${currencySymbol(currency)} `;
}
