import { beforeAll, describe, expect, test, vi } from 'vitest';
import { render, cleanup } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/nutrition/styles/nutri.css';

/**
 * C8 en Nutrify: el modo invitado (sin cuenta) existe desde 0.9.5 y la IA de
 * nutrición no funciona sin sesión. `estimate-service` ya distingue ese fallo
 * (`NoSessionError` / `isNoSessionError`) del «se cayó la red», pero los tres
 * llamadores lo trataban igual y mostraban «probá de nuevo» sobre un botón que
 * nunca iba a funcionar. Acá se verifica que empujen a la carga manual.
 *
 * Y los dos esqueletos: Ajustes mostraba un «Cargando...» pelado y el widget
 * del tablero tenía un esqueleto hardcodeado en `style={{}}`, con colores
 * literales y sin animación, teniendo `.nutri-skeleton` a mano.
 */

// Ojo: las factorías de `vi.mock` se izan al tope del archivo, así que no
// pueden leer ninguna variable de módulo — el código va literal adentro.
vi.mock('../../src/modules/nutrition/estimate-service', () => {
  class NoSessionError extends Error {
    readonly code = 'nutrition/no-session';
    constructor() { super('Login required to estimate nutrition'); this.name = 'NoSessionError'; }
  }
  return {
    NO_SESSION_ERROR_CODE: 'nutrition/no-session',
    NoSessionError,
    isNoSessionError: (err: unknown) =>
      err instanceof Error && (err as { code?: string }).code === 'nutrition/no-session',
    estimateNutrition: async () => { throw new NoSessionError(); },
    buildEstimateRequest: (description: string) => ({ description }),
    normalizeDescription: (s: string) => s,
    isTransientError: () => false,
    withRetry: async (fn: () => unknown) => fn(),
    normalizeResult: (r: unknown) => r,
  };
});

vi.mock('../../src/modules/nutrition/estimate-with-cache', () => ({
  resolveEstimate: async () => {
    const err = new Error('Login required to estimate nutrition') as Error & { code?: string };
    err.code = 'nutrition/no-session';
    err.name = 'NoSessionError';
    throw err;
  },
}));

import Today from '@modules/nutrition/components/Today';
import FoodLogItem from '@modules/nutrition/components/FoodLogItem';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import NutritionDashboardWidget from '@modules/nutrition/components/NutritionDashboardWidget';

const SCREENS = 'screens';

const PROFILE = {
  age: 31, sex: 'M' as const, heightCm: 178, initialWeightKg: 80,
  activityLevel: 'moderate' as const, deficitTargetKcal: 400,
  dateOfBirth: '1995-03-12', weightCheckDay: 1, weightPopupEnabled: 1,
  mealSchedule: null, dayCutoffHour: 0,
  proteinTargetG: null, carbsTargetG: null, fatTargetG: null,
};

const FOODS = [
  {
    id: 1, date: '2026-06-26', time: '13:40', description: 'Milanesa con puré',
    calories: 720, source: 'manual', frequentFoodId: null, aiBreakdown: null,
    meal: 'lunch', proteinG: 40,
  },
];

/** Una promesa que no resuelve nunca: congela el componente en «cargando». */
const pending = () => new Promise<never>(() => undefined);

type Handlers = Record<string, unknown>;

function installApi(over: Handlers = {}) {
  const base: Handlers = {
    nutritionGetFoodByDate: async () => FOODS,
    nutritionGetSummary: async () => ({
      date: '2026-06-26', totalCaloriesIn: 720, bmr: 1760, tdee: 2400,
      balance: 1680, activityLevel: 'moderate', proteinG: 40, carbsG: 60, fatG: 20,
    }),
    nutritionGetDailyMetrics: async () => ({ date: '2026-06-26', steps: 0, gym: false }),
    nutritionGetFrequentFoods: async () => [],
    nutritionGetFavoriteFoods: async () => [],
    nutritionGetProfile: async () => PROFILE,
    nutritionGetTodayTarget: async () => 2000,
    nutritionGetTodayCalories: async () => 720,
    nutritionGetWeekCalories: async () => [1800, 2100, 1600, 2400, 1900, 2000, 720],
    nutritionIsDayClosed: async () => null,
    nutritionGetMealSchedule: async () => null,
    nutritionGetMacroTargets: async () => ({ proteinG: 150, carbsG: 220, fatG: 60, auto: true }),
    nutritionGetPendingDays: async () => [],
    nutritionGetPendingWeeks: async () => [],
    nutritionShouldAskWeight: async () => ({ shouldAsk: false }),
    nutritionGetRecentLoggedDays: async () => [],
    nutritionGetWeights: async () => [],
    nutritionGetStreak: async () => ({ streak: 0, todayPending: true }),
    nutritionGetEventDays: async () => [],
    nutritionSearchHistory: async () => [],
    nutritionGetCachedEstimate: async () => null,
    nutritionCacheEstimate: async () => ({ cached: true }),
    nutritionGetAdaptiveTdee: async () => null,
    ...over,
  };
  (window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop: string) => {
      if (prop in target) return (target as Handlers)[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
}

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
});

