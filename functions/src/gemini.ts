/**
 * The Gemini half of `estimateNutrition`, kept free of firebase-functions so the
 * prompt, the request we send and the way we read the answer can be unit-tested
 * from the repo root (tests/functions/gemini.test.ts) and benchmarked
 * (scripts/ai-benchmark.mjs) without deploying anything.
 *
 * This file has NO imports on purpose: the benchmark loads it with Node's type
 * stripping (`node --experimental-strip-types`), and `shared-logic` imports
 * `PROMPT_VERSION` from here to decide whether a cached model answer is stale.
 */

export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Human-readable half of PROMPT_VERSION. Bump the date/letter when the prompt
 * changes in a way worth naming; the hash half changes on its own.
 *
 * 2026-09-02-b: whole-dish Argentine portion anchors (variant B of the
 * 2026-09-02 benchmark, docs/superpowers/plans/2026-09-02-ai-estimation-
 * research.md), tostado/manzana/bizcochitos fixed, sandwich cap relaxed.
 */
export const PROMPT_TAG = '2026-09-02-b';

/**
 * Whole-dish anchors. The benchmark found the model repeats the prompt's
 * numbers almost verbatim ("milanesa con puré" → 530 in 22/22 runs across 7
 * models, because that is the first few-shot), so anchoring the 25–30 dishes
 * one person repeats most of the time is the cheapest precision there is:
 * covered dishes went from MAE 49 to 11–18 kcal; uncovered ones did not move.
 *
 * Values are per unit / standard home portion, midpoints of public sources
 * (Argenfoods/UNLu via Diquecito, FatSecret AR, Nutrola, Fitia, USDA FDC);
 * macros are P/C/G in grams, composed from the ingredient table where no
 * source gives them. Sources per dish: research doc §4.4.
 */
