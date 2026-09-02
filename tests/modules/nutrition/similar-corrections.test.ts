/**
 * P3: which of the user's own corrections get offered to the model as
 * examples for a new description. Pure function, no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenize, jaccard, toExample, selectSimilarCorrections,
  SIMILARITY_THRESHOLD, MAX_EXAMPLES, type CorrectionRow,
} from '@modules/nutrition/similar-corrections';

const row = (description: string, calories: number, extra: Partial<CorrectionRow> = {}): CorrectionRow => ({
  description, calories, proteinG: null, carbsG: null, fatG: null, updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
});

describe('tokenize', () => {
  it('drops stop words, bare numbers and the plural s, after normalising', () => {
    expect([...tokenize('2 Milanesas de POLLO con 2 tomates')]).toEqual(['milanesa', 'pollo', 'tomate']);
    expect([...tokenize('una porción de pastel de  papa chica')]).toEqual(['pastel', 'papa', 'chica']);
    expect([...tokenize('  ')]).toEqual([]);
  });

  it('keeps short but meaningful words like "pan" and folds accents', () => {
    expect([...tokenize('asado con papa al horno y un pedazo de pan')]).toEqual(['asado', 'papa', 'horno', 'pan']);
    expect([...tokenize('Café con leche')]).toEqual(['cafe', 'leche']);
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets, 0 for disjoint or empty ones', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set(['b']))).toBe(0);
  });
});

describe('selectSimilarCorrections', () => {
  it('offers a correction that shares most of its tokens, not one that shares a single word', () => {
    const rows = [
      row('milanesa con pure', 700),
      row('tarta de jamon y queso', 500),
    ];
    // {milanesa, pure, ensalada} vs {milanesa, pure} = 2/3 → in
    expect(selectSimilarCorrections('milanesa con puré y ensalada', rows).map(e => e.description))
      .toEqual(['milanesa con pure']);
    // {sandwich, jamon} vs {tarta, jamon, queso} = 1/4 → out (the over-anchoring the research warned about)
    expect(selectSimilarCorrections('sándwich de jamón', rows)).toEqual([]);
  });

  it('scales across quantities: "3 empanadas" finds the correction for "2 empanadas"', () => {
    expect(selectSimilarCorrections('3 empanadas de carne', [row('2 empanadas de carne', 580)])).toHaveLength(1);
  });

  it('excludes the exact same description (that is the cache hit, or the number being rejected)', () => {
    expect(selectSimilarCorrections('Asado con papa al horno', [row('asado con papa al horno', 850)])).toEqual([]);
  });

  it('ranks by similarity, then by recency, and caps at MAX_EXAMPLES', () => {
    const rows = [
      row('pastel de papa', 480, { updatedAt: '2026-01-01T00:00:00.000Z' }),
      row('pastel de papa chico', 320, { updatedAt: '2026-05-01T00:00:00.000Z' }),
      row('pastel de papa grande', 700, { updatedAt: '2026-08-01T00:00:00.000Z' }),
      row('pastel de papa con ensalada', 560, { updatedAt: '2026-09-01T00:00:00.000Z' }),
      row('pastel de papa casero', 500, { updatedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const picked = selectSimilarCorrections('dos porciones de pastel de papa', rows);
    expect(picked).toHaveLength(MAX_EXAMPLES);
    // Exact token match first; the three 2/3 ties resolve newest first.
    expect(picked.map(e => e.description)).toEqual(['pastel de papa', 'pastel de papa casero', 'pastel de papa con ensalada']);
  });

  it('respects the threshold option and the default is 0.5', () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.5);
    const rows = [row('milanesa napolitana', 900)];
    // {milanesa, pure} vs {milanesa, napolitana} = 1/3
    expect(selectSimilarCorrections('milanesa con pure', rows)).toEqual([]);
    expect(selectSimilarCorrections('milanesa con pure', rows, { threshold: 0.3 })).toHaveLength(1);
  });

  it('returns nothing for a description with no content tokens', () => {
    expect(selectSimilarCorrections('de la', [row('de la', 100)])).toEqual([]);
  });
});

describe('toExample (client-side validation, mirrors the Cloud Function)', () => {
  it('maps macros to the snake_case wire shape and rounds', () => {
    expect(toExample(row('guiso', 700.4, { proteinG: 22.26, carbsG: null, fatG: 14 })))
      .toEqual({ description: 'guiso', calories: 700, protein_g: 22.3, carbs_g: null, fat_g: 14 });
  });

  it('rejects implausible calories, empty or overlong descriptions, and flattens newlines', () => {
    expect(toExample(row('agua', 0))).toBeNull();
    expect(toExample(row('asado para 12', 3001))).toBeNull();
    expect(toExample(row('', 300))).toBeNull();
    expect(toExample(row('x'.repeat(121), 300))).toBeNull();
    expect(toExample(row('pan\ncon\tmanteca', 200))?.description).toBe('pan con manteca');
  });

  it('turns a negative or non-finite macro into null instead of dropping the example', () => {
    expect(toExample(row('pollo', 300, { proteinG: -1, carbsG: Number.NaN }))).toMatchObject({ protein_g: null, carbs_g: null });
  });
});
