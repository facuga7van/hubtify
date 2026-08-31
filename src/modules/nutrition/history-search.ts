/**
 * Ranking for the history autocomplete — the path that logs a meal WITHOUT the AI.
 *
 * The SQL side does the grouping (it has the index); the scoring lives here, in
 * pure functions, so the order the user sees can be pinned by hand in a test
 * instead of being an emergent property of a 30-line query.
 *
 * ── The score ────────────────────────────────────────────────────────────────
 *
 *     score = (timesLogged + favoriteBonus) * 0.5 ^ (daysSinceLastSeen / 14)
 *
 * Frequency times an exponential recency decay with a FOURTEEN-DAY HALF-LIFE:
 * a meal you logged twelve times but not for a month is worth about as much as
 * one you logged three times yesterday (2.72 vs 2.85). That is the behaviour we
 * want — the list has to track what you are eating THIS fortnight, not what you
 * ate all of last spring, while still remembering the staples.
 *
 * `favoriteBonus` is 1 for an explicit favourite: the act of saving it counts as
 * one extra log. It is what lets a freshly saved favourite appear at all before
 * it has ever been logged, without letting it outrank a genuine daily habit.
 *
 * ── Prefix beats contains ────────────────────────────────────────────────────
 *
 * Matches are ranked in two tiers. "Starts with what you typed" always sorts
 * above "contains what you typed", and only inside a tier does the score decide.
 * Beyond being what people expect, the prefix tier is the one the index can SEEK
 * (a range scan on `description_norm`); the contains tier is a scan of the same
 * index. Keeping them separate keeps the fast path first and cheap.
 */

/** Where a suggestion came from. `history` = the food log; `favorite` = saved by hand. */
export type SuggestionSource = 'history' | 'favorite';

/** What `nutrition:searchHistory` returns, one row per normalised description. */
export interface HistorySuggestion {
  description: string;
  calories: number;
  timesLogged: number;
  /** `YYYY-MM-DD HH:MM` of the most recent log, or null if only ever a favourite. */
  lastLogged: string | null;
  source: SuggestionSource;
  /** Only present when the AI cache holds a protein value for this description. */
  proteinG?: number;
}

/** A suggestion plus the two fields ranking needs and the caller does not see. */
export interface RankableSuggestion extends HistorySuggestion {
  /**
   * `YYYY-MM-DD` the entry was last "seen" — the last log, or the day a
   * never-logged favourite was created. Drives the decay.
   */
  lastSeenDate: string;
  /** True when the description STARTS with the query (the index-seek tier). */
  prefixMatch: boolean;
}

/** Half-life of the recency decay, in days. */
export const DECAY_HALF_LIFE_DAYS = 14;

/** Extra weight an explicit favourite carries, in "logs". */
export const FAVORITE_BONUS = 1;

/** Default page size for `nutrition:searchHistory`. */
export const SEARCH_HISTORY_LIMIT = 8;

/** Whole days between two `YYYY-MM-DD` strings; negative clamps to 0. */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** `0.5 ^ (days / halfLife)` — 1.0 today, 0.5 after a fortnight, 0.25 after a month. */
export function recencyDecay(days: number): number {
  return Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

/** frequency x recency. See the header for why this shape. */
export function suggestionScore(
  s: Pick<RankableSuggestion, 'timesLogged' | 'lastSeenDate' | 'source'>,
  today: string,
): number {
  const weight = s.timesLogged + (s.source === 'favorite' ? FAVORITE_BONUS : 0);
  return weight * recencyDecay(daysBetween(s.lastSeenDate, today));
}

/**
 * Orders suggestions: prefix tier first, then score descending.
 *
 * Ties break on recency, then frequency, then the description — total and
 * deterministic, so a test can assert an exact order and a re-render cannot
 * reshuffle the list under the user's arrow keys.
 */
export function rankSuggestions(
  rows: RankableSuggestion[],
  today: string,
  limit = SEARCH_HISTORY_LIMIT,
): HistorySuggestion[] {
  const scored = rows.map((r) => ({ row: r, score: suggestionScore(r, today) }));

  scored.sort((a, b) => {
    if (a.row.prefixMatch !== b.row.prefixMatch) return a.row.prefixMatch ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    const aSeen = a.row.lastLogged ?? a.row.lastSeenDate;
    const bSeen = b.row.lastLogged ?? b.row.lastSeenDate;
    if (aSeen !== bSeen) return aSeen < bSeen ? 1 : -1;
    if (b.row.timesLogged !== a.row.timesLogged) return b.row.timesLogged - a.row.timesLogged;
    return a.row.description.localeCompare(b.row.description);
  });

  return scored.slice(0, limit).map(({ row }) => {
    // lastSeenDate and prefixMatch are ranking scaffolding, not part of the contract.
    const { lastSeenDate: _lastSeenDate, prefixMatch: _prefixMatch, ...suggestion } = row;
    return suggestion;
  });
}
