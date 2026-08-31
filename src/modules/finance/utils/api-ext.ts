/**
 * Thin, defensive access layer over the finance IPC surface.
 *
 * Two jobs:
 *
 * 1. **Failure envelopes.** Several finance handlers no longer throw or write
 *    garbage on bad input — they return `{ ok: false, reason }`. Callers must
 *    check, otherwise the UI happily reports success for a write that never
 *    happened. `unwrap()` turns that envelope into a discriminated result.
 *
 * 2. **Handlers not yet on the context bridge.** `finance:getExpenseBreakdown`,
 *    `finance:undoImportBatch` and `finance:getImportBatches` exist in the main
 *    process but are not (yet) declared in `electron/preload.ts` /
 *    `shared/types.ts`, which this module is not allowed to edit. These helpers
 *    call them when present and degrade to `null` when they are not, so the UI
 *    ships now and lights up the moment the bridge catches up.
 */

export interface FinanceFailure {
  ok: false;
  reason: string;
}

export type FinanceResult<T> = { ok: true; value: T } | FinanceFailure;

function isFailure(value: unknown): value is FinanceFailure {
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

// ── Handlers not yet on the context bridge ────────────────────────────────

export interface ExpenseBreakdown {
  total: number;
  direct: number;
  installments: number;
  pendingCard: number;
  cardPayments: number;
}

export type ExpenseBreakdownByCurrency = Record<'ARS' | 'USD', ExpenseBreakdown>;

export interface ImportBatch {
  id: string;
  source: string;
  filename: string | null;
  rowCount: number;
  createdAt: string;
  liveCount: number;
}

type MaybeApi = Record<string, unknown>;

function bridge(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
  const api = (window as unknown as { api?: MaybeApi }).api;
  const fn = api?.[name];
  return typeof fn === 'function' ? (fn as (...args: unknown[]) => Promise<unknown>) : null;
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getExpenseBreakdown(
  month?: string,
): Promise<ExpenseBreakdownByCurrency | null> {
  const fn = bridge('financeGetExpenseBreakdown');
  if (!fn) return null;
  try {
    return (await fn(month)) as ExpenseBreakdownByCurrency;
  } catch (err) {
    console.error('[finance] getExpenseBreakdown failed:', err);
    return null;
  }
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getExpenseBreakdownForRange(
  startMonth: string,
  endMonth: string,
): Promise<ExpenseBreakdownByCurrency | null> {
  const fn = bridge('financeGetExpenseBreakdownForRange');
  if (!fn) return null;
  try {
    return (await fn(startMonth, endMonth)) as ExpenseBreakdownByCurrency;
  } catch (err) {
    console.error('[finance] getExpenseBreakdownForRange failed:', err);
    return null;
  }
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getImportBatches(): Promise<ImportBatch[] | null> {
  const fn = bridge('financeGetImportBatches');
  if (!fn) return null;
  try {
    return (await fn()) as ImportBatch[];
  } catch (err) {
    console.error('[finance] getImportBatches failed:', err);
    return null;
  }
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function undoImportBatch(
  batchId: string,
): Promise<{ ok: true; deleted: number } | FinanceFailure | null> {
  const fn = bridge('financeUndoImportBatch');
  if (!fn) return null;
  try {
    const res = await fn(batchId);
    if (isFailure(res)) return res;
    return res as { ok: true; deleted: number };
  } catch (err) {
    console.error('[finance] undoImportBatch failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

/** True once the import-batch handlers are reachable. */
export function hasImportBatchSupport(): boolean {
  return bridge('financeGetImportBatches') !== null && bridge('financeUndoImportBatch') !== null;
}

/**
 * `finance:payStatement` takes an optional third `paidAmountUsd`, but the
 * declaration in `shared/types.ts` still stops at two arguments. Forwarding it
 * here keeps the extra argument out of the type error while the bridge catches
 * up — a `undefined` third argument is harmless on the older handler.
 */
export function payStatement(
  id: string,
  paidAmount: number,
  paidAmountUsd?: number,
): Promise<unknown> {
  const fn = window.api.financePayStatement as unknown as (
    id: string,
    paidAmount: number,
    paidAmountUsd?: number,
  ) => Promise<unknown>;
  return fn(id, paidAmount, paidAmountUsd);
}
