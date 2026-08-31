/**
 * Teaching the importer which category a merchant belongs to.
 *
 * `finance_category_mappings` has existed since the very first import, together
 * with a handler that writes it and a matcher that reads it — but nothing ever
 * called the writer, so the table stayed empty and every statement had to be
 * re-categorised by hand, forever.
 *
 * The matcher (both `suggestCategory` in `finance-import.ipc.ts` and the live
 * suggestion in `QuickAddForm`) asks a single question:
 *
 *     merchant.toUpperCase().includes(keyword.toUpperCase())
 *
 * so a stored keyword only ever matches if it is a substring of the merchant as
 * the PDF spells it. Everything below exists to keep what we store on the right
 * side of that rule.
 */

import { RESERVED_CATEGORIES } from '../types';

/**
 * The keyword to store for a merchant.
 *
 * Upper-cased and whitespace-collapsed so the same shop written
 * `"Rappi   Pro"` on one statement and `"RAPPI PRO"` on the next produces one
 * mapping instead of two. Instalment suffixes the app adds itself
 * (`" (Cuota 2/6)"`) are dropped — they are not part of the merchant, and
 * leaving them in would produce a keyword that matches exactly one row, ever.
 */
export function normalizeMerchantKeyword(description: string): string {
  return description
    .replace(/\s*\(Cuota\s+\d+\/\d+\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Whether a corrected category is worth remembering.
 *
 * Refuses:
 *  - an empty or one-character keyword, which would match half the statement;
 *  - a reserved category, which the app assigns itself;
 *  - a keyword that is not a substring of the merchant, because the matcher
 *    would never find it again.
 */
export function isTeachableMapping(keyword: string, category: string, merchant: string): boolean {
  if (keyword.length < 2) return false;
  if (!category.trim()) return false;
  if (RESERVED_CATEGORIES.includes(category)) return false;
  return merchant.toUpperCase().includes(keyword);
}

/**
 * Remembers "this merchant means this category" for the next import.
 *
 * Never rejects: a mapping that fails to save must not take a category change
 * down with it, so the failure is logged and swallowed.
 */
export async function rememberCategoryForMerchant(
  merchant: string,
  category: string,
): Promise<boolean> {
  const keyword = normalizeMerchantKeyword(merchant);
  if (!isTeachableMapping(keyword, category, merchant)) return false;
  try {
    await window.api.financeUpdateCategoryMapping(keyword, category);
    return true;
  } catch (err) {
    console.error('[finance] financeUpdateCategoryMapping failed:', err);
    return false;
  }
}
