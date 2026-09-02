/**
 * Dates must follow the app language, not the device locale (QA 0.9.0,
 * I18N-01: "Vence: 9/2/2026, 8:00:00 PM" under Spanish labels).
 */
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatMonthYear, toIntlLocale } from '../../src/shared/format-date';

// Local time on purpose: the components build dates the same way.
const due = new Date(2026, 8, 2, 20, 0, 0);

describe('toIntlLocale', () => {
  it('maps the app languages to their regional tags', () => {
    expect(toIntlLocale('es')).toBe('es-AR');
    expect(toIntlLocale('en')).toBe('en-US');
    expect(toIntlLocale('en-GB')).toBe('en-US');
  });

  it('defaults to Spanish when the language is unknown', () => {
    expect(toIntlLocale(undefined)).toBe('es-AR');
  });
});

describe('formatDateTime', () => {
  it('formats in Spanish without seconds', () => {
    const out = formatDateTime(due, 'es');
    expect(out).toMatch(/sept?\.?/i);
    expect(out).toContain('2026');
    expect(out).toContain('20:00');
    expect(out).not.toContain('20:00:00');
  });

  it('formats in English without seconds', () => {
    const out = formatDateTime(due, 'en');
    expect(out).toContain('Sep 2, 2026');
    expect(out).toMatch(/8:00\s?PM/);
    expect(out).not.toContain('8:00:00');
  });

  it('accepts ISO strings too', () => {
    expect(formatDateTime(due.toISOString(), 'en')).toBe(formatDateTime(due, 'en'));
  });
});

describe('formatDate', () => {
  it('follows the language, not the device', () => {
    expect(formatDate(due, 'en')).toBe('Sep 2, 2026');
    const es = formatDate(due, 'es');
    expect(es).toContain('2026');
    expect(es).not.toBe('Sep 2, 2026');
  });
});

describe('formatMonthYear', () => {
  it('renders the month name in the app language', () => {
    expect(formatMonthYear('2026-09', 'en')).toBe('September 2026');
    expect(formatMonthYear('2026-09', 'es')).toBe('septiembre de 2026');
  });

  it('does not drift a month on the first day', () => {
    expect(formatMonthYear('2026-01', 'en')).toBe('January 2026');
    expect(formatMonthYear('2026-12', 'en')).toBe('December 2026');
  });
});
