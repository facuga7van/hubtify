import * as functions from 'firebase-functions/v1';
import {
  GEMINI_MODEL,
  MAX_OUTPUT_ATTEMPTS,
  SYSTEM_PROMPT,
  GeminiOutputError,
  buildRequestBody,
  isRetryableOutput,
  parseEstimate,
  sanitizeExamples,
  type GeminiResponse,
} from './gemini';

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
    // The user's own corrections for similar dishes, chosen client-side and
    // validated again here (max 3, bounded text, plausible kcal).
    const examples = sanitizeExamples(data?.examples);
    const body = JSON.stringify(buildRequestBody(description, SYSTEM_PROMPT, examples));

    const askOnce = async (): Promise<ReturnType<typeof parseEstimate>> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[gemini] API error:', response.status, errText.slice(0, 200));
        throw new functions.https.HttpsError('internal', 'AI estimation failed');
      }

      return parseEstimate(await response.json() as GeminiResponse);
    };

    try {
      // One more call when the model answered with nothing usable (see
      // MAX_OUTPUT_ATTEMPTS). The same 30 s budget covers both attempts.
      for (let attempt = 1; ; attempt++) {
        try {
          return await askOnce();
        } catch (err) {
          if (attempt >= MAX_OUTPUT_ATTEMPTS || !isRetryableOutput(err)) throw err;
          console.warn('[gemini] Bad output, retrying once:', (err as GeminiOutputError).reason);
        }
      }
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
