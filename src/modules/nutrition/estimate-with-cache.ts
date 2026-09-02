import { estimateNutrition } from './estimate-service';
import { getCachedEstimate, getSimilarCorrections } from './history-api';
import type { BreakdownItem } from './breakdown-utils';

export interface ResolvedEstimate {
  /** `cache` means no network call was made — the UI says so. */
  origin: 'cache' | 'ai';
  totalCalories: number;
  /** Macros totales en gramos, o null cuando ni la IA ni el cache los conocen. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  items: BreakdownItem[];
}

/**
 * An estimate for a description, from the local cache when we already have one.
 *
 * This is the choke point the whole "the AI does not repeat work" half of phase
 * 2 hangs on, which is exactly why it is a plain function and not four lines
 * inside a React handler: a test can assert that a cache hit never reaches
 * `estimateNutrition`, and that is the only property that actually matters.
 *
 * The cache behind `getCachedEstimate` is the SQLite `nutrition_ai_cache` table
 * (per-account, keyed by `description_norm`). Upstream's localStorage cache lost
 * the merge; see estimate-service.ts for why.
 *
 * @param skipCache `true` for an explicit "estimate again" — the point of that
 *   button is a FRESH opinion, so it must go past the stored one (and the
 *   caller then refreshes the cache with what comes back).
 */
export async function resolveEstimate(
  description: string,
  { skipCache = false, onRetry }: { skipCache?: boolean; onRetry?: (attempt: number) => void } = {},
): Promise<ResolvedEstimate> {
  const desc = description.trim();

  if (!skipCache) {
    const cached = await getCachedEstimate(desc);
    if (cached) {
      return {
        origin: 'cache',
        totalCalories: cached.calories,
        proteinG: cached.proteinG ?? null,
        carbsG: cached.carbsG ?? null,
        fatG: cached.fatG ?? null,
        items: parseItems(cached.aiBreakdown),
      };
    }
  }

  // Only on the network path: the user's corrections for similar dishes ride
  // along as examples, so "milanesa con pure" corrected to 700 anchors the
  // next "milanesa con pure y ensalada" (P3). An exact match never gets here
  // unless the user asked for a fresh opinion, and then it is excluded.
  const examples = await getSimilarCorrections(desc);
  const result = await estimateNutrition(desc, { onRetry, examples });
  return {
    origin: 'ai',
    totalCalories: result.calories,
    proteinG: result.proteinG ?? null,
    carbsG: result.carbsG ?? null,
    fatG: result.fatG ?? null,
    items: result.items ?? [],
  };
}

/**
 * A corrupt breakdown costs us the item list, never the cache hit itself.
 *
 * Items cached before macros existed carry calories only, so each field is
 * normalised to `number | null` — BreakdownItem's contract, and what
 * rescaleItem/sumBreakdown expect.
 */
function parseItems(raw: string | null): BreakdownItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((it: Record<string, unknown>) => ({
      name: String(it.name ?? ''),
      calories: Number(it.calories) || 0,
      proteinG: typeof it.proteinG === 'number' ? it.proteinG : null,
      carbsG: typeof it.carbsG === 'number' ? it.carbsG : null,
      fatG: typeof it.fatG === 'number' ? it.fatG : null,
    }));
  } catch {
    return [];
  }
}
