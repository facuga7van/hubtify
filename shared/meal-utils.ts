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

/** Format minutes-since-midnight back to a "HH:MM" string */
export function minutesToTime(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

/** A detected overlap between two enabled meal ranges. */
export interface ScheduleOverlap {
  /** The two meals whose ranges intersect, in MEAL_ORDER order. */
  meals: [MealType, MealType];
  /** Overlap window start, in minutes since midnight. */
  startMinutes: number;
  /** Overlap window end, in minutes since midnight (exclusive). */
  endMinutes: number;
}

/**
 * Find every pair of enabled meals whose time ranges overlap.
 * Snack is excluded — it has no range (catch-all).
 * Returned pairs preserve MEAL_ORDER, so the result is deterministic and
 * the UI can warn the user precisely which meals collide and in what window.
 */
export function findScheduleOverlaps(schedule?: MealSchedule | null): ScheduleOverlap[] {
  const s = schedule ?? DEFAULT_MEAL_SCHEDULE;

  const ranges = MEAL_ORDER
    .filter((meal) => meal !== 'snack' && s[meal].enabled)
    .map((meal) => ({
      meal,
      start: timeToMinutes(s[meal].startHour, s[meal].startMinute),
      end: timeToMinutes(s[meal].endHour, s[meal].endMinute),
    }))
    // A zero/negative-length range can't overlap anything.
    .filter((r) => r.end > r.start);

  const overlaps: ScheduleOverlap[] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const start = Math.max(ranges[i].start, ranges[j].start);
      const end = Math.min(ranges[i].end, ranges[j].end);
      if (start < end) {
        overlaps.push({
          meals: [ranges[i].meal, ranges[j].meal],
          startMinutes: start,
          endMinutes: end,
        });
      }
    }
  }
  return overlaps;
}
