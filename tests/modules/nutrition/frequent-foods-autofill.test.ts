/**
 * `frequent_foods` estaba VACÍA en la base real del dueño, y no por falta de
 * uso: `nutrition:createFrequentFood` nunca tuvo un solo llamador en `src/` en
 * toda la historia del repo. La tarjeta "Comidas Frecuentes" se renderiza sólo
 * si la lista tiene algo, así que estaba escondida para siempre y el atajo de
 * repetir nunca se estrenó. Ahora la tabla se deriva del registro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { getHandler, clearHandlers } from '../../../shared-logic/registry';

let testDb: Database.Database;

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../../shared-logic/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) {
    try { db.exec(m.up); } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
  return db;
}

const DATE = '2026-09-03';

const log = (entry: Record<string, unknown>) =>
  getHandler('nutrition:logFood')!({}, { date: DATE, source: 'manual', ...entry });
const frequents = () =>
  getHandler('nutrition:getFrequentFoods')!({}) as Array<{ id: number; name: string; calories: number; timesUsed: number }>;

beforeEach(() => {
  testDb = setupDb();
  clearHandlers();
  registerNutritionIpcHandlers();
});

describe('nutrition:logFood — llena frequent_foods sola', () => {
  it('la primera vez crea la fila con un uso', () => {
    log({ description: 'Milanesa con puré', calories: 700, proteinG: 40 });
    const rows = frequents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Milanesa con puré', calories: 700, timesUsed: 1 });
  });

  it('repetir el mismo plato cuenta usos en vez de duplicar filas', () => {
    log({ description: 'Milanesa', calories: 600 });
    log({ description: 'milanesa', calories: 600 });
    log({ description: 'MILANESA', calories: 600 });
    const rows = frequents();
    expect(rows).toHaveLength(1);
    expect(rows[0].timesUsed).toBe(3);
  });

  // C12: el default que sirve es el último valor usado.
  it('guarda las calorías y macros del último registro', () => {
    log({ description: 'Ensalada', calories: 300, proteinG: 10 });
    log({ description: 'Ensalada', calories: 450, proteinG: 22 });
    const row = testDb.prepare('SELECT calories, protein_g FROM frequent_foods WHERE name = ?')
      .get('Ensalada') as { calories: number; protein_g: number };
    expect(row).toMatchObject({ calories: 450, protein_g: 22 });
  });

  it('ordena por uso, que es lo que el atajo debería ofrecer primero', () => {
    log({ description: 'Café', calories: 60 });
    log({ description: 'Tostadas', calories: 200 });
    log({ description: 'Café', calories: 60 });
    expect(frequents().map((r) => r.name)).toEqual(['Café', 'Tostadas']);
  });

  // Sacarlo de la lista fue una decisión del usuario, no un accidente.
  it('un plato borrado no resucita al volver a registrarlo', () => {
    log({ description: 'Torta', calories: 500 });
    const [row] = frequents();
    getHandler('nutrition:deleteFrequentFood')!({}, row.id);
    expect(frequents()).toHaveLength(0);

    log({ description: 'Torta', calories: 500 });
    expect(frequents()).toHaveLength(0);
    const raw = testDb.prepare('SELECT times_used, deleted_at FROM frequent_foods WHERE name = ?')
      .get('Torta') as { times_used: number; deleted_at: string | null };
    expect(raw.deleted_at).not.toBeNull();
    expect(raw.times_used).toBe(2);
  });

  it('un evento lleva banda, no un número: no entra en la lista', () => {
    log({ description: 'Cumpleaños de la abuela', calories: 1200, isEvent: true, eventKcalMin: 900, eventKcalMax: 1500 });
    expect(frequents()).toHaveLength(0);
  });

  it('una crónica de 100 caracteres no es un plato repetible', () => {
    log({ description: 'x'.repeat(120), calories: 400 });
    expect(frequents()).toHaveLength(0);
  });

  it('cada fila lleva sync_id, así el merge tiene por dónde agarrarla', () => {
    log({ description: 'Yogur', calories: 120 });
    const row = testDb.prepare('SELECT sync_id, updated_at FROM frequent_foods WHERE name = ?')
      .get('Yogur') as { sync_id: string | null; updated_at: string | null };
    expect(row.sync_id).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });
});
