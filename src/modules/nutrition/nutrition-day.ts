import {
  nutritionDayString,
  clampCutoffHour,
  DEFAULT_DAY_CUTOFF_HOUR,
} from '../../../shared/meal-utils';

/**
 * Renderer-side twin of `nutritionToday(db)` in electron/modules/nutrition.ipc.ts.
 *
 * The backend decides which calendar day a log belongs to using the profile's
 * `dayCutoffHour`; every screen that says "today" has to use the SAME rule or
 * the page and the database disagree between midnight and the cutoff. The
 * cutoff arrives with the profile the screens already load — cache it in state,
 * never fetch it on its own.
 */
export function nutritionToday(cutoffHour: number, now: Date = new Date()): string {
  return nutritionDayString(now, cutoffHour);
}

export { DEFAULT_DAY_CUTOFF_HOUR, clampCutoffHour };

/** The cutoff options offered in Settings. 0 = strict midnight (old behaviour). */
export const DAY_CUTOFF_OPTIONS = [0, 2, 4, 6] as const;

// ── Streak ──────────────────────────────────────────────────

export interface StreakInfo {
  streak: number;
  /** Today hasn't counted yet — the flame is in play, not broken. */
  todayPending: boolean;
  /** The day the weekly grace bridged (YYYY-MM-DD), if any. */
  graceUsedOn?: string;
}

/**
 * `nutrition:getStreak` returns an object now; older preload builds (and the
 * `HubtifyApi` typing until it is updated) still say `number`. Accept both so a
 * version skew degrades to "streak, no pending flag" instead of NaN.
 */
export function normalizeStreak(raw: unknown): StreakInfo {
  if (typeof raw === 'number') return { streak: raw, todayPending: false };
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<StreakInfo>;
    return {
      streak: typeof r.streak === 'number' ? r.streak : 0,
      todayPending: !!r.todayPending,
      graceUsedOn: typeof r.graceUsedOn === 'string' ? r.graceUsedOn : undefined,
    };
  }
  return { streak: 0, todayPending: false };
}
