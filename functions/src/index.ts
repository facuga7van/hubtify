import * as functions from 'firebase-functions/v1';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `Sos un nutricionista que estima calorías de comida argentina con precisión. Pensá en GRAMOS primero, después calculá calorías.

MÉTODO: Para cada ingrediente → estimá gramos → aplicá kcal/100g → resultado.

Reglas:
- Cada ingrediente SEPARADO con su peso en gramos y calorías
- Si hay cantidad (ej: "2 milanesas"), reflejar TODAS las unidades
- Sé CONSERVADOR: ante duda, estimá porciones normales, NO exageres
- Si no reconocés la comida, estimá lo más cercano

Modificadores de tamaño (OBLIGATORIO respetar):
- "pequeño/chico/mini/pedacito" → 50-70% del peso estándar
- "grande/doble/abundante" → 140-170% del peso estándar
- Sin modificador → porción estándar casera argentina

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
- Milanesa (empanada y frita): 220 kcal/100g (1 unidad = 130-160g)
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
- Manzana: 52 kcal/100g (1 unidad = 150g)

Pesos de referencia por formato:
- Sándwich de miga: 2 tapas = 30g total de pan
- Sándwich pan de molde: 2 rebanadas = 50-60g de pan
- Sándwich pancito/felipe: 1 pan = 50-60g
- Tostada: 1 rebanada = 25g
- Plato de comida: 300-400g total

Límites de sanidad (si tu estimación excede esto, REVISÁ):
- Sándwich/sanguche simple: 150-350 kcal (NUNCA 450+ para uno chico)
- Plato principal (milanesa/pasta/etc): 400-700 kcal
- Snack/merienda: 80-250 kcal
- Fruta sola: 40-120 kcal
- Bebida sin alcohol: 0-150 kcal

Ejemplos:
Input: "milanesa con puré"
→ {"items": [{"name": "milanesa", "grams": 150, "calories": 330}, {"name": "puré de papas", "grams": 200, "calories": 200}]}

Input: "3 empanadas de carne"
→ {"items": [{"name": "empanada de carne x3", "grams": 360, "calories": 900}]}

Input: "sanguche chico de queso y tomate"
→ {"items": [{"name": "pan de molde x2 rebanadas (chico)", "grams": 40, "calories": 106}, {"name": "queso cremoso (1 feta)", "grams": 20, "calories": 60}, {"name": "tomate (2 rodajas)", "grams": 40, "calories": 7}]}

Input: "café con leche y 2 medialunas"
→ {"items": [{"name": "café con leche", "grams": 200, "calories": 75}, {"name": "medialuna x2", "grams": 100, "calories": 350}]}

Input: "ensalada de lechuga, tomate y huevo"
→ {"items": [{"name": "lechuga", "grams": 60, "calories": 9}, {"name": "tomate", "grams": 100, "calories": 18}, {"name": "huevo duro", "grams": 50, "calories": 78}, {"name": "aceite (aderezo)", "grams": 10, "calories": 90}]}`;

export const estimateNutrition = functions
  .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const description = data?.description;
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Description is required');
    }

    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: description.trim() }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                items: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      name: { type: 'STRING', description: 'Ingredient name with portion context' },
                      grams: { type: 'INTEGER', description: 'Estimated weight in grams' },
                      calories: { type: 'INTEGER', description: 'Calories calculated from grams × kcal/100g' },
                    },
                    required: ['name', 'grams', 'calories'],
                  },
                },
              },
              required: ['items'],
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[gemini] API error:', response.status, errText.slice(0, 200));
        throw new functions.https.HttpsError('internal', 'AI estimation failed');
      }

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new functions.https.HttpsError('internal', 'No response from AI');
      }

      const parsed = JSON.parse(text) as { items?: Array<{ name: string; calories: number }> };
      if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new functions.https.HttpsError('internal', 'Could not parse AI response');
      }

      const items = parsed.items
        .filter(it => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0)
        .map(it => ({ name: it.name.trim(), calories: Math.round(it.calories) }));

      if (items.length === 0) {
        throw new functions.https.HttpsError('internal', 'No valid items in AI response');
      }

      const calories = items.reduce((sum, it) => sum + it.calories, 0);

      return { calories, items };
    } catch (err) {
      if (err instanceof functions.https.HttpsError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new functions.https.HttpsError('deadline-exceeded', 'AI request timed out');
      }
      console.error('[gemini] Error:', err);
      throw new functions.https.HttpsError('internal', 'AI estimation failed');
    } finally {
      clearTimeout(timeout);
    }
  });
