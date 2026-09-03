import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { smallText, tokenPx } from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/modules/nutrition/styles/nutri.css';

// Mocked at the SERVICE layer — the same seam nutrify-screens uses, so the
// Firebase callable never runs in the browser.
vi.mock('../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({
    calories: 780,
    proteinG: 44,
    carbsG: 68,
    fatG: 30,
    items: [
      { name: 'Milanesa de pollo napolitana con jamón y queso', calories: 420, proteinG: 35, carbsG: 22, fatG: 18 },
      { name: 'Puré de papas', calories: 240, proteinG: 5, carbsG: 38, fatG: 8 },
      { name: 'Ensalada mixta', calories: 120, proteinG: 4, carbsG: 8, fatG: 4 },
    ],
  }),
}));

import Today from '@modules/nutrition/components/Today';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import NutritionCharts from '@modules/nutrition/components/NutritionCharts';
import NutritionOnboarding from '@modules/nutrition/components/NutritionOnboarding';
import NutritionDashboardWidget from '@modules/nutrition/components/NutritionDashboardWidget';

const SCREENS = 'screens';
const WIDE = { w: 1640, h: 900, sidebar: 260 };
const NARROW = { w: 760, h: 640, sidebar: 220 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LONG_DESC =
  'Milanesa napolitana de ternera con jamón crudo, muzzarella, salsa de tomate casera, ' +
  'papas fritas a la provenzal y ensalada mixta de lechuga, tomate, cebolla y zanahoria rallada';

const PROFILE = {
  age: 31, sex: 'M' as const, heightCm: 178, initialWeightKg: 80,
  activityLevel: 'moderate' as const, deficitTargetKcal: 400,
  dateOfBirth: '1995-03-12', weightCheckDay: 1, weightPopupEnabled: 1,
  mealSchedule: null, dayCutoffHour: 4,
  proteinTargetG: null, carbsTargetG: null, fatTargetG: null,
};

const MACRO_TARGETS = { proteinG: 150, carbsG: 220, fatG: 60, auto: true };

/** Un día muy por encima del objetivo: 187 % de calorías, macros desbordados. */
const SUMMARY_OVER = {
  date: '2026-06-26', totalCaloriesIn: 3740, bmr: 1760, tdee: 2400,
  balance: -1740, activityLevel: 'moderate',
  proteinG: 232, carbsG: 431, fatG: 158,
};

const SUMMARY_EMPTY = {
  date: '2026-06-26', totalCaloriesIn: 0, bmr: 1760, tdee: 2400,
  balance: 2000, activityLevel: 'moderate', proteinG: 0, carbsG: 0, fatG: 0,
};

const MEALS = ['breakfast', 'lunch', 'lunch', 'merienda', 'dinner', 'snack'];
/** 15 comidas: el día pesado que el dueño realmente carga un domingo. */
const FOODS_MANY = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  date: '2026-06-26',
  time: `${String(7 + i).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
  description: i === 3 ? LONG_DESC : `Comida número ${i + 1} del día`,
  calories: 120 + i * 37,
  source: i % 3 === 0 ? 'ai_estimate' : i % 3 === 1 ? 'manual' : 'favorite',
  frequentFoodId: null,
  aiBreakdown: i === 0
    ? JSON.stringify([
        { name: 'Avena', calories: 180 },
        { name: 'Frutas', calories: 90 },
        { name: 'Miel', calories: 80 },
      ])
    : null,
  meal: MEALS[i % MEALS.length],
  proteinG: i % 2 === 0 ? 12 + i : null,
}));

/** El asado: una entrada con banda, más un par de comidas normales. */
const FOODS_EVENT = [
  { id: 1, date: '2026-06-26', time: '09:10', description: 'Café con leche y tostadas', calories: 320, source: 'manual', frequentFoodId: null, aiBreakdown: null, meal: 'breakfast', proteinG: 11 },
  { id: 2, date: '2026-06-26', time: '13:40', description: 'Asado en lo de la abuela con chorizo, morcilla, vacío y ensaladas', calories: 1400, source: 'manual', frequentFoodId: null, aiBreakdown: null, meal: 'lunch', proteinG: null, isEvent: 1, eventKcalMin: 1200, eventKcalMax: 1600 },
  { id: 3, date: '2026-06-26', time: '21:30', description: 'Yogur', calories: 140, source: 'favorite', frequentFoodId: null, aiBreakdown: null, meal: 'dinner', proteinG: 9 },
];

const FREQUENT = [
  { id: 1, name: 'Café con leche', calories: 120, timesUsed: 22, proteinG: 6, carbsG: 12, fatG: 5 },
  { id: 2, name: 'Yogur con granola y frutos rojos del bosque', calories: 260, timesUsed: 14, proteinG: 12, carbsG: 34, fatG: 8 },
  { id: 3, name: 'Banana', calories: 95, timesUsed: 9, proteinG: 1, carbsG: 24, fatG: 0 },
  { id: 4, name: 'Sandwich de milanesa completo', calories: 720, timesUsed: 7, proteinG: 38, carbsG: 62, fatG: 28 },
];

const FAVORITES = [
  { id: 'fav1', description: 'Milanesa napolitana con papas fritas y ensalada', calories: 980, source: 'ai_estimate', proteinG: 48, carbsG: 40, fatG: 32, createdAt: '2026-06-01' },
  { id: 'fav2', description: 'Bowl de pollo y arroz', calories: 540, source: 'ai_estimate', proteinG: 42, carbsG: 60, fatG: 12, createdAt: '2026-06-05' },
  { id: 'fav3', description: 'Tostadas con palta', calories: 310, source: 'manual', proteinG: 8, carbsG: 30, fatG: 18, createdAt: '2026-06-07' },
];

const RECENT_DAYS = [
  { date: '2026-06-25', meals: 4, calories: 1980 },
  { date: '2026-06-24', meals: 3, calories: 1740 },
  { date: '2026-06-22', meals: 5, calories: 2230 },
  { date: '2026-06-21', meals: 6, calories: 2610 },
];

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const WEIGHTS = [
  { date: daysAgo(24), weightKg: 82.5 },
  { date: daysAgo(18), weightKg: 81.6 },
  { date: daysAgo(11), weightKg: 82.1 },
  { date: daysAgo(4), weightKg: 80.9 },
  { date: daysAgo(1), weightKg: 80.4 },
];

const SUMMARY_RANGE = Array.from({ length: 26 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (25 - i));
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    date,
    totalCaloriesIn: 1700 + (i % 5) * 260,
    bmr: 1760, tdee: 2400, balance: 0,
    proteinG: 110 + (i % 3) * 18,
    carbsG: 210 + (i % 4) * 25,
    fatG: 55 + (i % 3) * 9,
  };
});

const CLOSED = {
  xpPrecision: 30, xpSteps: 10, xpGym: 15, xpWeight: 5,
  xpBonus: 8, xpTotal: 68, hpChange: 5, consumed: 1980, target: 2000,
};

const HISTORY = [
  { description: 'Milanesa con puré', calories: 720, source: 'history', timesLogged: 12, proteinG: 40 },
  { description: 'Milanesa napolitana con papas fritas y ensalada mixta enorme', calories: 980, source: 'favorite', timesLogged: 5, proteinG: 48 },
  { description: 'Milanga al horno', calories: 520, source: 'history', timesLogged: 3, proteinG: 36 },
];

// ── window.api: Proxy permisivo + overrides ──────────────────────────────────

type ApiOverrides = Record<string, unknown>;

function installApi(over: ApiOverrides = {}) {
  const base: ApiOverrides = {
    nutritionGetFoodByDate: async () => FOODS_MANY,
    nutritionGetSummary: async () => SUMMARY_OVER,
    nutritionGetDailyMetrics: async () => ({ date: '2026-06-26', steps: 6200, gym: true }),
    nutritionGetFrequentFoods: async () => FREQUENT,
    nutritionGetProfile: async () => PROFILE,
    nutritionGetTodayTarget: async () => 2000,
    nutritionIsDayClosed: async () => null,
    nutritionGetFavoriteFoods: async () => FAVORITES,
    nutritionGetMealSchedule: async () => null,
    nutritionGetMacroTargets: async () => MACRO_TARGETS,
    nutritionGetPendingDays: async () => [],
    nutritionShouldAskWeight: async () => ({ shouldAsk: false }),
    nutritionGetRecentLoggedDays: async () => RECENT_DAYS,
    nutritionGetWeights: async () => WEIGHTS,
    nutritionGetSummaryRange: async () => SUMMARY_RANGE,
    nutritionGetStreak: async () => ({ streak: 9, todayPending: true }),
    nutritionGetEventDays: async () => [],
    nutritionSearchHistory: async () => HISTORY,
    nutritionGetCachedEstimate: async () => null,
    nutritionCacheEstimate: async () => ({ cached: true }),
    nutritionGetAdaptiveTdee: async () => ({
      tdee: 2280, confidence: 'high', windowDays: 28, sampleDays: 25,
      weightSamples: 4, intakeAvg: 2000, deltaKg: -1,
    }),
    nutritionRepeatDay: async () => ({ copied: 3 }),
    nutritionCloseDay: async () => ({ success: false, alreadyClosed: false }),
    nutritionGetTodayCalories: async () => 1650,
    nutritionGetWeekCalories: async () => [1800, 2100, 1600, 2400, 1900, 2000, 1650],
    ...over,
  };
  (window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (t, prop: string) => {
      if (prop in t) return (t as Record<string, unknown>)[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
}

function Providers({ children, sidebar }: { children: React.ReactNode; sidebar: number }) {
  return (
    <MemoryRouter>
      <ConfirmProvider>
        <ToastProvider>
          {/* Reproduce el hueco del sidebar fijo: el ancho real que recibe la
              página es viewport - sidebar, que es donde viven los males de ancho. */}
          <div
            id="audit-content"
            style={{ marginLeft: sidebar, minHeight: '100vh', background: 'var(--parch-0)' }}
          >
            {children}
          </div>
        </ToastProvider>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

// ── Medidas ──────────────────────────────────────────────────────────────────

/** Desborde horizontal del documento entero. Cero o negativo = sano. */
function docOverflowX(): number {
  return document.documentElement.scrollWidth - document.documentElement.clientWidth;
}

/** Elementos cuyo contenido no entra a lo ancho (texto cortado sin ellipsis). */
function clippedElements(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll<HTMLElement>('[class*="nutri-"]').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return;
    if (style.textOverflow === 'ellipsis') return;
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 1) return;
    // `.help-bubble-inline::after` es un blanco de toque INVISIBLE de 32x32
    // sobre un sello de 18: sobresale 7 px por lado y ensancha el scrollWidth
    // de cualquier caja que lo contenga sin que se vea nada. No es recorte.
    if (over <= 8 && el.querySelector('.help-bubble-inline')) return;
    out.push(`${el.className} (${el.scrollWidth} > ${el.clientWidth}) «${(el.textContent || '').slice(0, 40)}»`);
  });
  return out;
}

/** Ancho útil real de un input: ancho de caja menos su padding horizontal. */
function usableInputWidth(el: HTMLElement): number {
  const s = getComputedStyle(el);
  return el.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
}

/**
 * Dispersión horizontal de una columna del registro: la distancia entre el
 * borde derecho más a la izquierda y el más a la derecha. Cero = alineada.
 */
function columnSpread(selector: string): number {
  const cells = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (cells.length < 2) return 0;
  const rights = cells.map((c) => Math.round(c.getBoundingClientRect().right));
  return Math.max(...rights) - Math.min(...rights);
}

/**
 * Sellos de ayuda (`position: absolute`) que se pisan entre sí o se montan
 * sobre otro control: el tooltip de abajo queda inalcanzable.
 */
function overlappingHelpBubbles(): string[] {
  const bubbles = Array.from(document.querySelectorAll<HTMLElement>('.help-bubble'));
  const out: string[] = [];
  bubbles.forEach((b, i) => {
    const rb = b.getBoundingClientRect();
    bubbles.slice(i + 1).forEach((o) => {
      const ro = o.getBoundingClientRect();
      if (rb.left < ro.right && ro.left < rb.right && rb.top < ro.bottom && ro.top < rb.bottom) {
        out.push(`dos sellos superpuestos en ${Math.round(rb.left)},${Math.round(rb.top)}`);
      }
    });
    // ¿Cae encima del contenido de otra tarjeta?
    document.querySelectorAll<HTMLElement>('.nutri-kpi-body, .nutri-cal-val').forEach((c) => {
      const rc = c.getBoundingClientRect();
      if (rb.left < rc.right && rc.left < rb.right && rb.top < rc.bottom && rc.top < rb.bottom) {
        out.push(`sello sobre ${c.className}`);
      }
    });
  });
  return out;
}

/** Botones sin nombre accesible: ni texto, ni aria-label, ni title. */
function unlabelledControls(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll<HTMLElement>('button, [role="button"], [role="checkbox"]').forEach((el) => {
    const text = (el.textContent || '').trim();
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!text && !label) out.push(el.className || el.tagName);
  });
  return out;
}

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
});

/** Foto del ELEMENTO, no del viewport: se lee a resolución real. */
async function shotAt(selector: string, path: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`no encontré ${selector}`);
  el.scrollIntoView({ block: 'center' });
  await sleep(200);
  await page.elementLocator(el).screenshot({ path });
}

beforeEach(() => {
  document.documentElement.scrollTop = 0;
  localStorage.setItem('hubtify_weight_dismiss_date', '2026-06-26');
  installApi();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Auditoría visual Nutrify — Today', () => {
  test('01 — día pesado (15 comidas, macros desbordados) a 1640×900', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Macros', { exact: true })).toBeVisible();
    await sleep(700);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-01-today-1640.png` });
    await shotAt('.nutri-hero-card', `${SCREENS}/audit-nutri-01a-hero.png`);
    await shotAt('.nutri-frequent-pills', `${SCREENS}/audit-nutri-01d-favoritos.png`);
    await shotAt('[data-tour="nutrition-log"]', `${SCREENS}/audit-nutri-01b-today-1640-log.png`);
    await shotAt('.nutri-close-day', `${SCREENS}/audit-nutri-01c-today-1640-cierre.png`);
    expect(columnSpread('.nutri-meal-kcal')).toBeLessThanOrEqual(1);
    expect(columnSpread('.nutri-meal-time')).toBeLessThanOrEqual(1);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);

    // Ningún texto informativo de la fila de comida baja del piso de 13 px, y
    // la hora lleva tinta (--ink-soft), no opacidad ni --ink-faded.
    const rows = [...document.querySelectorAll('.nutri-meal-row')];
    expect(rows.length).toBeGreaterThan(0);
    const small = rows.flatMap((r) => smallText(r));
    expect(small, `texto chico: ${small.map((s) => `${s.sel} «${s.text}» ${s.px}px`).join(', ')}`).toEqual([]);
    const body = tokenPx('--fs-body');
    expect(body).toBeGreaterThan(13);
    expect(parseFloat(getComputedStyle(document.querySelector('.nutri-meal-kcal')!).fontSize)).toBeGreaterThanOrEqual(body - 0.01);
    expect(getComputedStyle(document.querySelector('.nutri-meal-time')!).color).toBe('rgb(74, 53, 32)');
  });

  test('02 — mismo día a 760×640 (mínimo de la app)', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Macros', { exact: true })).toBeVisible();
    await sleep(700);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-02-today-760.png` });
    await shotAt('[data-tour="nutrition-log"]', `${SCREENS}/audit-nutri-02b-today-760-log.png`);
    expect(columnSpread('.nutri-meal-kcal')).toBeLessThanOrEqual(1);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);
  });

  test('03 — día vacío: el estado sin comidas a 1640', async () => {
    installApi({
      nutritionGetFoodByDate: async () => [],
      nutritionGetSummary: async () => SUMMARY_EMPTY,
      nutritionGetFavoriteFoods: async () => [],
      nutritionGetFrequentFoods: async () => [],
    });
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText(/No hay comidas registradas/)).toBeVisible();
    await sleep(500);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-03-today-vacio.png` });
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });

  test('04 — día con evento (el asado): banda + tono del estado', async () => {
    installApi({ nutritionGetFoodByDate: async () => FOODS_EVENT });
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Evento').first()).toBeVisible();
    await sleep(600);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-04-today-evento.png` });
    await shotAt('[data-tour="nutrition-log"]', `${SCREENS}/audit-nutri-04b-evento-log.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);
  });

  test('05 — día cerrado: banner, recompensa y reapertura', async () => {
    installApi({ nutritionIsDayClosed: async () => CLOSED });
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText(/Este día está cerrado/)).toBeVisible();
    await sleep(600);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-05-today-cerrado.png` });
    await shotAt('.nutri-close-day', `${SCREENS}/audit-nutri-05b-cerrado-recompensa.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);
  });

  test('06 — día cerrado a 760: la grilla de recompensa no se parte', async () => {
    installApi({ nutritionIsDayClosed: async () => CLOSED });
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText(/Este día está cerrado/)).toBeVisible();
    await sleep(600);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-06-cerrado-760.png` });
    await shotAt('.nutri-close-day', `${SCREENS}/audit-nutri-06b-cerrado-760-recompensa.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });
});

