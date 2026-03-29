import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const fn = httpsCallable<{ description: string }, AiResult>(getActiveFunctions(), 'estimateNutrition');
  const result = await fn({ description });
  return result.data;
}
