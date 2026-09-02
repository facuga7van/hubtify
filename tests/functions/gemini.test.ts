import { describe, it, expect } from 'vitest';
import {
  buildGenerationConfig,
  buildRequestBody,
  parseEstimate,
  promptVersionFor,
  isRetryableOutput,
  GeminiOutputError,
  MAX_OUTPUT_ATTEMPTS,
  PROMPT_TAG,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type GeminiResponse,
} from '../../functions/src/gemini';

function reply(text: string, finishReason = 'STOP'): GeminiResponse {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason }] };
}

describe('buildGenerationConfig', () => {
  /**
   * Regression for the 2026-09-02 "estimar con IA tira timeout" report.
   *
   * With `responseSchema` (constrained decoding) and temperature 0.1,
   * gemini-2.5-flash-lite never closes a number for some inputs: for
   * "una manzana" it emits `"protein_g": 1.5000000000000002220446…` followed by
   * zeros until its default output cap, 30+ s later (Cloud Logging: three
   * 30.7 s → 504 executions from the phone, 29.7 s → 200 and 30.2 s → 504 from
   * the desktop the day before; reproduced 5/5 against the API, and 3/3 fixed
   * with the schema removed — the prompt's examples already fix the shape).
   */
  it('does not constrain decoding with a responseSchema', () => {
    const config = buildGenerationConfig();
    expect(config.responseMimeType).toBe('application/json');
    expect(config).not.toHaveProperty('responseSchema');
  });

  it('caps the output so a runaway generation fails in seconds, not at the 30 s abort', () => {
    const config = buildGenerationConfig();
    expect(typeof config.maxOutputTokens).toBe('number');
    expect(config.maxOutputTokens as number).toBeGreaterThan(0);
    expect(config.maxOutputTokens as number).toBeLessThanOrEqual(4096);
  });

  it('keeps temperature 0.1: the 2026-09-02 benchmark found no precision gain above it', () => {
    expect(buildGenerationConfig().temperature).toBe(0.1);
  });

  it('sends the trimmed description and the system prompt', () => {
    const body = buildRequestBody('  una manzana  ', 'PROMPT') as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.contents[0].parts[0].text).toBe('una manzana');
    expect(body.systemInstruction.parts[0].text).toBe('PROMPT');
  });
});

/**
 * The 2026-09-02 benchmark (330 calls, docs/superpowers/plans/2026-09-02-ai-
 * estimation-research.md) found the model repeats the prompt's anchors almost
 * verbatim, so a table of whole-dish Argentine portions is the one lever that
 * moved the error (MAE 49 → 11–18 kcal on covered dishes) without hurting the
 * rest. These tests pin the anchors that fixed the systematic misses.
 */
describe('SYSTEM_PROMPT anchors', () => {
  it('carries a table of whole-dish Argentine portions with macros', () => {
    expect(SYSTEM_PROMPT).toContain('Porciones ESTÁNDAR ARGENTINAS');
    for (const dish of [
      'Choripán', 'Empanada de carne', 'Tostado de jamón y queso', 'Sándwich de miga',
      'Hamburguesa completa', 'Tarta de jamón y queso', 'Pizza muzzarella', 'Bizcochito de grasa',
      'Ñoquis', 'Ravioles', 'Locro', 'Guiso de lentejas', 'Tortilla de papa', 'Alfajor',
      'Fernet con coca', 'Cerveza', 'Sushi', 'Milanesa de pollo',
      // From the real-log set (scratchpad real-set.json, variant R): MAE 203 -> 102 on the user's own dishes.
      'Pastel de papa', 'triple con cheddar y bacon', 'Tofi', 'moccalatte', 'Papa al horno', 'Nuggets',
    ]) {
      expect(SYSTEM_PROMPT, `anchor missing: ${dish}`).toContain(dish);
    }
    // At least 25 anchored dishes, each with the P/C/G triple.
    const rows = SYSTEM_PROMPT.split('\n').filter(l => /kcal.*P \d+(\.\d+)? · C \d+(\.\d+)? · G \d+(\.\d+)?/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });

  it('fixes the three systematic misses: tostado, manzana, bizcochitos', () => {
    // Tostado: 238 kcal in production because "sándwich simple ≤ 350" pushed it down.
    expect(SYSTEM_PROMPT).toMatch(/Tostado de jamón y queso[^\n]*≈ 380 kcal/);
    expect(SYSTEM_PROMPT).not.toContain('NUNCA 450+');
    // Manzana: 52 kcal/100 g was SR Legacy; USDA Foundation says ~60.
    expect(SYSTEM_PROMPT).toMatch(/Manzana: 60 kcal\/100g/);
    // Bizcochitos: 137 kcal for three of them; the unit is 5–6 g / ~28 kcal.
    expect(SYSTEM_PROMPT).toMatch(/Bizcochito de grasa[^\n]*≈ 28 kcal/);
  });

  /**
   * Real-log benchmark (docs/superpowers/plans/2026-09-02-ai-real-benchmark.md):
   * a bare "porción ≈ 450 kcal" anchor made the model read 450 as GRAMS
   * ("porción y media de pastel de papa" → 1350), so every anchor carries
   * kcal/100 g + portion weight + portion kcal, and fractions scale grams.
   */
  it('anchors in the kcal/100 g + portion grams + portion kcal format, scaling grams for fractions', () => {
    expect(SYSTEM_PROMPT).toMatch(/Pastel de papa[^\n]*160 kcal\/100g\. Porción 300g ≈ 480 kcal[^\n]*porción y media 450g ≈ 720 kcal/);
    expect(SYSTEM_PROMPT).toMatch(/Asado de tira[^\n]*290 kcal\/100g[^\n]*250g ≈ 720 kcal/);
    expect(SYSTEM_PROMPT).toMatch(/"porción y media" → ×1\.5 de los GRAMOS/);
    expect(SYSTEM_PROMPT).toMatch(/NUNCA multipliques las kcal por 100g/);
  });

  it('adds the three rules the real set asked for: combo cap, no invented ingredients, unit multipliers', () => {
    expect(SYSTEM_PROMPT).toMatch(/Combo de hamburguesería \(triple \+ papas\): 1500-2000 kcal/);
    expect(SYSTEM_PROMPT).toMatch(/NO inventes ingredientes que el usuario no nombró/);
    expect(SYSTEM_PROMPT).toMatch(/"x3", "×2", "dos", "2 porciones" → multiplicá las unidades/);
  });

  it('does NOT ask the model to reason about grams before answering (variant C lost)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/"reasoning"/);
  });
});

