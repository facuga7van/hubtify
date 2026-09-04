import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerSyncIpcHandlers } from '../../../shared-logic/modules/sync.ipc';
import { initCoreTables, coreMigrations, applyMigrations } from '../../../shared-logic/db';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, nutritionMigrations);
  // clearUserDataInto unconditionally re-seeds cauldron_presets after a clear.
  applyMigrations(db, cauldronMigrations);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level)
    VALUES (1, 30, 'M', 175, 80, 'moderate')
  `).run();
  return db;
}

function insertLocalWeek(weekStart: string, daysCompliant: number, updatedAt: string): void {
  testDb.prepare(`
    INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, avg_consumed, avg_target, weight_start,
       weight_end, days_steps, days_gym, streak_end, xp_total, closed_at, updated_at)
    VALUES (?, 7, ?, 2000, 2200, 80, 79.5, 5, 3, 6, 120, ?, ?)
  `).run(weekStart, daysCompliant, weekStart, updatedAt);
}

interface WeekRow {
  daysClosed: number;
  daysCompliant: number;
  avgConsumed: number;
  avgTarget: number;
  weightStart: number;
  weightEnd: number;
  daysSteps: number;
  daysGym: number;
  streakEnd: number;
  xpTotal: number;
  closedAt: string;
  updatedAt: string;
}

// Trae las 13 columnas (menos week_start, que es la clave del WHERE): el INSERT
// de 13 parámetros posicionales en sync.ipc.ts es invisible al compilador si se
// intercambian dos columnas del mismo tipo (avg_consumed/avg_target,
// weight_start/weight_end, days_steps/days_gym, streak_end/xp_total). Si el test
// solo lee daysCompliant, un swap así pasa los 5 tests y corrompe una fila
// sellada para siempre en cada dispositivo sincronizado.
const readWeek = (weekStart: string) =>
  testDb.prepare(`SELECT
      days_closed AS daysClosed, days_compliant AS daysCompliant,
      avg_consumed AS avgConsumed, avg_target AS avgTarget,
      weight_start AS weightStart, weight_end AS weightEnd,
      days_steps AS daysSteps, days_gym AS daysGym,
      streak_end AS streakEnd, xp_total AS xpTotal,
      closed_at AS closedAt, updated_at AS updatedAt
    FROM nutrition_weekly_closed WHERE week_start = ?`)
    .get(weekStart) as WeekRow | undefined;

const OLD = '2026-08-31T08:00:00.000Z';
const NEW = '2026-08-31T20:00:00.000Z';

async function merge(data: Record<string, unknown>): Promise<any> {
  return await getHandler('sync:mergeNutritionData')!({}, data);
}

beforeEach(() => {
  testDb = setupDb();
  clearHandlers();
  registerSyncIpcHandlers();
});

describe('nutrition_weekly_closed — multi-account sync wiring', () => {
  it('is in USER_DATA_TABLES: sync:clearUserData empties the table', async () => {
    insertLocalWeek('2026-08-31', 5, NEW);
    expect((testDb.prepare('SELECT COUNT(*) AS c FROM nutrition_weekly_closed').get() as { c: number }).c).toBe(1);

    await getHandler('sync:clearUserData')!({});

    expect((testDb.prepare('SELECT COUNT(*) AS c FROM nutrition_weekly_closed').get() as { c: number }).c).toBe(0);
  });

  it('sync:getAllNutritionData returns weeklyClosed with snake_case keys', async () => {
    insertLocalWeek('2026-08-31', 5, NEW);
    const data = await getHandler('sync:getAllNutritionData')!({}) as { weeklyClosed: Array<Record<string, unknown>> };
    expect(data.weeklyClosed).toHaveLength(1);
    expect(data.weeklyClosed[0].week_start).toBe('2026-08-31');
    // camelCase would be undefined — this is the exact trap the brief warns about.
    expect((data.weeklyClosed[0] as Record<string, unknown>).weekStart).toBeUndefined();
  });

  it('sync:mergeNutritionData inserts a week that was not there locally', async () => {
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: NEW, updated_at: NEW,
      }],
    });
    expect(res.changed).toBe(true);
    // Se verifican las 13 columnas, no solo daysCompliant: un swap posicional
    // entre columnas del mismo tipo (p. ej. days_steps <-> days_gym) en el
    // INSERT de sync.ipc.ts no lo detecta el compilador ni un test que solo
    // mira una columna, y corrompe una fila sellada para siempre.
    expect(readWeek('2026-08-31')).toMatchObject({
      daysClosed: 7, daysCompliant: 5, avgConsumed: 2000, avgTarget: 2200,
      weightStart: 80, weightEnd: 79.5, daysSteps: 5, daysGym: 3, streakEnd: 6, xpTotal: 120,
      closedAt: NEW, updatedAt: NEW,
    });
  });

  it('last-write-wins: a newer incoming row overwrites the local one', async () => {
    insertLocalWeek('2026-08-31', 2, OLD);
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: NEW, updated_at: NEW,
      }],
    });
    expect(res.changed).toBe(true);
    // Idem: el UPDATE también es un swap posicional de 12 valores — hay que
    // chequear las 13 columnas, no solo daysCompliant.
    expect(readWeek('2026-08-31')).toMatchObject({
      daysClosed: 7, daysCompliant: 5, avgConsumed: 2000, avgTarget: 2200,
      weightStart: 80, weightEnd: 79.5, daysSteps: 5, daysGym: 3, streakEnd: 6, xpTotal: 120,
      closedAt: NEW, updatedAt: NEW,
    });
  });

  it('an older incoming row does NOT overwrite the local one', async () => {
    insertLocalWeek('2026-08-31', 2, NEW);
    const res = await merge({
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
        weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
        closed_at: OLD, updated_at: OLD,
      }],
    });
    expect(res.changed).toBe(false);
    expect(readWeek('2026-08-31')?.daysCompliant).toBe(2);
  });

  it('isUsableRow rejects a weeklyClosed row with no week_start', async () => {
    const res = await merge({
      weeklyClosed: [
        {
          week_start: '2026-08-31', days_closed: 7, days_compliant: 5, avg_consumed: 2000, avg_target: 2200,
          weight_start: 80, weight_end: 79.5, days_steps: 5, days_gym: 3, streak_end: 6, xp_total: 120,
          closed_at: NEW, updated_at: NEW,
        },
        {
          // Sin week_start: isUsableRow debe descartar esta fila sin tocar la válida.
          days_closed: 7, days_compliant: 9, avg_consumed: 1800, avg_target: 1900,
          weight_start: 75, weight_end: 74, days_steps: 4, days_gym: 2, streak_end: 3, xp_total: 50,
          closed_at: NEW, updated_at: NEW,
        },
      ],
    });
    expect(res.changed).toBe(true);
    expect(readWeek('2026-08-31')).toMatchObject({ daysCompliant: 5 });
    expect((testDb.prepare('SELECT COUNT(*) AS c FROM nutrition_weekly_closed').get() as { c: number }).c).toBe(1);
  });
});
