import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rankSuggestions, suggestionScore, recencyDecay, daysBetween,
  DECAY_HALF_LIFE_DAYS,
} from '@modules/nutrition/history-search';
import type { RankableSuggestion } from '@modules/nutrition/history-search';

const TODAY = '2026-08-31';

function daysAgo(n: number): string {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function row(over: Partial<RankableSuggestion> & { description: string }): RankableSuggestion {
  return {
    calories: 500,
    timesLogged: 1,
    lastLogged: `${over.lastSeenDate ?? TODAY} 13:00`,
    source: 'history',
    lastSeenDate: TODAY,
    prefixMatch: true,
    ...over,
  };
}

describe('the decay', () => {
  it('is 1.0 today and halves every fortnight', () => {
    expect(recencyDecay(0)).toBe(1);
    expect(recencyDecay(DECAY_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(DECAY_HALF_LIFE_DAYS * 2)).toBeCloseTo(0.25, 10);
  });

  it('counts whole days between two dates and never goes negative', () => {
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0);
    // A stamp from "the future" (clock skew across devices) must not inflate a score.
    expect(daysBetween('2026-09-05', '2026-08-31')).toBe(0);
  });
});

describe('frequency x recency, worked by hand', () => {
  it('lets three recent logs beat twelve stale ones', () => {
    // 12 * 0.5^(30/14) = 2.72 ; 3 * 0.5^(1/14) = 2.85
    const stale = suggestionScore(
      { timesLogged: 12, lastSeenDate: daysAgo(30), source: 'history' }, TODAY);
    const fresh = suggestionScore(
      { timesLogged: 3, lastSeenDate: daysAgo(1), source: 'history' }, TODAY);
    expect(stale).toBeCloseTo(2.72, 2);
    expect(fresh).toBeCloseTo(2.855, 2);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('gives a favourite the weight of one extra log', () => {
    const asHistory = suggestionScore({ timesLogged: 2, lastSeenDate: TODAY, source: 'history' }, TODAY);
    const asFavorite = suggestionScore({ timesLogged: 2, lastSeenDate: TODAY, source: 'favorite' }, TODAY);
    expect(asHistory).toBe(2);
    expect(asFavorite).toBe(3);
  });

  it('still surfaces a favourite that was never logged', () => {
    expect(suggestionScore(
      { timesLogged: 0, lastSeenDate: TODAY, source: 'favorite' }, TODAY)).toBe(1);
    expect(suggestionScore(
      { timesLogged: 0, lastSeenDate: TODAY, source: 'history' }, TODAY)).toBe(0);
  });
});

describe('rankSuggestions', () => {
  it('produces the exact order the numbers dictate', () => {
    const rows = [
      row({ description: 'ensalada', timesLogged: 1, lastSeenDate: daysAgo(0) }),      // 1.00
      row({ description: 'milanesa', timesLogged: 12, lastSeenDate: daysAgo(30) }),    // 2.72
      row({ description: 'tostadas', timesLogged: 3, lastSeenDate: daysAgo(1) }),      // 2.85
      row({ description: 'sopa', timesLogged: 20, lastSeenDate: daysAgo(90) }),        // 0.24
      row({ description: 'cafe', timesLogged: 4, lastSeenDate: daysAgo(0) }),          // 4.00
    ];
    expect(rankSuggestions(rows, TODAY).map(s => s.description))
      .toEqual(['cafe', 'tostadas', 'milanesa', 'ensalada', 'sopa']);
  });

  it('puts every prefix match above every contains match, whatever the score', () => {
    const rows = [
      // A far stronger candidate that only CONTAINS the query…
      row({ description: 'pure de papa', timesLogged: 50, lastSeenDate: TODAY, prefixMatch: false }),
      // …still loses to a weak one that STARTS with it.
      row({ description: 'papa al horno', timesLogged: 1, lastSeenDate: daysAgo(20), prefixMatch: true }),
    ];
    expect(rankSuggestions(rows, TODAY).map(s => s.description))
      .toEqual(['papa al horno', 'pure de papa']);
  });

  it('breaks exact ties deterministically, so arrow keys never fight a re-render', () => {
    const rows = [
      row({ description: 'zapallo', timesLogged: 2, lastSeenDate: TODAY }),
      row({ description: 'acelga', timesLogged: 2, lastSeenDate: TODAY }),
    ];
    const once = rankSuggestions(rows, TODAY).map(s => s.description);
    const twice = rankSuggestions([...rows].reverse(), TODAY).map(s => s.description);
    expect(once).toEqual(['acelga', 'zapallo']);
    expect(twice).toEqual(once);
  });

  it('honours the limit and strips the ranking scaffolding from the result', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ description: `comida ${i}`, timesLogged: 12 - i, lastSeenDate: TODAY }));
    const out = rankSuggestions(rows, TODAY, 8);
    expect(out).toHaveLength(8);
    expect(out[0].description).toBe('comida 0');
    expect(out[0]).not.toHaveProperty('prefixMatch');
    expect(out[0]).not.toHaveProperty('lastSeenDate');
    expect(Object.keys(out[0]).sort())
      .toEqual(['calories', 'description', 'lastLogged', 'source', 'timesLogged']);
  });
});

