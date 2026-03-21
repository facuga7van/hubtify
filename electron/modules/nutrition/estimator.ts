import { searchFoodDatabase } from './food-db';
import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama } from './ollama';
import type { EstimationMatch, EstimationResult } from '../../../shared/types';

export function combineResults(
  dbMatches: EstimationMatch[],
  aiResult: { calories: number; breakdown: string } | null,
  ollamaMissing = false,
  unmatchedTokens: string[] = [],
  aiError?: string,
): EstimationResult {
  const matches: EstimationMatch[] = [...dbMatches];

  if (aiResult) {
    matches.push({ name: aiResult.breakdown, calories: aiResult.calories, source: 'ai' });
  }

  const totalCalories = matches.reduce((sum, m) => sum + m.calories, 0);
  const breakdown = matches.map(m => {
    if (m.source === 'ai') return m.name;
    return `${m.name} ~${m.calories}kcal`;
  }).join(' + ');

  return {
    totalCalories,
    matches,
    breakdown,
    hasAiFallback: matches.some(m => m.source === 'ai'),
    ollamaMissing,
    unmatchedTokens,
    aiError,
  };
}

export type ProgressCallback = (stage: string) => void;

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  const { matched, unmatched } = searchFoodDatabase(description);
  console.log('[Estimator] Input:', description);
  console.log('[Estimator] DB matched:', matched.map(m => m.name));
  console.log('[Estimator] Unmatched tokens:', unmatched);

  let aiResult: { calories: number; breakdown: string } | null = null;
  let ollamaMissing = false;
  let aiError: string | undefined;

  if (unmatched.length > 0) {
    const available = isOllamaAvailable();
    console.log('[Estimator] Ollama available:', available);
    if (!available) {
      ollamaMissing = true;
    } else {
      try {
        onProgress?.('Iniciando Ollama...');
        console.log('[Estimator] Starting Ollama...');
        await ensureOllamaRunning();

        onProgress?.('Verificando modelo de IA...');
        console.log('[Estimator] Ensuring model is pulled...');
        await ensureModelPulled(onProgress);

        const aiInput = matched.length === 0 ? description : unmatched.join(', ');
        console.log('[Estimator] AI input:', aiInput);
        onProgress?.('Estimando con IA...');
        aiResult = await estimateWithAi(aiInput);
        if (aiResult) {
          console.log('[Estimator] AI result:', aiResult);
        } else {
          console.log('[Estimator] AI returned null, debug:', lastAiDebug);
          aiError = `La IA no pudo estimar. Respuesta: ${lastAiDebug}`;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('[Estimator] Error:', msg);
        aiError = msg;
      } finally {
        // Stop Ollama immediately after estimation to free resources
        stopOllama();
        console.log('[Estimator] Ollama stopped after estimation');
      }
    }
  }

  const result = combineResults(matched, aiResult, ollamaMissing, unmatched, aiError);
  console.log('[Estimator] Final result:', { matches: result.matches.length, aiError: result.aiError, ollamaMissing: result.ollamaMissing });
  return result;
}
