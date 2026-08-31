/**
 * `finance_category_mappings` shipped with a writer, a reader and no caller, so
 * it stayed empty forever and every statement had to be re-categorised by hand.
 *
 * The only rule that matters is the matcher's:
 *
 *     merchant.toUpperCase().includes(keyword.toUpperCase())
 *
 * A keyword that fails it is worse than no mapping at all — it looks saved and
 * never matches again. These tests pin the normalisation to that rule.
 */
import { describe, it, expect } from 'vitest';
import {
  isTeachableMapping,
  normalizeMerchantKeyword,
} from '@modules/finance/utils/category-mapping';
import { CARD_PAYMENT_CATEGORY, CARD_TAX_CATEGORY } from '@modules/finance/types';

/** The matcher, verbatim, so these tests fail if the two ever disagree. */
function matches(merchant: string, keyword: string): boolean {
  return merchant.toUpperCase().includes(keyword.toUpperCase());
}

describe('normalizeMerchantKeyword', () => {
  it('upper-cases and collapses whitespace', () => {
    expect(normalizeMerchantKeyword('  Rappi   Pro  ')).toBe('RAPPI PRO');
  });

  it('drops the instalment suffix the app adds itself', () => {
    expect(normalizeMerchantKeyword('Notebook (Cuota 2/6)')).toBe('NOTEBOOK');
    expect(normalizeMerchantKeyword('Notebook (Cuota 12/12)')).toBe('NOTEBOOK');
  });

  it('leaves a merchant that merely mentions a slash alone', () => {
    expect(normalizeMerchantKeyword('IMP DE SELLOS P/INT.FIN.')).toBe('IMP DE SELLOS P/INT.FIN.');
  });

  it('produces a keyword the importer can actually match again', () => {
    const merchant = 'WWW.FRAVEGA.COM';
    expect(matches(merchant, normalizeMerchantKeyword(merchant))).toBe(true);
  });
});

describe('isTeachableMapping', () => {
  const teach = (merchant: string, category: string) =>
    isTeachableMapping(normalizeMerchantKeyword(merchant), category, merchant);

  it('accepts an ordinary correction', () => {
    expect(teach('RAPPIPRO', 'Delivery')).toBe(true);
  });

  it('refuses a keyword too short to mean anything', () => {
    expect(teach('A', 'Delivery')).toBe(false);
    expect(teach('   ', 'Delivery')).toBe(false);
  });

  it('refuses an empty category', () => {
    expect(teach('RAPPIPRO', '   ')).toBe(false);
  });

  it('refuses the categories the app assigns itself', () => {
    expect(teach('RAPPIPRO', CARD_PAYMENT_CATEGORY)).toBe(false);
    expect(teach('IMP DE SELLOS', CARD_TAX_CATEGORY)).toBe(false);
  });

  it('refuses a keyword the merchant does not contain', () => {
    // The instalment suffix is stripped, so a description that is *only* the
    // suffix leaves nothing the matcher could ever find.
    expect(isTeachableMapping('NOTEBOOK', 'Compras', 'Monitor (Cuota 1/3)')).toBe(false);
  });
});
