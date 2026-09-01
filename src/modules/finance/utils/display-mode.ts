/**
 * Display-mode state (ARS → USD → ARS de hoy) plus the feature-detected IPC
 * bridges the mode needs.
 *
 * The mode itself is renderer-only state: localStorage + a window event, so
 * the DollarChip (the master control) and every screen that prints money stay
 * in sync without threading a context through the router.
 *
 * The `finance:getValuedView` / `finance:getInflationSeries` /
 * `finance:getUpcoming` / `dollar:*` handlers exist in the main process but are
 * not on the context bridge yet (this module may not edit `electron/preload.ts`
 * / `shared/types.ts`). Same degrade-to-null contract as `api-ext.ts`: the UI
 * compiles today and lights up the moment the bridge catches up. What works
 * without the new bridge: cycling ARS↔USD and per-row ledger conversion (the
 * ledger rows already carry `fxRate`, and the current rate comes from the
 * long-exposed `dollarGetRates`).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  buildIpcCoefficients,
  convertTransactionAmount,
  nextDisplayMode,
  type ConvertedAmount,
  type DisplayMode,
  type IpcCoefficients,
  type IpcSeriesPoint,
} from './valuation';

const MODE_KEY = 'coinify_display_mode';
const MODE_EVENT = 'coinify:displayModeChanged';

// ── Wire shapes (mirror electron/modules/finance.balance.ts) ───────────────

export interface ValuedAggregates {
  balance: { income: number; expenses: number; balance: number };
  monthlyExpenses: number[];
  categories: Array<{ category: string; value: number }>;
  approx: boolean;
}

export interface ValuedView {
  month: string;
  house: string;
  currentRate: number | null;
  usd: ValuedAggregates | null;
  arsToday: (ValuedAggregates & { latestIpcMonth: string }) | null;
  /**
   * `realPct` is null while either month's IPC index is unpublished;
   * `realPending` distinguishes that ("sin dato del INDEC todavía") from "no
   * series at all". Older main processes omit the flag → treated as false.
   */
  trend: { nominalPct: number | null; realPct: number | null; realPending?: boolean };
}

export interface UpcomingItem {
  kind: 'installment' | 'recurring' | 'card_due';
  date: string;
  label: string;
  amount: number;
  currency: 'ARS' | 'USD';
  refId: string;
  detail?: string;
}

export interface UpcomingTimeline {
  from: string;
  to: string;
  items: UpcomingItem[];
  totals: { ARS: number; USD: number };
}

// ── Bridge (feature-detect, same pattern as api-ext.ts) ────────────────────

type MaybeApi = Record<string, unknown>;

function bridge(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
  const api = (window as unknown as { api?: MaybeApi }).api;
  const fn = api?.[name];
  return typeof fn === 'function' ? (fn as (...args: unknown[]) => Promise<unknown>) : null;
}

export function hasValuedViewSupport(): boolean {
  return bridge('financeGetValuedView') !== null;
}

export function hasUpcomingSupport(): boolean {
  return bridge('financeGetUpcoming') !== null;
}

