import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CauldronPreset } from '../../../shared/types';

/** Whether starting a brew also pops the external floating window open. */
export const POPOUT_ON_START_KEY = 'hubtify_cauldron_popout_on_start';

export function shouldPopOutOnStart(): boolean {
  try {
    return localStorage.getItem(POPOUT_ON_START_KEY) === 'true';
  } catch {
    return false;
  }
}

/** La última receta con la que se encendió el caldero. */
export const LAST_PRESET_KEY = 'hubtify_cauldron_last_preset';

export function rememberLastPreset(id: string): void {
  try { localStorage.setItem(LAST_PRESET_KEY, id); } catch { /* private mode */ }
}

/**
 * Qué receta usar en un arranque de UN CLICK — el botón de la fila de misión en
 * Questify, por ejemplo, donde no hay dónde elegir.
 *
 * La última usada gana sobre la primera de la lista: quien ya eligió «Enfoque
 * Largo» tres veces no quiere que el atajo le arranque un «Clásico». Si esa
 * receta se borró, cae en la primera disponible.
 */
export function quickStartPresetId(presets: Array<Pick<CauldronPreset, 'id'>>): string | null {
  if (presets.length === 0) return null;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PRESET_KEY); } catch { /* private mode */ }
  if (last && presets.some((p) => p.id === last)) return last;
  return presets[0].id;
}

/**
 * Seeded default presets carry English names in the database, so rendering
 * `preset.name` raw showed "Classic" to a Spanish user even though
 * `cauldron.presets.classic` has existed all along. Map by id — only defaults,
 * never a name the user typed.
 */
const DEFAULT_PRESET_KEYS: Record<string, string> = {
  'preset-classic': 'cauldron.presets.classic',
  'preset-long-focus': 'cauldron.presets.longFocus',
  'preset-quick-sprint': 'cauldron.presets.quickSprint',
};

export function usePresetName() {
  const { t } = useTranslation();
  return useCallback(
    (preset: Pick<CauldronPreset, 'id' | 'name' | 'isDefault'> | null | undefined): string => {
      if (!preset) return '';
      const key = preset.isDefault ? DEFAULT_PRESET_KEYS[preset.id] : undefined;
      return key ? t(key, preset.name) : preset.name;
    },
    [t],
  );
}

/**
 * Same idea for a running/interrupted session, which only carries the
 * `presetId` + the name persisted at start time. Built-in recipes were stored
 * with their English default name ("Quick Sprint"), so the label is rebuilt
 * from the id; custom recipes keep whatever the user typed.
 */
export function useTimerPresetName() {
  const { t } = useTranslation();
  return useCallback(
    (presetId: string | null | undefined, presetName: string | null | undefined): string | null => {
      const key = presetId ? DEFAULT_PRESET_KEYS[presetId] : undefined;
      if (key) return presetName ? t(key, presetName) : t(key);
      return presetName ?? null;
    },
    [t],
  );
}

/**
 * The main process builds OS notifications for the cauldron, and its copy used
 * to be hardcoded Spanish. Push the translated strings down on mount and on
 * every language change so the notification speaks the user's language.
 */
export function useCauldronLabels() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    window.api.cauldronSetLabels({
      cycleComplete: t('cauldron.notify.cycleComplete', 'Caldero — ¡Ciclo completo!'),
      cycleCompleteBody: t('cauldron.notify.cycleCompleteBody', 'Ciclo de pociones terminado.'),
      potionDone: t('cauldron.pomodoroComplete', '¡Poción completada!'),
      breakDone: t('cauldron.notify.breakDone', '¡Descanso terminado!'),
      focus: t('cauldron.work', 'Enfoque'),
      longBreak: t('cauldron.longBreak', 'Descanso largo'),
      shortBreak: t('cauldron.break', 'Descanso'),
      cycle: t('cauldron.notify.cycle', 'Ciclo'),
      next: t('cauldron.notify.next', 'Siguiente'),
      minutesShort: t('cauldron.weeklyFocus.unit', 'min'),
    }).catch(() => { /* main process not ready — labels keep their defaults */ });
  }, [t, i18n.language]);
}
