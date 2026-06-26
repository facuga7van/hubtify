import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';

// Real i18n (Spanish) + styles so the screens match production pixel-for-pixel.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

// ── Mock the AI estimation at the SERVICE layer ───────────────────────────────
// `estimate-service.ts` imports the Firebase SDK (httpsCallable + getActiveAuth),
// which we cannot exercise in a browser unit test. Today.tsx imports
// `estimateNutrition` from this module, so mocking the module returns a
// deterministic 3-ingredient breakdown with macros and skips Firebase entirely.
// Path is relative so it resolves to the SAME absolute file Today imports.
vi.mock('../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({
    calories: 780,
    proteinG: 44,
    carbsG: 68,
    fatG: 30,
    items: [
      { name: 'Milanesa de pollo', calories: 420, proteinG: 35, carbsG: 22, fatG: 18 },
      { name: 'Puré de papas', calories: 240, proteinG: 5, carbsG: 38, fatG: 8 },
      { name: 'Ensalada mixta', calories: 120, proteinG: 4, carbsG: 8, fatG: 4 },
    ],
  }),
}));

// Now import the screens (after the mock is registered).
import Today from '@modules/nutrition/components/Today';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import NutritionCharts from '@modules/nutrition/components/NutritionCharts';

const SCREENS = 'screens';

// ── Realistic mock data exercising Fases 0-2 (macros) ─────────────────────────
const PROFILE = {
  age: 31,
  sex: 'M' as const,
  heightCm: 178,
  initialWeightKg: 80,
  activityLevel: 'moderate' as const,
  deficitTargetKcal: 400, // deficit goal
  dateOfBirth: '1995-03-12',
  weightCheckDay: 1,
  weightPopupEnabled: 1,
  mealSchedule: null,
  // No overrides → auto macro targets in use.
  proteinTargetG: null,
  carbsTargetG: null,
  fatTargetG: null,
};

// Day summary: macros consumed. protein UNDER, carbs + fat OVER target (the
// "over" state is informative, not punitive).
const SUMMARY = {
  date: '2026-06-26',
  totalCaloriesIn: 1650,
  bmr: 1760,
  tdee: 2400,
  balance: 350,
  activityLevel: 'moderate',
  proteinG: 118, // / 150 → 79%
  carbsG: 236,   // / 220 → 107% (over)
  fatG: 72,      // / 60  → 120% (over)
};

const MACRO_TARGETS = { proteinG: 150, carbsG: 220, fatG: 60, auto: true };

const FOODS = [
  { id: 1, date: '2026-06-26', time: '08:15', description: 'Avena con frutas y miel', calories: 350, source: 'ai_estimate', frequentFoodId: null, aiBreakdown: null, meal: 'breakfast' },
  { id: 2, date: '2026-06-26', time: '13:10', description: 'Milanesa de pollo con puré', calories: 720, source: 'ai_estimate', frequentFoodId: null, aiBreakdown: null, meal: 'lunch' },
  { id: 3, date: '2026-06-26', time: '13:20', description: 'Ensalada mixta', calories: 150, source: 'manual', frequentFoodId: null, aiBreakdown: null, meal: 'lunch' },
  { id: 4, date: '2026-06-26', time: '21:00', description: 'Omelette de 3 huevos', calories: 430, source: 'favorite', frequentFoodId: null, aiBreakdown: null, meal: 'dinner' },
];

const FREQUENT = [
  { id: 1, name: 'Café con leche', calories: 120, timesUsed: 22, proteinG: 6, carbsG: 12, fatG: 5 },
  { id: 2, name: 'Yogur con granola', calories: 260, timesUsed: 14, proteinG: 12, carbsG: 34, fatG: 8 },
  { id: 3, name: 'Banana', calories: 95, timesUsed: 9, proteinG: 1, carbsG: 24, fatG: 0 },
];

const FAVORITES = [
  { id: 'fav1', description: 'Milanesa napolitana', calories: 680, source: 'ai_estimate', proteinG: 48, carbsG: 40, fatG: 32, createdAt: '2026-06-01' },
  { id: 'fav2', description: 'Bowl de pollo y arroz', calories: 540, source: 'ai_estimate', proteinG: 42, carbsG: 60, fatG: 12, createdAt: '2026-06-05' },
];

const RECENT_DAYS = [
  { date: '2026-06-25', meals: 4, calories: 1980 },
  { date: '2026-06-24', meals: 3, calories: 1740 },
  { date: '2026-06-22', meals: 5, calories: 2230 },
];

const WEIGHTS = [
  { date: '2026-05-01', weightKg: 82.5 },
  { date: '2026-05-15', weightKg: 81.6 },
  { date: '2026-06-01', weightKg: 80.9 },
  { date: '2026-06-15', weightKg: 80.2 },
];

// Range summaries for the charts (with macros so MacroHistory / Balance renders).
const SUMMARY_RANGE = Array.from({ length: 10 }, (_, i) => {
  const day = String(16 + i).padStart(2, '0');
  return {
    date: `2026-06-${day}`,
    totalCaloriesIn: 1700 + (i % 4) * 180,
    bmr: 1760,
    tdee: 2400,
    balance: 0,
    proteinG: 110 + (i % 3) * 18,
    carbsG: 210 + (i % 4) * 25,
    fatG: 55 + (i % 3) * 9,
  };
});

