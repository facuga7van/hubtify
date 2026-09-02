/**
 * Renderer-side access to the phase-2 nutrition IPC methods.
 *
 * `electron/preload.ts` and `shared/types.ts` are wired separately from this
 * change, so `window.api` does not declare these three methods yet. Rather than
 * scatter `as any` through Today.tsx, the cast lives here once, narrowly typed,
 * and every call site gets a real signature.
 *
 * The guards are not ceremony: until the preload lands, the methods genuinely
 * are undefined, and the autocomplete has to degrade to "no suggestions" instead
 * of crashing the food input. Once the bridge is in place this file can collapse
 * to three one-line pass-throughs.
 */
import type { HistorySuggestion } from './history-search';

export type { HistorySuggestion, SuggestionSource } from './history-search';

/** What a cache hit looks like. `hits` already includes this lookup. */
export interface CachedEstimate {
  calories: number;
  aiBreakdown: string | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  hits: number;
  /** 'user' when the number is a correction the human typed; 'model' otherwise. */
  source: 'model' | 'user';
}

interface NutritionPhase2Api {
  nutritionSearchHistory: (query?: string, limit?: number) => Promise<HistorySuggestion[]>;
  nutritionGetCachedEstimate: (description: string) => Promise<CachedEstimate | null>;
  nutritionCacheEstimate: (entry: {
    description: string; calories: number; aiBreakdown?: string | null;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
    corrected?: boolean;
  }) => Promise<{ cached: boolean }>;
}

function bridge(): Partial<NutritionPhase2Api> {
  return window.api as unknown as Partial<NutritionPhase2Api>;
}

/** Suggestions from the user's own log. Empty query = the top of the ranking. */
export async function searchHistory(query = '', limit?: number): Promise<HistorySuggestion[]> {
  const fn = bridge().nutritionSearchHistory;
  if (!fn) return [];
  try {
    return (await fn(query, limit)) ?? [];
  } catch (err) {
    // A failing suggestion query must never block the AI path behind it.
    console.error('[Nutrition] searchHistory failed', err);
    return [];
  }
}

/** A previously confirmed estimate for this exact description, or null. */
export async function getCachedEstimate(description: string): Promise<CachedEstimate | null> {
  const fn = bridge().nutritionGetCachedEstimate;
  if (!fn) return null;
  try {
    return (await fn(description)) ?? null;
  } catch (err) {
    console.error('[Nutrition] getCachedEstimate failed', err);
    return null;
  }
}

/**
 * Remembers what the user confirmed for this description.
 *
 * Pass `corrected: true` when the calories on screen are not the ones the model
 * returned — the corrected number is stored (it is better evidence) and the
 * per-item breakdown is dropped, since it no longer adds up.
 */
export async function cacheEstimate(entry: {
  description: string; calories: number; aiBreakdown?: string | null;
  proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  corrected?: boolean;
}): Promise<void> {
  const fn = bridge().nutritionCacheEstimate;
  if (!fn) return;
  try {
    await fn(entry);
  } catch (err) {
    console.error('[Nutrition] cacheEstimate failed', err);
  }
}
