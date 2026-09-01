import { describe, it, expect } from 'vitest';
import {
  resolveMealType,
  findScheduleOverlaps,
  minutesToTime,
  DEFAULT_MEAL_SCHEDULE,
  type MealSchedule,
} from '../../../shared/meal-utils';

// Clone helper so each test can tweak a fresh schedule without leaking state.
const schedule = (over: Partial<Record<keyof MealSchedule, Partial<MealSchedule[keyof MealSchedule]>>> = {}): MealSchedule => {
  const base: MealSchedule = JSON.parse(JSON.stringify(DEFAULT_MEAL_SCHEDULE));
  for (const meal of Object.keys(over) as (keyof MealSchedule)[]) {
    base[meal] = { ...base[meal], ...over[meal] };
  }
  return base;
};

describe('resolveMealType — schedules without overlap', () => {
  it('resolves a clearly-breakfast time to breakfast, unambiguously', () => {
    const r = resolveMealType('07:30', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('breakfast');
    expect(r.ambiguous).toEqual([]);
  });

  it('resolves a clearly-lunch time to lunch', () => {
    const r = resolveMealType('12:00', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('lunch');
    expect(r.ambiguous).toEqual([]);
  });

  it('resolves a clearly-dinner time to dinner', () => {
    // The default cena is 20:30-23:59: dinner around here happens after 21:00,
    // and the old 18:00-22:00 window put every real cena in `snack`.
    const r = resolveMealType('21:00', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('dinner');
    expect(r.ambiguous).toEqual([]);
  });

  it('resolves a clearly-merienda time to merienda', () => {
    const r = resolveMealType('17:30', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('merienda');
    expect(r.ambiguous).toEqual([]);
  });

  it('falls back to snack when no range matches (gap between ranges)', () => {
    // 15:30 sits between lunch (ends 15:00) and merienda (starts 16:00).
    const r = resolveMealType('15:30', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('snack');
    expect(r.ambiguous).toEqual([]);
  });

  it('falls back to snack before the first range (early morning)', () => {
    const r = resolveMealType('03:00', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('snack');
    expect(r.ambiguous).toEqual([]);
  });
});

describe('resolveMealType — boundary times', () => {
  it('includes the exact start minute (inclusive)', () => {
    // breakfast starts 06:00
    const r = resolveMealType('06:00', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('breakfast');
    expect(r.ambiguous).toEqual([]);
  });

  it('excludes the exact end minute (exclusive)', () => {
    // breakfast ends 10:00 — 10:00 itself is NOT breakfast, and no other
    // range covers it, so it becomes snack.
    const r = resolveMealType('10:00', DEFAULT_MEAL_SCHEDULE);
    expect(r.meal).toBe('snack');
    expect(r.ambiguous).toEqual([]);
  });
});

describe('resolveMealType — disabled meals', () => {
  it('excludes a disabled meal even if the time falls in its range', () => {
    const s = schedule({ lunch: { enabled: false } });
    const r = resolveMealType('12:00', s);
    // lunch disabled and no other range covers noon -> snack
    expect(r.meal).toBe('snack');
    expect(r.ambiguous).toEqual([]);
  });
});

describe('resolveMealType — overlapping schedules (ambiguity)', () => {
  it('reports both meals as ambiguous and resolves deterministically by MEAL_ORDER', () => {
    // lunch 11:00-15:00, dinner moved to 14:00-22:00 -> 14:00-15:00 overlaps.
    const s = schedule({ dinner: { startHour: 14, startMinute: 0, endHour: 22, endMinute: 0 } });
    const r = resolveMealType('14:30', s);
    // First candidate by MEAL_ORDER (lunch before dinner) is the deterministic pick.
    expect(r.meal).toBe('lunch');
    expect(r.ambiguous).toEqual(['lunch', 'dinner']);
  });

  it('is NOT ambiguous just outside the overlap window', () => {
    const s = schedule({ dinner: { startHour: 14, startMinute: 0, endHour: 22, endMinute: 0 } });
    // 13:30 is only inside lunch.
    const before = resolveMealType('13:30', s);
    expect(before.meal).toBe('lunch');
    expect(before.ambiguous).toEqual([]);
    // 15:30 is only inside dinner.
    const after = resolveMealType('15:30', s);
    expect(after.meal).toBe('dinner');
    expect(after.ambiguous).toEqual([]);
  });
});

describe('findScheduleOverlaps', () => {
  it('returns no overlaps for the default (non-overlapping) schedule', () => {
    expect(findScheduleOverlaps(DEFAULT_MEAL_SCHEDULE)).toEqual([]);
  });

  it('detects a single overlapping pair with the exact intersection window', () => {
    // merienda (16-19) is disabled so the stretched dinner collides with lunch
    // and with nothing else — the point of the test is the ONE pair and its window.
    const s = schedule({
      dinner: { startHour: 14, startMinute: 0, endHour: 22, endMinute: 0 },
      merienda: { enabled: false },
    });
    const overlaps = findScheduleOverlaps(s);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].meals).toEqual(['lunch', 'dinner']);
    // lunch ends 15:00, dinner starts 14:00 -> window 14:00-15:00
    expect(minutesToTime(overlaps[0].startMinutes)).toBe('14:00');
    expect(minutesToTime(overlaps[0].endMinutes)).toBe('15:00');
  });

  it('orders the meal pair by MEAL_ORDER regardless of which range starts first', () => {
    // Make breakfast span into lunch.
    const s = schedule({ breakfast: { startHour: 6, startMinute: 0, endHour: 12, endMinute: 0 } });
    const overlaps = findScheduleOverlaps(s);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].meals).toEqual(['breakfast', 'lunch']);
  });

  it('ignores disabled meals when detecting overlaps', () => {
    const s = schedule({
      dinner: { startHour: 14, startMinute: 0, endHour: 22, endMinute: 0, enabled: false },
    });
    expect(findScheduleOverlaps(s)).toEqual([]);
  });

  it('does not flag ranges that merely touch at a boundary', () => {
    // breakfast ends exactly when lunch starts (10:00 vs 11:00 default has a gap;
    // make them touch at 11:00).
    const s = schedule({ breakfast: { endHour: 11, endMinute: 0 } });
    expect(findScheduleOverlaps(s)).toEqual([]);
  });

  it('detects multiple overlapping pairs', () => {
    // Stretch everything so breakfast/lunch/dinner all pile up around midday.
    const s = schedule({
      breakfast: { startHour: 6, startMinute: 0, endHour: 16, endMinute: 0 },
      lunch: { startHour: 11, startMinute: 0, endHour: 20, endMinute: 0 },
      dinner: { startHour: 13, startMinute: 0, endHour: 22, endMinute: 0 },
      // Off, so the assertion stays about the three meals being stretched.
      merienda: { enabled: false },
    });
    const overlaps = findScheduleOverlaps(s);
    // breakfast∩lunch, breakfast∩dinner, lunch∩dinner
    expect(overlaps).toHaveLength(3);
    expect(overlaps.map((o) => o.meals)).toEqual([
      ['breakfast', 'lunch'],
      ['breakfast', 'dinner'],
      ['lunch', 'dinner'],
    ]);
  });

  it('falls back to the default schedule when given null', () => {
    expect(findScheduleOverlaps(null)).toEqual([]);
  });
});

describe('minutesToTime', () => {
  it('formats minutes-since-midnight as zero-padded HH:MM', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(9 * 60 + 5)).toBe('09:05');
    expect(minutesToTime(14 * 60 + 30)).toBe('14:30');
    expect(minutesToTime(23 * 60 + 59)).toBe('23:59');
  });
});