const DISH_ANCHORS = `Porciones ESTÁNDAR ARGENTINAS de platos completos. Formato: kcal por 100g, peso de la porción y kcal de ESA porción, con macros P=proteína C=carbohidratos G=grasa en gramos de la porción. Usalas como ancla cuando el usuario NO da cantidad. Para escalar multiplicá SIEMPRE los gramos de la porción; nunca confundas "480 kcal" con "480 g":
- Milanesa de carne (empanada y frita): 235 kcal/100g. 1 unidad 150g ≈ 350 kcal · P 25 · C 18 · G 19
- Milanesa de pollo: 220 kcal/100g. 1 unidad 130g ≈ 290 kcal · P 26 · C 16 · G 13
- Milanesa napolitana con papas fritas (plato): 1 milanesa + salsa, jamón y queso + papas 150g ≈ 1050 kcal · P 45 · C 90 · G 55
- Empanada de carne al horno: 240 kcal/100g. 1 unidad 120g ≈ 290 kcal · P 11 · C 25 · G 16 (frita: +25%)
- Choripán: chorizo 80g + pan 80g + chimichurri ≈ 480 kcal · P 20 · C 40 · G 26
- Asado de tira / costilla con grasa: 290 kcal/100g (NO uses "carne magra" para el asado). Porción 250g ≈ 720 kcal · P 55 · C 0 · G 54
- Chorizo criollo: 320 kcal/100g. 1 unidad 80g ≈ 256 kcal · P 12 · C 1 · G 23
- Papa al horno con aceite: 120 kcal/100g. Porción 150g ≈ 180 kcal · P 3 · C 30 · G 6
- Pastel de papa (carne picada + puré + queso): 160 kcal/100g. Porción 300g ≈ 480 kcal · P 22 · C 45 · G 23; porción chica 200g ≈ 320 kcal; porción y media 450g ≈ 720 kcal; 2 porciones 600g ≈ 960 kcal
- Pizza muzzarella: 230 kcal/100g. 1 porción (1/8 de grande) 130g ≈ 300 kcal · P 13 · C 33 · G 13
- Pizza fugazzeta: 1 porción 140g ≈ 340 kcal · P 12 · C 36 · G 16
- Tarta de jamón y queso: 215 kcal/100g. 1 porción (1/8) 200g ≈ 430 kcal · P 18 · C 30 · G 26
- Tostado de jamón y queso de bar: 2 tapas grandes (pan 85g + jamón 40g + queso 40g) ≈ 380 kcal · P 20 · C 36 · G 17. Es un sándwich GRANDE: 350-450 kcal es lo normal, no lo achiques
- Sándwich de miga jamón y queso: 210 kcal/100g. 1 unidad (2 tapas) 90g ≈ 190 kcal · P 10 · C 18 · G 8; "x3" = 3 unidades ≈ 570 kcal; 1 triángulo ≈ 95 kcal
- Hamburguesa completa casera (pan, medallón, jamón, queso, huevo, lechuga, tomate): 1 unidad 300g ≈ 600 kcal · P 35 · C 40 · G 32
- Hamburguesa de local/cadena: simple ≈ 550 kcal · P 30 · C 40 · G 30; doble ≈ 850 kcal · P 50 · C 42 · G 52; triple con cheddar y bacon ≈ 1150 kcal · P 70 · C 45 · G 75. "Triple" = 3 medallones en UN solo pan
- Papas fritas de local: 290 kcal/100g. Porción mediana 150g ≈ 430 kcal · P 5 · C 50 · G 23
- Nuggets de pollo: 6 unidades 110g ≈ 280 kcal · P 15 · C 18 · G 17
- Arroz cocido: 130 kcal/100g. Porción 180g ≈ 235 kcal · P 5 · C 50 · G 1
- Pechuga de pollo hervida o a la plancha: 165 kcal/100g. Porción 150g ≈ 250 kcal · P 46 · C 0 · G 6; chica 110g ≈ 180 kcal
- Fideos con tuco: 160 kcal/100g. Plato 300g (fideos cocidos 200g + tuco 90g + queso rallado 10g) ≈ 480 kcal · P 16 · C 70 · G 14
- Ñoquis con salsa: 180 kcal/100g. Porción 250g ≈ 450 kcal · P 12 · C 75 · G 11
- Ravioles con tuco: porción 280g ≈ 520 kcal · P 20 · C 70 · G 17
- Pollo al horno con papas: 1/4 de pollo 250g + papas 150g ≈ 650 kcal · P 45 · C 40 · G 33
- Tortilla de papa: 175 kcal/100g. 1 porción (1/4) 200g ≈ 350 kcal · P 10 · C 30 · G 21
- Locro: 130 kcal/100g. Plato hondo 420g ≈ 550 kcal · P 25 · C 55 · G 25
- Guiso de lentejas: 110 kcal/100g. Plato hondo 400g ≈ 450 kcal · P 22 · C 55 · G 14
- Ensalada César con pollo: plato 300g ≈ 420 kcal · P 30 · C 15 · G 27
- Sushi: 10 piezas variadas 300g ≈ 400 kcal · P 18 · C 60 · G 9
- Medialuna de manteca: 350 kcal/100g. 1 unidad 45g ≈ 150 kcal · P 3 · C 18 · G 7
- Medialuna con jamón y queso: 1 unidad ≈ 260 kcal · P 11 · C 20 · G 15
- Factura (vigilante, cañoncito, bola de fraile): 1 unidad 60g ≈ 200 kcal · P 4 · C 26 · G 9
- Alfajor: simple 50g ≈ 220 kcal · P 3 · C 32 · G 9; triple 70g ≈ 280 kcal · P 4 · C 38 · G 11
- Golosinas por paquete: M&M 45g ≈ 230 kcal · P 4 · C 30 · G 11; Tofi barra 30g ≈ 155 kcal · P 2 · C 18 · G 8 (Tofi bañado grande 60g ≈ 300 kcal)
- Bizcochito de grasa: 500 kcal/100g. 1 unidad 5-6g ≈ 28 kcal · P 0.5 · C 3 · G 1.5 (Don Satur: 6 unidades = 155 kcal)
- Tostadas con dulce de leche: 2 rebanadas de pan de molde 55g + 2 cdas de dulce de leche 40g ≈ 260 kcal · P 6 · C 45 · G 6
- Café con leche de bar: 200ml de leche entera + 1 sobre de azúcar ≈ 130 kcal · P 6 · C 17 · G 5
- Café de cadena: moccalatte / mocha grande 450ml ≈ 300 kcal · P 10 · C 40 · G 11; latte grande ≈ 190 kcal · P 10 · C 18 · G 8
- Cortado (café chico con un poco de leche): ≈ 30 kcal · P 1 · C 3 · G 1
- Mate cebado sin azúcar: ≈ 5 kcal · P 0 · C 1 · G 0 (con azúcar: +20 kcal por cucharadita)
- Yogur entero 200g + granola 40g ≈ 310 kcal · P 12 · C 42 · G 10
- Cerveza 500ml ≈ 215 kcal · P 2 · C 18 · G 0
- Copa de vino 150ml ≈ 125 kcal · P 0 · C 4 · G 0
- Fernet con coca, vaso 250ml ≈ 200 kcal · P 0 · C 25 · G 0`;

