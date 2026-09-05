/**
 * Failure envelopes over the finance IPC surface.
 *
 * Several finance handlers no longer throw or write garbage on bad input — they
 * return `{ ok: false, reason }`. Callers must check, otherwise the UI happily
 * reports success for a write that never happened. `unwrap()` turns that
 * envelope into a discriminated result.
 */

export interface FinanceFailure {
  ok: false;
  reason: string;
}

export type FinanceResult<T> = { ok: true; value: T } | FinanceFailure;

export function isFailure(value: unknown): value is FinanceFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/**
 * Await an IPC call and normalise it into `{ ok: true, value }` or the handler's
 * own `{ ok: false, reason }`. Thrown errors become `reason: 'ipc_error'`.
 */
export async function unwrap<T>(call: Promise<T>): Promise<FinanceResult<T>> {
  try {
    const value = await call;
    if (isFailure(value)) return value;
    return { ok: true, value };
  } catch (err) {
    console.error('[finance] IPC call failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

/**
 * Human-readable message for a failure reason. Falls back to a generic message
 * so an unforeseen reason still reaches the user instead of failing silently.
 */
export function failureMessage(
  reason: string,
  t: (key: string, fallback: string) => string,
): string {
  const key = `coinify.reason_${reason}`;
  const generic = t('coinify.saveError', 'Error al guardar');
  // i18next echoes the key back when it is missing; never show that to a user.
  const translated = t(key, generic);
  return translated === key ? generic : translated;
}
