import { estimateNutrition } from './estimate-service';
import { getCachedEstimate } from './history-api';

export interface ResolvedEstimate {
  /** `cache` means no network call was made — the UI says so. */
  origin: 'cache' | 'ai';
  totalCalories: number;
  /** Proteína total en gramos, o null cuando ni la IA ni el cache la conocen. */
  proteinG: number | null;
  items: Array<{ name: string; calories: number }>;
}

/**
 * An estimate for a description, from the local cache when we already have one.
 *
 * This is the choke point the whole "the AI does not repeat work" half of phase
 * 2 hangs on, which is exactly why it is a plain function and not four lines
 * inside a React handler: a test can assert that a cache hit never reaches
 * `estimateNutrition`, and that is the only property that actually matters.
 *
 * @param skipCache `true` for an explicit "estimate again" — the point of that
 *   button is a FRESH opinion, so it must go past the stored one (and the
 *   caller then refreshes the cache with what comes back).
 */
export async function resolveEstimate(
  description: string,
  { skipCache = false }: { skipCache?: boolean } = {},
): Promise<ResolvedEstimate> {
  const desc = description.trim();

  if (!skipCache) {
    const cached = await getCachedEstimate(desc);
    if (cached) {
      return {
        origin: 'cache',
        totalCalories: cached.calories,
        proteinG: cached.proteinG ?? null,
        items: parseItems(cached.aiBreakdown),
      };
    }
  }

  const result = await estimateNutrition(desc);
  return {
    origin: 'ai',
    totalCalories: result.calories,
    proteinG: result.proteinG ?? null,
    items: result.items ?? [],
  };
}

/** A corrupt breakdown costs us the item list, never the cache hit itself. */
function parseItems(raw: string | null): Array<{ name: string; calories: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