export const SYSTEM_PROMPT = `Sos un nutricionista que estima calorías de comida argentina con precisión. Pensá en GRAMOS primero, después calculá calorías.

MÉTODO: Para cada ingrediente → estimá gramos → aplicá kcal/100g → resultado. Estimá también los MACROS (proteína, carbohidratos, grasa) en gramos por ingrediente.

Reglas:
- Cada ingrediente SEPARADO con su peso en gramos, calorías y macros (protein_g, carbs_g, fat_g)
- Los macros van en GRAMOS del ingrediente (no por 100g). Aproximadamente: proteína 4 kcal/g, carbohidratos 4 kcal/g, grasa 9 kcal/g
- Si no podés estimar un macro con confianza, devolvé 0 para ese macro
- Si hay cantidad (ej: "2 milanesas"), reflejar TODAS las unidades
- Sé CONSERVADOR: ante duda, estimá porciones normales, NO exageres
- Si no reconocés la comida, estimá lo más cercano
- NO inventes ingredientes que el usuario no nombró (nada de "salsa especial (estimado)", ni cheddar ni huevo si no los dijo): el usuario escribe lo que comió
- protein_g de referencia por 100g: carne vacuna 26, pollo 31, milanesa 18, huevo 13, queso cremoso 18, queso rallado 33, leche 3, pan 8, arroz/fideos cocidos 4-5, papa/puré 2, verduras 1-2, dulces/galletitas 4-6

Modificadores de tamaño (OBLIGATORIO respetar):
- "pequeño/chico/mini/pedacito" → 50-70% del peso estándar
- "grande/doble/abundante" → 140-170% del peso estándar
- "porción y media" → ×1.5 de los GRAMOS de una porción; "media porción" → ×0.5; "x3", "×2", "dos", "2 porciones" → multiplicá las unidades. NUNCA multipliques las kcal por 100g como si fueran las kcal de la porción
- Sin modificador → porción estándar casera argentina

${DISH_ANCHORS}

Tabla de referencia (kcal por 100g):
- Pan blanco/molde: 265 kcal/100g (1 rebanada = 25-30g)
- Pan francés/felipe: 280 kcal/100g (1 unidad = 50-60g)
- Queso cremoso/barra: 300 kcal/100g (1 feta fina = 20g, 1 feta gruesa = 35g)
- Queso rallado: 420 kcal/100g (1 cda = 7g)
- Palta/aguacate: 160 kcal/100g (1/4 palta = 40g, 1/2 = 80g)
- Tomate: 18 kcal/100g (2-3 rodajas = 50g)
- Lechuga: 15 kcal/100g (un puñado = 30g)
- Carne vacuna magra: 250 kcal/100g
- Pollo (pechuga): 165 kcal/100g
- Milanesa (empanada y frita): 235 kcal/100g (1 unidad = 130-160g)
- Arroz cocido: 130 kcal/100g (porción = 150-180g)
- Fideos cocidos: 131 kcal/100g (porción = 180-220g)
- Papa cocida: 77 kcal/100g
- Puré (con leche/manteca): 100 kcal/100g (porción = 200g)
- Huevo: 155 kcal/100g (1 unidad = 50g)
- Aceite/manteca: 900/720 kcal/100g (1 cda = 10-14g)
- Leche entera: 61 kcal/100g (1 taza = 200ml)
- Medialuna manteca: 350 kcal/100g (1 unidad = 50g)
- Empanada: 250 kcal/100g (1 unidad = 110-130g)
- Galletitas dulces: 450 kcal/100g (1 unidad = 8-12g)
- Dulce de leche: 315 kcal/100g (1 cda = 20g)
- Banana: 89 kcal/100g (1 unidad = 120g sin cáscara)
- Manzana: 60 kcal/100g (1 unidad = 150g → ~90 kcal)

Pesos de referencia por formato:
- Sándwich de miga: 2 tapas = 30g total de pan
- Sándwich pan de molde: 2 rebanadas = 50-60g de pan
- Sándwich pancito/felipe: 1 pan = 50-60g
- Tostado de bar: 2 tapas grandes = 80-90g de pan + jamón 40g + queso 40g
- Tostada: 1 rebanada = 25g
- Plato de comida: 300-400g total

Límites de sanidad (si tu estimación excede esto, REVISÁ):
- Sándwich chico o de miga: 150-350 kcal
- Tostado de bar o sándwich completo en pancito: 350-500 kcal
- Plato principal (milanesa/pasta/etc): 400-700 kcal
- Combo de hamburguesería (triple + papas): 1500-2000 kcal
- Snack/merienda: 80-250 kcal
- Fruta sola: 40-120 kcal
- Bebida sin alcohol: 0-150 kcal

Ejemplos:
Input: "milanesa con puré"
→ {"items": [{"name": "milanesa", "grams": 150, "calories": 350, "protein_g": 25, "carbs_g": 18, "fat_g": 19}, {"name": "puré de papas", "grams": 200, "calories": 200, "protein_g": 4, "carbs_g": 30, "fat_g": 6}]}

Input: "3 empanadas de carne"
→ {"items": [{"name": "empanada de carne x3", "grams": 360, "calories": 900, "protein_g": 33, "carbs_g": 75, "fat_g": 48}]}

Input: "sanguche chico de queso y tomate"
→ {"items": [{"name": "pan de molde x2 rebanadas (chico)", "grams": 40, "calories": 106, "protein_g": 4, "carbs_g": 20, "fat_g": 1}, {"name": "queso cremoso (1 feta)", "grams": 20, "calories": 60, "protein_g": 4, "carbs_g": 1, "fat_g": 5}, {"name": "tomate (2 rodajas)", "grams": 40, "calories": 7, "protein_g": 0, "carbs_g": 2, "fat_g": 0}]}

Input: "café con leche y 2 medialunas"
→ {"items": [{"name": "café con leche", "grams": 200, "calories": 75, "protein_g": 6, "carbs_g": 9, "fat_g": 3}, {"name": "medialuna x2", "grams": 100, "calories": 350, "protein_g": 6, "carbs_g": 40, "fat_g": 18}]}

Input: "ensalada de lechuga, tomate y huevo"
→ {"items": [{"name": "lechuga", "grams": 60, "calories": 9, "protein_g": 1, "carbs_g": 2, "fat_g": 0}, {"name": "tomate", "grams": 100, "calories": 18, "protein_g": 1, "carbs_g": 4, "fat_g": 0}, {"name": "huevo duro", "grams": 50, "calories": 78, "protein_g": 6, "carbs_g": 1, "fat_g": 5}, {"name": "aceite (aderezo)", "grams": 10, "calories": 90, "protein_g": 0, "carbs_g": 0, "fat_g": 10}]}`;

