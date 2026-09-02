/**
 * Which of the user's own corrections are worth showing the model for a new
 * description (P3 of docs/superpowers/plans/2026-09-02-ai-estimation-research.md).
 *
 * Pure and dependency-free so it can be tested as a function of its inputs.
 * The corrections come from `nutrition_ai_cache` rows with `source = 'user'`
 * (history-api.ts fetches them); this file only decides which ones resemble
 * the dish being estimated.
 *
 * Similarity is Jaccard over content tokens of the NORMALISED description
 * (normalize.ts: lowercase, no accents, single spaces). Tokens drop Spanish
 * stop words, bare numbers and a trailing plural "s", so that
 * "milanesa con pure y ensalada" and "milanesa con pure" share 2 of 3 tokens
 * (0.67, in) while "tarta de jamon" vs "sandwich de jamon" share 1 of 3
 * (0.33, out) — the over-anchoring the research warned about.
 */
import { normalizeDescription } from './normalize';

/** A user correction as stored in the cache, with the stamp used to rank ties. */
export interface CorrectionRow {
  description: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string | null;
}

/** The example shape the Cloud Function accepts (functions/src/gemini.ts UserExample). */
export interface EstimateExample {
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/** Minimum Jaccard for a correction to be offered as an example. */
export const SIMILARITY_THRESHOLD = 0.5;
/** Same caps the Cloud Function enforces; anything else is dropped there anyway. */
export const MAX_EXAMPLES = 3;
export const EXAMPLE_DESCRIPTION_MAX_CHARS = 120;
export const EXAMPLE_KCAL_MIN = 10;
export const EXAMPLE_KCAL_MAX = 3000;

const STOP_WORDS = new Set([
  'de', 'del', 'con', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'sin', 'por', 'para',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'mi', 'mis',
  'x', 'porcion', 'porciones', 'plato', 'pedazo', 'un', 'poco',
]);

/** Content tokens of a description: normalised, no stop words, no numbers, singular. */
export function tokenize(description: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeDescription(description).split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2) continue;
    if (/^\d+$/.test(raw)) continue;
    const word = raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (STOP_WORDS.has(word) || STOP_WORDS.has(raw)) continue;
    out.add(word);
  }
  return out;
}

/** |A ∩ B| / |A ∪ B|; 0 when either side is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The client-side half of the Cloud Function's validation; a rejected row is silently skipped. */
export function toExample(row: CorrectionRow): EstimateExample | null {
  const description = String(row.description ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!description || description.length > EXAMPLE_DESCRIPTION_MAX_CHARS) return null;
  const calories = row.calories;
  if (typeof calories !== 'number' || !Number.isFinite(calories) || calories < EXAMPLE_KCAL_MIN || calories > EXAMPLE_KCAL_MAX) return null;
  const m = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
  return {
    description,
    calories: Math.round(calories),
    protein_g: m(row.proteinG),
    carbs_g: m(row.carbsG),
    fat_g: m(row.fatG),
  };
}

/**
 * Up to `max` corrections whose description resembles `description`, best
 * match first (ties: most recent first). The exact same normalised description
 * is excluded: that row is the cache hit itself, and when the user explicitly
 * asks to re-estimate it is the number they are rejecting.
 */
export function selectSimilarCorrections(
  description: string,
  rows: CorrectionRow[],
  { threshold = SIMILARITY_THRESHOLD, max = MAX_EXAMPLES }: { threshold?: number; max?: number } = {},
): EstimateExample[] {
  const target = tokenize(description);
  const targetNorm = normalizeDescription(description);
  if (target.size === 0) return [];

  const scored: Array<{ score: number; updatedAt: string; example: EstimateExample }> = [];
  for (const row of rows) {
    if (normalizeDescription(row.description) === targetNorm) continue;
    const score = jaccard(target, tokenize(row.description));
    if (score < threshold) continue;
    const example = toExample(row);
    if (!example) continue;
    scored.push({ score, updatedAt: row.updatedAt ?? '', example });
  }
  scored.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return scored.slice(0, max).map(s => s.example);
}
