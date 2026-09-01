/**
 * Review UI — MEDIO «copyDay»: "repetir ayer" copiaba las filas de food_log sin
 * `is_event`, `event_kcal_min/max` ni `protein_g`. El asado de ayer copiado hoy
 * perdía la marca de evento (y el día podía recibir −20 HP injustos al cerrar)
 * y la proteína desaparecía.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../electron/ipc/db', () => ({ getDb: () => harness.db }));

const { registerNutritionIpcHandlers } = await import('../../../electron/modules/nutrition.ipc');
registerNutritionIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const TODAY = '2026-08-31';
const YESTERDAY = '2026-08-30';

type FoodRow = {
  description: string; calories: number; source: string; proteinG: number | null;
  isEvent: number; eventKcalMin: number | null; eventKcalMax: number | null;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
  harness.db = new Database(':memory:');
  harness.db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) harness.db.exec(m.up);
  harness.db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, day_cutoff_hour)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, '1996-01-01', 0)
  `).run();
});

afterEach(() => { vi.useRealTimers(); });

describe('nutrition:copyDay conserva evento y proteína', () => {
  it('un asado con banda y proteína copiado a hoy sigue siendo un asado con banda y proteína', async () => {
    await invoke('nutrition:logFood', {
      date: YESTERDAY, description: 'Asado familiar', calories: 1400, source: 'manual',
      isEvent: true, eventKcalMin: 1200, eventKcalMax: 1600, proteinG: 85,
    });
    await invoke('nutrition:logFood', {
      date: YESTERDAY, description: 'Yogur', calories: 150, source: 'ai_estimate', proteinG: 12,
    });

    const res = await invoke<{ success: boolean; copied: number }>('nutrition:copyDay', { from: YESTERDAY, to: TODAY });
    expect(res.success).toBe(true);
    expect(res.copied).toBe(2);

    const today = await invoke<FoodRow[]>('nutrition:getFoodByDate', TODAY);
    const asado = today.find((f) => f.description === 'Asado familiar')!;
    expect(asado).toMatchObject({ isEvent: 1, eventKcalMin: 1200, eventKcalMax: 1600, proteinG: 85, calories: 1400 });

    const yogur = today.find((f) => f.description === 'Yogur')!;
    expect(yogur).toMatchObject({ isEvent: 0, eventKcalMin: null, eventKcalMax: null, proteinG: 12, source: 'frequent' });
  });
});
