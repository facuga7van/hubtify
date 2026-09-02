/**
 * P3, renderer half: the user's own corrections for similar dishes ride along
 * with the estimate as `examples`, and only on the network path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getCachedEstimate = vi.fn();
const getSimilarCorrections = vi.fn();
const estimateNutrition = vi.fn();

beforeEach(() => {
  vi.resetModules();
  getCachedEstimate.mockReset();
  getSimilarCorrections.mockReset().mockResolvedValue([]);
  estimateNutrition.mockReset().mockResolvedValue({ calories: 480, proteinG: 16, carbsG: 70, fatG: 14, items: [] });
  vi.doMock('../../../src/modules/nutrition/history-api', () => ({ getCachedEstimate, getSimilarCorrections }));
  vi.doMock('../../../src/modules/nutrition/estimate-service', () => ({ estimateNutrition }));
});

afterEach(() => {
  vi.doUnmock('../../../src/modules/nutrition/history-api');
  vi.doUnmock('../../../src/modules/nutrition/estimate-service');
});

describe('resolveEstimate + examples', () => {
  it('passes the similar corrections to the model call', async () => {
    const { resolveEstimate } = await import('../../../src/modules/nutrition/estimate-with-cache');
    const examples = [{ description: 'fideos con tuco', calories: 600, protein_g: null, carbs_g: null, fat_g: null }];
    getCachedEstimate.mockResolvedValueOnce(null);
    getSimilarCorrections.mockResolvedValueOnce(examples);

    const result = await resolveEstimate('fideos con tuco y queso');

    expect(result.origin).toBe('ai');
    expect(getSimilarCorrections).toHaveBeenCalledWith('fideos con tuco y queso');
    expect(estimateNutrition).toHaveBeenCalledWith('fideos con tuco y queso', expect.objectContaining({ examples }));
  });

  it('does not look for corrections on a cache hit', async () => {
    const { resolveEstimate } = await import('../../../src/modules/nutrition/estimate-with-cache');
    getCachedEstimate.mockResolvedValueOnce({ calories: 480, aiBreakdown: null, proteinG: null, carbsG: null, fatG: null, hits: 2, source: 'user' });

    expect((await resolveEstimate('fideos con tuco')).origin).toBe('cache');
    expect(getSimilarCorrections).not.toHaveBeenCalled();
    expect(estimateNutrition).not.toHaveBeenCalled();
  });

  it('skipCache still asks for corrections (the exact match is excluded by the selector)', async () => {
    const { resolveEstimate } = await import('../../../src/modules/nutrition/estimate-with-cache');
    await resolveEstimate('fideos con tuco', { skipCache: true });
    expect(getCachedEstimate).not.toHaveBeenCalled();
    expect(getSimilarCorrections).toHaveBeenCalledWith('fideos con tuco');
  });
});

describe('getSimilarCorrections (history-api) over the bridge', () => {
  it('pulls the user rows and ranks them; an empty bridge or a failure yields []', async () => {
    vi.doUnmock('../../../src/modules/nutrition/history-api');
    vi.resetModules();
    const api = { nutritionGetUserCorrections: vi.fn() };
    (globalThis as unknown as { window: { api: unknown } }).window = { api };
    const { getSimilarCorrections: real, USER_CORRECTIONS_LIMIT } = await import('../../../src/modules/nutrition/history-api');

    api.nutritionGetUserCorrections.mockResolvedValueOnce([
      { description: 'milanesa con pure', calories: 700, proteinG: 30, carbsG: null, fatG: null, updatedAt: '2026-09-01T00:00:00.000Z' },
      { description: 'tarta de jamon y queso', calories: 500, proteinG: null, carbsG: null, fatG: null, updatedAt: null },
    ]);
    expect(await real('milanesa con puré y ensalada')).toEqual([
      { description: 'milanesa con pure', calories: 700, protein_g: 30, carbs_g: null, fat_g: null },
    ]);
    expect(api.nutritionGetUserCorrections).toHaveBeenCalledWith(USER_CORRECTIONS_LIMIT);

    api.nutritionGetUserCorrections.mockRejectedValueOnce(new Error('boom'));
    expect(await real('milanesa')).toEqual([]);

    (globalThis as unknown as { window: { api: unknown } }).window = { api: {} };
    expect(await real('milanesa')).toEqual([]);
  });
});
