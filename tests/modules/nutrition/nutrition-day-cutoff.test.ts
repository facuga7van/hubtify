import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import {
  nutritionDayString,
  resolveMealType,
  ensureMerienda,
  computeNutritionStreak,
  shiftDateString,
} from '../../../shared/meal-utils';
import type { MealSchedule, StreakDay } from '../../../shared/meal-utils';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  return db;
}

/** A profile as it existed BEFORE v11, so v11 runs against real legacy data. */
function seedLegacyProfile(db: Database.Database, mealSchedule: string | null): void {
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, meal_schedule)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, ?)
  `).run(mealSchedule);
}

const LEGACY_DEFAULT_JSON = JSON.stringify({
  breakfast: { enabled: true, startHour: 6, startMinute: 0, endHour: 10, endMinute: 0 },
  lunch:     { enabled: true, startHour: 11, startMinute: 0, endHour: 15, endMinute: 0 },
  dinner:    { enabled: true, startHour: 18, startMinute: 0, endHour: 22, endMinute: 0 },
  snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
});

function readSchedule(db: Database.Database): MealSchedule | null {
  const row = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1')
    .get() as { meal_schedule: string | null };
  return row.meal_schedule ? JSON.parse(row.meal_schedule) : null;
}

describe('nutrition migration v11 — day_cutoff_hour', () => {
  it('adds the column with a 4 AM default', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_profile)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('day_cutoff_hour');

    seedLegacyProfile(db, null);
    const row = db.prepare('SELECT day_cutoff_hour FROM nutrition_profile WHERE id = 1')
      .get() as { day_cutoff_hour: number };
    expect(row.day_cutoff_hour).toBe(4);
  });

  it('backfills existing rows that predate the column', () => {
    // Run everything up to v10, insert, then apply v11 — the real upgrade order.
    const db = new Database(':memory:');
    for (const m of nutritionMigrations.filter(m => m.version <= 10)) db.exec(m.up);
    seedLegacyProfile(db, LEGACY_DEFAULT_JSON);
    db.exec(nutritionMigrations.find(m => m.version === 11)!.up);

    const row = db.prepare('SELECT day_cutoff_hour FROM nutrition_profile WHERE id = 1')
      .get() as { day_cutoff_hour: number };
    expect(row.day_cutoff_hour).toBe(4);
  });
});

describe('nutrition migration v11 — merienda in the schedule', () => {
  function migrateFromV10(mealSchedule: string | null): Database.Database {
    const db = new Database(':memory:');
    for (const m of nutritionMigrations.filter(m => m.version <= 10)) db.exec(m.up);
    seedLegacyProfile(db, mealSchedule);
    db.exec(nutritionMigrations.find(m => m.version === 11)!.up);
    return db;
  }

  it('rewrites the untouched v6 default to the new one', () => {
    const s = readSchedule(migrateFromV10(LEGACY_DEFAULT_JSON))!;
    expect(s.merienda).toMatchObject({ enabled: true, startHour: 16, endHour: 19 });
    expect(s.dinner).toMatchObject({ startHour: 20, startMinute: 30, endHour: 23, endMinute: 59 });
    expect(s.lunch).toMatchObject({ startHour: 11, endHour: 15 });
  });

  it('fills a NULL schedule with the new default', () => {
    const s = readSchedule(migrateFromV10(null))!;
    expect(s.merienda.enabled).toBe(true);
    expect(s.dinner.startHour).toBe(20);
  });

  it('leaves a CUSTOM schedule exactly as the user left it', () => {
    const custom = JSON.stringify({
      breakfast: { enabled: true, startHour: 5, startMinute: 30, endHour: 9, endMinute: 0 },
      lunch:     { enabled: true, startHour: 12, startMinute: 0, endHour: 14, endMinute: 0 },
      dinner:    { enabled: true, startHour: 21, startMinute: 0, endHour: 23, endMinute: 0 },
      snack:     { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 },
    });
    const db = migrateFromV10(custom);
    const raw = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1')
      .get() as { meal_schedule: string };
    expect(raw.meal_schedule).toBe(custom);

    // Merienda reaches it lazily, at read time, without touching those windows.
    const grafted = ensureMerienda(JSON.parse(raw.meal_schedule));
    expect(grafted.merienda).toMatchObject({ enabled: true, startHour: 16, endHour: 19 });
    expect(grafted.dinner).toMatchObject({ startHour: 21, endHour: 23 });
  });

  it('is idempotent — re-running v11 does not clobber the new default', () => {
    const db = migrateFromV10(LEGACY_DEFAULT_JSON);
    const first = readSchedule(db);
    db.exec(nutritionMigrations.find(m => m.version === 11)!.up.replace(/ALTER TABLE[^;]*;/g, ''));
    expect(readSchedule(db)).toEqual(first);
  });
});

describe('the 00:30 dessert lands on the day the user is still living', () => {
  const CUTOFF = 4;

  it('routes a 01:00 log to the previous date and to dinner', () => {
    const at1am = new Date(2026, 7, 31, 1, 0); // 2026-08-31 01:00 local
    const date = nutritionDayString(at1am, CUTOFF);
    expect(date).toBe('2026-08-30');

    const time = at1am.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    expect(resolveMealType(time, null, CUTOFF).meal).toBe('dinner');
  });

  it('with cutoff 0 the same log splits the two days, as it always did', () => {
    const at1am = new Date(2026, 7, 31, 1, 0);
    expect(nutritionDayString(at1am, 0)).toBe('2026-08-31');
    expect(resolveMealType('01:00', null, 0).meal).toBe('snack');
  });

  it('a late-night dinner does not break the streak', () => {
    // 2026-08-30 is fully logged only because the 01:00 dessert was routed back
    // to it. Under the old midnight rule those 800 kcal would have opened
    // 2026-08-31 instead, leaving 08-30 short and 08-31 already over.
    const TODAY = '2026-08-30';
    const TDEE = 3000;
    const days: StreakDay[] = [];
    for (let i = 0; i < 5; i++) {
      days.push({ date: shiftDateString(TODAY, -i), totalCaloriesIn: 2400, tdee: TDEE });
    }
    const res = computeNutritionStreak(days, TODAY, 500);
    expect(res.streak).toBe(5);
    expect(res.todayPending).toBe(false);
  });
});
