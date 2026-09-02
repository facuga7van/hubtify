/**
 * Phase 2, backend half: answering "what did you eat?" from the user's own log
 * instead of from the model, and never asking the model the same question twice.
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
import { PROMPT_VERSION } from '../../../functions/src/gemini';

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerNutritionIpcHandlers, normalizeFoodSource } =
  await import('../../../shared-logic/modules/nutrition.ipc');
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

let syncSeq = 0;
function logMeal(date: string, description: string, calories: number, opts: { time?: string; source?: string } = {}) {
  harness.db.prepare(`
    INSERT INTO food_log (date, time, description, calories, source, updated_at, sync_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, opts.time ?? '13:00', description, calories, opts.source ?? 'ai_estimate',
    `${date}T00:00:00.000Z`, `s${++syncSeq}`);
}

function saveFavorite(description: string, calories: number, createdAt = `${TODAY}T00:00:00.000Z`) {
  harness.db.prepare(`
    INSERT INTO favorite_foods (id, description, calories, source, created_at, updated_at)
    VALUES (?, ?, ?, 'manual', ?, ?)
  `).run(`f${++syncSeq}`, description, calories, createdAt, createdAt);
}

function daysAgo(n: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
  harness.db = setupDb();
});

afterEach(() => { vi.useRealTimers(); });

describe('nutrition:searchHistory', () => {
  it('groups the log by normalised description, ignoring case and accents', async () => {
    logMeal(daysAgo(2), 'Milanesa con puré', 900);
    logMeal(daysAgo(1), 'milanesa con pure', 950);
    logMeal(TODAY, 'MILANESA CON PURE', 980, { time: '20:00' });

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'milanesa');

    expect(out).toHaveLength(1);
    expect(out[0].timesLogged).toBe(3);
    // The most RECENT number wins: it is the user's latest word on the subject.
    expect(out[0].calories).toBe(980);
    expect(out[0].lastLogged).toBe(`${TODAY} 20:00`);
    expect(out[0].source).toBe('history');
  });

  it('returns the top of the ranking for an empty query', async () => {
    logMeal(TODAY, 'cafe con leche', 200);
    logMeal(TODAY, 'cafe con leche', 200, { time: '09:00' });
    logMeal(TODAY, 'cafe con leche', 200, { time: '10:00' });
    logMeal(TODAY, 'cafe con leche', 200, { time: '11:00' });
    logMeal(daysAgo(60), 'lomo completo', 1200);

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', '');

    expect(out.map(s => s.description)).toEqual(['cafe con leche', 'lomo completo']);
  });

  it('caps the result at the requested limit', async () => {
    for (let i = 0; i < 12; i++) logMeal(TODAY, `comida ${i}`, 100 + i, { time: `0${i % 10}:00` });
    expect(await invoke<HistorySuggestion[]>('nutrition:searchHistory', '')).toHaveLength(8);
    expect(await invoke<HistorySuggestion[]>('nutrition:searchHistory', '', 4)).toHaveLength(4);
  });

  it('ranks a prefix match above a stronger contains match', async () => {
    // "pure de papa" is logged far more often, but "papa al horno" is what the
    // user started typing.
    for (let i = 0; i < 10; i++) logMeal(TODAY, 'pure de papa', 300, { time: `1${i % 10}:00` });
    logMeal(daysAgo(10), 'papa al horno', 250);

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'papa');

    expect(out.map(s => s.description)).toEqual(['papa al horno', 'pure de papa']);
  });

  it('finds an accented meal from an unaccented query, and the reverse', async () => {
    logMeal(TODAY, 'Puré de calabaza', 320);
    expect((await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'pure')).map(s => s.description))
      .toEqual(['Puré de calabaza']);
    expect((await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'PURÉ')).map(s => s.description))
      .toEqual(['Puré de calabaza']);
  });

  it('unifies a favourite with its own history instead of showing it twice', async () => {
    logMeal(daysAgo(3), 'ensalada cesar', 400);
    logMeal(TODAY, 'Ensalada César', 420);
    saveFavorite('Ensalada César', 450);

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'ensalada');

    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('favorite');
    // The curated favourite value wins over the logged one.
    expect(out[0].calories).toBe(450);
    expect(out[0].timesLogged).toBe(2);
  });

  it('offers a favourite that was never logged', async () => {
    saveFavorite('Yogur con granola', 260);
    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'yogur');
    expect(out).toEqual([{
      description: 'Yogur con granola', calories: 260,
      timesLogged: 0, lastLogged: null, source: 'favorite',
    }]);
  });

  it('never suggests a deleted meal or a deleted favourite', async () => {
    logMeal(TODAY, 'pizza muzzarella', 1100);
    saveFavorite('pizza napolitana', 1300);
    harness.db.prepare("UPDATE food_log SET deleted_at = ? WHERE description = 'pizza muzzarella'")
      .run(`${TODAY}T12:00:00.000Z`);
    harness.db.prepare("UPDATE favorite_foods SET deleted_at = ? WHERE description = 'pizza napolitana'")
      .run(`${TODAY}T12:00:00.000Z`);

    expect(await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'pizza')).toEqual([]);
  });

  it('treats LIKE metacharacters in the query as literal text', async () => {
    logMeal(TODAY, 'leche 50% descremada', 90);
    logMeal(TODAY, 'algo cualquiera', 400, { time: '14:00' });

    // An unescaped '%' would match every description in the table.
    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', '50%');
    expect(out.map(s => s.description)).toEqual(['leche 50% descremada']);
  });

  it('returns nothing when nothing matches', async () => {
    logMeal(TODAY, 'guiso de lentejas', 700);
    expect(await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'sushi')).toEqual([]);
  });

  it('carries protein through from the AI cache when it knows it', async () => {
    logMeal(TODAY, 'pechuga a la plancha', 300);
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, protein_g, created_at)
      VALUES ('pechuga a la plancha', 300, 42.5, ?)
    `).run(`${TODAY}T00:00:00.000Z`);

    const out = await invoke<HistorySuggestion[]>('nutrition:searchHistory', 'pechuga');
    expect(out[0].proteinG).toBe(42.5);
  });
});

describe('logging a suggestion — the source mapping', () => {
  it("maps 'history' onto the existing 'frequent' value instead of widening the CHECK", async () => {
    expect(normalizeFoodSource('history')).toBe('frequent');
    expect(normalizeFoodSource('ai_estimate')).toBe('ai_estimate');
    expect(normalizeFoodSource('favorite')).toBe('favorite');
    expect(normalizeFoodSource('manual')).toBe('manual');
    expect(normalizeFoodSource(undefined)).toBe('manual');
  });

  it('accepts a history log without tripping the CHECK constraint', async () => {
    await invoke('nutrition:logFood', {
      date: TODAY, description: 'Milanesa con puré', calories: 900, source: 'history',
    });
    const row = harness.db.prepare('SELECT source, description_norm AS norm FROM food_log').get() as
      { source: string; norm: string };
    expect(row.source).toBe('frequent');
    expect(row.norm).toBe('milanesa con pure');
  });

  it('leaves every legacy source value valid after v12', () => {
    // v12 adds a generated column and an index; it must not touch the CHECK, so
    // rows written by any earlier version keep inserting exactly as they did.
    for (const source of ['ai_estimate', 'frequent', 'manual', 'favorite']) {
      expect(() => logMeal(TODAY, `legacy ${source}`, 100, { source })).not.toThrow();
    }
    const count = harness.db.prepare('SELECT COUNT(*) AS c FROM food_log').get() as { c: number };
    expect(count.c).toBe(4);
  });
});

describe('nutrition:getCachedEstimate / nutrition:cacheEstimate', () => {
  it('misses on an unknown description', async () => {
    expect(await invoke('nutrition:getCachedEstimate', 'algo que nunca comi')).toBeNull();
  });

  it('hits regardless of case, accents and spacing', async () => {
    await invoke('nutrition:cacheEstimate', {
      description: 'Milanesa con puré', calories: 980,
      aiBreakdown: JSON.stringify([{ name: 'milanesa', calories: 700 }]),
    });

    const hit = await invoke<{ calories: number; hits: number }>(
      'nutrition:getCachedEstimate', '  MILANESA   con  pure ');
    expect(hit.calories).toBe(980);
  });

  it('counts the hits, because that is what "al instante" is claiming', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'cafe', calories: 5 });
    expect((await invoke<{ hits: number }>('nutrition:getCachedEstimate', 'cafe')).hits).toBe(2);
    expect((await invoke<{ hits: number }>('nutrition:getCachedEstimate', 'CAFÉ')).hits).toBe(3);
  });

  it('stores the CORRECTED value, not the one the model guessed', async () => {
    // The model said 980; the human looked at it and said 700. The human wins —
    // deleting the row would only send the next identical description back to
    // the model to be told 980 again.
    await invoke('nutrition:cacheEstimate', {
      description: 'Milanesa con puré', calories: 980,
      aiBreakdown: JSON.stringify([{ name: 'milanesa', calories: 700 }, { name: 'pure', calories: 280 }]),
    });
    await invoke('nutrition:cacheEstimate', {
      description: 'Milanesa con puré', calories: 700, corrected: true,
    });

    const hit = await invoke<{ calories: number; aiBreakdown: string | null }>(
      'nutrition:getCachedEstimate', 'milanesa con pure');
    expect(hit.calories).toBe(700);
    // The per-item breakdown is dropped: 700 + 280 no longer adds up to anything.
    expect(hit.aiBreakdown).toBeNull();
  });

  it('keeps the hit counter across a correction', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'tarta', calories: 640 });
    await invoke('nutrition:getCachedEstimate', 'tarta'); // hits -> 2
    await invoke('nutrition:cacheEstimate', { description: 'tarta', calories: 500, corrected: true });

    const row = harness.db.prepare('SELECT hits, calories FROM nutrition_ai_cache').get() as
      { hits: number; calories: number };
    expect(row).toEqual({ hits: 2, calories: 500 });
  });

  it('keeps a known protein value when a later write does not carry one', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'pollo', calories: 300, proteinG: 40 });
    await invoke('nutrition:cacheEstimate', { description: 'pollo', calories: 320 });
    const hit = await invoke<{ proteinG: number | null }>('nutrition:getCachedEstimate', 'pollo');
    expect(hit.proteinG).toBe(40);
  });

  it('refuses to cache an empty description or a nonsense calorie count', async () => {
    expect(await invoke('nutrition:cacheEstimate', { description: '   ', calories: 500 }))
      .toEqual({ cached: false });
    expect(await invoke('nutrition:cacheEstimate', { description: 'x', calories: 0 }))
      .toEqual({ cached: false });
    const count = harness.db.prepare('SELECT COUNT(*) AS c FROM nutrition_ai_cache').get() as { c: number };
    expect(count.c).toBe(0);
  });
});

/**
 * Migration v17: the cache knows WHO wrote a row and with WHICH prompt, so a
 * better prompt is not buried under the old number for the dishes the user
 * repeats most, while a human correction survives every prompt change.
 */
