/**
 * Pure, framework- and Firebase-free core of the AI estimation flow.
 *
 * Kept separate from `estimate-service.ts` so the retry policy, error
 * classification and result normalization can be unit-tested in the Node
 * environment without pulling in the Firebase SDK (which touches localStorage
 * at import time).
 */

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

/**
 * Hard cap so a hung call never leaves the UI spinning forever.
 *
 * MUST stay above the Cloud Function's own abort (30 s in functions/src/index.ts)
 * plus network margin. With 15 s the client gave up and retried while the server
 * was still working on the previous attempt — every click could fan out into
 * three concurrent Gemini calls. Now a `deadline-exceeded` is always the SERVER
 * giving up, and the server has already stopped by the time we see it.
 */
export const TIMEOUT_MS = 35000;
/**
 * Backoff before each retry (ms). One entry → at most 2 total attempts.
 * Short on purpose: the user is waiting on a single interactive estimate.
 */
export const RETRY_DELAYS_MS = [800];

/**
 * Firebase callable error codes worth retrying.
 * `internal` is intentionally included: the Cloud Function collapses transient
 * Gemini 5xx/network failures into `internal`, so retrying recovers from those.
 * The downside is that a genuinely deterministic `internal` (e.g. an unparseable
 * model response) costs ~0.8s of a wasted retry before failing — an acceptable
 * trade for recovering the common transient case.
 *
 * `deadline-exceeded` is deliberately NOT here: it means the model took longer
 * than the server allows, and the same prompt will very likely take just as
 * long again. Retrying it only doubled the Gemini spend and the wait.
 */
const TRANSIENT_CODES = new Set([
  'unavailable',
  'internal',
  'resource-exhausted',
  'aborted',
  'cancelled',
]);

/** Extract a Firebase callable error code, stripping the `functions/` prefix. */
export function getErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const raw = String((err as { code: unknown }).code);
    return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
  }
  return null;
}

/**
 * Decide whether an error is transient (retry) or permanent (give up).
 * Network failures (offline) surface as plain errors without a code → transient.
 * Validation/auth failures (`invalid-argument`, `unauthenticated`, …) → permanent.
 */
export function isTransientError(err: unknown): boolean {
  const code = getErrorCode(err);
  if (!code) return true; // no code → network/offline → retry
  return TRANSIENT_CODES.has(code);
}

export type RetryConfig = {
  delays: number[];
  isTransient: (err: unknown) => boolean;
  onRetry?: (attempt: number) => void;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

/** Run `fn`, retrying transient failures with the given backoff delays. */
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T> {
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const maxAttempts = config.delays.length + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !config.isTransient(err)) throw err;
      config.onRetry?.(attempt + 1);
      await sleep(config.delays[attempt - 1]);
    }
  }
  throw lastErr;
}

/** Clamp an incoming macro to a finite, non-negative number or null. */
function macro(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
}

/** Validate/normalize the raw callable payload defensively. */
export function normalizeResult(data: AiResult): AiResult {
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