const wrap = (node: React.ReactNode) => {
  cleanup();
  return render(
    <MemoryRouter>
      <ConfirmProvider><ToastProvider>
        <div style={{ padding: 16, background: 'var(--parch-0)', minHeight: '100vh' }}>{node}</div>
      </ToastProvider></ConfirmProvider>
    </MemoryRouter>,
  );
};

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/** Escribe en un input controlado por React. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const AI_OFF = /Estimaci[oó]n IA no disponible/i;

describe('Sin sesión, la IA de nutrición degrada a carga manual', () => {
  test('Hoy: el aviso nombra la carga manual y el modo Manual queda activo', async () => {
    installApi();
    await page.viewport(1100, 900);
    wrap(<Today />);
    await settle(500);

    const input = el<HTMLInputElement>('.nutri-food-input-row input');
    type(input, 'milanesa con papas');
    await settle(80);
    el<HTMLButtonElement>('.nutri-food-input-row button').click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/nutrify-c8-01-sin-sesion.png` });

    const notice = el('.nutri-estimate-notice');
    expect(notice.textContent ?? '').toMatch(AI_OFF);
    expect(notice.textContent ?? '').not.toMatch(/nutrify\.[a-zA-Z]/);

    // Y no deja al usuario en un modo que no puede funcionar: Manual queda activo.
    const active = [...document.querySelectorAll('.nutri-mode-btn.active')];
    expect(active).toHaveLength(1);
    expect(active[0].textContent!.trim()).toBe('Manual');
    expect(document.querySelector('.nutri-manual-inputs')).toBeTruthy();
  });

  test('fila de comida: re-estimar sin sesión avisa que hay que cargar a mano', async () => {
    installApi();
    await page.viewport(900, 400);
    wrap(
      <FoodLogItem
        entry={FOODS[0]}
        onDelete={() => undefined}
        onUpdate={() => undefined}
      />,
    );
    await settle(120);

    // Abrir la edición y pedir la re-estimación.
    el<HTMLButtonElement>('button[aria-label^="Editar"]').click();
    await settle(120);
    el<HTMLButtonElement>('.nutri-meal-edit-ai').click();
    await settle(300);

    expect(document.body.textContent ?? '').toMatch(AI_OFF);
    // La fila sigue en edición: el usuario puede tipear el número a mano.
    expect(document.querySelector('.nutri-meal-row--edit')).toBeTruthy();
  });

  test('widget del tablero: cae al ingreso manual sin ofrecer un reintento inútil', async () => {
    installApi();
    await page.viewport(420, 700);
    wrap(<NutritionDashboardWidget />);
    await settle(300);

    el<HTMLButtonElement>('.nutri-dash-quick-btn').click();
    await settle(120);
    const input = el<HTMLInputElement>('.nutri-dash-quick-input');
    type(input, 'milanesa con papas');
    await settle(80);
    el<HTMLButtonElement>('.nutri-dash-quick-submit').click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/nutrify-c8-02-widget-sin-sesion.png` });

    expect(document.body.textContent ?? '').toMatch(AI_OFF);
    // El input de kcal manual está a mano, en el mismo lugar.
    expect(document.querySelector('.nutri-dash-quick-form input[type="number"]')).toBeTruthy();
    // Y el botón de estimar queda deshabilitado: sin sesión no hay red que probar.
    expect(el<HTMLButtonElement>('.nutri-dash-quick-submit').disabled).toBe(true);
  });
});

describe('Nutrify carga con esqueleto, no con texto pelado', () => {
  test('Ajustes: esqueleto del códice mientras llega el perfil', async () => {
    installApi({ nutritionGetProfile: pending });
    await page.viewport(1100, 900);
    wrap(<NutritionSettings />);
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/nutrify-c8-03-ajustes-cargando.png` });

    expect(document.querySelectorAll('.nutri-skeleton').length).toBeGreaterThan(2);
    expect(document.body.textContent ?? '').not.toContain('Cargando...');
  });

  test('widget del tablero: el esqueleto usa la clase del módulo, no colores sueltos', async () => {
    installApi({ nutritionGetTodayCalories: pending });
    await page.viewport(420, 400);
    wrap(<NutritionDashboardWidget />);
    await settle(250);

    const bones = [...document.querySelectorAll<HTMLElement>('.nutri-skeleton')];
    expect(bones.length).toBeGreaterThan(2);
    // Animado (shimmer), no un bloque muerto.
    expect(getComputedStyle(bones[0]).animationName).not.toBe('none');
    // Y ningún hueso pinta un color literal por `style`.
    for (const bone of bones) expect(bone.getAttribute('style') ?? '').not.toMatch(/background/);
  });
});

describe('Un borrado que falla no se disfraza de borrado', () => {
  test('Hoy: si el backend rechaza el delete, se avisa y la fila vuelve', async () => {
    installApi({
      nutritionDeleteFood: async () => { throw new Error('closed day'); },
    });
    await page.viewport(1100, 900);
    wrap(<Today />);
    await settle(500);

    el<HTMLButtonElement>('button[aria-label^="Eliminar «"]').click();
    await settle(120);
    [...document.querySelectorAll<HTMLButtonElement>('.nutri-meal-del-confirm button')]
      .find((b) => /eliminar/i.test(b.textContent ?? ''))!.click();
    await settle(600);
    await page.screenshot({ path: `${SCREENS}/nutrify-c8-04-borrado-fallido.png` });

    // Hay un aviso visible, y la comida sigue en la lista.
    expect(document.body.textContent ?? '').toMatch(/no se pudo|error|cerrado/i);
    expect(document.body.textContent ?? '').toContain('Milanesa con puré');
  });
});
