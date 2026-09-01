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
  /**
   * Fase 3 widening of an EXISTING channel (no preload change needed — the
   * bridge forwards whatever the handler returns): completing a task with a
   * `repeat_rule` answers with the spawned next instance. An older main
   * process resolves `undefined`, so callers must treat the result as
   * optional — that IS the feature detection for recurring tasks.
   */
  questsSetTaskStatus: (taskId: string, status: boolean) => Promise<
    { repeated: { nextTaskId: string; nextDueDate: string | null } } | undefined | void
  >;
}

export type QuestsApi = Omit<HubtifyApi, keyof QuestsApiFase1> & QuestsApiFase1;

/** `window.api`, widened with the Fase 1 channels. */
export function questsApi(): QuestsApi {
  return window.api as unknown as QuestsApi;
}
