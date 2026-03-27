import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama, downloadAndInstallOllama } from './ollama';
import type { EstimationMatch, EstimationResult } from '../../../shared/types';

export type ProgressCallback = (stage: string) => void;

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  try {
    if (!isOllamaAvailable()) {
      onProgress?.('Instalando motor de estimación por primera vez...');
      await downloadAndInstallOllama(onProgress);
    }

    onProgress?.('Iniciando motor de estimación...');
    await ensureOllamaRunning();

    onProgress?.('Verificando modelo de IA...');
    await ensureModelPulled(onProgress);

    onProgress?.('Estimando con IA...');
    const aiResult = await estimateWithAi(description);

    if (!aiResult) {
      return {
        totalCalories: 0,
        matches: [],
        breakdown: '',
        ollamaMissing: false,
        aiError: `La IA no pudo estimar. Respuesta: ${lastAiDebug}`,
      };
    }

    const matches: EstimationMatch[] = [{ name: aiResult.breakdown, calories: aiResult.calories, source: 'ai' }];

    return {
      totalCalories: aiResult.calories,
      matches,
      breakdown: aiResult.breakdown,
      ollamaMissing: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      totalCalories: 0,
      matches: [],
      breakdown: '',
      ollamaMissing: false,
      aiError: msg,
    };
  } finally {
    stopOllama();
  }
}
