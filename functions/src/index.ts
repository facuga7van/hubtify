import * as functions from 'firebase-functions/v1';
import { GEMINI_MODEL, GeminiOutputError, buildRequestBody, parseEstimate, type GeminiResponse } from './gemini';

const SYSTEM_PROMPT = `Sos un nutricionista que estima calorías de comida argentina con precisión. Pensá en GRAMOS primero, después calculá calorías.

MÉTODO: Para cada ingrediente → estimá gramos → aplicá kcal/100g → resultado. Estimá también los MACROS (proteína, carbohidratos, grasa) en gramos por ingrediente.

Reglas:
- Cada ingrediente SEPARADO con su peso en gramos, calorías y macros (protein_g, carbs_g, fat_g)
- Los macros van en GRAMOS del ingrediente (no por 100g). Aproximadamente: proteína 4 kcal/g, carbohidratos 4 kcal/g, grasa 9 kcal/g
- Si no podés estimar un macro con confianza, devolvé 0 para ese macro
- Si hay cantidad (ej: "2 milanesas"), reflejar TODAS las unidades
- Sé CONSERVADOR: ante duda, estimá porciones normales, NO exageres
- Si no reconocés la comida, estimá lo más cercano
- protein_g de referencia por 100g: carne vacuna 26, pollo 31, milanesa 18, huevo 13, queso cremoso 18, queso rallado 33, leche 3, pan 8, arroz/fideos cocidos 4-5, papa/puré 2, verduras 1-2, dulces/galletitas 4-6

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
→ {"items": [{"name": "milanesa", "grams": 150, "calories": 330, "protein_g": 24, "carbs_g": 18, "fat_g": 17}, {"name": "puré de papas", "grams": 200, "calories": 200, "protein_g": 4, "carbs_g": 30, "fat_g": 6}]}

Input: "3 empanadas de carne"
→ {"items": [{"name": "empanada de carne x3", "grams": 360, "calories": 900, "protein_g": 33, "carbs_g": 75, "fat_g": 48}]}

Input: "sanguche chico de queso y tomate"
→ {"items": [{"name": "pan de molde x2 rebanadas (chico)", "grams": 40, "calories": 106, "protein_g": 4, "carbs_g": 20, "fat_g": 1}, {"name": "queso cremoso (1 feta)", "grams": 20, "calories": 60, "protein_g": 4, "carbs_g": 1, "fat_g": 5}, {"name": "tomate (2 rodajas)", "grams": 40, "calories": 7, "protein_g": 0, "carbs_g": 2, "fat_g": 0}]}

Input: "café con leche y 2 medialunas"
→ {"items": [{"name": "café con leche", "grams": 200, "calories": 75, "protein_g": 6, "carbs_g": 9, "fat_g": 3}, {"name": "medialuna x2", "grams": 100, "calories": 350, "protein_g": 6, "carbs_g": 40, "fat_g": 18}]}

Input: "ensalada de lechuga, tomate y huevo"
→ {"items": [{"name": "lechuga", "grams": 60, "calories": 9, "protein_g": 1, "carbs_g": 2, "fat_g": 0}, {"name": "tomate", "grams": 100, "calories": 18, "protein_g": 1, "carbs_g": 4, "fat_g": 0}, {"name": "huevo duro", "grams": 50, "calories": 78, "protein_g": 6, "carbs_g": 1, "fat_g": 5}, {"name": "aceite (aderezo)", "grams": 10, "calories": 90, "protein_g": 0, "carbs_g": 0, "fat_g": 10}]}`;

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
        body: JSON.stringify(buildRequestBody(description, SYSTEM_PROMPT)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[gemini] API error:', response.status, errText.slice(0, 200));
        throw new functions.https.HttpsError('internal', 'AI estimation failed');
      }

      const data = await response.json() as GeminiResponse;
      return parseEstimate(data);
    } catch (err) {
      if (err instanceof functions.https.HttpsError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new functions.https.HttpsError('deadline-exceeded', 'AI request timed out');
      }
      if (err instanceof GeminiOutputError) {
        console.error('[gemini] Bad output:', err.reason, err.message);
        throw new functions.https.HttpsError('internal', err.message);
      }
      console.error('[gemini] Error:', err);
      throw new functions.https.HttpsError('internal', 'AI estimation failed');
    } finally {
      clearTimeout(timeout);
    }
  });
