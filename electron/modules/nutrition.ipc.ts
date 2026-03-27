import { BrowserWindow } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { estimate } from './nutrition/estimator';

import { getOllamaStatus, isOllamaAvailable } from './nutrition/ollama';
import { seedFoodDatabase } from './nutrition/food-db-seed';
import { todayDateString, formatDateString, getMondayOfWeek, getAgeFromDob } from '../../shared/date-utils';

/** Seed the food_database table if it's empty or missing entries */
export function seedFoodDatabaseIfEmpty(): void {
  const db = getDb();
  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_database (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      calories REAL NOT NULL,
      serving_size TEXT NOT NULL,
      category TEXT NOT NULL
    )
  `);
  seedFoodDatabase(db);
}

export function registerNutritionIpcHandlers(): void {
  // Seed food database on startup
  seedFoodDatabaseIfEmpty();
  // ── Profile ────────────────────────────────────────

  ipcHandle('nutrition:getProfile', () => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      dateOfBirth: row.date_of_birth, weightCheckDay: row.weight_check_day,
      sex: row.sex, heightCm: row.height_cm,
      initialWeightKg: row.initial_weight_kg, activityLevel: row.activity_level,
      deficitTargetKcal: row.deficit_target_kcal, gymCalories: row.gym_calories,
      stepCaloriesFactor: row.step_calories_factor,
    };
  });

  ipcHandle('nutrition:saveProfile', (_e, profile: {
    dateOfBirth: string; sex: string; heightCm: number; initialWeightKg: number;
    activityLevel: string; deficitTargetKcal?: number; gymCalories?: number; stepCaloriesFactor?: number;
    weightCheckDay?: number;
  }) => {
    if (!profile.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) throw new Error('Invalid date of birth format');
    const dobDate = new Date(profile.dateOfBirth + 'T00:00:00');
    if (isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) throw new Error('Invalid date of birth');
    if (!Number.isFinite(profile.heightCm) || profile.heightCm < 50 || profile.heightCm > 250) throw new Error('Invalid height: must be between 50 and 250 cm');
    if (!Number.isFinite(profile.initialWeightKg) || profile.initialWeightKg < 10 || profile.initialWeightKg > 500) throw new Error('Invalid weight: must be between 10 and 500 kg');
    if (profile.deficitTargetKcal !== undefined && (!Number.isFinite(profile.deficitTargetKcal) || profile.deficitTargetKcal < 0 || profile.deficitTargetKcal > 2000)) throw new Error('Invalid deficit target: must be between 0 and 2000 kcal');
    const age = getAgeFromDob(profile.dateOfBirth);
    const weightCheckDay = Math.max(1, Math.min(7, profile.weightCheckDay ?? 1));
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, date_of_birth, weight_check_day)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(age, profile.sex, profile.heightCm, profile.initialWeightKg,
      profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.gymCalories ?? 300,
      profile.stepCaloriesFactor ?? 0.04, profile.dateOfBirth, weightCheckDay);

    // Recalc today's summary with new profile
    const today = todayDateString();
    recalcSummary(db, today);
  });

  // ── Food Log ───────────────────────────────────────

  ipcHandle('nutrition:logFood', (_e, entry: {
    date?: string; description: string; calories: number; source: string;
    frequentFoodId?: number; aiBreakdown?: string;
  }) => {
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const date = entry.date ?? todayDateString();
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    db.transaction(() => {
      db.prepare(`
        INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, entry.description, entry.calories, entry.source,
        entry.frequentFoodId ?? null, entry.aiBreakdown ?? null);
      recalcSummary(db, date);
    })();
  });

  ipcHandle('nutrition:getFoodByDate', (_e, date: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, date, time, description, calories, source,
             frequent_food_id AS frequentFoodId, ai_breakdown AS aiBreakdown
      FROM food_log WHERE date = ? ORDER BY time ASC
    `).all(date);
  });

  ipcHandle('nutrition:deleteFood', (_e, id: number) => {
    const db = getDb();
    db.transaction(() => {
      const entry = db.prepare('SELECT date FROM food_log WHERE id = ?').get(id) as { date: string } | undefined;
      db.prepare('DELETE FROM food_log WHERE id = ?').run(id);
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  ipcHandle('nutrition:updateFood', (_e, id: number, fields: { description?: string; calories?: number }) => {
    if (fields.calories !== undefined && (!Number.isFinite(fields.calories) || fields.calories <= 0)) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.calories !== undefined) { sets.push('calories = ?'); vals.push(fields.calories); }
    if (sets.length === 0) return;
    vals.push(id);
    db.transaction(() => {
      db.prepare(`UPDATE food_log SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      const entry = db.prepare('SELECT date FROM food_log WHERE id = ?').get(id) as { date: string } | undefined;
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  // ── Frequent Foods ─────────────────────────────────

  ipcHandle('nutrition:getFrequentFoods', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, calories, ai_breakdown AS aiBreakdown,
             times_used AS timesUsed, created_at AS createdAt
      FROM frequent_foods ORDER BY times_used DESC
    `).all();
  });

  ipcHandle('nutrition:createFrequentFood', (_e, food: { name: string; calories: number; aiBreakdown?: string }) => {
    const db = getDb();
    db.prepare('INSERT INTO frequent_foods (name, calories, ai_breakdown, created_at) VALUES (?, ?, ?, ?)')
      .run(food.name, food.calories, food.aiBreakdown ?? null, new Date().toISOString());
  });

  ipcHandle('nutrition:deleteFrequentFood', (_e, id: number) => {
    const db = getDb();
    db.prepare('DELETE FROM frequent_foods WHERE id = ?').run(id);
  });

  ipcHandle('nutrition:incrementFrequentUsage', (_e, id: number) => {
    const db = getDb();
    db.prepare('UPDATE frequent_foods SET times_used = times_used + 1 WHERE id = ?').run(id);
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
      INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym)
      VALUES (?, ?, ?)
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
    const db = getDb();
    const date = metrics.date ?? getMondayOfWeek();
    db.prepare('INSERT OR REPLACE INTO nutrition_weekly_metrics (date, weight_kg, waist_cm) VALUES (?, ?, ?)')
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
    } : null;
  });

  ipcHandle('nutrition:getSummaryRange', (_e, start: string, end: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT date, total_calories_in AS totalCaloriesIn, bmr, tdee, balance
      FROM nutrition_daily_summary WHERE date BETWEEN ? AND ? ORDER BY date ASC
    `).all(start, end);
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

  ipcHandle('nutrition:getTodayCalories', () => {
    const db = getDb();
    const today = todayDateString();
    const row = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ?').get(today) as { total: number };
    return row.total;
  });

  // ── AI Estimation ────────────────────────────────────

  ipcHandle('nutrition:estimate', async (event, description: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return await estimate(description, (stage: string) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('nutrition:estimate-progress', stage);
      }
    });
  });

  ipcHandle('nutrition:getAiStatus', () => {
    return getOllamaStatus();
  });

  ipcHandle('nutrition:isOllamaAvailable', () => {
    return isOllamaAvailable();
  });

  ipcHandle('nutrition:learnFood', (_e, entry: { description: string; calories: number; breakdown?: string }) => {
    const db = getDb();
    const name = entry.description.trim();
    if (!name) return;

    try {
      // Extract quantity to store per-unit calories
      const qtyMatch = name.match(/^(\d+)\s*/);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      const caloriesPerUnit = Math.round(entry.calories / qty);

      // Normalize keywords for search
      const keywords = name.toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').trim();

      // Check if already exists
      const existing = db.prepare('SELECT id, calories FROM food_database WHERE keywords = ?').get(keywords) as { id: number; calories: number } | undefined;
      if (existing) {
        // Update calories (average with existing)
        const avg = Math.round((existing.calories + caloriesPerUnit) / 2);
        db.prepare('UPDATE food_database SET calories = ? WHERE keywords = ?')
          .run(avg, keywords);
      } else {
        db.prepare('INSERT INTO food_database (name, keywords, calories, serving_size, category) VALUES (?, ?, ?, ?, ?)')
          .run(name, keywords, caloriesPerUnit, 'porcion', 'aprendido');
      }
    } catch (err) {
      // Silent catch — learning failures should not break the UI
      console.error('[nutrition:learnFood]', err);
    }
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

      // Check if weight logged this week
      const monday = getMondayOfWeek(date);
      const weightLogged = db.prepare('SELECT 1 FROM nutrition_weekly_metrics WHERE date = ? AND weight_kg IS NOT NULL').get(monday);

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
        } else if (deficitPct <= 0.15) {
          xpPrecision = 30;
          xpBonus = 10;
        } else if (deficitPct <= 0.30) {
          xpPrecision = 30;
          xpBonus = 15;
        } else {
          xpPrecision = 20; // undereating
          xpBonus = 5;
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

      // Calculate HP change
      let hpChange = 0;
      if (target > 0) {
        const excess = consumed - target;
        if (excess > 0) {
          const excessPct = excess / target;
          if (excessPct <= 0.10) hpChange = -5;
          else if (excessPct <= 0.20) hpChange = -10;
          else hpChange = -20;
        } else {
          const pct = Math.abs(consumed - target) / target;
          if (pct <= 0.10) hpChange = 10;
          else hpChange = 0;
        }
      }

      // Save close record
      db.prepare(`
        INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_total, hp_change, consumed, target)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, xpPrecision, xpSteps, xpGym, xpWeight, xpTotal, hpChange, consumed, Math.round(target));

      return {
        success: true,
        breakdown: {
          xpPrecision, xpSteps, xpGym, xpWeight, xpTotal, hpChange,
          consumed, target: Math.round(target),
          precisionPct: target > 0 ? Math.round(Math.abs(consumed - target) / target * 100) : 0,
        },
      };
    })();
  });

  ipcHandle('nutrition:shouldAskWeight', () => {
    const db = getDb();
    const profile = db.prepare('SELECT weight_check_day FROM nutrition_profile WHERE id = 1').get() as { weight_check_day: number } | undefined;
    if (!profile) return { shouldAsk: false };

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

    return { shouldAsk: true, lastWeight: lastWeight?.weight_kg };
  });

  ipcHandle('nutrition:isDayClosed', (_e, date: string) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM nutrition_daily_closed WHERE date = ?').get(date) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        xpPrecision: row.xp_precision, xpSteps: row.xp_steps,
        xpGym: row.xp_gym, xpWeight: row.xp_weight,
        xpTotal: row.xp_total, hpChange: row.hp_change,
        consumed: row.consumed, target: row.target,
      };
    } catch (err) {
      // Silent catch — return null on failure instead of propagating
      console.error('[nutrition:isDayClosed]', err);
      return null;
    }
  });
}

// ── Helpers ────────────────────────────────────────

function recalcSummary(db: ReturnType<typeof getDb>, date: string): void {
  const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!profile) return;

  const totalCals = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ?').get(date) as { total: number };
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

  db.prepare(`
    INSERT OR REPLACE INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, totalCals.total, Math.round(bmr), tdee, balance);
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
  const recentMetrics = db.prepare(`
    SELECT steps, gym FROM nutrition_daily_metrics
    WHERE date >= DATE('now', '-13 days')
    ORDER BY date DESC
  `).all() as Array<{ steps: number | null; gym: number }>;

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

function calculateTDEE(bmr: number, activityLevel: string): number {
  const factors: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  return Math.round(bmr * (factors[activityLevel] ?? 1.2));
}

function calculateTDEEWithFactor(bmr: number, factor: number): number {
  return Math.round(bmr * factor);
}