// ── window.api mock — every nutrition method the screens call ──────────────────
function installApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = {
    // Today.loadData (Promise.all)
    nutritionGetFoodByDate: async () => FOODS,
    nutritionGetSummary: async () => SUMMARY,
    nutritionGetDailyMetrics: async () => ({ date: '2026-06-26', steps: 6200, gym: true }),
    nutritionGetFrequentFoods: async () => FREQUENT,
    nutritionGetProfile: async () => PROFILE,
    nutritionGetTodayTarget: async () => 2000,
    nutritionIsDayClosed: async () => null,
    nutritionGetFavoriteFoods: async () => FAVORITES,
    nutritionGetMealSchedule: async () => null, // → DEFAULT_MEAL_SCHEDULE
    nutritionGetMacroTargets: async () => MACRO_TARGETS,
    // Today misc
    nutritionGetPendingDays: async () => [],
    nutritionShouldAskWeight: async () => ({ shouldAsk: false }),
    nutritionGetRecentLoggedDays: async () => RECENT_DAYS,
    // Mutations (driven scenes only need them to resolve)
    nutritionLogFood: async () => ({ id: 99 }),
    nutritionIncrementFrequentUsage: async () => {},
    nutritionRepeatDay: async () => ({ copied: 3 }),
    nutritionAddFavoriteFood: async () => {},
    nutritionRemoveFavoriteFood: async () => {},
    nutritionUpdateFood: async () => {},
    nutritionDeleteFood: async () => {},
    nutritionDeleteByDate: async () => {},
    nutritionSaveDailyMetrics: async () => {},
    nutritionSaveWeeklyMetrics: async () => {},
    nutritionCloseDay: async () => ({ success: false, alreadyClosed: false }),
    processRpgEvent: async () => ({}),
    // NutritionSettings
    nutritionGetWeights: async () => WEIGHTS,
    nutritionSaveProfile: async () => {},
    // NutritionCharts
    nutritionGetSummaryRange: async () => SUMMARY_RANGE,
    nutritionGetStreak: async () => 9,
  };
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  document.body.style.margin = '0';
  installApi();
});

beforeEach(() => {
  document.documentElement.scrollTop = 0;
  // Avoid the weekly weight popup interfering with the Today screen.
  localStorage.setItem('hubtify_weight_dismiss_date', '2026-06-26');
});

describe('Nutrify — full screens (macros, Fases 0-2)', () => {
  test('01 — Today with meals + 3 macro bars (carbs/fat over)', async () => {
    render(<Providers><Today /></Providers>);
    // Wait for load + macros to render.
    await expect.element(page.getByText('Macros', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Sugerido automáticamente')).toBeVisible();
    await sleep(600); // let the calorie ring number settle
    await page.screenshot({ path: `${SCREENS}/nutri-screen-01-today.png` });
  });

  test('02 — Today estimate breakdown (editable ingredients with macros)', async () => {
    render(<Providers><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByPlaceholder('¿Qué comiste? ej: milanesa con papas fritas').fill('milanesa de pollo con puré y ensalada');
    await page.getByRole('button', { name: 'Estimar' }).click();
    // Breakdown appears once the (mocked) estimation resolves. The hint line is
    // unique to the breakdown panel (the dish name also appears in the food log).
    await expect.element(page.getByText(/Ajustá las calorías de cada ingrediente/)).toBeVisible();
    await expect.element(page.getByText('Puré de papas')).toBeVisible();
    const hint = page.getByText(/Ajustá las calorías de cada ingrediente/).element();
    hint.scrollIntoView({ block: 'center' });
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/nutri-screen-02-estimate-breakdown.png` });
  });

  test('03 — Settings macro targets section', async () => {
    render(<Providers><NutritionSettings /></Providers>);
    await expect.element(page.getByText('Objetivos de macros')).toBeVisible();
    const heading = page.getByText('Objetivos de macros').element();
    heading.scrollIntoView({ block: 'center' });
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/nutri-screen-03-settings-macros.png` });
  });

  test('04 — Charts "Balance de Nutrientes" card', async () => {
    render(<Providers><NutritionCharts /></Providers>);
    await expect.element(page.getByText('Balance de Nutrientes')).toBeVisible();
    const card = page.getByText('Balance de Nutrientes').element();
    card.scrollIntoView({ block: 'center' });
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/nutri-screen-04-charts-balance.png` });
  });

  test('05 — Today repeat-previous-day picker', async () => {
    render(<Providers><Today /></Providers>);
    await expect.element(page.getByText('Registro de Comidas')).toBeVisible();
    // The "Repetir día" button lives in the food-log header (foods exist).
    await page.getByRole('button', { name: 'Repetir día' }).click();
    await expect.element(page.getByText('Repetir el festín de…')).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/nutri-screen-05-repeat-day.png` });
  });

  test('06 — Today portion-adjust picker (frequent food)', async () => {
    render(<Providers><Today /></Providers>);
    await expect.element(page.getByText('Comidas Frecuentes')).toBeVisible();
    // Each frequent pill has an "Ajustar porción" button; open the first.
    await page.getByRole('button', { name: 'Ajustar porción' }).first().click();
    await expect.element(page.getByText('Ajustar porción', { exact: true })).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/nutri-screen-06-portion.png` });
  });
});
