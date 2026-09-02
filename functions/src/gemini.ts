/**
 * The Gemini half of `estimateNutrition`, kept free of firebase-functions so the
 * request we send and the way we read the answer can be unit-tested from the
 * repo root (tests/functions/gemini.test.ts) without deploying anything.
 */

export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

export interface EstimateItem {
  name: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface Estimate {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  items: EstimateItem[];
}

/** The subset of a `generateContent` response we read. */
export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

export type GeminiOutputReason = 'empty' | 'unparseable' | 'no-items';

/** The model answered, but not with something we can turn into an estimate. */
export class GeminiOutputError extends Error {
  constructor(
    public readonly reason: GeminiOutputReason,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiOutputError';
  }
}

/**
 * Ceiling for the answer. A plate with 7 items is ~350 tokens; 2048 leaves
 * room for the biggest asado and still turns a runaway generation into a
 * MAX_TOKENS answer after ~3 s instead of a 30 s abort.
 */
export const MAX_OUTPUT_TOKENS = 2048;

/**
 * JSON mode WITHOUT a `responseSchema`.
 *
 * There used to be one (items[].name/grams/calories/protein_g/carbs_g/fat_g).
 * Schema-constrained decoding is what made gemini-2.5-flash-lite loop on some
 * inputs: for "una manzana" it wrote `"protein_g": 1.5000000000000002220446…`
 * and kept emitting zeros until the output cap, i.e. 30+ s per call — every
 * call, since temperature 0.1 is near-deterministic. Cloud Logging for the
 * 2026-09-02 report shows exactly that (three 30.7 s → 504 executions), and
 * the same signature the day before from the desktop. Without the schema the
 * same inputs answer in ~1 s with the shape the prompt's examples describe;
 * `parseEstimate` validates that shape anyway.
 */
export function buildGenerationConfig(): Record<string, unknown> {
  return {
    temperature: 0.1,
    responseMimeType: 'application/json',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
}

/** The full `generateContent` body for one description. */
export function buildRequestBody(description: string, systemPrompt: string): Record<string, unknown> {
  return {
    contents: [{ parts: [{ text: description.trim() }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: buildGenerationConfig(),
  };
}

/** Coerce a macro value: keep null when absent/invalid so it never fakes a 0. */
function macro(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
}

/** Turn a `generateContent` response into the estimate the app consumes. */
export function parseEstimate(data: GeminiResponse): Estimate {
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiOutputError('empty', 'No response from AI');
  }

  let parsed: {
    items?: Array<{ name: string; calories: number; protein_g?: unknown; carbs_g?: unknown; fat_g?: unknown }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiOutputError('unparseable', 'Could not parse AI response');
  }
  if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new GeminiOutputError('unparseable', 'Could not parse AI response');
  }

  const items = parsed.items
    .filter(it => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0)
    .map(it => ({
      name: it.name.trim(),
      calories: Math.round(it.calories),
      proteinG: macro(it.protein_g),
      carbsG: macro(it.carbs_g),
      fatG: macro(it.fat_g),
    }));

  if (items.length === 0) {
    throw new GeminiOutputError('no-items', 'No valid items in AI response');
  }

  const calories = items.reduce((sum, it) => sum + it.calories, 0);

  // Sum only the items that reported a given macro; null if none did (backward compatible).
  const sumMacro = (key: 'proteinG' | 'carbsG' | 'fatG'): number | null => {
    const present = items.map(it => it[key]).filter((v): v is number => v != null);
    return present.length > 0 ? Math.round(present.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };

  return {
    calories,
    proteinG: sumMacro('proteinG'),
    carbsG: sumMacro('carbsG'),
    fatG: sumMacro('fatG'),
    items,
  };
}
