import type {
  CauldronTimerState,
  CauldronSessionEndResult,
  CauldronPreset,
  CauldronSession,
} from '../../../shared/types';

export type {
  CauldronTimerStatus,
  CauldronTimerState,
  CauldronPreset,
  CauldronSession,
  CauldronStats,
  CauldronSessionEndResult,
} from '../../../shared/types';

/**
 * Fase-1 fields (autoStartAt/round, autoStartBreak/Work, cycleComplete) ya viven
 * en shared/types.ts.
 *
 * Fase 2 agrega el vínculo con Questify. Los campos viajan EN EL BROADCAST de
 * `cauldron:tick`: ninguna superficie consulta la tarea por su cuenta, todas
 * reflejan el mismo estado autoritativo del main.
 *
 * TODO(shared/types.ts): mover estos campos a `CauldronTimerState` /
 * `CauldronSessionEndResult` / `CauldronSession`. Fuera del alcance de este
 * cambio; los alias los declaran mientras tanto.
 *
 * Van OPCIONALES por eso mismo: `HubtifyApi` todavía tipa los canales del
 * caldero como `CauldronTimerState` pelado, así que un estado recién llegado del
 * puente tiene que seguir siendo asignable. Cuando aterricen en
 * `shared/types.ts` se vuelven obligatorios y esto desaparece.
 */
export type CauldronTimerStateEx = CauldronTimerState & {
  /** Misión vinculada, o null. SIEMPRE opcional: nunca es un peaje antes del play. */
  taskId?: string | null;
  taskName?: string | null;
  taskProjectId?: string | null;
  taskProjectColor?: string | null;
};

export type CauldronPresetEx = CauldronPreset;

export type CauldronSessionEndResultEx = CauldronSessionEndResult & {
  /** True cuando un enfoque se cortó a mano pasado el umbral: deja frasco roto. */
  abandoned?: boolean;
  /** Minutos efectivamente enfocados antes de cortar (las pausas no cuentan). */
  elapsedMinutes?: number;
  taskId?: string | null;
  taskName?: string | null;
};

/**
 * Un frasco del estante. Cada enfoque completado deposita uno; cada enfoque
 * abandonado pasado el umbral deja uno roto en el mismo lugar.
 */
export type CauldronShelfSession = CauldronSession & {
  presetName?: string | null;
  /** Frasco roto: silueta quebrada, tono apagado. Memoria, no acusación. */
  abandoned: boolean;
  /** Solo en los rotos: «abandonada a los N min». */
  elapsedMinutes: number | null;
  taskId: string | null;
  /** null cuando no hubo misión O cuando la misión fue borrada: «sin etiqueta». */
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
};

/** Una fila de `cauldron:getWeekByProject`: una misión de la semana. */
export interface CauldronWeekTaskRow {
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  sessions: number;
  minutes: number;
}

/** El color de un frasco sin misión: gris-neutro, «sin etiqueta». */
export const UNLABELED_POTION_COLOR = '#8b7f6e';

/** Seconds left on the auto-start countdown, or null when nothing is armed. */
export function autoStartSecondsLeft(
  state: CauldronTimerStateEx | null | undefined,
): number | null {
  if (!state || state.status !== 'awaiting_next') return null;
  if (state.autoStartAt == null) return null;
  return Math.max(0, Math.ceil((state.autoStartAt - Date.now()) / 1000));
}
