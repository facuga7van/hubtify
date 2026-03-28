const GEMINI_API_KEY = 'AIzaSyB8uI3CuYb_XAzz72WrHUv1IDf9HqWQotM';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

export async function estimateWithGemini(description: string): Promise<AiResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: description }] }],
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
      return null;
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as { items?: Array<{ name: string; calories: number }> };
    if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;

    const items = parsed.items
      .filter(it => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0)
      .map(it => ({ name: it.name.trim(), calories: Math.round(it.calories) }));

    if (items.length === 0) return null;

    const totalCalories = items.reduce((sum, it) => sum + it.calories, 0);

    return { calories: totalCalories, items };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[gemini] Request timed out');
    } else {
      console.error('[gemini] Error:', err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