describe('PROMPT_VERSION', () => {
  it('is the tag plus a hash of the prompt text', () => {
    expect(PROMPT_VERSION).toBe(promptVersionFor(SYSTEM_PROMPT));
    expect(PROMPT_VERSION.startsWith(`${PROMPT_TAG}.`)).toBe(true);
    expect(PROMPT_VERSION).toMatch(/\.[0-9a-f]{8}$/);
  });

  it('changes when the prompt changes, so cached model answers get re-estimated', () => {
    expect(promptVersionFor(SYSTEM_PROMPT + ' ')).not.toBe(PROMPT_VERSION);
    expect(promptVersionFor('a')).not.toBe(promptVersionFor('b'));
    // Deterministic: the client and the function must compute the same value.
    expect(promptVersionFor('x')).toBe(promptVersionFor('x'));
  });
});

describe('parseEstimate', () => {
  it('sums calories and the macros the items reported', () => {
    const result = parseEstimate(reply(JSON.stringify({
      items: [
        { name: ' milanesa ', grams: 150, calories: 330.4, protein_g: 24, carbs_g: 18, fat_g: 17 },
        { name: 'puré', grams: 200, calories: 200, protein_g: 4 },
      ],
    })));
    expect(result.calories).toBe(530);
    expect(result.items[0].name).toBe('milanesa');
    expect(result.proteinG).toBe(28);
    expect(result.carbsG).toBe(18);
    expect(result.fatG).toBe(17);
    expect(result.items[1].carbsG).toBeNull();
  });

  it('rejects the truncated digit run-off instead of returning garbage', () => {
    const runaway = '{"items": [{"name": "manzana", "grams": 150, "calories": 78, "protein_g": 1.5' + '0'.repeat(400);
    expect(() => parseEstimate(reply(runaway, 'MAX_TOKENS'))).toThrow(GeminiOutputError);
  });

  it('rejects an empty answer and an empty item list', () => {
    expect(() => parseEstimate({ candidates: [] })).toThrow(GeminiOutputError);
    expect(() => parseEstimate(reply('{"items": []}'))).toThrow(GeminiOutputError);
  });

  it('drops items without positive calories and fails when none survive', () => {
    expect(() => parseEstimate(reply('{"items": [{"name": "agua", "grams": 250, "calories": 0}]}')))
      .toThrow(GeminiOutputError);
  });
});

describe('isRetryableOutput', () => {
  /**
   * 1 of 90 real-set calls answered `{"items": []}` with finishReason STOP
   * (5 tokens, an ambiguous "desayuno proteico"). Temperature 0.1 is not
   * deterministic, so one more call is worth more than an error toast.
   */
  it('retries once on an empty or unparseable answer, never on transport errors', () => {
    expect(isRetryableOutput(new GeminiOutputError('unparseable', 'x'))).toBe(true);
    expect(isRetryableOutput(new GeminiOutputError('empty', 'x'))).toBe(true);
    expect(isRetryableOutput(new GeminiOutputError('no-items', 'x'))).toBe(true);
    expect(isRetryableOutput(new Error('fetch failed'))).toBe(false);
    expect(MAX_OUTPUT_ATTEMPTS).toBe(2);
  });
});
