/**
 * NUT-03 (QA 0.9.1): «Cerrar el Día» con Pasos vacío fallaba siempre.
 * Today.tsx manda `steps: null` cuando el input está vacío y el handler
 * validaba `steps !== undefined && !Number.isFinite(steps)`: `null` no es
 * `undefined` y `Number.isFinite(null)` es false → «Invalid steps».
 * See docs/superpowers/plans/2026-09-02-mobile-qa-0.9.1.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { getHandler, clearHandlers } from '../../../shared-logic/registry';

let testDb: Database.Database;

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../../shared-logic/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
  return db;
}

const DATE = '2026-09-02';

const save = (metrics: Record<string, unknown>) =>
  getHandler('nutrition:saveDailyMetrics')!({}, metrics);
const get = (date: string) =>
  getHandler('nutrition:getDailyMetrics')!({}, date) as { date: string; steps: number | null; gym: boolean };

beforeEach(() => {
  testDb = setupDb();
  clearHandlers();
  registerNutritionIpcHandlers();
});

describe('nutrition:saveDailyMetrics — Pasos vacío (NUT-03)', () => {
  it('steps: null (lo que manda la UI con el input vacío) no lanza y guarda «sin dato»', () => {
    expect(() => save({ date: DATE, steps: null, gym: true })).not.toThrow();
    const row = get(DATE);
    expect(row.steps).toBeNull();
    expect(row.gym).toBe(true);
  });

  it('steps: undefined tampoco lanza', () => {
    expect(() => save({ date: DATE, steps: undefined, gym: false })).not.toThrow();
    expect(get(DATE).steps).toBeNull();
  });

  it('steps con un valor válido se guarda tal cual', () => {
    save({ date: DATE, steps: 1000, gym: false });
    expect(get(DATE).steps).toBe(1000);
  });

  it('steps inválido (texto, negativo) sigue lanzando', () => {
    expect(() => save({ date: DATE, steps: 'abc' })).toThrow(/Invalid steps/);
    expect(() => save({ date: DATE, steps: -1 })).toThrow(/Invalid steps/);
    expect(() => save({ date: DATE, steps: NaN })).toThrow(/Invalid steps/);
  });
});
