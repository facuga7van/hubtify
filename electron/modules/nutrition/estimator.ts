import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama, downloadAndInstallOllama } from './ollama';
import type { EstimationResult } from '../../../shared/types';

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
        items: [],
        ollamaMissing: false,
        aiError: `La IA no pudo estimar. Respuesta: ${lastAiDebug}`,
      };
    }

    return {
      totalCalories: aiResult.calories,
      items: aiResult.items,
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
  } finally {
    stopOllama();
  }
}
