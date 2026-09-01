import { describe, it, expect } from 'vitest';
import { rescaleItem, sumBreakdown, scalePortion } from '@modules/nutrition/breakdown-utils';
import type { BreakdownItem } from '@modules/nutrition/breakdown-utils';

const item = (over: Partial<BreakdownItem> = {}): BreakdownItem => ({
  name: 'Milanesa',
  calories: 400,
  proteinG: 30,
  carbsG: 20,
  fatG: 18,
  ...over,
});

describe('rescaleItem — proportional macro rescaling (rule of three)', () => {
  it('rescales macros proportionally when calories are lowered', () => {
    // Half the calories → half the macros (relative to the ORIGINAL item).
    const r = rescaleItem(item(), 200);
    expect(r.calories).toBe(200);
    expect(r.proteinG).toBe(15);
    expect(r.carbsG).toBe(10);
    expect(r.fatG).toBe(9);
  });

  it('rescales macros up when calories are raised', () => {
    const r = rescaleItem(item(), 600); // 1.5x
    expect(r.calories).toBe(600);
    expect(r.proteinG).toBe(45);
    expect(r.carbsG).toBe(30);
    expect(r.fatG).toBe(27);
  });

  it('always derives from the ORIGINAL so repeated edits never drift', () => {
    const original = item();
    const half = rescaleItem(original, 200);
    // Edit again from the original back to the original calories → original macros.
    const back = rescaleItem(original, 400);
    expect(half.proteinG).toBe(15);
    expect(back.proteinG).toBe(30);
    expect(back.carbsG).toBe(20);
    expect(back.fatG).toBe(18);
  });

  it('keeps null macros null (partial data is not invented)', () => {
    const r = rescaleItem(item({ proteinG: null, fatG: null }), 200);
    expect(r.proteinG).toBeNull();
    expect(r.fatG).toBeNull();
    expect(r.carbsG).toBe(10);
  });

  it('clamps invalid / negative calories to 0', () => {
    expect(rescaleItem(item(), -50).calories).toBe(0);
    expect(rescaleItem(item(), NaN).calories).toBe(0);
  });

  it('rounds calories to an integer', () => {
    expect(rescaleItem(item(), 199.6).calories).toBe(200);
  });

  it('does not divide by zero when the original item has 0 calories', () => {
    const r = rescaleItem(item({ calories: 0, proteinG: 5, carbsG: null, fatG: 2 }), 120);
    expect(r.calories).toBe(120);
    // No ratio possible → macros are left as-is rather than producing Infinity/NaN.
    expect(r.proteinG).toBe(5);
    expect(r.carbsG).toBeNull();
    expect(r.fatG).toBe(2);
  });
});

