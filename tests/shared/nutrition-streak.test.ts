import { describe, it, expect } from 'vitest';
import { computeNutritionStreak, shiftDateString } from '../../shared/meal-utils';
import type { StreakDay } from '../../shared/meal-utils';

const TDEE = 3000;
const CUT = 500;    // deficit goal  → target 2500, compliant when consumed <= 2500
const BULK = -500;  // surplus goal  → target 3500, compliant when consumed >= 3500

/** Builds `n` consecutive days ending on `end`, each with the given calories. */
function run(end: string, n: number, calories: number): StreakDay[] {
  const days: StreakDay[] = [];
  for (let i = 0; i < n; i++) {
    days.push({ date: shiftDateString(end, -i), totalCaloriesIn: calories, tdee: TDEE });
  }
  return days;
}

// A Wednesday, so a single hole lands inside one Mon-Sun week.
const TODAY = '2026-08-26';

describe('getStreak — the goal-blind bug', () => {
  it('does NOT count a surplus day spent eating far too little', () => {
    // The old rule was `consumed <= target * 1.1`, which on a surplus goal is
    // satisfied by starving. 1500 on a 3500 target is a failed bulking day.
    const days = run(TODAY, 5, 1500);
    expect(computeNutritionStreak(days, TODAY, BULK).streak).toBe(0);
  });

  it('counts a surplus day that actually hit the target', () => {
    const days = run(TODAY, 5, 3600);
    expect(computeNutritionStreak(days, TODAY, BULK).streak).toBe(5);
  });

  it('still counts deficit days under target', () => {
    expect(computeNutritionStreak(run(TODAY, 4, 2200), TODAY, CUT).streak).toBe(4);
  });

  it('does not count a deficit day that blew past the target', () => {
    expect(computeNutritionStreak(run(TODAY, 4, 4000), TODAY, CUT).streak).toBe(0);
  });
});

describe('getStreak — today is pending, not failed', () => {
  it('reports todayPending with no data today and keeps the streak whole', () => {
    const days = run(shiftDateString(TODAY, -1), 3, 2200); // yesterday and back
    const res = computeNutritionStreak(days, TODAY, CUT);
    expect(res.todayPending).toBe(true);
    expect(res.streak).toBe(3);
  });

  it('a surplus morning with only breakfast logged is pending, not a broken streak', () => {
    const days = [
      { date: TODAY, totalCaloriesIn: 400, tdee: TDEE },   // way under a 3500 target
      ...run(shiftDateString(TODAY, -1), 4, 3600),
    ];
    const res = computeNutritionStreak(days, TODAY, BULK);
    expect(res.todayPending).toBe(true);
    expect(res.streak).toBe(4);
  });

  it('todayPending is false once today itself complies', () => {
    const res = computeNutritionStreak(run(TODAY, 3, 2200), TODAY, CUT);
    expect(res.todayPending).toBe(false);
    expect(res.streak).toBe(3);
  });
});

describe('getStreak — one grace day per calendar week', () => {
  it('bridges a single hole and reports the day it was spent on', () => {
    const hole = shiftDateString(TODAY, -2); // Monday 2026-08-24, same week
    const days = run(TODAY, 6, 2200).filter(d => d.date !== hole);

    const res = computeNutritionStreak(days, TODAY, CUT);
    expect(res.graceUsedOn).toBe(hole);
    // 5 compliant days counted; the bridged day itself does not add to the count.
    expect(res.streak).toBe(5);
  });

  it('bridges a day that was logged but blown, not just a missing one', () => {
    const hole = shiftDateString(TODAY, -1);
    const days = run(TODAY, 6, 2200).map(d =>
      d.date === hole ? { ...d, totalCaloriesIn: 5000 } : d);

    const res = computeNutritionStreak(days, TODAY, CUT);
    expect(res.graceUsedOn).toBe(hole);
    expect(res.streak).toBe(5);
  });

  it('falls on the SECOND hole in the same calendar week', () => {
    // Sunday, so its Mon-Sun week (08-24 … 08-30) is wide enough to hold two
    // non-adjacent holes. On a Wednesday they would spill into the week before
    // and each would legitimately get its own grace.
    const sunday = '2026-08-30';
    const h1 = shiftDateString(sunday, -1); // Sat 08-29
    const h2 = shiftDateString(sunday, -3); // Thu 08-27
    const days = run(sunday, 8, 2200).filter(d => d.date !== h1 && d.date !== h2);

    const res = computeNutritionStreak(days, sunday, CUT);
    // today (1) + the day between the two holes (1); the second hole ends it.
    expect(res.streak).toBe(2);
    expect(res.graceUsedOn).toBe(h1);
  });

  it('does not accumulate: grace is per week, one hole per week keeps going', () => {
    // Holes 7 days apart fall in different Mon-Sun weeks, so each gets its own.
    const h1 = shiftDateString(TODAY, -2);
    const h2 = shiftDateString(TODAY, -9);
    const days = run(TODAY, 14, 2200).filter(d => d.date !== h1 && d.date !== h2);

    const res = computeNutritionStreak(days, TODAY, CUT);
    expect(res.streak).toBe(12);
    expect(res.graceUsedOn).toBe(h1); // the most recent one, for the UI
  });

  it('does not burn grace on an edge with nothing behind it', () => {
    // Two adjacent holes: bridging the first would still land on a second.
    const days = [
      { date: TODAY, totalCaloriesIn: 2200, tdee: TDEE },
      // yesterday and the day before are missing entirely
      { date: shiftDateString(TODAY, -3), totalCaloriesIn: 2200, tdee: TDEE },
    ];
    const res = computeNutritionStreak(days, TODAY, CUT);
    expect(res.streak).toBe(1);
    expect(res.graceUsedOn).toBeUndefined();
  });

  it('returns zero and pending on an empty history', () => {
    expect(computeNutritionStreak([], TODAY, CUT)).toEqual({ streak: 0, todayPending: true });
  });
});
