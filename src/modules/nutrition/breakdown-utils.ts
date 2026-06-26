/**
 * Pure helpers for the editable AI ingredient breakdown.
 *
 * Kept framework-free so the recompute logic (proportional macro rescaling +
 * total/macro aggregation) can be unit-tested in the Node environment without
 * pulling React or Firebase. Used by `Today.tsx` (estimation flow) and the
 * presentational `EstimationBreakdown` component.
 */

export interface BreakdownItem {
  name: string;
  calories: number;
  /** Macros in grams; null when the model could not estimate them (partial data). */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface BreakdownTotals {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** Round to one decimal place (macros are stored with 0.1 g precision). */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Scale a single macro by a ratio, preserving null (= unknown / partial data). */
function scaleMacro(value: number | null, ratio: number): number | null {
  if (value == null) return null;
  return round1(value * ratio);
}

/**
 * Rescale an item's macros proportionally to a new calorie figure, using the
 * item's ORIGINAL calories as the reference (rule of three). Always derive from
 * the immutable original so repeated edits never accumulate drift.
 *
 * - Calories are clamped to a non-negative integer.
 * - When the original calories are 0 (cannot form a ratio) macros are left as-is;
 *   a null macro stays null.
 */
export function rescaleItem(original: BreakdownItem, newCalories: number): BreakdownItem {
  const cal = Number.isFinite(newCalories) ? Math.max(0, Math.round(newCalories)) : 0;
  if (original.calories <= 0) {
    return { name: original.name, calories: cal, proteinG: original.proteinG, carbsG: original.carbsG, fatG: original.fatG };
  }
  const ratio = cal / original.calories;
  return {
    name: original.name,
    calories: cal,
    proteinG: scaleMacro(original.proteinG, ratio),
    carbsG: scaleMacro(original.carbsG, ratio),
    fatG: scaleMacro(original.fatG, ratio),
  };
}

/**
 * Sum the calories and macros of the given items.
 * A macro total stays null until at least one item reports that macro, so a
 * breakdown with no macro data keeps null totals (instead of a misleading 0).
 */
export function sumBreakdown(items: BreakdownItem[]): BreakdownTotals {
  let calories = 0;
  let protein: number | null = null;
  let carbs: number | null = null;
  let fat: number | null = null;
  for (const it of items) {
    calories += Number.isFinite(it.calories) ? it.calories : 0;
    if (it.proteinG != null) protein = (protein ?? 0) + it.proteinG;
    if (it.carbsG != null) carbs = (carbs ?? 0) + it.carbsG;
    if (it.fatG != null) fat = (fat ?? 0) + it.fatG;
  }
  return {
    calories: Math.round(calories),
    proteinG: protein == null ? null : round1(protein),
    carbsG: carbs == null ? null : round1(carbs),
    fatG: fat == null ? null : round1(fat),
  };
}
