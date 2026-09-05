/**
 * Los eventos del Caldero que NO pagan: registro puro para el Códice y los logros.
 *
 * Los dos valen `xp: 0` y están en `NON_MEANINGFUL_EVENT_TYPES`
 * (shared/rpg-engine.ts), así que no cuentan como "evento del día", no mueven
 * el combo (`advancesProgress` exige XP > 0) y no alimentan al sello ni al
 * Cronista. Existen para que `full_circle` y `one_more_log` tengan algo que
 * escuchar. POMODORO_COMPLETED y POMODORO_ABANDONED siguen emitidos inline en
 * `CauldronFloatingTimer` — el único listener siempre montado de `sessionEnd`.
 *
 * Nunca tiran: un registro que falla no puede romper el timer.
 */
import type { CauldronSessionEndResult } from '../../../shared/types';

/**
 * Una vuelta se cierra cuando termina el DESCANSO LARGO. El backend marca
 * `cycleComplete` mirando solo `sessionType`, así que una prórroga del descanso
 * largo también llega con el flag: sin el guard de `isExtension` la misma vuelta
 * se registraría dos veces.
 */
export function isLapClose(result: CauldronSessionEndResult): boolean {
  return result.completed && !!result.cycleComplete && !result.isExtension;
}

export async function emitLapCompleted(result: CauldronSessionEndResult): Promise<void> {
  if (!isLapClose(result)) return;
  try {
    await window.api.processRpgEvent({
      type: 'CAULDRON_LAP_COMPLETED',
      moduleId: 'cauldron',
      payload: { xp: 0, hp: 0, taskId: result.taskId ?? null },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[cauldron] processRpgEvent(CAULDRON_LAP_COMPLETED) failed:', err);
  }
}

/**
 * El usuario pidió más tiempo en vez de cortar. Se emite desde los tres botones
 * «+N min» (página, timer flotante, ventana PiP): cada click es una prórroga y
 * ningún componente ve los clicks de los otros. `sessionType` viaja para que el
 * catálogo decida si una prórroga de descanso cuenta o solo la de enfoque.
 */
export async function emitPomodoroExtended(
  sessionType: 'work' | 'break' | 'long_break',
  minutes: number,
  taskId?: string | null,
): Promise<void> {
  try {
    await window.api.processRpgEvent({
      type: 'POMODORO_EXTENDED',
      moduleId: 'cauldron',
      payload: { xp: 0, hp: 0, sessionType, minutes, taskId: taskId ?? null },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[cauldron] processRpgEvent(POMODORO_EXTENDED) failed:', err);
  }
}
