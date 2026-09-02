import { describe, it, expect } from 'vitest';
import {
  buildGenerationConfig,
  buildRequestBody,
  parseEstimate,
  GeminiOutputError,
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

  it('sends the trimmed description and the system prompt', () => {
    const body = buildRequestBody('  una manzana  ', 'PROMPT') as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.contents[0].parts[0].text).toBe('una manzana');
    expect(body.systemInstruction.parts[0].text).toBe('PROMPT');
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