describe('a cache hit never reaches the Cloud Function', () => {
  const estimateNutrition = vi.fn();
  const getCachedEstimate = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    estimateNutrition.mockReset();
    getCachedEstimate.mockReset();
    vi.doMock('../../../src/modules/nutrition/estimate-service', () => ({ estimateNutrition }));
    vi.doMock('../../../src/modules/nutrition/history-api', () => ({ getCachedEstimate, getSimilarCorrections: async () => [] }));
  });

  async function load() {
    return (await import('../../../src/modules/nutrition/estimate-with-cache')).resolveEstimate;
  }

  it('returns the cached value without calling the model', async () => {
    getCachedEstimate.mockResolvedValue({
      calories: 980,
      aiBreakdown: JSON.stringify([{ name: 'milanesa', calories: 700 }, { name: 'pure', calories: 280 }]),
      proteinG: null,
      hits: 4,
    });
    const resolveEstimate = await load();

    const result = await resolveEstimate('Milanesa con puré');

    expect(estimateNutrition).not.toHaveBeenCalled();
    expect(result.origin).toBe('cache');
    expect(result.totalCalories).toBe(980);
    expect(result.items).toHaveLength(2);
  });

  it('falls through to the model on a miss', async () => {
    getCachedEstimate.mockResolvedValue(null);
    estimateNutrition.mockResolvedValue({ calories: 640, items: [{ name: 'tarta', calories: 640 }] });
    const resolveEstimate = await load();

    const result = await resolveEstimate('tarta de verdura');

    expect(estimateNutrition).toHaveBeenCalledWith('tarta de verdura', { onRetry: undefined, examples: [] });
    expect(result).toEqual({
      origin: 'ai', totalCalories: 640,
      proteinG: null, carbsG: null, fatG: null,
      items: [{ name: 'tarta', calories: 640 }],
    });
  });

  it('skips the cache entirely for an explicit re-estimate', async () => {
    getCachedEstimate.mockResolvedValue({ calories: 980, aiBreakdown: null, proteinG: null, hits: 9 });
    estimateNutrition.mockResolvedValue({ calories: 720, items: [] });
    const resolveEstimate = await load();

    const result = await resolveEstimate('Milanesa con puré', { skipCache: true });

    expect(getCachedEstimate).not.toHaveBeenCalled();
    expect(estimateNutrition).toHaveBeenCalledOnce();
    expect(result.origin).toBe('ai');
    expect(result.totalCalories).toBe(720);
  });

  it('survives a corrupt breakdown rather than losing the hit', async () => {
    getCachedEstimate.mockResolvedValue({ calories: 500, aiBreakdown: '{not json', proteinG: null, hits: 1 });
    const resolveEstimate = await load();

    const result = await resolveEstimate('algo');

    expect(estimateNutrition).not.toHaveBeenCalled();
    expect(result).toEqual({
      origin: 'cache', totalCalories: 500,
      proteinG: null, carbsG: null, fatG: null,
      items: [],
    });
  });
});
