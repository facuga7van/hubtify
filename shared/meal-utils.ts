// ── Meal Schedule Types & Logic ─────────────────────────────
// Shared between main process (electron/) and renderer (src/)

/**
 * `merienda` is the Rioplatense afternoon meal (mate + facturas, 16:00-19:00).
 * Without it every 17:30 log landed in `snack` next to the 11:00 alfajor, so the
 * food log could not tell "I had my merienda" from "I picked at something".
 * The English label is "Tea time": it names the same 16-19 slot, and "afternoon
 * snack" would collide with the `snack` catch-all sitting right beside it in
 * every picker.
 */
export type MealType = 'breakfast' | 'lunch' | 'merienda' | 'dinner' | 'snack';

export interface MealTimeRange {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number;
  endMinute: number;
}

export type MealSchedule = Record<MealType, MealTimeRange>;

export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'merienda', 'dinner', 'snack'];

export const DEFAULT_MEAL_SCHEDULE: MealSchedule = {
  breakfast: { enabled: true, startHour: 6, startMinute: 0, endHour: 10, endMinute: 0 },
  lunch:     { enabled: true, startHour: 11, startMinute: 0, endHour: 15, endMinute: 0 },
  merienda:  { enabled: true, startHour: 16, startMinute: 0, endHour: 19, endMinute: 0 },
  // 20:30-23:59, not 18:00-22:00: dinner here happens after 21:00, and the old
  // window made every real cena land in `snack`.
  dinner:    { enabled: true, startHour: 20, startMinute: 30, endHour: 23, endMinute: 59 },
  snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
};

/** The merienda window handed to a custom schedule that has room for it. */
export const MERIENDA_DEFAULT_RANGE: MealTimeRange = {
  enabled: true, startHour: 16, startMinute: 0, endHour: 19, endMinute: 0,
};

/**
 * Adds `merienda` to a schedule saved before it existed, without ever touching
 * the windows the user chose by hand.
 *
 * If 16:00-19:00 is free it is added enabled. If it collides with a custom
 * window it is added DISABLED (same range, so Settings shows something sane to
 * drag) rather than silently stealing meals from a window the user configured.
 * Idempotent: a schedule that already has the key is returned untouched.
 */
export function ensureMerienda(schedule: MealSchedule | null | undefined): MealSchedule {
  if (!schedule) return { ...DEFAULT_MEAL_SCHEDULE };
  if (schedule.merienda) return schedule;

  const start = MERIENDA_DEFAULT_RANGE.startHour * 60 + MERIENDA_DEFAULT_RANGE.startMinute;
  const end = MERIENDA_DEFAULT_RANGE.endHour * 60 + MERIENDA_DEFAULT_RANGE.endMinute;

  const overlaps = MEAL_ORDER.some((meal) => {
    if (meal === 'snack' || meal === 'merienda') return false;
    const r = schedule[meal];
    if (!r?.enabled) return false;
    const s = r.startHour * 60 + r.startMinute;
    const e = r.endHour * 60 + r.endMinute;
    return s < end && start < e;
  });

  return { ...schedule, merienda: { ...MERIENDA_DEFAULT_RANGE, enabled: !overlaps } };
}

// ── Nutritional day cutoff ──────────────────────────────────
// The 00:30 dessert belongs to the day you are still living, not to the calendar
// day the clock just rolled into. `dayCutoffHour` (0-23, default 4) is the hour
// at which the nutritional day flips; 0 restores strict midnight.

export const DEFAULT_DAY_CUTOFF_HOUR = 4;

