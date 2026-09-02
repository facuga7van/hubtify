/**
 * Fase 3 — Proteína, y solo proteína.
 *
 * El dato tiene que atravesar el circuito completo sin perderse:
 * estimación → cache → log → sugerencias, y el objetivo diario tiene que caer
 * en peso × 1.6 g/kg cuando el usuario no fijó uno propio.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import type { HistorySuggestion } from '@modules/nutrition/history-search';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerNutritionIpcHandlers } =
  await import('../../../electron/modules/nutrition.ipc');
registerNutritionIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const TODAY = '2026-08-31';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, day_cutoff_hour)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, '1996-01-01', 0)
  `).run();
  return db;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
  harness.db = setupDb();
});

afterEach(() => { vi.useRealTimers(); });

describe('proteína a través del log', () => {
  it('logFood guarda protein_g y getFoodByDate lo devuelve con alias camelCase', async () => {
    await invoke('nutrition:logFood', {
      date: TODAY, description: 'milanesa con puré', calories: 900,
      source: 'ai_estimate', proteinG: 32.5,
    });

    const foods = await invoke<Array<{ proteinG: number | null }>>('nutrition:getFoodByDate', TODAY);
    expect(foods[0].proteinG).toBe(32.5);
  });

  it('sin dato queda NULL, nunca 0 implícito', async () => {
    await invoke('nutrition:logFood', { date: TODAY, description: 'café', calories: 80, source: 'manual' });
    const foods = await invoke<Array<{ proteinG: number | null }>>('nutrition:getFoodByDate', TODAY);
    expect(foods[0].proteinG).toBeNull();
  });

  it('updateFood puede corregir la proteína de una entrada', async () => {
    await invoke('nutrition:logFood', { date: TODAY, description: 'pollo', calories: 400, source: 'manual', proteinG: 20 });
    const foods = await invoke<Array<{ id: number }>>('nutrition:getFoodByDate', TODAY);
    await invoke('nutrition:updateFood', foods[0].id, { proteinG: 45 });
    const updated = await invoke<Array<{ proteinG: number | null }>>('nutrition:getFoodByDate', TODAY);
    expect(updated[0].proteinG).toBe(45);
  });
});

describe('proteína a través del cache de estimaciones', () => {
  it('cacheEstimate la guarda y getCachedEstimate la devuelve', async () => {
    await invoke('nutrition:cacheEstimate', {
      description: 'Milanesa con Puré', calories: 900,
      aiBreakdown: JSON.stringify([{ name: 'milanesa', calories: 500 }, { name: 'puré', calories: 400 }]),
      proteinG: 41,
    });

    const hit = await invoke<{ calories: number; proteinG: number | null }>('nutrition:getCachedEstimate', 'milanesa con pure');
    expect(hit).not.toBeNull();
    expect(hit.proteinG).toBe(41);
  });

  it('una corrección de calorías NO borra la proteína conocida (COALESCE)', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'guiso', calories: 980, proteinG: 38 });
    // El humano corrige el total; la proteína no fue discutida y sobrevive.
    await invoke('nutrition:cacheEstimate', { description: 'guiso', calories: 700, corrected: true, proteinG: null });

    const hit = await invoke<{ calories: number; proteinG: number | null }>('nutrition:getCachedEstimate', 'guiso');
    expect(hit.calories).toBe(700);
    expect(hit.proteinG).toBe(38);
  });

  it('searchHistory arrastra la proteína del cache a la sugerencia', async () => {
    await invoke('nutrition:logFood', { date: TODAY, description: 'milanesa con puré', calories: 900, source: 'ai_estimate' });
    await invoke('nutrition:cacheEstimate', { description: 'milanesa con puré', calories: 900, proteinG: 41 });

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'milanesa');
    expect(out).toHaveLength(1);
    expect(out[0].proteinG).toBe(41);
  });
});

describe('objetivo diario de proteína', () => {
  /* El objetivo dejó de ser «peso × 1,6» con helper propio: ahora lo deriva
     `nutrition:getMacroTargets` junto con carbohidratos y grasas, con g/kg según
     el objetivo (déficit 2,2 · mantenimiento 2,0 · superávit 1,8). Lo que sigue
     importando es lo mismo: sin objetivo fijado, la app propone uno solo, y usa
     el peso más reciente. */
  it('sin objetivo fijado propone uno automático a partir del peso', async () => {
    const t = await invoke<{ proteinG: number; auto: boolean }>('nutrition:getMacroTargets');
    expect(t.auto).toBe(true);
    expect(t.proteinG).toBeGreaterThan(0);
  });

  it('usa el peso más reciente cuando existe', async () => {
    const before = await invoke<{ proteinG: number }>('nutrition:getMacroTargets');
    await invoke('nutrition:saveWeeklyMetrics', { date: '2026-08-24', weightKg: 90 });
    const after = await invoke<{ proteinG: number }>('nutrition:getMacroTargets');
    expect(after.proteinG).toBeGreaterThan(before.proteinG);
  });

  it('un objetivo fijado a mano gana sobre el automático', async () => {
    // Escrito directo: saveProfile exige el perfil completo (fecha de nacimiento
    // incluida) y acá lo único bajo prueba es la precedencia del objetivo fijado.
    harness.db.prepare(
      'UPDATE nutrition_profile SET protein_target_g = 150, carbs_target_g = 200, fat_target_g = 60 WHERE id = 1',
    ).run();
    const t = await invoke<{ proteinG: number; auto: boolean }>('nutrition:getMacroTargets');
    expect(t.auto).toBe(false);
    expect(t.proteinG).toBe(150);
  });
});

describe('resolveEstimate (renderer) no descarta la proteína', () => {
  it('cache hit y respuesta de IA la pasan intactas; ausencia = null', async () => {
    vi.resetModules();
    const getCachedEstimate = vi.fn();
    const estimateNutrition = vi.fn();
    vi.doMock('../../../src/modules/nutrition/history-api', () => ({ getCachedEstimate }));
    vi.doMock('../../../src/modules/nutrition/estimate-service', () => ({ estimateNutrition }));
    const { resolveEstimate } = await import('../../../src/modules/nutrition/estimate-with-cache');

    getCachedEstimate.mockResolvedValueOnce({ calories: 900, aiBreakdown: null, proteinG: 41, hits: 2 });
    expect(await resolveEstimate('milanesa con puré')).toMatchObject({ origin: 'cache', totalCalories: 900, proteinG: 41 });

    getCachedEstimate.mockResolvedValueOnce(null);
    estimateNutrition.mockResolvedValueOnce({ calories: 780, proteinG: 35, items: [] });
    expect(await resolveEstimate('guiso de lentejas')).toMatchObject({ origin: 'ai', totalCalories: 780, proteinG: 35 });

    // Cloud Function vieja (sin proteína): degrada a null, no a undefined ni 0.
    getCachedEstimate.mockResolvedValueOnce(null);
    estimateNutrition.mockResolvedValueOnce({ calories: 500, items: [] });
    expect((await resolveEstimate('tostado')).proteinG).toBeNull();

    vi.doUnmock('../../../src/modules/nutrition/history-api');
    vi.doUnmock('../../../src/modules/nutrition/estimate-service');
  });
});
