import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';

import { todayDateString, formatDateString, getMondayOfWeek, getAgeFromDob, daysAgoDateString } from '../../shared/date-utils';
import { resolveMealType, DEFAULT_MEAL_SCHEDULE } from '../../shared/meal-utils';
import type { MealSchedule } from '../../shared/meal-utils';
import { calcAutoMacroTargets } from '../../shared/macro-utils';

function genId(): string {
  return crypto.randomUUID();
}

/** Normalize a macro gram value to a finite, non-negative number rounded to 0.1, or null. */
function normMacro(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
}

export function registerNutritionIpcHandlers(): void {
  // ── Profile ────────────────────────────────────────

  ipcHandle('nutrition:getProfile', () => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    let mealSchedule: MealSchedule | null = null;
    if (row.meal_schedule) {
      try { mealSchedule = JSON.parse(row.meal_schedule as string); } catch { /* invalid JSON */ }
    }
    return {
      dateOfBirth: row.date_of_birth, weightCheckDay: row.weight_check_day,
      weightPopupEnabled: row.weight_popup_enabled ?? 1,
      sex: row.sex, heightCm: row.height_cm,
      initialWeightKg: row.initial_weight_kg, activityLevel: row.activity_level,
      deficitTargetKcal: row.deficit_target_kcal,
      proteinTargetG: row.protein_target_g ?? null,
      carbsTargetG: row.carbs_target_g ?? null,
      fatTargetG: row.fat_target_g ?? null,
      mealSchedule,
    };
  });

  ipcHandle('nutrition:saveProfile', (_e, profile: {
    dateOfBirth: string; sex: string; heightCm: number; initialWeightKg: number;
    activityLevel: string; deficitTargetKcal?: number;
    weightCheckDay?: number; weightPopupEnabled?: boolean;
    mealSchedule?: MealSchedule;
    proteinTargetG?: number | null; carbsTargetG?: number | null; fatTargetG?: number | null;
  }) => {
    if (!profile.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) throw new Error('Invalid date of birth format');
    const dobDate = new Date(profile.dateOfBirth + 'T00:00:00');
    if (isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) throw new Error('Invalid date of birth');
    if (!Number.isFinite(profile.heightCm) || profile.heightCm < 100 || profile.heightCm > 250) throw new Error('Invalid height: must be between 100 and 250 cm');
    if (!Number.isFinite(profile.initialWeightKg) || profile.initialWeightKg < 10 || profile.initialWeightKg > 500) throw new Error('Invalid weight: must be between 10 and 500 kg');
    if (profile.deficitTargetKcal !== undefined && (!Number.isFinite(profile.deficitTargetKcal) || Math.abs(profile.deficitTargetKcal) > 2000)) throw new Error('Invalid deficit/surplus target: must be between -2000 and 2000 kcal');
    const age = getAgeFromDob(profile.dateOfBirth);
    const weightCheckDay = Math.max(1, Math.min(7, profile.weightCheckDay ?? 1));
    const weightPopupEnabled = profile.weightPopupEnabled !== false ? 1 : 0;
    const mealScheduleJson = profile.mealSchedule ? JSON.stringify(profile.mealSchedule) : null;
    // Validate macro target overrides (nullable; undefined = leave existing untouched)
    const validMacro = (v: number | null | undefined, label: string): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (!Number.isFinite(v) || v < 0 || v > 2000) throw new Error(`Invalid ${label} target: must be between 0 and 2000 g`);
      return Math.round(v * 10) / 10;
    };
    const proteinTargetG = validMacro(profile.proteinTargetG, 'protein');
    const carbsTargetG = validMacro(profile.carbsTargetG, 'carbs');
    const fatTargetG = validMacro(profile.fatTargetG, 'fat');
    const db = getDb();
    // Read existing values to preserve them when not provided
    const existing = db.prepare('SELECT meal_schedule, protein_target_g, carbs_target_g, fat_target_g FROM nutrition_profile WHERE id = 1').get() as
      { meal_schedule: string | null; protein_target_g: number | null; carbs_target_g: number | null; fat_target_g: number | null } | undefined;
    const finalMealSchedule = mealScheduleJson ?? existing?.meal_schedule ?? null;
    const finalProteinTarget = proteinTargetG !== undefined ? proteinTargetG : (existing?.protein_target_g ?? null);
    const finalCarbsTarget = carbsTargetG !== undefined ? carbsTargetG : (existing?.carbs_target_g ?? null);
    const finalFatTarget = fatTargetG !== undefined ? fatTargetG : (existing?.fat_target_g ?? null);
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, protein_target_g, carbs_target_g, fat_target_g, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(age, profile.sex, profile.heightCm, profile.initialWeightKg,
      profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.dateOfBirth, weightCheckDay, weightPopupEnabled, finalMealSchedule,
      finalProteinTarget, finalCarbsTarget, finalFatTarget);

    // Recalc today's summary with new profile
    const today = todayDateString();
    recalcSummary(db, today);
  });

  ipcHandle('nutrition:getMealSchedule', () => {
    const db = getDb();
    const row = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1').get() as { meal_schedule: string | null } | undefined;
    if (!row?.meal_schedule) return DEFAULT_MEAL_SCHEDULE;
    try { return JSON.parse(row.meal_schedule); } catch { return DEFAULT_MEAL_SCHEDULE; }
  });

  // ── Food Log ───────────────────────────────────────

  ipcHandle('nutrition:logFood', (_e, entry: {
    date?: string; description: string; calories: number; source: string;
    frequentFoodId?: number; aiBreakdown?: string; meal?: string;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  }) => {
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    if (!entry.description || !entry.description.trim()) throw new Error('Invalid description: must be a non-empty string');
    const db = getDb();
    const date = entry.date ?? todayDateString();
    const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(date);
    if (closed) throw new Error('Cannot modify a closed day');
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    // Resolve meal type if not provided
    let meal = entry.meal ?? null;
    if (!meal) {
      const profileRow = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1').get() as { meal_schedule: string | null } | undefined;
      let schedule: MealSchedule | null = null;
      if (profileRow?.meal_schedule) {
        try { schedule = JSON.parse(profileRow.meal_schedule); } catch { /* use default */ }
      }
      const resolved = resolveMealType(time, schedule);
      if (resolved.ambiguous.length === 0) {
        meal = resolved.meal;
      }
      // If ambiguous, leave meal null — frontend will handle picker
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, protein_g, carbs_g, fat_g)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, entry.description, entry.calories, entry.source,
        entry.frequentFoodId ?? null, entry.aiBreakdown ?? null, meal,
        normMacro(entry.proteinG), normMacro(entry.carbsG), normMacro(entry.fatG));
      recalcSummary(db, date);
    })();
  });

  ipcHandle('nutrition:getFoodByDate', (_e, date: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, date, time, description, calories, source,
             frequent_food_id AS frequentFoodId,
             ai_breakdown AS aiBreakdown,
             meal,
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG
      FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC
    `).all(date);
  });

  ipcHandle('nutrition:deleteFood', (_e, id: number) => {
    const db = getDb();
    const entry = db.prepare('SELECT date FROM food_log WHERE id = ? AND deleted_at IS NULL').get(id) as { date: string } | undefined;
    if (entry) {
      const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(entry.date);
      if (closed) throw new Error('Cannot modify a closed day');
    }
    db.transaction(() => {
      db.prepare("UPDATE food_log SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  ipcHandle('nutrition:updateFood', (_e, id: number, fields: { description?: string; calories?: number; meal?: string; time?: string; aiBreakdown?: string; source?: string; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }) => {
    if (fields.calories !== undefined && (!Number.isFinite(fields.calories) || fields.calories <= 0)) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const entry = db.prepare('SELECT date FROM food_log WHERE id = ? AND deleted_at IS NULL').get(id) as { date: string } | undefined;
    if (entry) {
      const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(entry.date);
      if (closed) throw new Error('Cannot modify a closed day');
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.calories !== undefined) { sets.push('calories = ?'); vals.push(fields.calories); }
    if (fields.meal !== undefined) { sets.push('meal = ?'); vals.push(fields.meal); }
    if (fields.time !== undefined) { sets.push('time = ?'); vals.push(fields.time); }
    if (fields.aiBreakdown !== undefined) { sets.push('ai_breakdown = ?'); vals.push(fields.aiBreakdown); }
    if (fields.source !== undefined) { sets.push('source = ?'); vals.push(fields.source); }
    if (fields.proteinG !== undefined) { sets.push('protein_g = ?'); vals.push(normMacro(fields.proteinG)); }
    if (fields.carbsG !== undefined) { sets.push('carbs_g = ?'); vals.push(normMacro(fields.carbsG)); }
    if (fields.fatG !== undefined) { sets.push('fat_g = ?'); vals.push(normMacro(fields.fatG)); }
    sets.push("updated_at = datetime('now')");
    if (sets.length === 1) return; // only updated_at, no real changes
    vals.push(id);
    db.transaction(() => {
      db.prepare(`UPDATE food_log SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...vals);
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  ipcHandle('nutrition:deleteByDate', (_e, date: string) => {
    const db = getDb();
    const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(date);
    if (closed) throw new Error('Cannot modify a closed day');
    db.transaction(() => {
      db.prepare("UPDATE food_log SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE date = ? AND deleted_at IS NULL").run(date);
      recalcSummary(db, date);
    })();
  });

  // Copy every non-deleted meal from a source day to a destination day.
  // Adds on top of whatever the destination already has (never replaces),
  // preserving each meal's original time/meal/macros so the day keeps its shape.
  ipcHandle('nutrition:repeatDay', (_e, fromDate: string, toDate: string) => {
    if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new Error('Invalid date format');
    }
    const db = getDb();
    const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(toDate);
    if (closed) throw new Error('Cannot modify a closed day');
    let copied = 0;
    db.transaction(() => { copied = repeatDayMeals(db, fromDate, toDate); })();
    return { copied };
  });

  // Recent days (last 30) that have at least one logged meal, before `beforeDate`.
  // Used by the "repeat a day" picker so the user can choose a source day.
  ipcHandle('nutrition:getRecentLoggedDays', (_e, beforeDate?: string, limit?: number) => {
    const db = getDb();
    const date = beforeDate ?? todayDateString();
    const lowerBound = (() => {
      const d = new Date(date + 'T12:00:00');
      d.setDate(d.getDate() - 30);
      return formatDateString(d);
    })();
    const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.min(Math.floor(limit as number), 60) : 14;
    return db.prepare(`
      SELECT date, COUNT(*) AS meals, COALESCE(SUM(calories), 0) AS calories
      FROM food_log
      WHERE deleted_at IS NULL AND date < ? AND date >= ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
    `).all(date, lowerBound, max);
  });

  // ── Frequent Foods ─────────────────────────────────

  ipcHandle('nutrition:getFrequentFoods', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, calories,
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
             times_used AS timesUsed, created_at AS createdAt
      FROM frequent_foods WHERE deleted_at IS NULL ORDER BY times_used DESC
    `).all();
  });

  ipcHandle('nutrition:createFrequentFood', (_e, food: { name: string; calories: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }) => {
    const trimmedName = typeof food.name === 'string' ? food.name.trim() : '';
    if (!trimmedName) throw new Error('Invalid name: must be a non-empty string');
    if (!Number.isFinite(food.calories) || food.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO frequent_foods (name, calories, protein_g, carbs_g, fat_g, times_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(trimmedName, food.calories, normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG), now, now);
  });

  ipcHandle('nutrition:deleteFrequentFood', (_e, id: number) => {
    const db = getDb();
    db.prepare("UPDATE frequent_foods SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
  });

  ipcHandle('nutrition:incrementFrequentUsage', (_e, id: number) => {
    const db = getDb();
    db.prepare("UPDATE frequent_foods SET times_used = times_used + 1, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
  });

  // ── Metrics ────────────────────────────────────────

  ipcHandle('nutrition:getDailyMetrics', (_e, date: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_daily_metrics WHERE date = ?').get(date) as Record<string, unknown> | undefined;
    return row ? { date: row.date, steps: row.steps, gym: !!row.gym } : { date, steps: null, gym: false };
  });

  ipcHandle('nutrition:saveDailyMetrics', (_e, metrics: { date?: string; steps?: number; gym?: boolean }) => {
    if (metrics.steps !== undefined && (!Number.isFinite(metrics.steps) || metrics.steps < 0)) throw new Error('Invalid steps: must be >= 0');
    const db = getDb();
    const date = metrics.date ?? todayDateString();
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(date, metrics.steps ?? null, metrics.gym ? 1 : 0);
    recalcSummary(db, date);
  });

  ipcHandle('nutrition:getWeeklyMetrics', (_e, date: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_weekly_metrics WHERE date = ?').get(date) as Record<string, unknown> | undefined;
    return row ? { date: row.date, weightKg: row.weight_kg, waistCm: row.waist_cm } : null;
  });

  ipcHandle('nutrition:saveWeeklyMetrics', (_e, metrics: { date?: string; weightKg?: number; waistCm?: number }) => {
    if (metrics.weightKg !== undefined && (!Number.isFinite(metrics.weightKg) || metrics.weightKg <= 0)) throw new Error('Invalid weight: must be > 0');
    if (metrics.waistCm != null && (!Number.isFinite(metrics.waistCm) || metrics.waistCm < 30 || metrics.waistCm > 250)) throw new Error('Invalid waist: must be between 30 and 250 cm');
    const db = getDb();
    const date = metrics.date ?? getMondayOfWeek();
    db.prepare('INSERT OR REPLACE INTO nutrition_weekly_metrics (date, weight_kg, waist_cm, updated_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .run(date, metrics.weightKg ?? null, metrics.waistCm ?? null);
    recalcSummary(db, todayDateString());
  });

  // ── Summary ────────────────────────────────────────

  ipcHandle('nutrition:getSummary', (_e, date: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_daily_summary WHERE date = ?').get(date) as Record<string, unknown> | undefined;
    return row ? {
      date: row.date, totalCaloriesIn: row.total_calories_in,
      bmr: row.bmr, tdee: row.tdee, balance: row.balance,
      proteinG: row.protein_g ?? null, carbsG: row.carbs_g ?? null, fatG: row.fat_g ?? null,
    } : null;
  });

  ipcHandle('nutrition:getSummaryRange', (_e, start: string, end: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT date, total_calories_in AS totalCaloriesIn, bmr, tdee, balance,
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG
      FROM nutrition_daily_summary WHERE date BETWEEN ? AND ? ORDER BY date ASC
    `).all(start, end);
  });

  // Macro targets: profile override when all three set, otherwise auto from the helper.
  ipcHandle('nutrition:getMacroTargets', (_e, date?: string) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!profile) return null;

    const p = profile.protein_target_g as number | null;
    const c = profile.carbs_target_g as number | null;
    const f = profile.fat_target_g as number | null;
    if (p != null && c != null && f != null) {
      return { proteinG: p, carbsG: c, fatG: f, auto: false };
    }

    const targetDate = date ?? todayDateString();
    // Ensure a summary (and thus a fresh tdee) exists for the target date.
    let summary = db.prepare('SELECT tdee FROM nutrition_daily_summary WHERE date = ?').get(targetDate) as { tdee: number } | undefined;
    if (!summary) {
      recalcSummary(db, targetDate);
      summary = db.prepare('SELECT tdee FROM nutrition_daily_summary WHERE date = ?').get(targetDate) as { tdee: number } | undefined;
    }
    const tdee = summary?.tdee ?? 0;
    const deficit = (profile.deficit_target_kcal as number) ?? 0;
    const targetCalories = tdee - deficit;

    const latestWeight = db.prepare('SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1').get() as { weight_kg: number } | undefined;
    const weight = latestWeight?.weight_kg ?? (profile.initial_weight_kg as number);

    const auto = calcAutoMacroTargets(targetCalories, weight, deficit);
    return { ...auto, auto: true };
  });

  // ── Dashboard ──────────────────────────────────────

  ipcHandle('nutrition:getWeights', () => {
    const db = getDb();
    return db.prepare(`
      SELECT date, weight_kg AS weightKg FROM nutrition_weekly_metrics
      WHERE weight_kg IS NOT NULL ORDER BY date ASC
    `).all();
  });

  ipcHandle('nutrition:getStreak', () => {
    // Streak tolerance: ±10% of daily target
    // This matches the HP system's "on target" threshold (±10% → +10 HP).
    // XP precision uses finer gradations (5%/15%/30%) for reward scaling,
    // but streak is binary (on/off) so the ±10% HP band is the right match.
    const db = getDb();
    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!profile) return 0;

    const today = todayDateString();
    const summaries = db.prepare(
      'SELECT date, total_calories_in, tdee FROM nutrition_daily_summary WHERE date <= ? AND total_calories_in > 0 ORDER BY date DESC LIMIT 365'
    ).all(today) as Array<{ date: string; total_calories_in: number; tdee: number }>;

    if (summaries.length === 0) return 0;

    let streak = 0;
    let expectedDate = new Date();
    const deficitTarget = profile.deficit_target_kcal as number;

    for (const row of summaries) {
      const expectedStr = formatDateString(expectedDate);
      if (row.date !== expectedStr) break; // non-consecutive day → stop

      const target = row.tdee - deficitTarget;
      if (row.total_calories_in <= target * 1.1) {
        streak++;
      } else {
        break;
      }
      expectedDate.setDate(expectedDate.getDate() - 1);
    }
    return streak;
  });

  ipcHandle('nutrition:getWeekCalories', () => {
    const db = getDb();
    const today = todayDateString();
    const sevenAgo = daysAgoDateString(6);
    const rows = db.prepare(`
      SELECT date, COALESCE(SUM(calories), 0) AS total
      FROM food_log
      WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
      GROUP BY date
      ORDER BY date ASC
    `).all(sevenAgo, today) as Array<{ date: string; total: number }>;

    // Build a map and fill in missing days with 0
    const map = new Map(rows.map(r => [r.date, r.total]));
    const result: number[] = [];
    const d = new Date(sevenAgo + 'T12:00:00');
    const end = new Date(today + 'T12:00:00');
    while (d <= end) {
      const key = formatDateString(d);
      result.push(map.get(key) ?? 0);
      d.setDate(d.getDate() + 1);
    }
    return result;
  });

  ipcHandle('nutrition:getTodayCalories', () => {
    const db = getDb();
    const today = todayDateString();
    const row = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL').get(today) as { total: number };
    return row.total;
  });

  ipcHandle('nutrition:getTodayMealsCount', () => {
    const db = getDb();
    const today = todayDateString();
    const row = db.prepare('SELECT COUNT(*) AS c FROM food_log WHERE date = ? AND deleted_at IS NULL').get(today) as { c: number };
    return row.c;
  });

  ipcHandle('nutrition:getTodayTarget', () => {
    const db = getDb();
    const today = todayDateString();
    const summary = db.prepare('SELECT tdee FROM nutrition_daily_summary WHERE date = ?').get(today) as { tdee: number } | undefined;
    const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1').get() as { deficit_target_kcal: number } | undefined;
    if (!summary || !profile) return null;
    return summary.tdee - profile.deficit_target_kcal;
  });

  // ── Close Day ──────────────────────────────────────

  ipcHandle('nutrition:closeDay', (_e, date: string) => {
    const db = getDb();

    return db.transaction(() => {
      // Check if day already closed
      const existing = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(date);
      if (existing) return { success: false, alreadyClosed: true };

      // Get summary
      const summary = db.prepare('SELECT * FROM nutrition_daily_summary WHERE date = ?').get(date) as Record<string, unknown> | undefined;
      if (!summary) return { success: false, error: 'No data for this day' };

      // Get profile
      const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
      if (!profile) return { success: false, error: 'No profile' };

      // Get metrics
      const metrics = db.prepare('SELECT * FROM nutrition_daily_metrics WHERE date = ?').get(date) as Record<string, unknown> | undefined;

      // Check if weight logged this week (using configured check day)
      const weightCheckDay = (profile.weight_check_day as number) ?? 1; // 1=Mon, 7=Sun
      const d = new Date(date + 'T12:00:00');
      const currentDow = d.getDay() || 7; // Convert Sun=0 to 7
      const diff = currentDow >= weightCheckDay ? currentDow - weightCheckDay : 7 - (weightCheckDay - currentDow);
      const checkDate = new Date(d);
      checkDate.setDate(checkDate.getDate() - diff);
      const checkDateStr = formatDateString(checkDate);
      const weightLogged = db.prepare('SELECT 1 FROM nutrition_weekly_metrics WHERE date = ? AND weight_kg IS NOT NULL').get(checkDateStr);

      const consumed = summary.total_calories_in as number;
      const tdee = summary.tdee as number;
      const target = tdee - (profile.deficit_target_kcal as number);
      const steps = (metrics?.steps as number) ?? 0;
      const gym = !!(metrics?.gym);

      // Calculate XP based on deficit compliance (balanced: max ~60 XP)
      let xpPrecision = 0;
      let xpBonus = 0;
      if (consumed === 0) {
        xpPrecision = 0;
      } else if (target <= 0) {
        xpPrecision = 5;
      } else if (consumed <= target) {
        const deficitPct = (target - consumed) / target;
        if (deficitPct <= 0.05) {
          xpPrecision = 30; // perfect precision
          xpBonus = 15;
        } else if (deficitPct <= 0.15) {
          xpPrecision = 30;
          xpBonus = 10;
        } else if (deficitPct <= 0.30) {
          xpPrecision = 30;
          xpBonus = 5;
        } else {
          xpPrecision = 20; // undereating
          xpBonus = 0;
        }
      } else {
        const overPct = (consumed - target) / target;
        if (overPct <= 0.10) xpPrecision = 15;
        else if (overPct <= 0.20) xpPrecision = 8;
        else xpPrecision = 2;
      }

      const xpSteps = steps > 0 ? 5 : 0;
      const xpGym = gym ? 5 : 0;
      const xpWeight = weightLogged ? 5 : 0;
      const xpTotal = xpPrecision + xpBonus + xpSteps + xpGym + xpWeight;

      // Calculate HP change based on nutritional goal
      const deficitTarget = profile.deficit_target_kcal as number;
      let hpChange = 0;
      if (target > 0 && consumed > 0) {
        if (deficitTarget > 0) {
          // Deficit goal: eating at/below target = healing, above = damage
          if (consumed <= target) {
            hpChange = 10;
          } else {
            const overPct = (consumed - target) / target;
            if (overPct <= 0.10) hpChange = -5;
            else if (overPct <= 0.20) hpChange = -10;
            else hpChange = -20;
          }
        } else if (deficitTarget < 0) {
          // Surplus goal: eating at/above target = healing, below = damage
          if (consumed >= target) {
            hpChange = 10;
          } else {
            const underPct = (target - consumed) / target;
            if (underPct <= 0.10) hpChange = -5;
            else if (underPct <= 0.20) hpChange = -10;
            else hpChange = -20;
          }
        } else {
          // Maintenance: staying close = healing, deviating = damage
          const deviationPct = Math.abs(consumed - target) / target;
          if (deviationPct <= 0.10) hpChange = 10;
          else if (deviationPct <= 0.20) hpChange = -5;
          else if (deviationPct <= 0.30) hpChange = -10;
          else hpChange = -20;
        }
      }

      // Save close record
      db.prepare(`
        INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange, consumed, Math.round(target));

      return {
        success: true,
        breakdown: {
          xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange,
          consumed, target: Math.round(target),
          precisionPct: target > 0 ? Math.round(Math.abs(consumed - target) / target * 100) : 0,
        },
      };
    })();
  });

  ipcHandle('nutrition:shouldAskWeight', () => {
    const db = getDb();
    const profile = db.prepare('SELECT weight_check_day, weight_popup_enabled FROM nutrition_profile WHERE id = 1').get() as { weight_check_day: number; weight_popup_enabled: number } | undefined;
    if (!profile) return { shouldAsk: false };
    if (!profile.weight_popup_enabled) return { shouldAsk: false };

    const checkDay = profile.weight_check_day ?? 1;
    const today = new Date();
    const dow = today.getDay() || 7; // Monday=1, Sunday=7

    if (dow < checkDay) return { shouldAsk: false };

    const monday = getMondayOfWeek();
    const thisWeekWeight = db.prepare(
      'SELECT weight_kg FROM nutrition_weekly_metrics WHERE date = ? AND weight_kg IS NOT NULL'
    ).get(monday) as { weight_kg: number } | undefined;

    if (thisWeekWeight) return { shouldAsk: false };

    const lastWeight = db.prepare(
      'SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1'
    ).get() as { weight_kg: number } | undefined;

    const fallbackWeight = lastWeight?.weight_kg
      ?? (db.prepare('SELECT initial_weight_kg FROM nutrition_profile WHERE id = 1').get() as { initial_weight_kg: number } | undefined)?.initial_weight_kg;

    return { shouldAsk: true, lastWeight: fallbackWeight };
  });

  ipcHandle('nutrition:isDayClosed', (_e, date: string) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM nutrition_daily_closed WHERE date = ?').get(date) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        xpPrecision: row.xp_precision, xpSteps: row.xp_steps,
        xpGym: row.xp_gym, xpWeight: row.xp_weight,
        xpBonus: row.xp_bonus ?? 0, xpTotal: row.xp_total,
        hpChange: row.hp_change,
        consumed: row.consumed, target: row.target,
      };
    } catch (err) {
      // Silent catch — return null on failure instead of propagating
      console.error('[nutrition:isDayClosed]', err);
      return null;
    }
  });

  // ── Favorite Foods ─────────────────────────────────

  ipcHandle('nutrition:getFavoriteFoods', () => {
    const db = getDb();
    return db.prepare('SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG, created_at AS createdAt, updated_at AS updatedAt FROM favorite_foods WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  });

  ipcHandle('nutrition:addFavoriteFood', (_e, food: { description: string; calories: number; source?: string; aiBreakdown?: string; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }) => {
    const db = getDb();
    const id = genId();
    db.prepare(
      'INSERT OR IGNORE INTO favorite_foods (id, description, calories, source, ai_breakdown, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, food.description, food.calories, food.source || 'manual', food.aiBreakdown || null,
      normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG));
    return { id };
  });

  ipcHandle('nutrition:removeFavoriteFood', (_e, id: string) => {
    const db = getDb();
    db.prepare("UPDATE favorite_foods SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
  });

  ipcHandle('nutrition:getPendingDays', () => {
    const db = getDb();
    const today = todayDateString();
    const sevenAgo = daysAgoDateString(7);

    const rows = db.prepare(`
      SELECT DISTINCT f.date
      FROM food_log f
      LEFT JOIN nutrition_daily_closed c ON c.date = f.date
      WHERE c.date IS NULL
        AND f.date >= ? AND f.date < ?
        AND f.deleted_at IS NULL
      ORDER BY f.date ASC
    `).all(sevenAgo, today) as { date: string }[];

    return rows.map(r => r.date);
  });
}

// ── Helpers ────────────────────────────────────────

/**
 * Copy all non-deleted meals from `fromDate` to `toDate`, returning the count
 * copied. New rows get fresh autoincrement IDs; description/calories/source/
 * meal/macros/ai_breakdown and the ORIGINAL time are preserved so the repeated
 * day keeps its meal grouping. Adds on top of existing entries (never replaces).
 * Recalculates the destination summary afterwards.
 */
export function repeatDayMeals(db: ReturnType<typeof getDb>, fromDate: string, toDate: string): number {
  const rows = db.prepare(`
    SELECT time, description, calories, source, frequent_food_id, ai_breakdown, meal, protein_g, carbs_g, fat_g
    FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC
  `).all(fromDate) as Array<{
    time: string; description: string; calories: number; source: string;
    frequent_food_id: number | null; ai_breakdown: string | null; meal: string | null;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  }>;
  if (rows.length === 0) return 0;
  const insert = db.prepare(`
    INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, protein_g, carbs_g, fat_g)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    insert.run(toDate, r.time, r.description, r.calories, r.source,
      r.frequent_food_id, r.ai_breakdown, r.meal, r.protein_g, r.carbs_g, r.fat_g);
  }
  recalcSummary(db, toDate);
  return rows.length;
}

export function recalcSummary(db: ReturnType<typeof getDb>, date: string): void {
  const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!profile) return;

  const totalCals = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL').get(date) as { total: number };
  // Sum macros for the day. NULL when no food entry reported that macro (avoids faking 0g totals).
  const macroTotals = db.prepare(`
    SELECT SUM(protein_g) AS protein, SUM(carbs_g) AS carbs, SUM(fat_g) AS fat
    FROM food_log WHERE date = ? AND deleted_at IS NULL
  `).get(date) as { protein: number | null; carbs: number | null; fat: number | null };
  const metrics = db.prepare('SELECT * FROM nutrition_daily_metrics WHERE date = ?').get(date) as Record<string, unknown> | undefined;

  const latestWeight = db.prepare('SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1').get() as { weight_kg: number } | undefined;
  const weight = latestWeight?.weight_kg ?? (profile.initial_weight_kg as number);

  const dob = profile.date_of_birth as string | null;
  const age = dob ? getAgeFromDob(dob) : (profile.age as number) ?? 30;
  const bmr = calculateBMR(weight, profile.height_cm as number, age, profile.sex as string);
  const steps = (metrics?.steps as number) ?? 0;
  const gym = !!(metrics?.gym);

  const dynamicFactor = getDynamicActivityFactor(db, profile.activity_level as string);
  const tdee = calculateTDEEWithFactor(bmr, dynamicFactor);
  const balance = tdee - totalCals.total;

  const roundMacro = (v: number | null): number | null =>
    v != null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;

  db.prepare(`
    INSERT OR REPLACE INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance, protein_g, carbs_g, fat_g, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(date, totalCals.total, Math.round(bmr), tdee, balance,
    roundMacro(macroTotals.protein), roundMacro(macroTotals.carbs), roundMacro(macroTotals.fat));
}

/**
 * Calculate a dynamic activity factor based on last 14 days of real data.
 * Blends the user's chosen base level with actual gym/steps history.
 * More gym days + more steps → higher factor, fewer → lower factor.
 */
function getDynamicActivityFactor(db: ReturnType<typeof getDb>, baseLevel: string): number {
  const baseFactor: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  const base = baseFactor[baseLevel] ?? 1.2;

  // Get last 14 days of metrics
  const fourteenDaysAgo = daysAgoDateString(13);
  const recentMetrics = db.prepare(`
    SELECT steps, gym FROM nutrition_daily_metrics
    WHERE date >= ?
    ORDER BY date DESC
  `).all(fourteenDaysAgo) as Array<{ steps: number | null; gym: number }>;

  if (recentMetrics.length < 3) {
    // Not enough history, use base level as-is
    return base;
  }

  // Calculate activity score from real data
  const totalDays = recentMetrics.length;
  const gymDays = recentMetrics.filter((m) => m.gym).length;
  const avgSteps = recentMetrics.reduce((s, m) => s + (m.steps ?? 0), 0) / totalDays;

  // Gym ratio: 0-1 (0 = never, 1 = every day)
  const gymRatio = gymDays / totalDays;

  // Steps score: 0-1 (0 = 0 steps, 1 = 10000+ steps average)
  const stepsScore = Math.min(avgSteps / 10000, 1);

  // Combined activity score 0-1
  const activityScore = gymRatio * 0.5 + stepsScore * 0.5;

  // Map score to factor range: sedentary (1.2) to active (1.725)
  const dynamicFactor = 1.2 + activityScore * (1.725 - 1.2);

  // Blend 50/50 with user's chosen base to not override their preference completely
  return Math.round((base * 0.4 + dynamicFactor * 0.6) * 1000) / 1000;
}

function calculateBMR(weight: number, height: number, age: number, sex: string): number {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.max(800, Math.min(3500, sex === 'M' ? base + 5 : base - 161));
}

function calculateTDEEWithFactor(bmr: number, factor: number): number {
  return Math.round(bmr * factor);
}