export function clampCutoffHour(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DAY_CUTOFF_HOUR;
  return Math.max(0, Math.min(23, Math.trunc(n)));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The nutritional date (YYYY-MM-DD) a given LOCAL instant belongs to.
 * Before the cutoff hour it is still yesterday.
 */
export function nutritionDayString(now: Date, cutoffHour: number): string {
  const cutoff = clampCutoffHour(cutoffHour);
  const d = new Date(now.getTime());
  if (cutoff > 0 && d.getHours() < cutoff) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ── Daily nutrition scoring ─────────────────────────────────
// Shared between main process (electron/nutrition.ipc.ts closeDay) and renderer
// (target gauges / "on track" colouring) so XP, HP and the UI all agree on what
// "hitting the target" means. There used to be THREE different definitions:
//   • UI:  green at ±5 % of target, regardless of goal
//   • HP:  goal-aware (≤ target when cutting, ≥ target when bulking, ±10 % at maintenance)
//   • XP:  `consumed <= target` for EVERY goal, with 5/15/30 % gradations
// so a bulking user who ate 3500/3500 got 15 XP and +10 HP while one who ate
// 1500/3500 got 20 XP — failing paid better than succeeding.
// The goal-aware HP band below is now the single source of truth.

export interface NutritionDayScore {
  /** True when the day meets the user's goal — the band the UI should paint green. */
  compliant: boolean;
  /** Fraction of the target missed on the WRONG side of the goal. 0 when compliant. */
  missPct: number;
  /** Fraction of the target overshot on the RIGHT side of the goal. 0 when not compliant. */
  slackPct: number;
  xpPrecision: number;
  xpBonus: number;
  hpChange: number;
}

/**
 * Scores one nutrition day against the user's goal.
 *
 * `deficitTargetKcal` encodes the goal: > 0 cutting, < 0 bulking, 0 maintenance.
 * `target` is the day's calorie target (tdee - deficitTargetKcal).
 *
 * Compliance bands (the +10 HP / top-XP band, and what the UI must call "green"):
 *   • cutting     → consumed <= target
 *   • bulking     → consumed >= target
 *   • maintenance → |consumed - target| <= 10 % of target
 *
 * Once compliant, `slackPct` (how far past the target, on the good side) taper the
 * bonus: <=5 % → +15, <=15 % → +10, <=30 % → +5, beyond that the precision itself
 * drops from 30 to 20 (e.g. eating 1200 on a 3000 cut is compliant but not healthy).
 * When NOT compliant, `missPct` drives both: <=10 % → 15 XP / -5 HP,
 * <=20 % → 8 XP / -10 HP, beyond → 2 XP / -20 HP.
 */
export function scoreNutritionDay(
  consumed: number,
  target: number,
  deficitTargetKcal: number,
): NutritionDayScore {
  if (!Number.isFinite(consumed) || consumed <= 0) {
    return { compliant: false, missPct: 0, slackPct: 0, xpPrecision: 0, xpBonus: 0, hpChange: 0 };
  }
  if (!Number.isFinite(target) || target <= 0) {
    // Nonsensical target (profile not set up) — award a token amount, no HP swing.
    return { compliant: false, missPct: 0, slackPct: 0, xpPrecision: 5, xpBonus: 0, hpChange: 0 };
  }

  let compliant: boolean;
  let missPct: number;
  let slackPct: number;

  if (deficitTargetKcal > 0) {
    compliant = consumed <= target;
    missPct = compliant ? 0 : (consumed - target) / target;
    slackPct = compliant ? (target - consumed) / target : 0;
  } else if (deficitTargetKcal < 0) {
    compliant = consumed >= target;
    missPct = compliant ? 0 : (target - consumed) / target;
    slackPct = compliant ? (consumed - target) / target : 0;
  } else {
    const deviation = Math.abs(consumed - target) / target;
    compliant = deviation <= 0.10;
    // Only the excess BEYOND the free ±10 % band counts as a miss, which keeps the
    // maintenance HP ladder at the historical 20 % / 30 % breakpoints.
    missPct = compliant ? 0 : deviation - 0.10;
    slackPct = compliant ? deviation : 0;
  }

  let xpPrecision: number;
  let xpBonus: number;
  let hpChange: number;

  if (compliant) {
    xpPrecision = slackPct <= 0.30 ? 30 : 20;
    xpBonus = slackPct <= 0.05 ? 15 : slackPct <= 0.15 ? 10 : slackPct <= 0.30 ? 5 : 0;
    hpChange = 10;
  } else {
    xpBonus = 0;
    if (missPct <= 0.10) { xpPrecision = 15; hpChange = -5; }
    else if (missPct <= 0.20) { xpPrecision = 8; hpChange = -10; }
    else { xpPrecision = 2; hpChange = -20; }
  }

  return { compliant, missPct, slackPct, xpPrecision, xpBonus, hpChange };
}

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
 *
 * `cutoffHour` (see `nutritionDayString`) closes the hole the cutoff opens: at
 * 01:00 with a cutoff of 4 the log belongs to YESTERDAY, so it must not be
 * classified as this morning's breakfast. When nothing matches and the clock is
 * still in the small hours, the last window of the day (the latest-ending
 * enabled meal — cena under every default) owns it. With `cutoffHour` 0 the
 * whole branch is skipped and behaviour is byte-for-byte the old one.
 */
export function resolveMealType(
  time: string,
  schedule?: MealSchedule | null,
  cutoffHour = 0,
): MealResolution {
  const s = schedule ?? DEFAULT_MEAL_SCHEDULE;
  const { hour, minute } = parseTime(time);
  const timeMin = timeToMinutes(hour, minute);

  const candidates: MealType[] = [];

  for (const meal of MEAL_ORDER) {
    if (meal === 'snack') continue; // snack has no range, it's catch-all
    const range = s[meal];
    if (!range?.enabled) continue;
    const start = timeToMinutes(range.startHour, range.startMinute);
    const end = timeToMinutes(range.endHour, range.endMinute);
    if (timeMin >= start && timeMin < end) {
      candidates.push(meal);
    }
  }

  if (candidates.length === 0) {
    const cutoff = clampCutoffHour(cutoffHour);
    if (cutoff > 0 && timeMin < cutoff * 60) {
      let latest: MealType | null = null;
      let latestEnd = -1;
      for (const meal of MEAL_ORDER) {
        if (meal === 'snack') continue;
        const range = s[meal];
        if (!range?.enabled) continue;
        const end = timeToMinutes(range.endHour, range.endMinute);
        if (end > latestEnd) { latestEnd = end; latest = meal; }
      }
      if (latest) return { meal: latest, ambiguous: [] };
    }
    return { meal: 'snack', ambiguous: [] };
  }
  if (candidates.length === 1) {
    return { meal: candidates[0], ambiguous: [] };
  }
  return { meal: candidates[0], ambiguous: candidates };
}

// ── Streak ──────────────────────────────────────────────────

/** One day of nutrition history, as the streak engine needs it. */
export interface StreakDay {
  date: string;          // YYYY-MM-DD
  totalCaloriesIn: number;
  tdee: number;
}

export interface StreakResult {
  streak: number;
  /** Today has no data yet. Pending is NOT failed — the streak stays whole. */
  todayPending: boolean;
  /** The single non-compliant day the weekly grace bridged, if any (YYYY-MM-DD). */
  graceUsedOn?: string;
}

/** Adds `days` (may be negative) to a YYYY-MM-DD string, DST- and TZ-proof. */
export function shiftDateString(dateStr: string, days: number): string {
  return shiftDay(dateStr, days);
}

function shiftDay(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Monday of the calendar week a YYYY-MM-DD belongs to — the grace bucket key. */
function weekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Mon=1 … Sun=7
  return shiftDay(dateStr, 1 - dow);
}

/**
 * Counts the streak of days that actually met the user's goal.
 *
 * Three things this fixes over the old `total_calories_in <= target * 1.1`:
 *
 *  • It is GOAL-AWARE. The old comparison meant that on a surplus goal, eating
 *    far too LITTLE kept the streak alive — the exact inversion `scoreNutritionDay`
 *    was written to kill. A day counts iff `scoreNutritionDay(...).compliant`.
 *  • Today is PENDING, not failed. Not having logged breakfast yet is not a
 *    broken streak; `todayPending` lets the UI show the flame "in play today".
 *  • ONE grace day per calendar week (Mon-Sun). A single missed or blown day
 *    surrounded by good ones is bridged instead of resetting the count to zero.
 *    Not accumulable, not configurable: a second hole in the same week ends it.
 *    The bridged day does not itself add to the count.
 *
 * Historical days are scored against the CURRENT profile goal
 * (`deficitTargetKcal`) applied to that day's own stored `tdee`. Changing the
 * goal therefore re-scores history — accepted, because the alternative is
 * storing the goal per day, which no row has.
 */
export function computeNutritionStreak(
  days: StreakDay[],
  today: string,
  deficitTargetKcal: number,
): StreakResult {
  const byDate = new Map(days.map(d => [d.date, d]));

  const isCompliant = (date: string): boolean => {
    const row = byDate.get(date);
    if (!row || !(row.totalCaloriesIn > 0)) return false;
    return scoreNutritionDay(row.totalCaloriesIn, row.tdee - deficitTargetKcal, deficitTargetKcal).compliant;
  };

  // Today can only ADD to the streak, never end it: the day is not over, so a
  // half-logged surplus day (consumed still under target) is pending, not failed.
  // `closeDay` is what settles a day; the streak just refuses to punish in advance.
  const todayPending = !isCompliant(today);

  let cursor = todayPending ? shiftDay(today, -1) : today;
  let streak = 0;
  let graceUsedOn: string | undefined;
  const graceSpent = new Set<string>();

  // 366 days is the same horizon the query pulls; the loop can never outrun it.
  for (let guard = 0; guard < 366; guard++) {
    if (isCompliant(cursor)) {
      streak++;
      cursor = shiftDay(cursor, -1);
      continue;
    }
    // A hole. Bridge it once per calendar week, then keep walking.
    const week = weekKey(cursor);
    if (graceSpent.has(week)) break;
    // Nothing to bridge TO: if the day before is also a hole the streak is over
    // anyway, and burning the week's grace on the edge would hide that.
    if (!isCompliant(shiftDay(cursor, -1))) break;
    graceSpent.add(week);
    if (!graceUsedOn) graceUsedOn = cursor;
    cursor = shiftDay(cursor, -1);
  }

  return graceUsedOn ? { streak, todayPending, graceUsedOn } : { streak, todayPending };
}

// ── Schedule overlaps ───────────────────────────────────────
// Both branches appended here. Nothing in common: HEAD added the streak engine,
// upstream added the overlap detector Settings uses to warn about colliding
// windows. Both survive.

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

  // `s[meal]?.enabled` — a schedule saved before `merienda` existed has no entry
  // for it, and ensureMerienda() may not have run on the value we were handed.
  const ranges = MEAL_ORDER
    .filter((meal) => meal !== 'snack' && !!s[meal]?.enabled)
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
