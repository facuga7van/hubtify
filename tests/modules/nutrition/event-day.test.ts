/**
 * Fase 3 — Modo evento (el asado del domingo).
 *
 * La regla de oro bajo test: la racha mide PRESENTARSE. Registrar el evento ES
 * presentarse, así que (a) un día con evento nunca DESCUENTA vigor por pasarse
 * del objetivo, (b) la racha avanza sin quemar el día de gracia semanal, y
 * (c) el evento queda como UNA sola entrada con su banda honesta.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

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

const { registerNutritionIpcHandlers } = await import('../../../shared-logic/modules/nutrition.ipc');
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

function daysAgo(n: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** El objetivo del día tal como lo calcula closeDay: tdee del summary - déficit. */
function targetFor(date: string): number {
  const row = harness.db.prepare('SELECT tdee FROM nutrition_daily_summary WHERE date = ?').get(date) as { tdee: number };
  return row.tdee - 500;
}

async function logMeal(date: string, calories: number, extra: Record<string, unknown> = {}) {
  await invoke('nutrition:logFood', { date, description: 'comida', calories, source: 'manual', ...extra });
}

async function logEvent(date: string, opts: { min?: number; max?: number; calories?: number; name?: string } = {}) {
  const min = opts.min ?? 1200;
  const max = opts.max ?? 1600;
  await invoke('nutrition:logFood', {
    date,
    description: opts.name ?? 'Asado familiar',
    calories: opts.calories ?? Math.round((min + max) / 2),
    source: 'manual',
    isEvent: true,
    eventKcalMin: min,
    eventKcalMax: max,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
  harness.db = setupDb();
});

afterEach(() => { vi.useRealTimers(); });

describe('migración v13', () => {
  it('agrega is_event, event_kcal_min/max y protein_g a food_log, y protein_target_g al perfil', () => {
    const foodCols = (harness.db.prepare('PRAGMA table_info(food_log)').all() as Array<{ name: string }>).map(c => c.name);
    expect(foodCols).toEqual(expect.arrayContaining(['is_event', 'event_kcal_min', 'event_kcal_max', 'protein_g']));
    const profCols = (harness.db.prepare('PRAGMA table_info(nutrition_profile)').all() as Array<{ name: string }>).map(c => c.name);
    expect(profCols).toContain('protein_target_g');
  });
});

describe('nutrition:logFood con evento', () => {
  it('guarda UNA entrada marcada con banda y punto medio', async () => {
    await logEvent(TODAY, { min: 1200, max: 1600 });

    const foods = await invoke<Array<Record<string, unknown>>>('nutrition:getFoodByDate', TODAY);
    expect(foods).toHaveLength(1);
    expect(foods[0].isEvent).toBe(1);
    expect(foods[0].eventKcalMin).toBe(1200);
    expect(foods[0].eventKcalMax).toBe(1600);
    expect(foods[0].calories).toBe(1400);
  });

  it('rechaza una banda incoherente (max < min)', async () => {
    await expect(logEvent(TODAY, { min: 1600, max: 1200 })).rejects.toThrow(/event band/i);
  });

  it('una comida normal queda con is_event = 0', async () => {
    await logMeal(TODAY, 500);
    const foods = await invoke<Array<Record<string, unknown>>>('nutrition:getFoodByDate', TODAY);
    expect(foods[0].isEvent).toBe(0);
    expect(foods[0].eventKcalMin).toBeNull();
  });
});

describe('nutrition:closeDay — día con evento: neutro-o-cura, jamás daño', () => {
  it('surplus enorme SIN evento descuenta HP (control)', async () => {
    await logMeal(TODAY, 5000);
    const res = await invoke<{ success: boolean; breakdown: { hpChange: number; eventDay: boolean } }>('nutrition:closeDay', TODAY);
    expect(res.success).toBe(true);
    expect(res.breakdown.hpChange).toBeLessThan(0);
    expect(res.breakdown.eventDay).toBe(false);
  });

  it('el mismo surplus CON evento deja el HP en 0, nunca negativo', async () => {
    await logEvent(TODAY, { min: 4800, max: 5200, calories: 5000 });
    const res = await invoke<{ success: boolean; breakdown: { hpChange: number; xpPrecision: number; eventDay: boolean } }>('nutrition:closeDay', TODAY);
    expect(res.success).toBe(true);
    expect(res.breakdown.hpChange).toBe(0);
    expect(res.breakdown.eventDay).toBe(true);
    // El XP de precisión sigue midiendo precisión: no se infla por el evento.
    expect(res.breakdown.xpPrecision).toBeGreaterThan(0);
  });

  it('un día con evento que igual cumple el objetivo cobra la curación completa', async () => {
    await logEvent(TODAY, { min: 1000, max: 1400, calories: 1200 });
    expect(1200).toBeLessThanOrEqual(targetFor(TODAY));
    const res = await invoke<{ breakdown: { hpChange: number } }>('nutrition:closeDay', TODAY);
    expect(res.breakdown.hpChange).toBe(10);
  });
});

describe('nutrition:getStreak — registrar el evento ES presentarse', () => {
  it('el día-evento pasado de calorías no corta la racha ni quema el día de gracia', async () => {
    await logMeal(daysAgo(2), 1500);
    await logEvent(daysAgo(1), { min: 3800, max: 4200, calories: 4000 }); // muy por encima del objetivo
    await logMeal(TODAY, 1500);

    const res = await invoke<{ streak: number; todayPending: boolean; graceUsedOn?: string }>('nutrition:getStreak');

    // Sin la semántica de evento este día sería un agujero puenteado por la
    // gracia (streak 2 + graceUsedOn). Con ella: 3 días, gracia intacta.
    expect(res.streak).toBe(3);
    expect(res.graceUsedOn).toBeUndefined();
  });

  it('un día pasado de calorías SIN evento sigue gastando la gracia (control)', async () => {
    await logMeal(daysAgo(2), 1500);
    await logMeal(daysAgo(1), 4000);
    await logMeal(TODAY, 1500);

    const res = await invoke<{ streak: number; graceUsedOn?: string }>('nutrition:getStreak');
    expect(res.streak).toBe(2);
    expect(res.graceUsedOn).toBe(daysAgo(1));
  });
});

describe('nutrition:getEventDays', () => {
  it('devuelve las fechas con evento vivo dentro del rango', async () => {
    await logEvent(daysAgo(3));
    await logEvent(daysAgo(1));
    await logMeal(TODAY, 800);

    const days = await invoke<string[]>('nutrition:getEventDays', daysAgo(2), TODAY);
    expect(days).toEqual([daysAgo(1)]);

    const all = await invoke<string[]>('nutrition:getEventDays', daysAgo(7), TODAY);
    expect(all).toEqual([daysAgo(3), daysAgo(1)]);
  });

  it('ignora eventos soft-deleteados', async () => {
    await logEvent(daysAgo(1));
    const food = harness.db.prepare('SELECT id FROM food_log WHERE is_event = 1').get() as { id: number };
    await invoke('nutrition:deleteFood', food.id);

    const days = await invoke<string[]>('nutrition:getEventDays', daysAgo(7), TODAY);
    expect(days).toEqual([]);
  });
});