describe('Auditoría visual Nutrify — controles del registro', () => {
  test('07 — menú de acciones ABIERTO', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registro de Comidas')).toBeVisible();
    await page.getByRole('button', { name: 'Acciones del registro' }).click();
    await expect.element(page.getByRole('menuitem', { name: 'Repetir día' })).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-07-menu-acciones.png` });
    const menu = document.querySelector('.nutri-card-menu-list') as HTMLElement;
    const r = menu.getBoundingClientRect();
    // El menú tiene que caber dentro de la ventana, no colgar del borde.
    expect(r.right).toBeLessThanOrEqual(window.innerWidth);
    expect(r.left).toBeGreaterThanOrEqual(0);
  });

  test('08 — selector de repetir día ABIERTO', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registro de Comidas')).toBeVisible();
    await page.getByRole('button', { name: 'Acciones del registro' }).click();
    await page.getByRole('menuitem', { name: 'Repetir día' }).click();
    await expect.element(page.getByText('Repetir el festín de…')).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-08-repetir-dia.png` });
    expect(clippedElements(document.querySelector('.nutri-popup')!)).toEqual([]);
  });

  test('09 — selector de porción ABIERTO (frecuente)', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Comidas Frecuentes')).toBeVisible();
    await page.getByRole('button', { name: 'Ajustar porción' }).first().click();
    await expect.element(page.getByText('Ajustar porción', { exact: true })).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-09-porcion.png` });
    const input = document.querySelector('.nutri-popup .rpg-number-input') as HTMLElement;
    // El campo de porciones tiene 52 px de padding reservado para las flechas:
    // lo que sobra para el número tiene que ser positivo y legible.
    expect(usableInputWidth(input)).toBeGreaterThan(40);
  });

  test('10 — formulario de evento ABIERTO', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByRole('button', { name: /Evento/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Registrar evento' })).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-10-evento-form.png` });
    const popup = document.querySelector('.nutri-popup') as HTMLElement;
    // El popup entra de alto sin cortar el botón de registrar.
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(unlabelledControls(popup)).toEqual([]);
  });

  test('11 — formulario de evento a 760×640 (el popup más alto)', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByRole('button', { name: /Evento/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Registrar evento' })).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-11-evento-760.png` });
    const popup = document.querySelector('.nutri-popup') as HTMLElement;
    const r = popup.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(-1);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  // Un solo cierre de día: este footer abría un segundo ritual que pagaba XP
  // por su cuenta y no se anunciaba en ningún lado. Ahora abre el Códice —que
  // vive en Layout, no acá— con la fecha del día que se está mirando.
  test('12 — cerrar el día abre el Códice, no un segundo ritual', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registro de Comidas')).toBeVisible();

    const opened: Array<string | undefined> = [];
    const spy = (e: Event) => opened.push((e as CustomEvent<{ date?: string }>).detail?.date);
    window.addEventListener('codex:open', spy);
    try {
      await page.getByRole('button', { name: /Cerrar el día en el Códice/i }).click();
      await sleep(200);
      await page.screenshot({ path: `${SCREENS}/audit-nutri-12-cerrar-dia-760.png` });
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Y ya no queda ningún popup propio de cierre en la página.
      expect(document.querySelector('.nutri-popup')).toBeNull();
    } finally {
      window.removeEventListener('codex:open', spy);
    }
  });

  test('13 — desplegable de sugerencias ABIERTO sobre el input', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByPlaceholder('¿Qué comiste? ej: milanesa con papas fritas').click();
    await expect.element(page.getByText('Tus de siempre')).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-13-sugerencias.png` });
    const pop = document.querySelector('.nutri-suggest-popup') as HTMLElement;
    const anchor = document.querySelector('.nutri-food-input-row') as HTMLElement;
    // La lista se alinea con la fila del input: mismo left, mismo ancho.
    expect(Math.abs(pop.getBoundingClientRect().left - anchor.getBoundingClientRect().left)).toBeLessThan(2);
    expect(Math.abs(pop.getBoundingClientRect().width - anchor.getBoundingClientRect().width)).toBeLessThan(2);
    expect(pop.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });

  test('14 — desglose de IA editable con un ingrediente larguísimo', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByPlaceholder('¿Qué comiste? ej: milanesa con papas fritas').fill(LONG_DESC);
    await page.getByRole('button', { name: 'Estimar' }).click();
    await expect.element(page.getByText(/Ajustá las calorías de cada ingrediente/)).toBeVisible();
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-14-desglose.png` });
    const breakdown = document.querySelector('.nutri-est-breakdown') as HTMLElement;
    expect(clippedElements(breakdown)).toEqual([]);
    expect(unlabelledControls(breakdown)).toEqual([]);
  });

  test('15 — desglose de IA a 760: el input de kcal sigue siendo usable', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByPlaceholder('¿Qué comiste? ej: milanesa con papas fritas').fill(LONG_DESC);
    await page.getByRole('button', { name: 'Estimar' }).click();
    await expect.element(page.getByText(/Ajustá las calorías de cada ingrediente/)).toBeVisible();
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-15-desglose-760.png` });
    const cal = document.querySelector('.nutri-est-cal-input') as HTMLElement;
    expect(usableInputWidth(cal)).toBeGreaterThan(28);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });

  test('16 — modo manual: los tres campos entran en una fila a 760', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><Today /></Providers>);
    await expect.element(page.getByText('Registrar Comida')).toBeVisible();
    await page.getByRole('button', { name: 'Manual' }).click();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-16-manual-760.png` });
    const row = document.querySelector('.nutri-manual-inputs') as HTMLElement;
    expect(row.scrollWidth - row.clientWidth).toBeLessThanOrEqual(1);
    const nums = Array.from(row.querySelectorAll<HTMLElement>('.rpg-number-input'));
    nums.forEach((n) => expect(usableInputWidth(n)).toBeGreaterThan(30));
  });
});

