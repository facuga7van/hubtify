/**
 * NUT-06 (QA 0.9.0): al terminar el setup —donde se acaba de cargar el peso—
 * saltaba enseguida «Registrar peso semanal». El recordatorio no debe pedir el
 * mismo día nutricional en que se guardó el perfil, mientras ese peso sea el
 * único que hay.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

import { getHandler } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerNutritionIpcHandlers, profileSavedOn } =
  await import('../../../shared-logic/modules/nutrition.ipc');
registerNutritionIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

type Ask = { shouldAsk: boolean; lastWeight?: number };

// Lunes 31/08/2026 al mediodía: el día de pesaje por defecto (1) ya llegó.
const NOW = new Date(2026, 7, 31, 12, 0, 0);

const SETUP = {
  dateOfBirth: '1996-01-01', sex: 'M', heightCm: 175, initialWeightKg: 80,
  activityLevel: 'moderate', deficitTargetKcal: 500,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  harness.db = new Database(':memory:');
  harness.db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) harness.db.exec(m.up);
});

afterEach(() => { vi.useRealTimers(); });

describe('nutrition:shouldAskWeight el día del setup', () => {
  it('no pide el peso el mismo día en que el setup lo cargó', async () => {
    await invoke('nutrition:saveProfile', SETUP);
    const r = await invoke<Ask>('nutrition:shouldAskWeight');
    expect(r.shouldAsk).toBe(false);
  });

  it('al día siguiente sí lo pide, ofreciendo el peso del setup', async () => {
    await invoke('nutrition:saveProfile', SETUP);
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
    const r = await invoke<Ask>('nutrition:shouldAskWeight');
    expect(r).toEqual({ shouldAsk: true, lastWeight: 80 });
  });

  it('guardar Configuración hoy no se come el recordatorio si ya hay pesajes', async () => {
    await invoke('nutrition:saveProfile', SETUP);
    // Un pesaje de la semana pasada: el del perfil ya no es el único.
    harness.db.prepare(
      'INSERT INTO nutrition_weekly_metrics (date, weight_kg, updated_at) VALUES (?, ?, ?)',
    ).run('2026-08-24', 81.2, new Date().toISOString());
    const r = await invoke<Ask>('nutrition:shouldAskWeight');
    expect(r).toEqual({ shouldAsk: true, lastWeight: 81.2 });
  });

  it('un pesaje de esta semana sigue callando el recordatorio', async () => {
    await invoke('nutrition:saveProfile', SETUP);
    harness.db.prepare(
      'INSERT INTO nutrition_weekly_metrics (date, weight_kg, updated_at) VALUES (?, ?, ?)',
    ).run('2026-08-31', 79.5, new Date().toISOString());
    const r = await invoke<Ask>('nutrition:shouldAskWeight');
    expect(r.shouldAsk).toBe(false);
  });
});

describe('profileSavedOn', () => {
  it('lee un stamp ISO y uno legado, y respeta el corte del día', () => {
    // ISO en UTC → día local, el mismo que usa nutritionDayString.
    expect(profileSavedOn(new Date(2026, 7, 31, 12, 0, 0).toISOString(), 4)).toBe('2026-08-31');
    expect(profileSavedOn('2026-08-31 12:00:00', 4)).toBe('2026-08-31');
    // A la 1:00 con corte a las 4 todavía es el día anterior.
    expect(profileSavedOn('2026-08-31 01:00:00', 4)).toBe('2026-08-30');
    expect(profileSavedOn(null, 4)).toBeNull();
    expect(profileSavedOn('garbage', 4)).toBeNull();
  });
});