/**
 * FNV-1a (32-bit) over the UTF-16 code units of `text`, as 8 hex chars.
 *
 * Plain JS, no `crypto`: this must run identically in the Cloud Function, the
 * Electron main process, the Android worker and a Vitest test. It only has to
 * tell two prompts apart, not resist an adversary.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `<tag>.<hash>` for an arbitrary prompt text (tests, benchmark variants). */
export function promptVersionFor(prompt: string): string {
  return `${PROMPT_TAG}.${fnv1a(prompt)}`;
}

/**
 * Identifies the prompt that produced an estimate. Stored next to every cached
 * MODEL answer; a cached row with a different version is re-estimated, a row
 * the USER corrected is kept regardless (shared-logic/modules/nutrition.ipc.ts).
 */
export const PROMPT_VERSION = promptVersionFor(SYSTEM_PROMPT);

// ─────────────────────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────────────────────

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
  readonly reason: GeminiOutputReason;

  constructor(reason: GeminiOutputReason, message: string) {
    super(message);
    this.name = 'GeminiOutputError';
    this.reason = reason;
  }
}

/**
 * How many times the model gets asked before an unusable answer is an error.
 *
 * 1 of 90 real-set calls (2026-09-02-ai-real-benchmark.md §3.1) came back as
 * `{"items": []}` with finishReason STOP and 5 output tokens. Temperature 0.1
 * is near- but not fully deterministic, so a second call usually answers;
 * transport errors and timeouts are NOT retried here (the client already
 * retries `internal`, and a timeout would just run the slow prompt again).
 */
