import { estimateWithGemini } from './gemini';
import type { EstimationResult } from '../../../shared/types';

// Ollama imports kept for future reactivation:
// import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama, downloadAndInstallOllama } from './ollama';

export type ProgressCallback = (stage: string) => void;

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  try {
    onProgress?.('Estimando con IA...');
    const result = await estimateWithGemini(description);

    if (!result) {
      return {
        totalCalories: 0,
        items: [],
        ollamaMissing: false,
        aiError: 'La IA no pudo estimar. Intentá de nuevo.',
      };
    }

    return {
      totalCalories: result.calories,
      items: result.items,
      ollamaMissing: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      totalCalories: 0,
      items: [],
      ollamaMissing: false,
      aiError: msg,
    };
  }
}
