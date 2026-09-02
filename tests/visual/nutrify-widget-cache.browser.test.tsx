/**
 * The dashboard widget goes through the SAME estimate cache as the Nutrify
 * page (P4 of the 2026-09-02 AI estimation research): a cache hit answers
 * without the model, and a confirmed number is written back so the next
 * device or the page benefits from it. Until this change the widget called
 * the model directly and neither read nor wrote the cache.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/modules/nutrition/styles/nutri.css';

// The Firebase callable must never run here: a cache hit is the whole point.
const estimateNutrition = vi.fn(async () => { throw new Error('model must not be called on a cache hit'); });
vi.mock('../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: (...args: unknown[]) => estimateNutrition(...(args as [])),
}));

import NutritionDashboardWidget from '@modules/nutrition/components/NutritionDashboardWidget';

const getCached = vi.fn();
const cacheEstimate = vi.fn(async () => ({ cached: true }));
const logFood = vi.fn(async () => undefined);

function installApi() {
  const base: Record<string, unknown> = {
    nutritionGetTodayCalories: async () => 650,
    nutritionGetTodayTarget: async () => 2000,
    nutritionGetWeekCalories: async () => [1800, 2100, 1600, 2400, 1900, 2000, 650],
    nutritionGetMealSchedule: async () => null,
    nutritionGetProfile: async () => ({ dayCutoffHour: 0 }),
    nutritionGetCachedEstimate: getCached,
    nutritionCacheEstimate: cacheEstimate,
    nutritionLogFood: logFood,
    processRpgEvent: async () => ({ xpGained: 10, hpChange: 0 }),
  };
  (window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (t, prop: string) => {
      if (prop in t) return t[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
});

describe('NutritionDashboardWidget — estimate cache', () => {
  test('a cache hit answers without the model and the confirmation is written back', async () => {
    getCached.mockResolvedValue({
      calories: 480, aiBreakdown: null, proteinG: 16, carbsG: 70, fatG: 14, hits: 3, source: 'model',
    });
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <ToastProvider>
            <div className="rpg-card" style={{ width: 420, margin: 20 }}>
              <NutritionDashboardWidget />
            </div>
          </ToastProvider>
        </ConfirmProvider>
      </MemoryRouter>,
    );
    await expect.element(page.getByText(/del objetivo diario/)).toBeVisible();

    await page.getByRole('button', { name: 'Estimar' }).click();
    const input = page.getByPlaceholder('milanesa con pure...');
    await input.fill('un plato de fideos con tuco');
    await page.getByRole('button', { name: 'Estimar', exact: true }).last().click();

    await expect.element(page.getByText('480 kcal')).toBeVisible();
    expect(getCached).toHaveBeenCalledWith('un plato de fideos con tuco');
    expect(estimateNutrition).not.toHaveBeenCalled();

    await page.getByRole('button', { name: 'Confirmar' }).click();
    await vi.waitFor(() => expect(cacheEstimate).toHaveBeenCalledTimes(1));
    expect(cacheEstimate).toHaveBeenCalledWith(expect.objectContaining({
      description: 'un plato de fideos con tuco', calories: 480, proteinG: 16, carbsG: 70, fatG: 14, corrected: false,
    }));
    expect(logFood).toHaveBeenCalledWith(expect.objectContaining({
      description: 'un plato de fideos con tuco', calories: 480, source: 'ai_estimate', proteinG: 16,
    }));
  });
});