describe('sumBreakdown — total + macro aggregation', () => {
  it('sums calories and macros across items', () => {
    const totals = sumBreakdown([
      item({ calories: 200, proteinG: 15, carbsG: 10, fatG: 9 }),
      item({ name: 'Papas', calories: 300, proteinG: 5, carbsG: 60, fatG: 12 }),
    ]);
    expect(totals.calories).toBe(500);
    expect(totals.proteinG).toBe(20);
    expect(totals.carbsG).toBe(70);
    expect(totals.fatG).toBe(21);
  });

  it('treats a missing macro as 0 without breaking the total', () => {
    const totals = sumBreakdown([
      item({ calories: 200, proteinG: 15, carbsG: null, fatG: null }),
      item({ name: 'Papas', calories: 300, proteinG: null, carbsG: 60, fatG: 12 }),
    ]);
    expect(totals.calories).toBe(500);
    expect(totals.proteinG).toBe(15); // only the first item reported protein
    expect(totals.carbsG).toBe(60);   // only the second reported carbs
    expect(totals.fatG).toBe(12);
  });

  it('keeps a macro total NULL when no item reports it', () => {
    const totals = sumBreakdown([
      item({ calories: 200, proteinG: null, carbsG: null, fatG: null }),
      item({ name: 'Papas', calories: 300, proteinG: null, carbsG: null, fatG: null }),
    ]);
    expect(totals.calories).toBe(500);
    expect(totals.proteinG).toBeNull();
    expect(totals.carbsG).toBeNull();
    expect(totals.fatG).toBeNull();
  });

  it('removing an item subtracts its calories and macros from the total', () => {
    const all = [
      item({ calories: 200, proteinG: 15, carbsG: 10, fatG: 9 }),
      item({ name: 'Papas', calories: 300, proteinG: 5, carbsG: 60, fatG: 12 }),
    ];
    const afterRemoval = sumBreakdown(all.filter((_, i) => i !== 1));
    expect(afterRemoval.calories).toBe(200);
    expect(afterRemoval.proteinG).toBe(15);
    expect(afterRemoval.carbsG).toBe(10);
    expect(afterRemoval.fatG).toBe(9);
  });

  it('returns zeroed/null totals for an empty list', () => {
    const totals = sumBreakdown([]);
    expect(totals.calories).toBe(0);
    expect(totals.proteinG).toBeNull();
    expect(totals.carbsG).toBeNull();
    expect(totals.fatG).toBeNull();
  });

  it('edit + remove flow stays consistent end to end', () => {
    const originals: BreakdownItem[] = [
      item({ name: 'Milanesa', calories: 400, proteinG: 30, carbsG: 20, fatG: 18 }),
      item({ name: 'Papas', calories: 300, proteinG: 5, carbsG: 60, fatG: 12 }),
      item({ name: 'Ensalada', calories: 100, proteinG: 2, carbsG: 8, fatG: 7 }),
    ];
    // User halves the milanesa and removes the papas.
    const live = [rescaleItem(originals[0], 200), originals[2]];
    const totals = sumBreakdown(live);
    expect(totals.calories).toBe(300); // 200 + 100
    expect(totals.proteinG).toBe(17);  // 15 + 2
    expect(totals.carbsG).toBe(18);    // 10 + 8
    expect(totals.fatG).toBe(16);      // 9 + 7
  });
});

describe('scalePortion — portion multiplier for quick-log', () => {
  const food = { calories: 400, proteinG: 30, carbsG: 20, fatG: 18 };

  it('is an identity at factor 1 (one tap stays one tap)', () => {
    const r = scalePortion(food, 1);
    expect(r).toEqual({ calories: 400, proteinG: 30, carbsG: 20, fatG: 18 });
  });

  it('doubles calories and macros at factor 2', () => {
    const r = scalePortion(food, 2);
    expect(r.calories).toBe(800);
    expect(r.proteinG).toBe(60);
    expect(r.carbsG).toBe(40);
    expect(r.fatG).toBe(36);
  });

  it('halves calories and macros at factor 0.5', () => {
    const r = scalePortion(food, 0.5);
    expect(r.calories).toBe(200);
    expect(r.proteinG).toBe(15);
    expect(r.carbsG).toBe(10);
    expect(r.fatG).toBe(9);
  });

  it('keeps a null macro null while still scaling the others', () => {
    const r = scalePortion({ calories: 200, proteinG: null, carbsG: 20, fatG: null }, 1.5);
    expect(r.calories).toBe(300);
    expect(r.proteinG).toBeNull();
    expect(r.carbsG).toBe(30);
    expect(r.fatG).toBeNull();
  });

  it('rounds calories to an integer and macros to one decimal', () => {
    const r = scalePortion({ calories: 333, proteinG: 10, carbsG: 5, fatG: 3 }, 1.5);
    expect(r.calories).toBe(500); // 333 * 1.5 = 499.5 → 500
    expect(r.proteinG).toBe(15);
    expect(r.fatG).toBe(4.5);
  });

  it('falls back to factor 1 for invalid factors (0, negative, NaN)', () => {
    expect(scalePortion(food, 0)).toEqual(food);
    expect(scalePortion(food, -2)).toEqual(food);
    expect(scalePortion(food, NaN)).toEqual(food);
  });
});
