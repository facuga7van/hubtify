import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';
import { normalizeDescription } from './normalize';
import {
  type AiResult,
  type AiEstimationItem,
  TIMEOUT_MS,
  RETRY_DELAYS_MS,
  isTransientError,
  withRetry,
  normalizeResult,
} from './estimate-core';

export { normalizeDescription, isTransientError, withRetry, normalizeResult };
export type { AiResult, AiEstimationItem };

export type EstimateOptions = {
  /** Called before each retry with the upcoming attempt number (2-based). */
  onRetry?: (attempt: number) => void;
};

/**
 * One network estimate: timeout, retry on transient failures, normalized result.
 *
 * NO CACHE LIVES HERE. There were two competing caches across the two branches
 * (a localStorage map in estimate-cache.ts, and the SQLite `nutrition_ai_cache`
 * behind `nutrition:getCachedEstimate`); the SQLite one won — it is per-account,
 * keyed by the SAME `description_norm` the history autocomplete uses, counts
 * hits, and stores the number the user CONFIRMED rather than the model's guess.
 * It is applied one layer up, in `resolveEstimate` (estimate-with-cache.ts), so
 * this function is always a real call and `forceFresh` has nothing to bypass.
 */
export async function estimateNutrition(
  description: string,
  options: EstimateOptions = {},
): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }

  // Firebase callable honours its own `timeout` option (an external AbortController
  // is not wired into httpsCallable) — a timeout surfaces as `deadline-exceeded`,
  // which is NOT retried: TIMEOUT_MS outlives the server abort, so by then the
  // server already gave up and a retry would just run the slow prompt again.
  const fn = httpsCallable<{ description: string }, AiResult>(
    getActiveFunctions(),
    'estimateNutrition',
    { timeout: TIMEOUT_MS },
  );

  return withRetry(
    async () => normalizeResult((await fn({ description })).data),
    { delays: RETRY_DELAYS_MS, isTransient: isTransientError, onRetry: options.onRetry },
  );
}
