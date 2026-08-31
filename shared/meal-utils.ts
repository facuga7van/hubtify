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
