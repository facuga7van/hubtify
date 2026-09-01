import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';

type AiResult = {
  calories: number;
  /**
   * Proteína total en gramos. Opcional: la Cloud Function desplegada antes de
   * la fase 3 no la devuelve, y el cliente tiene que degradar a "sin dato" en
   * vez de romperse durante la ventana de deploy.
   */
  proteinG?: number | null;
  items: Array<{ name: string; calories: number; proteinG?: number | null }>;
};

export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const fn = httpsCallable<{ description: string }, AiResult>(getActiveFunctions(), 'estimateNutrition');
  const result = await fn({ description });
  return result.data;
}
