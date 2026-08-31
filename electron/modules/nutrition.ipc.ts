import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';

import { todayDateString, formatDateString, getMondayOfWeek, getAgeFromDob, daysAgoDateString } from '../../shared/date-utils';
import { resolveMealType, DEFAULT_MEAL_SCHEDULE, scoreNutritionDay } from '../../shared/meal-utils';
import type { MealSchedule } from '../../shared/meal-utils';
import { getLevel, getTitle, clampHp } from '../../shared/rpg-engine';

function genId(): string {
  return crypto.randomUUID();
}

/**
 * Timestamp format for every nutrition updated_at / deleted_at.
 *
 * These columns are compared as STRINGS by the last-write-wins merge, so the
 * whole module must use one format. It used to mix ISO on insert with
 * datetime('now') on delete, and since 'T' > ' ' a soft-delete could never beat
 * the row's own insert timestamp. Migration nutrition v10 normalised the history.
 */
function syncStamp(): string {
  return new Date().toISOString();
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
      mealSchedule,
    };
  });

  ipcHandle('nutrition:saveProfile', (_e, profile: {
    dateOfBirth: string; sex: string; heightCm: number; initialWeightKg: number;
    activityLevel: string; deficitTargetKcal?: number;
    weightCheckDay?: number; weightPopupEnabled?: boolean;
    mealSchedule?: MealSchedule;
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
    const db = getDb();
    // Read existing meal_schedule to preserve it when not provided
    const existing = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1').get() as { meal_schedule: string | null } | undefined;
    const finalMealSchedule = mealScheduleJson ?? existing?.meal_schedule ?? null;
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(age, profile.sex, profile.heightCm, profile.initialWeightKg,
      profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.dateOfBirth, weightCheckDay, weightPopupEnabled, finalMealSchedule);

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
  }) => {
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    if (!entry.description || !entry.description.trim()) throw new Error('Invalid description: must be a non-empty string');
    const db = getDb();
    const date = entry.date ?? todayDateString();
    if (isDayClosed(db, date)) throw new Error('Cannot modify a closed day');
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
      // sync_id is the cross-device identity (food_log.id is a local AUTOINCREMENT
      // surrogate that collides between devices). updated_at is set on INSERT too —
      // a NULL there loses every last-write-wins comparison later.
      db.prepare(`
        INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, entry.description, entry.calories, entry.source,
        entry.frequentFoodId ?? null, entry.aiBreakdown ?? null, meal, syncStamp(), genId());
      recalcSummary(db, date);
    })();
  });


  /**
   * Copia las comidas de `from` a `to` (por defecto, ayer -> hoy).
   *
   * "Repetir el almuerzo de siempre" costaba retipear la descripcion y pagar otra
   * llamada a la IA, cuando el modulo se vende como registro rapido. Copia
   * descripcion y calorias, re-sella la hora y genera sync_id nuevos: son comidas
   * nuevas, no las mismas filas.
   */
  ipcHandle('nutrition:copyDay', (_e, opts?: { from?: string; to?: string }) => {
    const db = getDb();
    const to = opts?.to ?? todayDateString();
    const from = opts?.from ?? (() => {
      const d = new Date(`${to}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return formatDateString(d);
    })();

    if (isDayClosed(db, to)) return { success: false, reason: 'day_closed', copied: 0 };

    const rows = db.prepare(
      `SELECT description, calories, source, frequent_food_id AS frequentFoodId, meal, time
       FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC`,
    ).all(from) as Array<{
      description: string; calories: number; source: string;
      frequentFoodId: number | null; meal: string | null; time: string;
    }>;

    if (rows.length === 0) return { success: false, reason: 'source_empty', copied: 0 };

    const insert = db.prepare(`
      INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const r of rows) {
        // La comida original pudo venir de la IA; la copia no vuelve a estimar, asi
        // que su origen es 'frequent' (reutilizada), no 'ai_estimate'.
        const source = r.source === 'ai_estimate' ? 'frequent' : r.source;
        insert.run(to, r.time, r.description, r.calories, source, r.frequentFoodId, r.meal, syncStamp(), genId());
      }
      recalcSummary(db, to);
    })();

    return { success: true, copied: rows.length, from, to };
  });

  ipcHandle('nutrition:getFoodByDate', (_e, date: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, date, time, description, calories, source,
             frequent_food_id AS frequentFoodId,
             ai_breakdown AS aiBreakdown,
             meal
      FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC
    `).all(date);
  });

  ipcHandle('nutrition:deleteFood', (_e, id: number) => {
    const db = getDb();
    const entry = db.prepare('SELECT date FROM food_log WHERE id = ? AND deleted_at IS NULL').get(id) as { date: string } | undefined;
    if (entry && isDayClosed(db, entry.date)) throw new Error('Cannot modify a closed day');
    const now = syncStamp();
    db.transaction(() => {
      db.prepare('UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  ipcHandle('nutrition:updateFood', (_e, id: number, fields: { description?: string; calories?: number; meal?: string; time?: string; aiBreakdown?: string; source?: string }) => {
    if (fields.calories !== undefined && (!Number.isFinite(fields.calories) || fields.calories <= 0)) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const entry = db.prepare('SELECT date FROM food_log WHERE id = ? AND deleted_at IS NULL').get(id) as { date: string } | undefined;
    if (entry && isDayClosed(db, entry.date)) throw new Error('Cannot modify a closed day');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.calories !== undefined) { sets.push('calories = ?'); vals.push(fields.calories); }
    if (fields.meal !== undefined) { sets.push('meal = ?'); vals.push(fields.meal); }
    if (fields.time !== undefined) { sets.push('time = ?'); vals.push(fields.time); }
    if (fields.aiBreakdown !== undefined) { sets.push('ai_breakdown = ?'); vals.push(fields.aiBreakdown); }
    if (fields.source !== undefined) { sets.push('source = ?'); vals.push(fields.source); }
    sets.push('updated_at = ?'); vals.push(syncStamp());
    if (sets.length === 1) return; // only updated_at, no real changes
    vals.push(id);
    db.transaction(() => {
      db.prepare(`UPDATE food_log SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...vals);
      if (entry) recalcSummary(db, entry.date);
    })();
  });

  ipcHandle('nutrition:deleteByDate', (_e, date: string) => {
    const db = getDb();
    if (isDayClosed(db, date)) throw new Error('Cannot modify a closed day');
    const now = syncStamp();
    db.transaction(() => {
      db.prepare('UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE date = ? AND deleted_at IS NULL').run(now, now, date);
      recalcSummary(db, date);
    })();
  });

  // ── Frequent Foods ─────────────────────────────────

  ipcHandle('nutrition:getFrequentFoods', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, calories,
             times_used AS timesUsed, created_at AS createdAt
      FROM frequent_foods WHERE deleted_at IS NULL ORDER BY times_used DESC
    `).all();
  });

  ipcHandle('nutrition:createFrequentFood', (_e, food: { name: string; calories: number }) => {
    const trimmedName = typeof food.name === 'string' ? food.name.trim() : '';
    if (!trimmedName) throw new Error('Invalid name: must be a non-empty string');
    if (!Number.isFinite(food.calories) || food.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    const db = getDb();
    const now = syncStamp();
    // Upsert on the UNIQUE name index instead of INSERT OR IGNORE: saving a name
    // that already exists used to be a silent no-op (and left a resurrected
    // soft-deleted row invisible). Returns the row that actually exists.
    const existing = db.prepare('SELECT id FROM frequent_foods WHERE name = ? COLLATE NOCASE')
      .get(trimmedName) as { id: number } | undefined;

    if (existing) {
      db.prepare('UPDATE frequent_foods SET calories = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
        .run(food.calories, now, existing.id);
      return { id: existing.id, created: false };
    }
    const info = db.prepare(
      'INSERT INTO frequent_foods (name, calories, times_used, created_at, updated_at, sync_id) VALUES (?, ?, 1, ?, ?, ?)'
    ).run(trimmedName, food.calories, now, now, genId());
    return { id: Number(info.lastInsertRowid), created: true };
  });

  ipcHandle('nutrition:deleteFrequentFood', (_e, id: number) => {
    const db = getDb();
    const now = syncStamp();
    db.prepare('UPDATE frequent_foods SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
  });

  ipcHandle('nutrition:incrementFrequentUsage', (_e, id: number) => {
    const db = getDb();
    db.prepare('UPDATE frequent_foods SET times_used = times_used + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(syncStamp(), id);
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
      if (isDayClosed(db, date)) return { success: false, alreadyClosed: true };

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
      const deficitTarget = profile.deficit_target_kcal as number;
      const target = tdee - deficitTarget;
      const steps = (metrics?.steps as number) ?? 0;
      const gym = !!(metrics?.gym);

      // XP *and* HP now come from the same goal-aware bands (see scoreNutritionDay).
      // XP used to only ever check `consumed <= target`, so on a surplus goal
      // failing the target paid MORE XP than hitting it while HP said the opposite.
      const score = scoreNutritionDay(consumed, target, deficitTarget);
      const { xpPrecision, xpBonus, hpChange } = score;

      const xpSteps = steps > 0 ? 5 : 0;
      const xpGym = gym ? 5 : 0;
      const xpWeight = weightLogged ? 5 : 0;
      const xpTotal = xpPrecision + xpBonus + xpSteps + xpGym + xpWeight;

      const closedAt = syncStamp();
      // OR REPLACE: a day that was reopened leaves a soft-deleted row behind, and
      // date is the primary key.
      db.prepare(`
        INSERT OR REPLACE INTO nutrition_daily_closed
          (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, closed_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(date, xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange, consumed, Math.round(target), closedAt, closedAt);

      return {
        success: true,
        breakdown: {
          xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange,
          consumed, target: Math.round(target),
          compliant: score.compliant,
          precisionPct: target > 0 ? Math.round(Math.abs(consumed - target) / target * 100) : 0,
        },
      };
    })();
  });

  /**
   * Reopens a closed day so the user can keep logging (they closed at 20:00 and
   * then had dinner). Reverses the XP and HP the closure granted, then soft-deletes
   * the closure record.
   *
   * The DAY_SUMMARY rpg_event is emitted by the renderer right after closeDay
   * returns, so it is located by (module, type, payload xp/hp, created after
   * closed_at) and its EXACT xp_gained is reversed — that value includes the combo
   * and random-bonus multipliers, which the stored xp_total does not. If the event
   * can't be found (pre-v10 closures with no closed_at, or a purged log) the stored
   * base values are reversed as a best effort.
   */
  ipcHandle('nutrition:reopenDay', (_e, date: string) => {
    const db = getDb();
    return db.transaction(() => {
      const closed = db.prepare(
        'SELECT * FROM nutrition_daily_closed WHERE date = ? AND deleted_at IS NULL'
      ).get(date) as Record<string, unknown> | undefined;
      if (!closed) return { success: false, error: 'Day is not closed' };

      const xpTotal = (closed.xp_total as number) ?? 0;
      const hpChange = (closed.hp_change as number) ?? 0;
      const since = (closed.closed_at as string | null) ?? date;

      const event = db.prepare(`
        SELECT id, xp_gained, hp_change FROM rpg_events
        WHERE module_id = 'nutrition' AND event_type = 'DAY_SUMMARY'
          AND json_extract(payload, '$.xp') = ?
          AND json_extract(payload, '$.hp') = ?
          AND created_at >= ?
        ORDER BY id DESC LIMIT 1
      `).get(xpTotal, hpChange, since) as { id: number; xp_gained: number; hp_change: number } | undefined;

      const xpToRevert = event ? event.xp_gained : xpTotal;
      const hpToRevert = event ? event.hp_change : hpChange;
      if (event) db.prepare('DELETE FROM rpg_events WHERE id = ?').run(event.id);

      const stats = db.prepare('SELECT xp, hp, title FROM player_stats WHERE user_id = ?')
        .get('default') as { xp: number; hp: number; title: string };
      const newXp = Math.max(0, stats.xp - xpToRevert);
      const newLevel = getLevel(newXp);
      db.prepare('UPDATE player_stats SET xp = ?, level = ?, title = ?, hp = ? WHERE user_id = ?')
        .run(newXp, newLevel, getTitle(newLevel), clampHp(stats.hp - hpToRevert), 'default');

      // Soft delete, not DELETE: a hard delete is resurrected by the next pull,
      // because mergeNutritionData re-inserts any closure row it doesn't find locally.
      const now = syncStamp();
      db.prepare('UPDATE nutrition_daily_closed SET deleted_at = ?, updated_at = ? WHERE date = ?')
        .run(now, now, date);

      recalcSummary(db, date);

      return { success: true, xpReverted: xpToRevert, hpReverted: hpToRevert, eventFound: !!event };
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
      const row = db.prepare('SELECT * FROM nutrition_daily_closed WHERE date = ? AND deleted_at IS NULL').get(date) as Record<string, unknown> | undefined;
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
    return db.prepare('SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, created_at AS createdAt, updated_at AS updatedAt FROM favorite_foods WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  });

  ipcHandle('nutrition:addFavoriteFood', (_e, food: { description: string; calories: number; source?: string; aiBreakdown?: string }) => {
    const db = getDb();
    const now = syncStamp();
    // favorite_foods.description is UNIQUE. The old INSERT OR IGNORE silently did
    // nothing on a repeat and still returned a BRAND NEW uuid that existed nowhere
    // in the database, while the UI toasted "saved". Upsert on the description and
    // return the row that really exists, plus whether it was an insert.
    const existing = db.prepare('SELECT id FROM favorite_foods WHERE description = ?')
      .get(food.description) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE favorite_foods SET calories = ?, source = ?, ai_breakdown = ?, updated_at = ?, deleted_at = NULL WHERE id = ?'
      ).run(food.calories, food.source || 'manual', food.aiBreakdown || null, now, existing.id);
      return { id: existing.id, created: false };
    }

    const id = genId();
    db.prepare(
      'INSERT INTO favorite_foods (id, description, calories, source, ai_breakdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, food.description, food.calories, food.source || 'manual', food.aiBreakdown || null, now, now);
    return { id, created: true };
  });

  ipcHandle('nutrition:removeFavoriteFood', (_e, id: string) => {
    const db = getDb();
    const now = syncStamp();
    db.prepare('UPDATE favorite_foods SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
  });

  ipcHandle('nutrition:getPendingDays', () => {
    const db = getDb();
    const today = todayDateString();
    const sevenAgo = daysAgoDateString(7);

    const rows = db.prepare(`
      SELECT DISTINCT f.date
      FROM food_log f
      LEFT JOIN nutrition_daily_closed c ON c.date = f.date AND c.deleted_at IS NULL
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
 * A day counts as closed only while its record is live. `nutrition:reopenDay`
 * soft-deletes (a hard delete would be resurrected by the next pull), so every
 * "is this day locked?" check must exclude tombstones.
 */
export function isDayClosed(db: ReturnType<typeof getDb>, date: string): boolean {
  return !!db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ? AND deleted_at IS NULL').get(date);
}

export function recalcSummary(db: ReturnType<typeof getDb>, date: string): void {
  const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!profile) return;

  const totalCals = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL').get(date) as { total: number };
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
    INSERT OR REPLACE INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
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