export const MAX_OUTPUT_ATTEMPTS = 2;

/** True for the answers worth one more call: the model spoke, but said nothing usable. */
export function isRetryableOutput(err: unknown): boolean {
  return err instanceof GeminiOutputError;
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
 *
 * Temperature stays at 0.1: the benchmark measured 13/15 identical answers
 * between two runs at this value and no precision gain from moving it.
 */
export function buildGenerationConfig(): Record<string, unknown> {
  return {
    temperature: 0.1,
    responseMimeType: 'application/json',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal examples (P3): what THIS user said similar dishes weigh
// ─────────────────────────────────────────────────────────────────────────────

/** One correction the user made, offered back to the model as an anchor. */
export interface UserExample {
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export const MAX_EXAMPLES = 3;
export const EXAMPLE_DESCRIPTION_MAX_CHARS = 120;
export const EXAMPLE_KCAL_MIN = 10;
export const EXAMPLE_KCAL_MAX = 3000;

/**
 * Keeps only examples that are safe to put in front of the model: at most
 * MAX_EXAMPLES, a one-line description of bounded length, a plausible calorie
 * count and finite non-negative macros (or null). Anything else is dropped,
 * never "fixed" — the client applies the same rules, so a rejected example is
 * a bug or a forged payload, and either way silence is the right answer.
 */
export function sanitizeExamples(raw: unknown): UserExample[] {
  if (!Array.isArray(raw)) return [];
  const out: UserExample[] = [];
  for (const item of raw) {
    if (out.length >= MAX_EXAMPLES) break;
    if (!item || typeof item !== 'object') continue;
    const ex = item as Record<string, unknown>;
    if (typeof ex.description !== 'string') continue;
    const description = ex.description.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!description || description.length > EXAMPLE_DESCRIPTION_MAX_CHARS) continue;
    const calories = ex.calories;
    if (typeof calories !== 'number' || !isFinite(calories) || calories < EXAMPLE_KCAL_MIN || calories > EXAMPLE_KCAL_MAX) continue;
    const m = (v: unknown): number | null | undefined =>
      v == null ? null : (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined);
    const protein_g = m(ex.protein_g);
    const carbs_g = m(ex.carbs_g);
    const fat_g = m(ex.fat_g);
    if (protein_g === undefined || carbs_g === undefined || fat_g === undefined) continue;
    out.push({ description, calories: Math.round(calories), protein_g, carbs_g, fat_g });
  }
  return out;
}

/**
 * The user turn. Without examples it is exactly the trimmed description, so
 * the benchmark (which sends none) measures the prompt alone. With examples
 * they go in the USER turn, before the dish, as this user's own records: the
 * model repeats anchors almost verbatim (2026-09-02 research §2), and a text
 * in the user turn cannot rewrite the rules in the system instruction.
 */
export function buildUserTurn(description: string, examples: UserExample[] = []): string {
  const dish = description.trim();
  if (examples.length === 0) return dish;
  const fmt = (v: number | null) => (v == null ? '?' : `${v} g`);
  const lines = examples.map(ex =>
    `- "${ex.description}": ${ex.calories} kcal (P ${fmt(ex.protein_g)} · C ${fmt(ex.carbs_g)} · G ${fmt(ex.fat_g)})`);
  return [
    'Registros anteriores de ESTE usuario para platos parecidos (priorizá su porción):',
    ...lines,
    '',
    `Plato a estimar: ${dish}`,
  ].join('\n');
}

/** The full `generateContent` body for one description. */
export function buildRequestBody(
  description: string,
  systemPrompt: string,
  examples: UserExample[] = [],
): Record<string, unknown> {
  return {
    contents: [{ parts: [{ text: buildUserTurn(description, examples) }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: buildGenerationConfig(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response
// ─────────────────────────────────────────────────────────────────────────────

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
