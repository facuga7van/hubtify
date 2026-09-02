import { describe, it, expect, vi } from 'vitest';
import {
  isTransientError,
  getErrorCode,
  withRetry,
  normalizeResult,
  RETRY_DELAYS_MS,
  TIMEOUT_MS,
  type AiResult,
} from '@modules/nutrition/estimate-core';
// normalizeDescription now comes from `normalize.ts` — the SAME algorithm the
// SQLite estimate cache and the history autocomplete key on. The localStorage
// cache this file used to also cover (estimate-cache.ts) lost the merge to
// `nutrition_ai_cache`; its map/storage tests went with it.
import { normalizeDescription } from '@modules/nutrition/normalize';

const noSleep = () => Promise.resolve();

function fbError(code: string): Error & { code: string } {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

const sampleResult: AiResult = {
  calories: 500,
  proteinG: 30,
  carbsG: 40,
  fatG: 20,
  items: [{ name: 'milanesa', calories: 500, proteinG: 30, carbsG: 40, fatG: 20 }],
};

describe('normalizeDescription', () => {
  it('trims, lowercases and collapses inner whitespace', () => {
    expect(normalizeDescription('  Milanesa   con   Papas ')).toBe('milanesa con papas');
  });

  it('maps case/spacing variants to the same key', () => {
    expect(normalizeDescription('MILANESA con papas')).toBe(
      normalizeDescription('milanesa  con  papas'),
    );
  });

  it('collapses tabs and newlines', () => {
    expect(normalizeDescription('arroz\t\ncon\npollo')).toBe('arroz con pollo');
  });
});

describe('error classification', () => {
  it('strips the functions/ prefix from the code', () => {
    expect(getErrorCode(fbError('functions/deadline-exceeded'))).toBe('deadline-exceeded');
    expect(getErrorCode(fbError('internal'))).toBe('internal');
    expect(getErrorCode(new Error('boom'))).toBeNull();
  });

  it('retries transient codes (network/5xx)', () => {
    for (const code of ['unavailable', 'internal', 'resource-exhausted', 'aborted', 'cancelled']) {
      expect(isTransientError(fbError(code))).toBe(true);
      expect(isTransientError(fbError(`functions/${code}`))).toBe(true);
    }
  });

  it('does NOT retry a server deadline-exceeded (the model was slow; it will be slow again)', () => {
    expect(isTransientError(fbError('deadline-exceeded'))).toBe(false);
    expect(isTransientError(fbError('functions/deadline-exceeded'))).toBe(false);
  });

  it('does NOT retry permanent validation/auth codes', () => {
    for (const code of ['invalid-argument', 'unauthenticated', 'permission-denied', 'not-found']) {
      expect(isTransientError(fbError(code))).toBe(false);
    }
  });

  it('treats codeless errors (offline TypeError) as transient', () => {
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('timeout policy', () => {
  it('outlives the Cloud Function abort (30 s) so deadline-exceeded is always the server giving up', () => {
    expect(TIMEOUT_MS).toBeGreaterThanOrEqual(35000);
  });

  it('retries at most once', () => {
    expect(RETRY_DELAYS_MS).toHaveLength(1);
  });
});

describe('withRetry', () => {
  it('returns immediately on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    const out = await withRetry(fn, { delays: [1, 2], isTransient: isTransientError, onRetry, sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries transient failures then succeeds, reporting each retry attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(fbError('unavailable'))
      .mockRejectedValueOnce(fbError('internal'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    const out = await withRetry(fn, { delays: [1, 2], isTransient: isTransientError, onRetry, sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls).toEqual([[2], [3]]);
  });

  it('stops immediately on a permanent error (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(fbError('invalid-argument'));
    const onRetry = vi.fn();
    await expect(
      withRetry(fn, { delays: [1, 2], isTransient: isTransientError, onRetry, sleep: noSleep }),
    ).rejects.toHaveProperty('code', 'invalid-argument');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('calls the function exactly ONCE on deadline-exceeded (no concurrent server work)', async () => {
    const fn = vi.fn().mockRejectedValue(fbError('functions/deadline-exceeded'));
    const onRetry = vi.fn();
    await expect(
      withRetry(fn, { delays: RETRY_DELAYS_MS, isTransient: isTransientError, onRetry, sleep: noSleep }),
    ).rejects.toHaveProperty('code', 'functions/deadline-exceeded');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries unavailable/network once with the production policy (2 attempts total)', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      withRetry(fn, { delays: RETRY_DELAYS_MS, isTransient: isTransientError, sleep: noSleep }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting all attempts and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(fbError('unavailable'));
    await expect(
      withRetry(fn, { delays: [1, 2], isTransient: isTransientError, sleep: noSleep }),
    ).rejects.toHaveProperty('code', 'unavailable');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('waits the configured backoff between attempts', async () => {
    const fn = vi.fn().mockRejectedValueOnce(fbError('internal')).mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry(fn, { delays: [400, 1200], isTransient: isTransientError, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(400);
  });
});

describe('normalizeResult', () => {
  it('clamps negative / non-finite / non-number macros to null', () => {
    const out = normalizeResult({
      calories: 300,
      proteinG: -5,
      carbsG: Number.NaN as unknown as number,
      fatG: 'x' as unknown as number,
      items: [{ name: 'x', calories: 300, proteinG: 10.04, carbsG: -1, fatG: null }],
    });
    expect(out.proteinG).toBeNull();
    expect(out.carbsG).toBeNull();
    expect(out.fatG).toBeNull();
    expect(out.items[0].proteinG).toBe(10); // rounded to 1 decimal
    expect(out.items[0].carbsG).toBeNull();
  });

  it('tolerates a missing items array', () => {
    const out = normalizeResult({ calories: 100, proteinG: null, carbsG: null, fatG: null } as AiResult);
    expect(out.items).toEqual([]);
  });
});