describe('Auditoría visual Nutrify — Crónica (charts)', () => {
  test('17 — crónica completa a 1640×900', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><NutritionCharts /></Providers>);
    await expect.element(page.getByText('Balance de Nutrientes')).toBeVisible();
    await sleep(600);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-17-charts-1640.png` });
    await shotAt('.nutri-charts-grid', `${SCREENS}/audit-nutri-17b-charts-grid.png`);
    await shotAt('.castle-chart', `${SCREENS}/audit-nutri-17e-castle.png`);
    await shotAt('.nutri-charts-grid + .nutri-card', `${SCREENS}/audit-nutri-17c-charts-heatmap.png`);
    await shotAt('.nutri-charts-grid + .nutri-card + .nutri-card', `${SCREENS}/audit-nutri-17d-charts-macros.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    // Los gráficos no pueden crecer con el ancho: un SVG de viewBox fijo con
    // width:100% se estira a un alto absurdo en ventana maximizada.
    document.querySelectorAll<SVGElement>('.nutri-chart-card svg').forEach((svg) => {
      expect(svg.getBoundingClientRect().height).toBeLessThan(420);
    });
    expect(overlappingHelpBubbles()).toEqual([]);
  });

  test('18 — crónica a 760×640', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><NutritionCharts /></Providers>);
    await expect.element(page.getByText('Balance de Nutrientes')).toBeVisible();
    await sleep(600);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-18-charts-760.png` });
    await shotAt('.nutri-charts-grid', `${SCREENS}/audit-nutri-18b-charts-760-grid.png`);
    await shotAt('.nutri-charts-grid + .nutri-card + .nutri-card', `${SCREENS}/audit-nutri-18c-charts-760-macros.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });

  test('19 — crónica sin datos', async () => {
    installApi({ nutritionGetSummaryRange: async () => [], nutritionGetWeights: async () => [] });
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><NutritionCharts /></Providers>);
    await expect.element(page.getByText(/Logueá tu primer día/)).toBeVisible();
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-19-charts-vacio.png` });
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });

  test('20 — crónica con error de carga: el mensaje dice qué hacer', async () => {
    installApi({ nutritionGetSummaryRange: async () => { throw new Error('boom'); } });
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><NutritionCharts /></Providers>);
    await expect.element(page.getByText(/Algo salió mal|Something went wrong/)).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-20-charts-error.png` });
  });
});

