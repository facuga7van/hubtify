import * as functions from 'firebase-functions/v1';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `Sos un estimador preciso de calorías de comida argentina. Respondé SOLO con JSON válido.

Formato EXACTO:
{"items": [{"name": "<ingrediente>", "calories": <número>}, ...]}

Reglas:
- Estimá porciones típicas argentinas
- Redondeá hacia arriba si hay duda
- Cada ingrediente en un item separado con sus calorías individuales
- Si hay cantidad (ej: "2 milanesas"), las calorías deben reflejar TODAS las unidades
- SOLO JSON, sin texto adicional, sin explicaciones, sin markdown
- Si no reconocés la comida, estimá lo más cercano

Ejemplos:
Input: "milanesa con puré" → {"items": [{"name": "milanesa", "calories": 350}, {"name": "puré de papas", "calories": 200}]}
Input: "3 empanadas de carne" → {"items": [{"name": "empanada de carne x3", "calories": 900}]}
Input: "café con leche y 2 medialunas" → {"items": [{"name": "café con leche", "calories": 80}, {"name": "medialuna x2", "calories": 400}]}`;

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
                      name: { type: 'STRING' },
                      calories: { type: 'INTEGER' },
                    },
                    required: ['name', 'calories'],
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