export function hasBackfillSupport(): boolean {
  return bridge('financeBackfillFxRates') !== null;
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getValuedView(month?: string): Promise<ValuedView | null> {
  const fn = bridge('financeGetValuedView');
  if (!fn) return null;
  try {
    return (await fn(month)) as ValuedView;
  } catch (err) {
    console.error('[finance] getValuedView failed:', err);
    return null;
  }
}

/** `null` when unreachable (bridge missing, or offline with an empty cache). */
export async function getInflationSeries(): Promise<IpcSeriesPoint[] | null> {
  const fn = bridge('financeGetInflationSeries');
  if (!fn) return null;
  try {
    const res = (await fn()) as { ok: boolean; series: IpcSeriesPoint[] | null };
    return res?.ok && Array.isArray(res.series) ? res.series : null;
  } catch (err) {
    console.error('[finance] getInflationSeries failed:', err);
    return null;
  }
}

/** `null` when the handler is not exposed on the bridge yet. */
export async function getUpcoming(days = 30): Promise<UpcomingTimeline | null> {
  const fn = bridge('financeGetUpcoming');
  if (!fn) return null;
  try {
    return (await fn(days)) as UpcomingTimeline;
  } catch (err) {
    console.error('[finance] getUpcoming failed:', err);
    return null;
  }
}

/** `null` = bridge not wired yet; otherwise the handler's envelope. */
export async function backfillFxRates(): Promise<
  { ok: true; updated: number; rate: number } | { ok: false; reason: string } | null
> {
  const fn = bridge('financeBackfillFxRates');
  if (!fn) return null;
  try {
    return (await fn()) as { ok: true; updated: number; rate: number } | { ok: false; reason: string };
  } catch (err) {
    console.error('[finance] backfillFxRates failed:', err);
    return { ok: false, reason: 'ipc_error' };
  }
}

const HOUSE_KEY = 'coinify_fx_house';
export const DEFAULT_FX_HOUSE = 'blue';
/** Fired after the preferred house changes, so every converted view reloads. */
export const FX_HOUSE_EVENT = 'coinify:fxHouseChanged';

/** Preferred house. Bridge if wired, localStorage echo otherwise. */
export async function getFxHouse(): Promise<string> {
  const fn = bridge('dollarGetFxHouse');
  if (fn) {
    try {
      const house = (await fn()) as string;
      if (typeof house === 'string' && house) return house;
    } catch (err) {
      console.error('[finance] getFxHouse failed:', err);
    }
  }
  try {
    return localStorage.getItem(HOUSE_KEY) || DEFAULT_FX_HOUSE;
  } catch {
    return DEFAULT_FX_HOUSE;
  }
}

/**
 * Persists the house (bridge + local echo) and announces the change: the chip
 * used to show the new rate while the ledger and the dashboard kept converting
 * with the old house until the next navigation. Returns false when nothing stuck.
 */
export async function setFxHouse(house: string): Promise<boolean> {
  try { localStorage.setItem(HOUSE_KEY, house); } catch { /* ignore */ }
  const fn = bridge('dollarSetFxHouse');
  let stuck = false;
  if (fn) {
    try {
      await fn(house);
      stuck = true;
    } catch (err) {
      console.error('[finance] setFxHouse failed:', err);
    }
  }
  window.dispatchEvent(new Event(FX_HOUSE_EVENT));
  return stuck;
}

// ── Mode state ─────────────────────────────────────────────────────────────

export function getDisplayMode(): DisplayMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'usd' || stored === 'ars-today') return stored;
  } catch { /* ignore */ }
  return 'ars';
}

export function setDisplayMode(mode: DisplayMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  window.dispatchEvent(new Event(MODE_EVENT));
}

export function cycleDisplayMode(inflationAvailable: boolean): DisplayMode {
  const next = nextDisplayMode(getDisplayMode(), { inflationAvailable });
  setDisplayMode(next);
  return next;
}

/** Reactive display mode — updates on the chip's cycle and on account switch. */
export function useDisplayMode(): DisplayMode {
  const [mode, setMode] = useState<DisplayMode>(getDisplayMode);
  useEffect(() => {
    const handler = () => setMode(getDisplayMode());
    window.addEventListener(MODE_EVENT, handler);
    return () => window.removeEventListener(MODE_EVENT, handler);
  }, []);
  return mode;
}

// ── Valuation context for per-row conversion ───────────────────────────────

export interface ValuationContext {
  mode: DisplayMode;
  /** Venta rate of the preferred house, from the rates the DollarChip shows. */
  currentRate: number | null;
  coefs: IpcCoefficients | null;
  /** True once the IPC series is loaded — gates the ars-today leg of the cycle. */
  inflationAvailable: boolean;
  convert: (tx: { amount: number; currency: string; fxRate?: number | null; fxRateSource?: string | null; date: string }) => ConvertedAmount;
}

interface RatesResponse {
  success: boolean;
  rates?: Array<{ casa: string; venta: number }>;
}

async function loadCurrentRate(): Promise<number | null> {
  try {
    const house = await getFxHouse();
    const res = await window.api.dollarGetRates() as RatesResponse;
    if (!res.success || !res.rates) return null;
    const pick = res.rates.find((r) => r.casa === house)
      ?? res.rates.find((r) => r.casa === DEFAULT_FX_HOUSE)
      ?? res.rates[0];
    const venta = pick?.venta;
    return typeof venta === 'number' && Number.isFinite(venta) && venta > 0 ? venta : null;
  } catch (err) {
    console.warn('[finance] loadCurrentRate failed:', err);
    return null;
  }
}

/**
 * Everything a list of transactions needs to print amounts under the current
 * mode. Loads the rate and the inflation series once per mount and again on
 * `account:switched`.
 */
export function useValuationContext(): ValuationContext {
  const mode = useDisplayMode();
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [coefs, setCoefs] = useState<IpcCoefficients | null>(null);

  const load = useCallback(() => {
    loadCurrentRate().then(setCurrentRate);
    getInflationSeries().then((series) => setCoefs(buildIpcCoefficients(series)));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    window.addEventListener(FX_HOUSE_EVENT, handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(FX_HOUSE_EVENT, handler);
    };
  }, [load]);

  const convert = useCallback(
    (tx: { amount: number; currency: string; fxRate?: number | null; fxRateSource?: string | null; date: string }) =>
      convertTransactionAmount(tx, mode, { currentRate, coefs }),
    [mode, currentRate, coefs],
  );

  return { mode, currentRate, coefs, inflationAvailable: coefs !== null, convert };
}
