import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { normalizeDescription, sqlNormalizeExpr } from '@modules/nutrition/normalize';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  return db;
}

/** Runs the SQL half of the normalizer on a literal, exactly as the column does. */
function sqlNormalize(db: Database.Database, value: string): string {
  const row = db.prepare(`SELECT ${sqlNormalizeExpr('?')} AS norm`).get(value) as { norm: string };
  return row.norm;
}

describe('normalizeDescription', () => {
  it('lowercases, folds accents and collapses whitespace', () => {
    expect(normalizeDescription('  Milanesa   con   PURÉ  ')).toBe('milanesa con pure');
  });

  it('treats accented and unaccented spellings as the same meal', () => {
    expect(normalizeDescription('Café con Leche')).toBe(normalizeDescription('cafe con leche'));
    expect(normalizeDescription('ÑOQUIS')).toBe('noquis');
    expect(normalizeDescription('niño envuelto')).toBe('nino envuelto');
  });

  it('folds every accented vowel, in both cases', () => {
    expect(normalizeDescription('ÁÉÍÓÚ áéíóú')).toBe('aeiou aeiou');
    expect(normalizeDescription('Àgüita Çocido Êclair')).toBe('aguita cocido eclair');
  });

  it('turns tabs and newlines into single spaces', () => {
    expect(normalizeDescription('pan\tcon\nmanteca')).toBe('pan con manteca');
  });

  it('is empty for null, undefined and whitespace-only input', () => {
    expect(normalizeDescription(null)).toBe('');
    expect(normalizeDescription(undefined)).toBe('');
    expect(normalizeDescription('   ')).toBe('');
  });
});

describe('the JS normalizer and the SQL expression cannot drift', () => {
  // If these two ever disagree, an estimate is cached under one key and looked
  // up under another and the cache silently stops working. That is the whole
  // reason both are generated from one fold table.
  const corpus = [
    'Milanesa con puré',
    '  DOBLE   espacio  ',
    'Café con leche y 2 medialunas',
    'ÑOQUIS del 29',
    'Àçaí bowl',
    'pan\tcon\nmanteca\r',
    'ASADO',
    '50% crema',
    "arroz_con_pollo",
    'ÁÉÍÓÚÜÑÇ áéíóúüñç',
    'Sopa',
    'yogur       griego',
    '',
  ];

  it('agrees on every string in the corpus', () => {
    const db = setupDb();
    for (const value of corpus) {
      expect(sqlNormalize(db, value), `mismatch for ${JSON.stringify(value)}`)
        .toBe(normalizeDescription(value));
    }
  });

  it('agrees with the generated columns the real tables use', () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO food_log (date, time, description, calories, source, sync_id)
       VALUES ('2026-08-31', '13:00', ?, 900, 'ai_estimate', 'a')`,
    ).run('  Milanesa   con   PURÉ  ');
    db.prepare(
      `INSERT INTO favorite_foods (id, description, calories, source, created_at)
       VALUES ('f1', ?, 900, 'manual', '2026-08-31T00:00:00.000Z')`,
    ).run('CAFÉ con Leche');

    const food = db.prepare('SELECT description_norm AS n FROM food_log').get() as { n: string };
    const fav = db.prepare('SELECT description_norm AS n FROM favorite_foods').get() as { n: string };

    expect(food.n).toBe('milanesa con pure');
    expect(food.n).toBe(normalizeDescription('  Milanesa   con   PURÉ  '));
    expect(fav.n).toBe(normalizeDescription('CAFÉ con Leche'));
  });
});

describe('migration v12 — indexes and the generated columns', () => {
  it('adds description_norm to both tables without touching the writers', () => {
    const db = setupDb();
    // The INSERT does NOT mention description_norm — that is the point: the sync
    // merge, copyDay and every other writer stay exactly as they are.
    db.prepare(
      `INSERT INTO food_log (date, time, description, calories, source, sync_id)
       VALUES ('2026-08-31', '09:00', 'Té Verde', 5, 'manual', 'x')`,
    ).run();
    const row = db.prepare('SELECT description_norm AS n FROM food_log').get() as { n: string };
    expect(row.n).toBe('te verde');
  });

  it('keeps description_norm in step when a row is edited', () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO food_log (date, time, description, calories, source, sync_id)
       VALUES ('2026-08-31', '09:00', 'Té Verde', 5, 'manual', 'x')`,
    ).run();
    db.prepare("UPDATE food_log SET description = 'CAFÉ' WHERE sync_id = 'x'").run();
    const row = db.prepare('SELECT description_norm AS n FROM food_log').get() as { n: string };
    expect(row.n).toBe('cafe');
  });

  it('serves a prefix search from the index instead of scanning the log', () => {
    const db = setupDb();
    const plan = db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT description FROM food_log
       WHERE deleted_at IS NULL AND description_norm >= 'mila' AND description_norm < 'milb'`,
    ).all() as Array<{ detail: string }>;
    const detail = plan.map(p => p.detail).join(' | ');
    expect(detail).toContain('idx_food_log_desc_norm');
    expect(detail).toContain('SEARCH');
  });

  it('creates nutrition_ai_cache with description_norm as the key', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_ai_cache)') as Array<{ name: string; pk: number }>;
    expect(cols.map(c => c.name).sort()).toEqual(
      ['ai_breakdown', 'calories', 'created_at', 'description_norm', 'hits', 'protein_g', 'updated_at'],
    );
    expect(cols.find(c => c.name === 'description_norm')?.pk).toBe(1);
  });

  it('is NOT exported by the sync layer — it is a local-only network cache', async () => {
    // Losing this table costs one API call; syncing it would push a per-device
    // performance artefact through Firestore for nothing.
    const syncSource = await import('node:fs').then(fs =>
      fs.readFileSync('electron/modules/sync.ipc.ts', 'utf-8'));
    expect(syncSource).not.toContain('nutrition_ai_cache');
  });
});
