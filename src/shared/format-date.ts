/**
 * Date formatting that follows the APP language, not the device locale.
 *
 * `toLocaleString()` with no locale takes whatever the OS is set to — on a phone
 * set to en-US the Spanish UI showed "9/2/2026, 8:00:00 PM" next to Spanish
 * labels, seconds included. Every user-facing date goes through here with
 * `i18n.language`.
 */

/** App language (`es` / `en`) → BCP 47 tag with the regional conventions we want. */
export function toIntlLocale(language: string | undefined): string {
  const lang = (language ?? 'es').toLowerCase();
  if (lang === 'es' || lang.startsWith('es-')) return 'es-AR';
  if (lang === 'en' || lang.startsWith('en-')) return 'en-US';
  return language ?? 'es-AR';
}

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "2 sept 2026, 20:00" / "Sep 2, 2026, 8:00 PM" — no seconds. */
export function formatDateTime(value: DateInput, language: string | undefined): string {
  const locale = toIntlLocale(language);
  return toDate(value).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    // ICU renders es-AR as "8:00 p. m."; the 24-hour clock is what reads natural there.
    ...(locale === 'es-AR' ? { hourCycle: 'h23' as const } : {}),
  });
}

/** "2 sept 2026" / "Sep 2, 2026". */
export function formatDate(value: DateInput, language: string | undefined): string {
  return toDate(value).toLocaleDateString(toIntlLocale(language), { dateStyle: 'medium' });
}

/**
 * "septiembre de 2026" / "September 2026" from a `YYYY-MM` key (the finance
 * month selector). Built with a local-time Date so the month never shifts.
 */
export function formatMonthYear(month: string, language: string | undefined): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(toIntlLocale(language), {
    month: 'long',
    year: 'numeric',
  });
}
