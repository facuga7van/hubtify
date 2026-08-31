import type { CauldronTimerState } from '../../../shared/types';
import type { CauldronTimerStateEx, CauldronWeekTaskRow } from './types';

/**
 * Los canales de Fase 2 ya viven en el main process, pero todavía no están
 * expuestos en `electron/preload.ts` (fuera del alcance de este cambio).
 *
 * TODO(preload/shared-types):
 *   preload.ts
 *     cauldronStart: (presetId: string, taskId?: string | null) =>
 *       ipcRenderer.invoke('cauldron:start', presetId, taskId),
 *     cauldronSetSessionTask: (taskId: string | null) =>
 *       ipcRenderer.invoke('cauldron:setSessionTask', taskId),
 *     cauldronGetWeekByProject: () => ipcRenderer.invoke('cauldron:getWeekByProject'),
 *   types.ts (HubtifyApi)
 *     cauldronStart: (presetId: string, taskId?: string | null) => Promise<CauldronTimerState>;
 *     cauldronSetSessionTask: (taskId: string | null) => Promise<CauldronTimerState>;
 *     cauldronGetWeekByProject: () => Promise<CauldronWeekTaskRow[]>;
 *
 * Hasta entonces este módulo detecta qué hay y degrada en silencio: el estante
 * y los frascos rotos funcionan HOY (van por `cauldron:getSessions`, que ya
 * estaba expuesto), y las superficies esconden las afordancias de misión en vez
 * de ofrecer botones muertos.
 */
type ApiPhase2 = {
  cauldronCancelAutoStart?: () => Promise<CauldronTimerState>;
  cauldronStart: (presetId: string, taskId?: string | null) => Promise<CauldronTimerState>;
  cauldronSetSessionTask?: (taskId: string | null) => Promise<CauldronTimerState>;
  cauldronGetWeekByProject?: () => Promise<CauldronWeekTaskRow[]>;
};

function api(): ApiPhase2 {
  return window.api as unknown as ApiPhase2;
}

/**
 * `cauldron:cancelAutoStart` está registrado en el main pero no expuesto en
 * preload. Cae en `cauldron:pause`, que el main trata como el mismo gesto
 * «Esperá» mientras hay un arranque automático armado.
 */
export async function cancelAutoStart(): Promise<CauldronTimerState> {
  const a = api();
  if (typeof a.cauldronCancelAutoStart === 'function') {
    return a.cauldronCancelAutoStart();
  }
  return window.api.cauldronPause();
}

/**
 * ¿Está cableado el vínculo con Questify? Las superficies preguntan antes de
 * ofrecer «¿Sobre qué misión?»: un enlace que no hace nada es peor que ninguno.
 */
export function isTaskLinkWired(): boolean {
  return typeof api().cauldronSetSessionTask === 'function';
}

/**
 * Encender el caldero, con o sin misión. El `taskId` es opcional SIEMPRE.
 *
 * Doble camino a propósito: si preload todavía pasa un solo parámetro, el
 * segundo se pierde en el puente y la misión se adjunta con un
 * `setSessionTask` inmediato. En cuanto preload acepte el tercer parámetro, la
 * llamada de respaldo se vuelve un no-op (el estado ya viene con la misión).
 */
export async function startBrew(
  presetId: string,
  taskId?: string | null,
): Promise<CauldronTimerStateEx> {
  const state = (await api().cauldronStart(presetId, taskId ?? null)) as CauldronTimerStateEx;
  if (taskId && state.taskId !== taskId) {
    const attached = await setSessionTask(taskId);
    if (attached) return attached;
  }
  return state;
}

/**
 * Asignar / cambiar / quitar la misión sin tocar el timer. Devuelve null si el
 * canal todavía no está expuesto — quien llama decide qué mostrar.
 */
export async function setSessionTask(taskId: string | null): Promise<CauldronTimerStateEx | null> {
  const fn = api().cauldronSetSessionTask;
  if (typeof fn !== 'function') return null;
  return (await fn(taskId)) as CauldronTimerStateEx;
}

/** El resumen semanal por misión. Array vacío mientras el canal no esté expuesto. */
export async function getWeekByProject(): Promise<CauldronWeekTaskRow[]> {
  const fn = api().cauldronGetWeekByProject;
  if (typeof fn !== 'function') return [];
  try {
    return await fn();
  } catch {
    return [];
  }
}
