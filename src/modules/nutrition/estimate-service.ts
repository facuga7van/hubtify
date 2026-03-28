import { httpsCallable } from 'firebase/functions';
import { functions, auth } from '../../shared/firebase';

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimateNutritionFn = httpsCallable<{ description: string }, AiResult>(functions, 'estimateNutrition');

export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!auth.currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const result = await estimateNutritionFn({ description });
  return result.data;
}
