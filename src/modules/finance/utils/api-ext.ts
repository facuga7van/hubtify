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

import type { FinanceAccount } from '../types';

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

export function payStatement(
  id: string,
  paidAmount: number,
  paidAmountUsd?: number,
  accountId?: string | null,
  paidDate?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return window.api.financePayStatement(id, paidAmount, paidAmountUsd, accountId, paidDate);
}

/**
 * `finance:importConfirm` takes an optional fifth `accountId` for card-less
 * imports (which pocket the rows leave). Same bridge caveat as `payStatement`.
 */
export function importConfirm(
  rows: unknown[],
  statementMonth: string,
  fileName: string,
  creditCardId: string | null,
  accountId?: string | null,
): ReturnType<typeof window.api.financeImportConfirm> {
  const fn = window.api.financeImportConfirm as unknown as (
    rows: unknown[],
    statementMonth: string,
    fileName: string,
    creditCardId?: string | null,
    accountId?: string | null,
  ) => ReturnType<typeof window.api.financeImportConfirm>;
  return fn(rows, statementMonth, fileName, creditCardId, accountId);
}

// ── Budgets ────────────────────────────────────────────────────────────────
//
// `finance:setBudget` / `finance:getBudgets` / `finance:getBudgetStatus` exist in
// the main process but are not on the context bridge yet (this module may not
// edit `electron/preload.ts` or `shared/types.ts`). Same degrade-to-null contract
// as the helpers above: the budget UI simply does not appear until the bridge
// catches up, instead of throwing on every dashboard mount.

export interface Budget {
  category: string;
  monthlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategoryStatus {
  category: string;
  limit: number;
  spent: number;
  /** Unclamped: over 100 means the limit was blown. */
  pct: number;
}

export interface BudgetStatus {
  month: string;
  categories: BudgetCategoryStatus[];
  totalLimit: number;
  totalSpent: number;
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getBudgets(): Promise<Budget[] | null> {
  const fn = bridge('financeGetBudgets');
  if (!fn) return null;
  try {
    return (await fn()) as Budget[];
  } catch (err) {
    console.error('[finance] getBudgets failed:', err);
    return null;
  }
}

/** `limit === null` clears the budget. `null` when the bridge is not there yet. */
export async function setBudget(
  category: string,
  limit: number | null,
): Promise<{ ok: true } | FinanceFailure | null> {
  const fn = bridge('financeSetBudget');
  if (!fn) return null;
  try {
    const res = await fn(category, limit);
    if (isFailure(res)) return res;
    return { ok: true };
  } catch (err) {
    console.error('[finance] setBudget failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getBudgetStatus(month?: string): Promise<BudgetStatus | null> {
  const fn = bridge('financeGetBudgetStatus');
  if (!fn) return null;
  try {
    return (await fn(month)) as BudgetStatus;
  } catch (err) {
    console.error('[finance] getBudgetStatus failed:', err);
    return null;
  }
}

/** True once the budget handlers are reachable. */
export function hasBudgetSupport(): boolean {
  return bridge('financeGetBudgetStatus') !== null && bridge('financeSetBudget') !== null;
}

// ── Accounts (cuentas y billeteras) ────────────────────────────────────────
//
// `finance:getAccounts` / `finance:getAccountsOverview` / `finance:saveAccount`
// / `finance:deleteAccount` / `finance:transferBetweenAccounts` exist in the
// main process but are not on the context bridge yet (this module may not edit
// `electron/preload.ts` or `shared/types.ts`). Same degrade-to-null contract as
// everything above: the chest keeps showing the plain monthly number, the
// account selector and the manager simply do not appear, and everything lights
// up the moment the bridge catches up.

export interface AccountsOverview {
  accounts: FinanceAccount[];
  totalArs: number;
  totalUsd: number;
}

/** True once the account read/write handlers are reachable. */
export function hasAccountsSupport(): boolean {
  return bridge('financeGetAccounts') !== null && bridge('financeSaveAccount') !== null;
}

/** True once transfers can be registered. */
export function hasTransferSupport(): boolean {
  return bridge('financeTransferBetweenAccounts') !== null;
}

/** Live accounts with computed balance. `null` when the bridge is not there yet. */
export async function getAccounts(): Promise<FinanceAccount[] | null> {
  const fn = bridge('financeGetAccounts');
  if (!fn) return null;
  try {
    return (await fn()) as FinanceAccount[];
  } catch (err) {
    console.error('[finance] getAccounts failed:', err);
    return null;
  }
}

/** The opened chest: rows + totals per currency. `null` when the bridge is missing. */
export async function getAccountsOverview(): Promise<AccountsOverview | null> {
  const fn = bridge('financeGetAccountsOverview');
  if (!fn) return null;
  try {
    return (await fn()) as AccountsOverview;
  } catch (err) {
    console.error('[finance] getAccountsOverview failed:', err);
    return null;
  }
}

/** Upsert an account. `null` when the bridge is not there yet. */
export async function saveAccount(account: {
  id?: string;
  name: string;
  kind: 'cash' | 'bank' | 'wallet';
  currency?: 'ARS' | 'USD';
  initialBalance?: number;
  order?: number;
}): Promise<{ ok: true; id: string } | FinanceFailure | null> {
  const fn = bridge('financeSaveAccount');
  if (!fn) return null;
  try {
    const res = await fn(account);
    if (isFailure(res)) return res;
    return res as { ok: true; id: string };
  } catch (err) {
    console.error('[finance] saveAccount failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

/** Soft-deletes an account (its transactions keep their history). */
export async function deleteAccount(
  id: string,
): Promise<{ ok: true } | FinanceFailure | null> {
  const fn = bridge('financeDeleteAccount');
  if (!fn) return null;
  try {
    const res = await fn(id);
    if (isFailure(res)) return res;
    return { ok: true };
  } catch (err) {
    console.error('[finance] deleteAccount failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

/**
 * Registers a transfer between two accounts: two live rows under the reserved
 * `Transferencia` category sharing a transfer_group_id. Balances move, monthly
 * totals do not, and no XP is emitted (see `rpg-events.ts`).
 */
export async function transferBetweenAccounts(input: {
  fromId: string;
  toId: string;
  amount: number;
  date?: string;
}): Promise<{ ok: true; transferGroupId: string } | FinanceFailure | null> {
  const fn = bridge('financeTransferBetweenAccounts');
  if (!fn) return null;
  try {
    const res = await fn(input);
    if (isFailure(res)) return res;
    return res as { ok: true; transferGroupId: string };
  } catch (err) {
    console.error('[finance] transferBetweenAccounts failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}
