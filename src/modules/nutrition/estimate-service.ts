import { httpsCallable } from 'firebase/functions';
import { functions } from '../../shared/firebase';

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimateNutritionFn = httpsCallable<{ description: string }, AiResult>(functions, 'estimateNutrition');

export async function estimateNutrition(description: string): Promise<AiResult> {
  const result = await estimateNutritionFn({ description });
  return result.data;
}
