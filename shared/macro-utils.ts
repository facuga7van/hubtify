// Pure helpers for macro (protein / carbs / fat) target calculation.
// No Electron/DB imports here so both the main process and tests can use it.

export type NutritionGoal = 'deficit' | 'maintenance' | 'surplus';

export interface MacroTargetGrams {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Energy density in kcal per gram for each macro. */
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

/**
 * Derive the nutritional goal from the deficit target.
 * Positive deficit → cutting, negative → bulking, zero → maintenance.
 */
export function goalFromDeficit(deficitTargetKcal: number): NutritionGoal {
  if (deficitTargetKcal > 0) return 'deficit';
  if (deficitTargetKcal < 0) return 'surplus';
  return 'maintenance';
}

/**
 * Compute automatic macro targets, prioritizing protein.
 *
 * Protein is set first (per body weight, higher when cutting to preserve muscle),
 * fat is set as a percentage of the calorie target, and carbohydrates fill the
 * remaining energy. This guarantees the macros "close" against the calorie target
 * (protein*4 + carbs*4 + fat*9 ≈ targetCalories) up to integer rounding.
 *
 * @param targetCalories Daily calorie goal (tdee - deficit).
 * @param weightKg       Latest body weight in kg (used for protein g/kg).
 * @param deficitTargetKcal Signed deficit target, used only to pick the goal profile.
 */
export function calcAutoMacroTargets(
  targetCalories: number,
  weightKg: number,
  deficitTargetKcal: number,
): MacroTargetGrams {
  const safeCalories = Number.isFinite(targetCalories) && targetCalories > 0 ? targetCalories : 0;
  const safeWeight = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 70;
  const goal = goalFromDeficit(deficitTargetKcal);

  // Protein g/kg: cutting prioritizes protein the most, bulking the least.
  const proteinPerKg = goal === 'deficit' ? 2.2 : goal === 'surplus' ? 1.8 : 2.0;
  let proteinG = Math.round(safeWeight * proteinPerKg);
  // Fat covers ~25% of the calorie target.
  let fatG = Math.round((safeCalories * 0.25) / KCAL_PER_GRAM.fat);

  // Don't let protein + fat exceed the calorie target; trim fat first, then protein.
  const proteinKcal = proteinG * KCAL_PER_GRAM.protein;
  let fatKcal = fatG * KCAL_PER_GRAM.fat;
  if (proteinKcal + fatKcal > safeCalories) {
    fatKcal = Math.max(0, safeCalories - proteinKcal);
    fatG = Math.round(fatKcal / KCAL_PER_GRAM.fat);
    if (proteinG * KCAL_PER_GRAM.protein > safeCalories) {
      proteinG = Math.round(safeCalories / KCAL_PER_GRAM.protein);
      fatG = 0;
    }
  }

  const remainingKcal = safeCalories - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat;
  const carbsG = Math.round(Math.max(0, remainingKcal) / KCAL_PER_GRAM.carbs);

  return { proteinG, carbsG, fatG };
}
