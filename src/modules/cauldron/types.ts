import type {
  CauldronTimerState,
  CauldronSessionEndResult,
  CauldronPreset,
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
 * en shared/types.ts. Los alias quedan solo para no tocar los imports de los
 * componentes; son el mismo tipo.
 */
export type CauldronTimerStateEx = CauldronTimerState;
export type CauldronPresetEx = CauldronPreset;
export type CauldronSessionEndResultEx = CauldronSessionEndResult;

/** Seconds left on the auto-start countdown, or null when nothing is armed. */
export function autoStartSecondsLeft(
  state: CauldronTimerStateEx | null | undefined,
): number | null {
  if (!state || state.status !== 'awaiting_next') return null;
  if (state.autoStartAt == null) return null;
  return Math.max(0, Math.ceil((state.autoStartAt - Date.now()) / 1000));
}
