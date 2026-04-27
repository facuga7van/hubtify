// ── Meal Schedule Types & Logic ─────────────────────────────
// Shared between main process (electron/) and renderer (src/)

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealTimeRange {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number;
  endMinute: number;
}

export type MealSchedule = Record<MealType, MealTimeRange>;

export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const DEFAULT_MEAL_SCHEDULE: MealSchedule = {
  breakfast: { enabled: true, startHour: 6, startMinute: 0, endHour: 10, endMinute: 0 },
  lunch:     { enabled: true, startHour: 11, startMinute: 0, endHour: 15, endMinute: 0 },
  dinner:    { enabled: true, startHour: 18, startMinute: 0, endHour: 22, endMinute: 0 },
  snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
};

/** Convert "HH:MM" to minutes since midnight */
function timeToMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** Parse "HH:MM" string to { hour, minute } */
function parseTime(time: string): { hour: number; minute: number } {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour: 12, minute: 0 };
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
}

export interface MealResolution {
  meal: MealType;
  ambiguous: MealType[];
}

/**
 * Resolve which meal a given time belongs to.
 * - 1 match → { meal, ambiguous: [] }
 * - 2+ matches → { meal: first candidate, ambiguous: all candidates }
 * - 0 matches → snack (catch-all)
 * Snack never has a range — it's the fallback.
 */
export function resolveMealType(time: string, schedule?: MealSchedule | null): MealResolution {
  const s = schedule ?? DEFAULT_MEAL_SCHEDULE;
  const { hour, minute } = parseTime(time);
  const timeMin = timeToMinutes(hour, minute);

  const candidates: MealType[] = [];

  for (const meal of MEAL_ORDER) {
    if (meal === 'snack') continue; // snack has no range, it's catch-all
    const range = s[meal];
    if (!range.enabled) continue;
    const start = timeToMinutes(range.startHour, range.startMinute);
    const end = timeToMinutes(range.endHour, range.endMinute);
    if (timeMin >= start && timeMin < end) {
      candidates.push(meal);
    }
  }

  if (candidates.length === 0) {
    return { meal: 'snack', ambiguous: [] };
  }
  if (candidates.length === 1) {
    return { meal: candidates[0], ambiguous: [] };
  }
  return { meal: candidates[0], ambiguous: candidates };
}
