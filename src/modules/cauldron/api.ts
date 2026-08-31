import type { CauldronTimerState } from '../../../shared/types';

/**
 * `cauldron:cancelAutoStart` is registered in the main process but not exposed by
 * `electron/preload.ts` yet (it is outside this change's scope).
 *
 * TODO(preload/shared-types):
 *   preload.ts   cauldronCancelAutoStart: () => ipcRenderer.invoke('cauldron:cancelAutoStart'),
 *   types.ts     cauldronCancelAutoStart: () => Promise<CauldronTimerState>;
 *
 * Until then this falls back to `cauldron:pause`, which the main process treats
 * as the same "Esperá" gesture while an auto-start is armed — so the button works
 * today and gets the dedicated channel for free once preload catches up.
 */
type ApiWithCancelAutoStart = {
  cauldronCancelAutoStart?: () => Promise<CauldronTimerState>;
};

export async function cancelAutoStart(): Promise<CauldronTimerState> {
  const api = window.api as unknown as ApiWithCancelAutoStart;
  if (typeof api.cauldronCancelAutoStart === 'function') {
    return api.cauldronCancelAutoStart();
  }
  return window.api.cauldronPause();
}