describe('Auditoría visual Nutrify — Configuración', () => {
  test('21 — settings completo a 1640×900', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><NutritionSettings /></Providers>);
    await expect.element(page.getByText('Objetivos de macros')).toBeVisible();
    await sleep(400);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-21-settings-1640.png` });
    await shotAt('.nutri-macro-targets-foot', `${SCREENS}/audit-nutri-21b-settings-macros.png`);
    await shotAt('.nutri-meal-schedule', `${SCREENS}/audit-nutri-21c-settings-horarios.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);
  });

  test('22 — settings a 760×640', async () => {
    await page.viewport(NARROW.w, NARROW.h);
    render(<Providers sidebar={NARROW.sidebar}><NutritionSettings /></Providers>);
    await expect.element(page.getByText('Objetivos de macros')).toBeVisible();
    await sleep(400);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-22-settings-760.png` });
    await shotAt('.nutri-adaptive-insight', `${SCREENS}/audit-nutri-22b-settings-760-adaptive.png`);
    await shotAt('.nutri-meal-schedule', `${SCREENS}/audit-nutri-22c-settings-760-horarios.png`);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(clippedElements()).toEqual([]);
  });

  test('23 — settings: todos los controles tienen nombre accesible', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(<Providers sidebar={WIDE.sidebar}><NutritionSettings /></Providers>);
    await expect.element(page.getByText('Objetivos de macros')).toBeVisible();
    await sleep(300);
    const page_ = document.querySelector('.nutri-page') as HTMLElement;
    expect(unlabelledControls(page_)).toEqual([]);
  });
});

describe('Auditoría visual Nutrify — Onboarding y widget', () => {
  test('24 — onboarding paso 1 a 1640 y a 760', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(
      <Providers sidebar={WIDE.sidebar}>
        <NutritionOnboarding onComplete={() => {}} onSkip={() => {}} />
      </Providers>,
    );
    await expect.element(page.getByText(/Fecha de nacimiento/)).toBeVisible();
    await sleep(200);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-24-onboarding-1640.png` });
    await page.viewport(NARROW.w, NARROW.h);
    await sleep(150);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-25-onboarding-760.png` });
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });

  test('26 — widget del dashboard en una tarjeta angosta (340px)', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <ToastProvider>
            <div className="rpg-card" style={{ width: 340, margin: 20 }}>
              <NutritionDashboardWidget />
            </div>
          </ToastProvider>
        </ConfirmProvider>
      </MemoryRouter>,
    );
    await expect.element(page.getByText(/del objetivo diario/)).toBeVisible();
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-26-widget-angosto.png` });
    const card = document.querySelector('.rpg-card') as HTMLElement;
    expect(card.scrollWidth - card.clientWidth).toBeLessThanOrEqual(1);
  });

  test('27 — widget del dashboard en una tarjeta ancha (800px)', async () => {
    await page.viewport(WIDE.w, WIDE.h);
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <ToastProvider>
            <div className="rpg-card" style={{ width: 800, margin: 20 }}>
              <NutritionDashboardWidget />
            </div>
          </ToastProvider>
        </ConfirmProvider>
      </MemoryRouter>,
    );
    await expect.element(page.getByText(/del objetivo diario/)).toBeVisible();
    await sleep(300);
    await page.screenshot({ path: `${SCREENS}/audit-nutri-27-widget-ancho.png` });
  });
});
