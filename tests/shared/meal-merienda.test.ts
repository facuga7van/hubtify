import { describe, it, expect } from 'vitest';
import {
  MEAL_ORDER,
  DEFAULT_MEAL_SCHEDULE,
  ensureMerienda,
  resolveMealType,
  nutritionDayString,
  clampCutoffHour,
  DEFAULT_DAY_CUTOFF_HOUR,
} from '../../shared/meal-utils';
import type { MealSchedule } from '../../shared/meal-utils';

/** The v6 default, as it sits in every profile saved before merienda existed. */
const LEGACY_DEFAULT = {
  breakfast: { enabled: true, startHour: 6, startMinute: 0, endHour: 10, endMinute: 0 },
  lunch:     { enabled: true, startHour: 11, startMinute: 0, endHour: 15, endMinute: 0 },
  dinner:    { enabled: true, startHour: 18, startMinute: 0, endHour: 22, endMinute: 0 },
  snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
} as unknown as MealSchedule;

describe('merienda — the fifth meal', () => {
  it('sits between lunch and dinner in the order', () => {
    expect(MEAL_ORDER).toEqual(['breakfast', 'lunch', 'merienda', 'dinner', 'snack']);
  });

  it('defaults to 16:00-19:00, enabled', () => {
    expect(DEFAULT_MEAL_SCHEDULE.merienda).toMatchObject({
      enabled: true, startHour: 16, startMinute: 0, endHour: 19, endMinute: 0,
    });
  });

  it('17:30 — mate con facturas — resolves to merienda, not snack', () => {
    expect(resolveMealType('17:30').meal).toBe('merienda');
    expect(resolveMealType('17:30').ambiguous).toEqual([]);
  });

  it('22:30 resolves to dinner with the new 20:30-23:59 default', () => {
    // The old default (18:00-22:00) dropped a 22:30 dinner into `snack`.
    expect(resolveMealType('22:30').meal).toBe('dinner');
  });

  it('keeps the rest of the day where it was', () => {
    expect(resolveMealType('08:00').meal).toBe('breakfast');
    expect(resolveMealType('13:00').meal).toBe('lunch');
    expect(resolveMealType('11:00').meal).toBe('lunch');
    expect(resolveMealType('19:30').meal).toBe('snack'); // gap between merienda and cena
  });
});

describe('ensureMerienda — grafting it onto a saved schedule', () => {
  it('adds it ENABLED at 16-19 when the custom windows leave room', () => {
    const custom = {
      breakfast: { enabled: true, startHour: 5, startMinute: 0, endHour: 9, endMinute: 0 },
      lunch:     { enabled: true, startHour: 12, startMinute: 0, endHour: 14, endMinute: 0 },
      dinner:    { enabled: true, startHour: 21, startMinute: 0, endHour: 23, endMinute: 30 },
      snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
    } as unknown as MealSchedule;

    const out = ensureMerienda(custom);
    expect(out.merienda).toMatchObject({ enabled: true, startHour: 16, endHour: 19 });
    // The user's own windows are untouched.
    expect(out.breakfast).toEqual(custom.breakfast);
    expect(out.lunch).toEqual(custom.lunch);
    expect(out.dinner).toEqual(custom.dinner);
  });

  it('adds it DISABLED when 16-19 would collide with a window the user chose', () => {
    const lateLunch = {
      breakfast: { enabled: true, startHour: 6, startMinute: 0, endHour: 10, endMinute: 0 },
      lunch:     { enabled: true, startHour: 13, startMinute: 0, endHour: 17, endMinute: 0 },
      dinner:    { enabled: true, startHour: 21, startMinute: 0, endHour: 23, endMinute: 0 },
      snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
    } as unknown as MealSchedule;

    const out = ensureMerienda(lateLunch);
    expect(out.merienda.enabled).toBe(false);
    expect(out.lunch).toEqual(lateLunch.lunch); // never overwritten
    // 16:00 still belongs to the custom lunch, not to a merienda nobody asked for.
    expect(resolveMealType('16:00', out).meal).toBe('lunch');
  });

  it('is idempotent — a schedule that already has merienda comes back untouched', () => {
    const once = ensureMerienda(LEGACY_DEFAULT);
    expect(ensureMerienda(once)).toBe(once);
  });
});

describe('nutritionDayString — the day has a cutoff hour', () => {
  it('00:30 with a 4 AM cutoff still belongs to the previous day', () => {
    expect(nutritionDayString(new Date(2026, 7, 31, 0, 30), 4)).toBe('2026-08-30');
    expect(nutritionDayString(new Date(2026, 7, 31, 3, 59), 4)).toBe('2026-08-30');
  });

  it('flips at the cutoff', () => {
    expect(nutritionDayString(new Date(2026, 7, 31, 4, 0), 4)).toBe('2026-08-31');
    expect(nutritionDayString(new Date(2026, 7, 31, 14, 0), 4)).toBe('2026-08-31');
  });

  it('cutoff 0 is strict midnight — the old behaviour, byte for byte', () => {
    expect(nutritionDayString(new Date(2026, 7, 31, 0, 30), 0)).toBe('2026-08-31');
    expect(nutritionDayString(new Date(2026, 7, 31, 23, 59), 0)).toBe('2026-08-31');
  });

  it('crosses month and year boundaries', () => {
    expect(nutritionDayString(new Date(2026, 0, 1, 2, 0), 4)).toBe('2025-12-31');
    expect(nutritionDayString(new Date(2026, 8, 1, 1, 0), 4)).toBe('2026-08-31');
  });

  it('clamps nonsense cutoffs instead of producing garbage dates', () => {
    expect(clampCutoffHour(-5)).toBe(0);
    expect(clampCutoffHour(99)).toBe(23);
    expect(clampCutoffHour('nope')).toBe(DEFAULT_DAY_CUTOFF_HOUR);
    expect(clampCutoffHour(4)).toBe(4);
  });
});

describe('resolveMealType — the small hours belong to yesterday', () => {
  it('01:00 with a 4 AM cutoff is last night’s dinner, never breakfast', () => {
    const r = resolveMealType('01:00', DEFAULT_MEAL_SCHEDULE, 4);
    expect(r.meal).toBe('dinner');
    expect(r.ambiguous).toEqual([]);
  });

  it('01:00 with cutoff 0 keeps the old answer (snack)', () => {
    expect(resolveMealType('01:00', DEFAULT_MEAL_SCHEDULE, 0).meal).toBe('snack');
    expect(resolveMealType('01:00', DEFAULT_MEAL_SCHEDULE).meal).toBe('snack');
  });

  it('05:00 is past a 4 AM cutoff, so it is NOT pushed back to dinner', () => {
    expect(resolveMealType('05:00', DEFAULT_MEAL_SCHEDULE, 4).meal).toBe('snack');
  });

  it('the cutoff never overrides a window that actually matches', () => {
    const nightOwl = ensureMerienda({
      ...DEFAULT_MEAL_SCHEDULE,
      breakfast: { enabled: true, startHour: 1, startMinute: 0, endHour: 3, endMinute: 0 },
    });
    expect(resolveMealType('01:00', nightOwl, 4).meal).toBe('breakfast');
  });
});
