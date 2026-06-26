import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';

export type AiEstimationItem = {
  name: string;
  calories: number;
  /** Macros in grams for this item; null when the model could not estimate it. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

export type AiResult = {
  calories: number;
  /** Day/item-level macro totals in grams; null when no item reported the macro. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  items: AiEstimationItem[];
};

/** Clamp an incoming macro to a finite, non-negative number or null. */
function macro(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
}

export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const fn = httpsCallable<{ description: string }, AiResult>(getActiveFunctions(), 'estimateNutrition');
  const result = await fn({ description });
  const data = result.data;
  // Validate/normalize macros defensively — older function deployments omit them.
  return {
    calories: data.calories,
    proteinG: macro(data.proteinG),
    carbsG: macro(data.carbsG),
    fatG: macro(data.fatG),
    items: (data.items ?? []).map(it => ({
      name: it.name,
      calories: it.calories,
      proteinG: macro(it.proteinG),
      carbsG: macro(it.carbsG),
      fatG: macro(it.fatG),
    })),
  };
}