describe('nutrition_ai_cache — source and prompt_version (v17)', () => {
  const rowFor = (norm: string) => harness.db.prepare(
    'SELECT source, prompt_version AS promptVersion, hits FROM nutrition_ai_cache WHERE description_norm = ?',
  ).get(norm) as { source: string; promptVersion: string | null; hits: number };

  it('stamps a model answer with the current prompt version and a correction as user', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'Pizza', calories: 300 });
    await invoke('nutrition:cacheEstimate', { description: 'Guiso', calories: 700, corrected: true });
    expect(rowFor('pizza')).toMatchObject({ source: 'model', promptVersion: PROMPT_VERSION });
    expect(rowFor('guiso')).toMatchObject({ source: 'user' });
  });

  it('ignores a model hit from an older prompt (and does not count it as a hit)', async () => {
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, source, prompt_version, created_at)
      VALUES ('tostado', 238, 'model', '2026-01-01-a.deadbeef', '2026-08-01T00:00:00.000Z')
    `).run();
    expect(await invoke('nutrition:getCachedEstimate', 'tostado')).toBeNull();
    expect(rowFor('tostado').hits).toBe(1);
  });

  it('re-estimates rows that predate v17 (NULL prompt_version)', async () => {
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, created_at) VALUES ('manzana', 78, '2026-08-01T00:00:00.000Z')
    `).run();
    expect(rowFor('manzana')).toMatchObject({ source: 'model', promptVersion: null });
    expect(await invoke('nutrition:getCachedEstimate', 'manzana')).toBeNull();
  });

  it('serves a user correction regardless of prompt version', async () => {
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, source, prompt_version, created_at)
      VALUES ('asado con papa al horno', 850, 'user', '2026-01-01-a.deadbeef', '2026-08-01T00:00:00.000Z')
    `).run();
    const hit = await invoke<{ calories: number; source: string; hits: number }>(
      'nutrition:getCachedEstimate', 'Asado con papa al horno');
    expect(hit).toMatchObject({ calories: 850, source: 'user', hits: 2 });
  });

  it('a fresh model write over a stale one becomes a hit again', async () => {
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, source, prompt_version, created_at)
      VALUES ('choripan', 458, 'model', 'old', '2026-08-01T00:00:00.000Z')
    `).run();
    expect(await invoke('nutrition:getCachedEstimate', 'choripán')).toBeNull();
    await invoke('nutrition:cacheEstimate', { description: 'choripán', calories: 480 });
    expect(await invoke<{ calories: number }>('nutrition:getCachedEstimate', 'choripán')).toMatchObject({ calories: 480, source: 'model' });
  });

  it('a confirmed model number after a correction is the user overruling himself (last write wins)', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'tarta', calories: 500, corrected: true });
    await invoke('nutrition:cacheEstimate', { description: 'tarta', calories: 430 });
    expect(rowFor('tarta')).toMatchObject({ source: 'model', promptVersion: PROMPT_VERSION });
  });
});

