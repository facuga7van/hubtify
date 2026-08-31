import type { HubtifyApi } from '../../../shared/types';

/**
 * Questify Fase 1 additions that are not in `HubtifyApi` (shared/types.ts) yet.
 *
 * The preload bridge and the shared interface are wired outside this module, so
 * until they land this file is the single place that knows the new signatures —
 * one cast, documented, instead of an `as any` scattered over five components.
 *
 * Once `shared/types.ts` carries these, delete the interface and the cast and
 * go back to plain `window.api`.
 */
export interface QuestsApiFase1 {
  /**
   * Reschedules tasks. `target` is 'today' | 'tomorrow' | 'YYYY-MM-DD' |
   * 'YYYY-MM-DDTHH:mm'. Neutral: no XP, no penalty.
   */
  questsPostponeTasks: (ids: string[], target: string) => Promise<{ moved: number }>;
  /** Toggles an excused day for a habit (defaults to today). */
  questsSkipHabit: (habitId: string, date?: string) => Promise<{ skipped: boolean }>;
  questsAddHabit: (habit: {
    name: string; frequency: string; timesPerWeek: number; specificDays?: number[] | null;
  }) => Promise<string>;
  questsUpdateHabit: (id: string, updates: {
    name?: string; frequency?: string; timesPerWeek?: number; specificDays?: number[] | null;
  }) => Promise<void>;
  questsGetHabitHeatmap: (days?: number) => Promise<{
    days: Array<{ date: string; count: number; skipCount: number }>;
    totalHabits: number;
  }>;
}

export type QuestsApi = Omit<HubtifyApi, keyof QuestsApiFase1> & QuestsApiFase1;

/** `window.api`, widened with the Fase 1 channels. */
export function questsApi(): QuestsApi {
  return window.api as unknown as QuestsApi;
}
