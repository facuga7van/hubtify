import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';
import { readEstimateCache, writeEstimateCache, normalizeDescription } from './estimate-cache';
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
  /** Bypass the local cache and force a fresh network estimate. */
  forceFresh?: boolean;
};

export async function estimateNutrition(
  description: string,
  options: EstimateOptions = {},
): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }

  // Serve from cache before touching the network (normalized key).
  if (!options.forceFresh) {
    const cached = readEstimateCache(description);
    if (cached) return cached;
  }

  // Firebase callable honours its own `timeout` option (an external AbortController
  // is not wired into httpsCallable) — a timeout surfaces as `deadline-exceeded`,
  // which the retry policy treats as transient.
  const fn = httpsCallable<{ description: string }, AiResult>(
    getActiveFunctions(),
    'estimateNutrition',
    { timeout: TIMEOUT_MS },
  );

  const result = await withRetry(
    async () => normalizeResult((await fn({ description })).data),
    { delays: RETRY_DELAYS_MS, isTransient: isTransientError, onRetry: options.onRetry },
  );

  writeEstimateCache(description, result);
  return result;
}