/** P3: the corrections the renderer picks personal examples from. */
describe('nutrition:getUserCorrections', () => {
  it('returns only user rows, newest first, in the shape similar-corrections expects', async () => {
    await invoke('nutrition:cacheEstimate', { description: 'Pizza', calories: 300 });
    await invoke('nutrition:cacheEstimate', { description: 'Guiso de lentejas', calories: 700, corrected: true, proteinG: 22 });
    harness.db.prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, source, updated_at, created_at)
      VALUES ('asado con papa al horno', 850, 'user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();
    const rows = await invoke<Array<{ description: string; calories: number; proteinG: number | null; updatedAt: string }>>(
      'nutrition:getUserCorrections');
    expect(rows.map(r => r.description)).toEqual(['guiso de lentejas', 'asado con papa al horno']);
    expect(rows[0]).toMatchObject({ calories: 700, proteinG: 22, carbsG: null, fatG: null });
    expect(typeof rows[0].updatedAt).toBe('string');
  });

  it('honours the limit and clamps nonsense', async () => {
    for (let i = 0; i < 5; i++) {
      await invoke('nutrition:cacheEstimate', { description: `plato ${i}`, calories: 100 + i, corrected: true });
    }
    expect(await invoke<unknown[]>('nutrition:getUserCorrections', 2)).toHaveLength(2);
    expect(await invoke<unknown[]>('nutrition:getUserCorrections', -3)).toHaveLength(1);
    expect(await invoke<unknown[]>('nutrition:getUserCorrections', Number.NaN)).toHaveLength(5);
  });
});

/**
 * Migration v18: corrections that already lived in food_log (the breakdown no
 * longer sums to the total the user typed) are promoted to user rows once.
 * Runs after the v16 twin repair, so food_log is already deduped here.
 */
describe('nutrition v18 — backfill of pre-existing corrections', () => {
  function freshDbUpTo(version: number): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const m of nutritionMigrations) if (m.version <= version) db.exec(m.up);
    return db;
  }
  const v18 = nutritionMigrations.find(m => m.version === 18)!;
  const breakdown = (...cals: number[]) => JSON.stringify(cals.map((c, i) => ({ name: `item ${i}`, calories: c })));
  function log(db: Database.Database, description: string, calories: number, aiBreakdown: string | null,
    opts: { source?: string; updatedAt?: string | null; syncId?: string; deleted?: boolean } = {}) {
    db.prepare(`
      INSERT INTO food_log (date, time, description, calories, source, ai_breakdown, updated_at, sync_id, deleted_at)
      VALUES ('2026-04-29', '13:00', ?, ?, ?, ?, ?, ?, ?)
    `).run(description, calories, opts.source ?? 'ai_estimate', aiBreakdown, opts.updatedAt ?? '2026-04-29T16:00:00.000Z',
      opts.syncId ?? `s${Math.random()}`, opts.deleted ? '2026-05-01T00:00:00.000Z' : null);
  }
  const cache = (db: Database.Database) => db.prepare(
    'SELECT description_norm AS norm, calories, source, protein_g AS proteinG, updated_at AS updatedAt FROM nutrition_ai_cache ORDER BY description_norm',
  ).all() as Array<{ norm: string; calories: number; source: string; proteinG: number | null; updatedAt: string }>;

  it('promotes an edited AI entry (breakdown does not sum to the total) and dedupes the sync twins', () => {
    const db = freshDbUpTo(17);
    // The real case from the report: 1200+450+300 = 1950 estimated, 1750 kept — twice, thanks to sync.
    log(db, 'hamburguesa triple con papas', 1750, breakdown(1200, 450, 300), { syncId: 'legacy-x', updatedAt: '2026-04-29T16:00:00.000Z' });
    log(db, 'Hamburguesa triple con papas', 1750, breakdown(1200, 450, 300), { syncId: 'uuid-x', updatedAt: '2026-04-30T10:00:00.000Z' });
    // Accepted as estimated: NOT a correction.
    log(db, 'dos porciones de pastel de papa', 1000, breakdown(500, 500));
    // Manual entries and deleted rows do not count.
    log(db, 'tofi', 270, null, { source: 'manual' });
    log(db, 'asado con papa al horno', 850, breakdown(700, 250), { deleted: true });
    db.exec(v18.up);
    expect(cache(db)).toEqual([
      expect.objectContaining({ norm: 'hamburguesa triple con papas', calories: 1750, source: 'user', proteinG: null, updatedAt: '2026-04-30T10:00:00.000Z' }),
    ]);
  });

  it('overwrites a stale model row for the same dish but never an existing user row', () => {
    const db = freshDbUpTo(17);
    db.prepare(`INSERT INTO nutrition_ai_cache (description_norm, calories, source, prompt_version) VALUES ('guiso', 980, 'model', 'old')`).run();
    db.prepare(`INSERT INTO nutrition_ai_cache (description_norm, calories, source) VALUES ('tarta', 500, 'user')`).run();
    log(db, 'guiso', 700, breakdown(980));
    log(db, 'tarta', 640, breakdown(400, 300));
    db.exec(v18.up);
    expect(cache(db)).toEqual([
      expect.objectContaining({ norm: 'guiso', calories: 700, source: 'user' }),
      expect.objectContaining({ norm: 'tarta', calories: 500, source: 'user' }),
    ]);
  });

  it('is a no-op on an empty log and idempotent when re-run', () => {
    const db = freshDbUpTo(17);
    db.exec(v18.up);
    expect(cache(db)).toEqual([]);
    log(db, 'milanesa', 400, breakdown(350));
    db.exec(v18.up);
    db.exec(v18.up);
    expect(cache(db)).toHaveLength(1);
  });
});
