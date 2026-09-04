import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import type { SqlDatabase } from '../db';
import { genId } from '../ids';

import { formatDateString, getMondayOfWeek, getAgeFromDob, daysAgoDateString } from '../../shared/date-utils';
import {
  resolveMealType, DEFAULT_MEAL_SCHEDULE, scoreNutritionDay,
  ensureMerienda, clampCutoffHour, nutritionDayString, shiftDateString,
  computeNutritionStreak, DEFAULT_DAY_CUTOFF_HOUR,
} from '../../shared/meal-utils';
import type { MealSchedule, StreakDay } from '../../shared/meal-utils';
import { calcAutoMacroTargets } from '../../shared/macro-utils';
import { estimateAdaptiveTdee, ADAPTIVE_LOOKBACK_DAYS } from '../../shared/adaptive-tdee';
import { normalizeDescription } from '../../src/modules/nutrition/normalize';
import { rankSuggestions, SEARCH_HISTORY_LIMIT } from '../../src/modules/nutrition/history-search';
import type { RankableSuggestion } from '../../src/modules/nutrition/history-search';
import { weekEndOf, shiftDay, countCompliantDays, weeklyXp, mondayOfWeek } from '../../shared/week-report';
import type { WeekReport } from '../../shared/week-report';
// The prompt's identity, from the same file the Cloud Function ships. A cached
// model answer is only a hit while the prompt that produced it is the current
// one (migration v17). gemini.ts has no imports, so this is safe in the worker.
import { PROMPT_VERSION } from '../../functions/src/gemini';

/** Who put a row in nutrition_ai_cache: the model, or the human overruling it. */
export type CacheSource = 'model' | 'user';

/** Normalize a macro gram value to a finite, non-negative number rounded to 0.1, or null. */
function normMacro(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
}

/**
 * `food_log.source` is guarded by a CHECK that allows exactly
 * ai_estimate | frequent | manual | favorite.
 *
 * Phase 2 introduces a fifth CONCEPT — "picked straight out of your history, no
 * AI call" — and deliberately does NOT add a fifth VALUE. Rebuilding food_log to
 * widen a CHECK means dropping and recreating the highest-value table in the app
 * along with its sync_id unique index, its soft-delete tombstones and now a
 * generated column, and v8 already showed how much ceremony that costs. The
 * risk buys nothing, because 'frequent' ALREADY means exactly this: reused,
 * not re-estimated. `nutrition:copyDay` has been mapping ai_estimate -> frequent
 * on the same reasoning since phase 1.
 *
 * So 'history' is accepted at the API boundary — the renderer, Syl and mobile
 * can all speak it — and mapped here. Old rows keep the values they always had;
 * the CHECK never changes.
 */
export function normalizeFoodSource(source: string | undefined | null): string {
  if (source === 'history') return 'frequent';
  return source ?? 'manual';
}

/**
 * Un plato con nombre razonable. Más largo que esto ya es una crónica, no algo
 * que se vaya a repetir de un toque.
 */
const FREQUENT_NAME_MAX = 80;

/**
 * Anota el plato en `frequent_foods` cada vez que se registra.
 *
 * `frequent_foods` estaba VACÍA en la base real, y no por falta de uso: el
 * canal `nutrition:createFrequentFood` nunca tuvo un solo llamador en `src/` en
 * toda la historia del repo. La tabla sólo podía llenarse desde un sync con
 * otro dispositivo que la tuviera igual de vacía, así que la tarjeta "Comidas
 * Frecuentes" estaba escondida para siempre y el atajo de repetir nunca se
 * estrenó. El diseño original (2026-05-02-nutrify-ux-audit-design.md:310) ya
 * proponía derivarla del registro; esto es eso.
 *
 * Reglas:
 * - Un evento no es un plato repetible: lleva una banda, no un número.
 * - Un plato que el usuario BORRÓ de la lista no resucita solo. Se le cuenta
 *   el uso y nada más; sacarlo de la lista fue una decisión suya.
 * - Las calorías y macros se actualizan al último valor registrado, que es el
 *   que el atajo debería ofrecer.
 * - `sync_id` nuevo por fila, como en `createFrequentFood`: el merge adopta por
 *   nombre (UNIQUE COLLATE NOCASE) cuando los sync_id no coinciden, así que dos
 *   dispositivos que anotan "milanesa" convergen en una sola fila.
 */
export function rememberFrequentFood(
  db: SqlDatabase,
  food: { description: string; calories: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null },
  now: string,
): void {
  const name = food.description.trim();
  if (!name || name.length > FREQUENT_NAME_MAX) return;
  if (!Number.isFinite(food.calories) || food.calories <= 0) return;

  const existing = db.prepare('SELECT id, deleted_at FROM frequent_foods WHERE name = ? COLLATE NOCASE')
    .get(name) as { id: number; deleted_at: string | null } | undefined;

  if (existing) {
    if (existing.deleted_at) {
      db.prepare('UPDATE frequent_foods SET times_used = times_used + 1 WHERE id = ?').run(existing.id);
      return;
    }
    db.prepare(`
      UPDATE frequent_foods
      SET times_used = times_used + 1, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, updated_at = ?
      WHERE id = ?
    `).run(food.calories, normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG), now, existing.id);
    return;
  }

  db.prepare(`
    INSERT INTO frequent_foods (name, calories, protein_g, carbs_g, fat_g, times_used, created_at, updated_at, sync_id)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(name, food.calories, normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG),
    now, now, genId());
}

/**
 * Upper bound of the "starts with `prefix`" range.
 *
 * SQLite compares TEXT by UTF-8 bytes, so `prefix <= x < prefix + U+10FFFF` is
 * every string beginning with `prefix` — and, unlike LIKE 'q%', it is a plain
 * range the query planner will always turn into an index SEEK.
 */
function prefixUpperBound(prefix: string): string {
  return prefix + String.fromCodePoint(0x10ffff);
}

/** Escapes LIKE metacharacters so a query of "50%" searches for a literal "50%". */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Timestamp format for every nutrition updated_at / deleted_at.
 *
 * These columns are compared as STRINGS by the last-write-wins merge, so the
 * whole module must use one format. It used to mix ISO on insert with
 * datetime('now') on delete, and since 'T' > ' ' a soft-delete could never beat
 * the row's own insert timestamp. Migration nutrition v12 normalised the history.
 */
function syncStamp(): string {
  return new Date().toISOString();
}

/**
 * The profile's nutritional-day cutoff hour (0-23, default 4). 0 = midnight.
 * Cheap enough to read per call: one indexed row on a single-row table.
 */
export function getDayCutoffHour(db: ReturnType<typeof getDb>): number {
  const row = db.prepare('SELECT day_cutoff_hour FROM nutrition_profile WHERE id = 1')
    .get() as { day_cutoff_hour: number | null } | undefined;
  if (!row || row.day_cutoff_hour == null) return DEFAULT_DAY_CUTOFF_HOUR;
  return clampCutoffHour(row.day_cutoff_hour);
}

/**
 * "Today" for NUTRITION — not the calendar's today.
 *
 * Every nutrition path that used to call `todayDateString()` goes through here:
 * at 00:30 with a cutoff of 4 the answer is still yesterday, so the late dessert
 * lands on the day the user is actually living instead of ruining two of them.
 * With a cutoff of 0 this is exactly `todayDateString()`.
 */
export function nutritionToday(db: ReturnType<typeof getDb>): string {
  return nutritionDayString(new Date(), getDayCutoffHour(db));
}

/**
 * The nutritional day a profile stamp (`nutrition_profile.updated_at`, an ISO
 * or legacy 'YYYY-MM-DD HH:MM:SS' string) falls on; null when there is none
 * or it does not parse.
 */
export function profileSavedOn(updatedAt: string | null | undefined, cutoffHour: number): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (isNaN(d.getTime())) return null;
  return nutritionDayString(d, cutoffHour);
}

/** True si el día tiene al menos un evento vivo (asado, cumpleaños…). */
export function dayHasEvent(db: ReturnType<typeof getDb>, date: string): boolean {
  return !!db.prepare(
    'SELECT 1 FROM food_log WHERE date = ? AND is_event = 1 AND deleted_at IS NULL LIMIT 1',
  ).get(date);
}

/** The stored meal schedule, always with a `merienda` entry (see ensureMerienda). */
function readMealSchedule(db: ReturnType<typeof getDb>): MealSchedule {
  const row = db.prepare('SELECT meal_schedule FROM nutrition_profile WHERE id = 1')
    .get() as { meal_schedule: string | null } | undefined;
  if (!row?.meal_schedule) return DEFAULT_MEAL_SCHEDULE;
  try {
    return ensureMerienda(JSON.parse(row.meal_schedule) as MealSchedule);
  } catch {
    return DEFAULT_MEAL_SCHEDULE;
  }
}

export function registerNutritionIpcHandlers(): void {
  // ── Profile ────────────────────────────────────────

  ipcHandle('nutrition:getProfile', () => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    let mealSchedule: MealSchedule | null = null;
    if (row.meal_schedule) {
      try { mealSchedule = ensureMerienda(JSON.parse(row.meal_schedule as string)); } catch { /* invalid JSON */ }
    }
    return {
      dateOfBirth: row.date_of_birth, weightCheckDay: row.weight_check_day,
      weightPopupEnabled: row.weight_popup_enabled ?? 1,
      sex: row.sex, heightCm: row.height_cm,
      initialWeightKg: row.initial_weight_kg, activityLevel: row.activity_level,
      deficitTargetKcal: row.deficit_target_kcal,
      // NULL on any of the three = "auto": nutrition:getMacroTargets derives all
      // three from the calorie target and the latest weight (macro-utils).
      proteinTargetG: row.protein_target_g ?? null,
      carbsTargetG: row.carbs_target_g ?? null,
      fatTargetG: row.fat_target_g ?? null,
      mealSchedule,
      // The renderer needs the cutoff to agree with the backend on which day
      // "today" is; it caches it alongside the profile it already loads.
      dayCutoffHour: row.day_cutoff_hour == null ? DEFAULT_DAY_CUTOFF_HOUR : clampCutoffHour(row.day_cutoff_hour),
    };
  });

  ipcHandle('nutrition:saveProfile', (_e, profile: {
    dateOfBirth: string; sex: string; heightCm: number; initialWeightKg: number;
    activityLevel: string; deficitTargetKcal?: number;
    weightCheckDay?: number; weightPopupEnabled?: boolean;
    mealSchedule?: MealSchedule; dayCutoffHour?: number;
    /** null = back to auto (macro-utils); undefined = leave what is stored. */
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
    const mealScheduleJson = profile.mealSchedule ? JSON.stringify(ensureMerienda(profile.mealSchedule)) : null;
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
    const existing = db.prepare('SELECT meal_schedule, day_cutoff_hour, protein_target_g, carbs_target_g, fat_target_g FROM nutrition_profile WHERE id = 1')
      .get() as {
        meal_schedule: string | null; day_cutoff_hour: number | null;
        protein_target_g: number | null; carbs_target_g: number | null; fat_target_g: number | null;
      } | undefined;
    const finalMealSchedule = mealScheduleJson ?? existing?.meal_schedule ?? null;
    const dayCutoffHour = profile.dayCutoffHour !== undefined
      ? clampCutoffHour(profile.dayCutoffHour)
      : (existing?.day_cutoff_hour ?? DEFAULT_DAY_CUTOFF_HOUR);
    const finalProteinTarget = proteinTargetG !== undefined ? proteinTargetG : (existing?.protein_target_g ?? null);
    const finalCarbsTarget = carbsTargetG !== undefined ? carbsTargetG : (existing?.carbs_target_g ?? null);
    const finalFatTarget = fatTargetG !== undefined ? fatTargetG : (existing?.fat_target_g ?? null);
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, day_cutoff_hour, protein_target_g, carbs_target_g, fat_target_g, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(age, profile.sex, profile.heightCm, profile.initialWeightKg,
      profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.dateOfBirth, weightCheckDay,
      weightPopupEnabled, finalMealSchedule, dayCutoffHour,
      finalProteinTarget, finalCarbsTarget, finalFatTarget, syncStamp());

    // Recalc today's summary with new profile
    recalcSummary(db, nutritionToday(db));
  });

  ipcHandle('nutrition:getMealSchedule', () => readMealSchedule(getDb()));

  // ── Food Log ───────────────────────────────────────

  ipcHandle('nutrition:logFood', (_e, entry: {
    date?: string; description: string; calories: number; source: string;
    frequentFoodId?: number; aiBreakdown?: string; meal?: string;
    /** Macros in grams, when known (AI, cache or manual entry). */
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
    /** Modo evento: una sola entrada con banda honesta; calories = punto medio. */
    isEvent?: boolean; eventKcalMin?: number | null; eventKcalMax?: number | null;
  }) => {
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) throw new Error('Invalid calories: must be a positive number');
    if (!entry.description || !entry.description.trim()) throw new Error('Invalid description: must be a non-empty string');
    if (entry.proteinG != null && (!Number.isFinite(entry.proteinG) || entry.proteinG < 0)) throw new Error('Invalid protein: must be >= 0 grams');
    const isEvent = entry.isEvent ? 1 : 0;
    let eventMin: number | null = null;
    let eventMax: number | null = null;
    if (isEvent) {
      // La banda es opcional (se puede registrar un evento con un solo número),
      // pero si viene tiene que ser coherente: 0 < min <= max.
      if (entry.eventKcalMin != null || entry.eventKcalMax != null) {
        eventMin = Number(entry.eventKcalMin);
        eventMax = Number(entry.eventKcalMax);
        if (!Number.isFinite(eventMin) || !Number.isFinite(eventMax) || eventMin <= 0 || eventMax < eventMin) {
          throw new Error('Invalid event band: need 0 < min <= max kcal');
        }
      }
    }
    const db = getDb();
    const cutoffHour = getDayCutoffHour(db);
    const date = entry.date ?? nutritionDayString(new Date(), cutoffHour);
    if (isDayClosed(db, date)) throw new Error('Cannot modify a closed day');
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    // Resolve meal type if not provided
    let meal = entry.meal ?? null;
    if (!meal) {
      // The cutoff matters here too: at 01:00 the log belongs to yesterday's
      // dinner, never to this morning's breakfast.
      const resolved = resolveMealType(time, readMealSchedule(db), cutoffHour);
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
        INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal,
                              protein_g, carbs_g, fat_g, is_event, event_kcal_min, event_kcal_max, updated_at, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, entry.description, entry.calories, normalizeFoodSource(entry.source),
        entry.frequentFoodId ?? null, entry.aiBreakdown ?? null, meal,
        normMacro(entry.proteinG), normMacro(entry.carbsG), normMacro(entry.fatG),
        isEvent, eventMin, eventMax, syncStamp(), genId());
      // Un evento lleva banda, no un número: no es un plato repetible.
      if (!isEvent) {
        rememberFrequentFood(db, {
          description: entry.description,
          calories: entry.calories,
          proteinG: entry.proteinG,
          carbsG: entry.carbsG,
          fatG: entry.fatG,
        }, syncStamp());
      }
      recalcSummary(db, date);
    })();
  });

  /**
   * Copia las comidas de `from` a `to` (por defecto, ayer -> hoy).
   *
   * "Repetir el almuerzo de siempre" costaba retipear la descripcion y pagar otra
   * llamada a la IA, cuando el modulo se vende como registro rapido. Copia
   * descripcion, calorias y macros, re-sella la hora y genera sync_id nuevos: son
   * comidas nuevas, no las mismas filas.
   *
   * Convive con `nutrition:repeatDay` a propósito: este es el atajo de un toque
   * ("copiá ayer") y devuelve un motivo cuando no puede; repeatDay es el picker
   * explícito de origen/destino. Comparten `repeatDayMeals` salvo por el remapeo
   * de `source`, que solo hace este.
   */
  ipcHandle('nutrition:copyDay', (_e, opts?: { from?: string; to?: string }) => {
    const db = getDb();
    const to = opts?.to ?? nutritionToday(db);
    const from = opts?.from ?? (() => {
      const d = new Date(`${to}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return formatDateString(d);
    })();

    if (isDayClosed(db, to)) return { success: false, reason: 'day_closed', copied: 0 };

    let copied = 0;
    db.transaction(() => { copied = repeatDayMeals(db, from, to, { demoteAiSource: true }); })();

    if (copied === 0) return { success: false, reason: 'source_empty', copied: 0 };
    return { success: true, copied, from, to };
  });

  // Copy every non-deleted meal from a source day to a destination day.
  // Adds on top of whatever the destination already has (never replaces),
  // preserving each meal's original time/meal/macros so the day keeps its shape.
  ipcHandle('nutrition:repeatDay', (_e, fromDate: string, toDate: string) => {
    if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new Error('Invalid date format');
    }
    const db = getDb();
    if (isDayClosed(db, toDate)) throw new Error('Cannot modify a closed day');
    let copied = 0;
    db.transaction(() => { copied = repeatDayMeals(db, fromDate, toDate); })();
    return { copied };
  });

  // Recent days (last 30) that have at least one logged meal, before `beforeDate`.
  // Used by the "repeat a day" picker so the user can choose a source day.
  ipcHandle('nutrition:getRecentLoggedDays', (_e, beforeDate?: string, limit?: number) => {
    const db = getDb();
    const date = beforeDate ?? nutritionToday(db);
    const lowerBound = shiftDateString(date, -30);
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

  ipcHandle('nutrition:getFoodByDate', (_e, date: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, date, time, description, calories, source,
             frequent_food_id AS frequentFoodId,
             ai_breakdown AS aiBreakdown,
             meal,
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
             is_event AS isEvent,
             event_kcal_min AS eventKcalMin,
             event_kcal_max AS eventKcalMax
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

  // ── History autocomplete (the path that never calls the AI) ────────

  /**
   * Suggestions for the food input, drawn from the user's OWN history.
   *
   * With 30 days of log this is how most meals get recorded: type three letters,
   * arrow down, Enter — no network, no model, no waiting, and it works on a
   * plane. `food_log` and `favorite_foods` are unified on `description_norm`
   * (migration v14's generated column) and ranked by frequency x recency; see
   * history-search.ts for the formula and why the tiers exist.
   *
   * An empty query returns the top of the ranking, which is what the input shows
   * on focus before a single keystroke.
   */
  ipcHandle('nutrition:searchHistory', (_e, query?: string, limit?: number) => {
    const db = getDb();
    const cap = Math.max(1, Math.min(50, limit ?? SEARCH_HISTORY_LIMIT));
    const q = normalizeDescription(query ?? '');

    // The window functions do the grouping in SQL: one row per DISTINCT
    // normalised description, carrying the count, the most recent stamp, and —
    // via rn = 1 — the calories of the LATEST log, because the user's most
    // recent number for a meal is their best one.
    const foodLogSql = (where: string) => `
      SELECT norm, description, calories, timesLogged, lastLogged FROM (
        SELECT description_norm AS norm, description, calories,
               COUNT(*) OVER (PARTITION BY description_norm) AS timesLogged,
               MAX(date || ' ' || time) OVER (PARTITION BY description_norm) AS lastLogged,
               ROW_NUMBER() OVER (
                 PARTITION BY description_norm ORDER BY date DESC, time DESC, id DESC
               ) AS rn
        FROM food_log
        WHERE deleted_at IS NULL AND description_norm <> '' ${where}
      ) WHERE rn = 1
    `;
    const favoritesSql = (where: string) => `
      SELECT description_norm AS norm, description, calories, created_at AS createdAt
      FROM favorite_foods
      WHERE deleted_at IS NULL AND description_norm <> '' ${where}
    `;

    type FoodRow = { norm: string; description: string; calories: number; timesLogged: number; lastLogged: string };
    type FavRow = { norm: string; description: string; calories: number; createdAt: string };

    const byNorm = new Map<string, RankableSuggestion>();

    /** Folds one batch of rows into the map; favourites win the calorie value. */
    const collect = (foods: FoodRow[], favorites: FavRow[], prefixMatch: boolean) => {
      for (const r of foods) {
        if (byNorm.has(r.norm)) continue;
        byNorm.set(r.norm, {
          description: r.description,
          calories: r.calories,
          timesLogged: r.timesLogged,
          lastLogged: r.lastLogged,
          source: 'history',
          lastSeenDate: r.lastLogged.slice(0, 10),
          prefixMatch,
        });
      }
      for (const f of favorites) {
        const existing = byNorm.get(f.norm);
        if (existing) {
          // Same meal, saved by hand: keep the history's counts (they are what
          // rank it) but take the CURATED calories and the favourite badge.
          existing.source = 'favorite';
          existing.calories = f.calories;
          existing.description = f.description;
          continue;
        }
        byNorm.set(f.norm, {
          description: f.description,
          calories: f.calories,
          timesLogged: 0,
          lastLogged: null,
          source: 'favorite',
          // Never logged — the day it was saved is the only recency signal there is.
          lastSeenDate: (f.createdAt || '').slice(0, 10),
          prefixMatch,
        });
      }
    };

    if (!q) {
      // No query: the whole ranking, which the UI shows as "your usuals".
      collect(
        db.prepare(foodLogSql('')).all() as FoodRow[],
        db.prepare(favoritesSql('')).all() as FavRow[],
        true,
      );
    } else {
      // Tier 1 — starts with the query. A range predicate, so the planner SEEKs
      // idx_food_log_desc_norm instead of walking the log.
      const lo = q;
      const hi = prefixUpperBound(q);
      const prefixWhere = 'AND description_norm >= ? AND description_norm < ?';
      collect(
        db.prepare(foodLogSql(prefixWhere)).all(lo, hi) as FoodRow[],
        db.prepare(favoritesSql(prefixWhere)).all(lo, hi) as FavRow[],
        true,
      );

      // Tier 2 is only worth paying for when tier 1 could not fill the list —
      // prefix matches outrank contains matches unconditionally, so anything it
      // could find would be cut by the limit anyway.
      if (byNorm.size < cap) {
        const containsWhere =
          "AND description_norm LIKE ? ESCAPE '\\' AND NOT (description_norm >= ? AND description_norm < ?)";
        collect(
          db.prepare(foodLogSql(containsWhere)).all(`%${escapeLike(q)}%`, lo, hi) as FoodRow[],
          db.prepare(favoritesSql(containsWhere)).all(`%${escapeLike(q)}%`, lo, hi) as FavRow[],
          false,
        );
      }
    }

    if (byNorm.size === 0) return [];

    // Protein rides along from the AI cache when it knows it. Only protein: the
    // suggestion row exists to pre-fill the input, and protein is the one macro
    // the user is shown a per-meal number for.
    const norms = [...byNorm.keys()];
    const proteins = db.prepare(
      `SELECT description_norm AS norm, protein_g AS proteinG FROM nutrition_ai_cache
       WHERE protein_g IS NOT NULL AND description_norm IN (${norms.map(() => '?').join(',')})`,
    ).all(...norms) as Array<{ norm: string; proteinG: number }>;
    for (const p of proteins) {
      const row = byNorm.get(p.norm);
      if (row) row.proteinG = p.proteinG;
    }

    return rankSuggestions([...byNorm.values()], nutritionToday(db), cap);
  });

  // ── AI estimate cache (local-only; see migration v14) ──────────────

  /**
   * The cached estimate for a description, or null.
   *
   * A hit is a HIT: `hits` is incremented here, because this is the only place
   * that knows the cache saved a round trip. The renderer uses the counter to
   * show "al instante" instead of the AI badge.
   */
  ipcHandle('nutrition:getCachedEstimate', (_e, description: string) => {
    const norm = normalizeDescription(description);
    if (!norm) return null;
    const db = getDb();
    const row = db.prepare(
      `SELECT calories, ai_breakdown AS aiBreakdown,
              protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG, hits,
              source, prompt_version AS promptVersion
       FROM nutrition_ai_cache WHERE description_norm = ?`,
    ).get(norm) as {
      calories: number; aiBreakdown: string | null;
      proteinG: number | null; carbsG: number | null; fatG: number | null; hits: number;
      source: CacheSource; promptVersion: string | null;
    } | undefined;
    if (!row) return null;
    // A model answer from another prompt is stale: the whole point of
    // improving the prompt is that the most-repeated dishes get the new
    // number. A human correction never expires (migration v17).
    if (row.source !== 'user' && row.promptVersion !== PROMPT_VERSION) return null;
    db.prepare('UPDATE nutrition_ai_cache SET hits = hits + 1, updated_at = ? WHERE description_norm = ?')
      .run(syncStamp(), norm);
    const { promptVersion: _pv, ...hit } = row;
    return { ...hit, hits: row.hits + 1 };
  });

  /**
   * Writes what the user CONFIRMED for this description — which is not always
   * what the model said.
   *
   * Invalidation policy: a manual correction does not delete the entry, it
   * REPLACES it. The human looked at "980 kcal", decided it was 700 and pressed
   * confirm; that number is strictly better evidence than the estimate, and
   * throwing it away would send the next identical description back to the model
   * to be told 980 again. The per-item `ai_breakdown` IS dropped on a correction
   * (`corrected: true`), because a breakdown that no longer adds up to the total
   * is worse than no breakdown.
   *
   * `hits` survives an update: it counts how often the description was reused,
   * not how often the number changed.
   */
  ipcHandle('nutrition:cacheEstimate', (_e, entry: {
    description: string; calories: number; aiBreakdown?: string | null;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
    corrected?: boolean;
  }) => {
    const norm = normalizeDescription(entry.description);
    if (!norm) return { cached: false };
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) return { cached: false };
    const breakdown = entry.corrected ? null : (entry.aiBreakdown ?? null);
    // `corrected` is the one signal that the number came from a human. It is
    // recorded as the row's origin so that (a) it survives every prompt change
    // and (b) it can be offered back to the model as a personal example.
    const source: CacheSource = entry.corrected ? 'user' : 'model';
    const now = syncStamp();
    getDb().prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, ai_breakdown, protein_g, carbs_g, fat_g, hits, created_at, updated_at, source, prompt_version)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(description_norm) DO UPDATE SET
        calories = excluded.calories,
        ai_breakdown = excluded.ai_breakdown,
        protein_g = COALESCE(excluded.protein_g, nutrition_ai_cache.protein_g),
        carbs_g = COALESCE(excluded.carbs_g, nutrition_ai_cache.carbs_g),
        fat_g = COALESCE(excluded.fat_g, nutrition_ai_cache.fat_g),
        updated_at = excluded.updated_at,
        source = excluded.source,
        prompt_version = excluded.prompt_version
    `).run(norm, Math.round(entry.calories), breakdown,
      normMacro(entry.proteinG), normMacro(entry.carbsG), normMacro(entry.fatG), now, now,
      source, PROMPT_VERSION);
    return { cached: true };
  });

  /**
   * The user's corrections, newest first, for the renderer to pick examples
   * from (src/modules/nutrition/similar-corrections.ts). Keyed by
   * description_norm, so the sync duplicates in food_log cannot show up here
   * twice; `description` IS the normalised text, which is what the model sees.
   */
  ipcHandle('nutrition:getUserCorrections', (_e, limit?: number) => {
    const cap = Math.max(1, Math.min(1000, Number.isFinite(limit as number) ? Math.floor(limit as number) : 200));
    return getDb().prepare(
      `SELECT description_norm AS description, calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
              updated_at AS updatedAt
       FROM nutrition_ai_cache WHERE source = 'user'
       ORDER BY updated_at DESC, description_norm ASC LIMIT ?`,
    ).all(cap);
  });

  ipcHandle('nutrition:updateFood', (_e, id: number, fields: {
    description?: string; calories?: number; meal?: string; time?: string;
    aiBreakdown?: string; source?: string;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  }) => {
    if (fields.calories !== undefined && (!Number.isFinite(fields.calories) || fields.calories <= 0)) throw new Error('Invalid calories: must be a positive number');
    if (fields.proteinG != null && (!Number.isFinite(fields.proteinG) || fields.proteinG < 0)) throw new Error('Invalid protein: must be >= 0 grams');
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
    if (fields.source !== undefined) { sets.push('source = ?'); vals.push(normalizeFoodSource(fields.source)); }
    if (fields.proteinG !== undefined) { sets.push('protein_g = ?'); vals.push(normMacro(fields.proteinG)); }
    if (fields.carbsG !== undefined) { sets.push('carbs_g = ?'); vals.push(normMacro(fields.carbsG)); }
    if (fields.fatG !== undefined) { sets.push('fat_g = ?'); vals.push(normMacro(fields.fatG)); }
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
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
             times_used AS timesUsed, created_at AS createdAt
      FROM frequent_foods WHERE deleted_at IS NULL ORDER BY times_used DESC
    `).all();
  });

  ipcHandle('nutrition:createFrequentFood', (_e, food: {
    name: string; calories: number;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  }) => {
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
      db.prepare(`
        UPDATE frequent_foods
        SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(food.calories, normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG), now, existing.id);
      return { id: existing.id, created: false };
    }
    const info = db.prepare(`
      INSERT INTO frequent_foods (name, calories, protein_g, carbs_g, fat_g, times_used, created_at, updated_at, sync_id)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(trimmedName, food.calories, normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG),
      now, now, genId());
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

  ipcHandle('nutrition:saveDailyMetrics', (_e, metrics: { date?: string; steps?: number | null; gym?: boolean }) => {
    // The UI sends `steps: null` for an empty input (Today.tsx); null and
    // undefined both mean "no data" and land as NULL in the nullable column.
    if (metrics.steps != null && (!Number.isFinite(metrics.steps) || metrics.steps < 0)) throw new Error('Invalid steps: must be >= 0');
    const db = getDb();
    const date = metrics.date ?? nutritionToday(db);
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(date, metrics.steps ?? null, metrics.gym ? 1 : 0, syncStamp());
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
    db.prepare('INSERT OR REPLACE INTO nutrition_weekly_metrics (date, weight_kg, waist_cm, updated_at) VALUES (?, ?, ?, ?)')
      .run(date, metrics.weightKg ?? null, metrics.waistCm ?? null, syncStamp());
    recalcSummary(db, nutritionToday(db));
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

  // ── Pergamino semanal ──────────────────────────────

  /**
   * El veredicto de una semana. Idéntico esté sellada o en vista previa: si hay
   * fila en `nutrition_weekly_closed` se devuelve TAL CUAL quedó archivada, y si
   * no, se calcula en vivo. Un pergamino sellado nunca se recalcula.
   */
  ipcHandle('nutrition:getWeekReport', (_e, weekStart: string) => {
    const db = getDb();
    return buildWeekReport(db, weekStart);
  });

  /**
   * Los lunes de las semanas que esperan pergamino.
   *
   * Cinco condiciones (spec §Cuándo hay pergamino pendiente). La 5 —el gate de
   * peso— existe porque `weight_end` sale del pesaje de la semana SIGUIENTE: sin
   * ella el usuario abre el pergamino el lunes temprano, lo sella, y el dato que
   * motivó toda la feature queda NULL para siempre.
   */
  ipcHandle('nutrition:getPendingWeeks', () => {
    const db = getDb();
    const currentWeek = mondayOfWeek(nutritionToday(db));
    const oldest = shiftDay(currentWeek, -28);

    const candidates = db.prepare(`
      SELECT DISTINCT c.date FROM nutrition_daily_closed c
      WHERE c.deleted_at IS NULL AND c.date >= ? AND c.date < ?
    `).all(oldest, currentWeek) as Array<{ date: string }>;

    // `oldest` y `currentWeek` son ambos lunes a exactamente 28 días de distancia,
    // así que todo candidato ya viene acotado a `[oldest, currentWeek)` en la query
    // de arriba y su `mondayOfWeek` cae siempre dentro del mismo rango. Este filter
    // es defensivo — no debería recortar nada nunca; si lo hace, algo más se rompió.
    const weeks = [...new Set(candidates.map(r => mondayOfWeek(r.date)))]
      .filter(w => w >= oldest && w < currentWeek)
      .sort();

    const isSealed = db.prepare('SELECT 1 FROM nutrition_weekly_closed WHERE week_start = ?');
    return weeks.filter(w => !isSealed.get(w) && weeklyGateOpen(db, w));
  });

  /**
   * Sella la semana. Irreversible por diseño: no existe `reopenWeek`.
   *
   * Revalida la condición 5 en vez de confiar en que el llamador pasó por
   * `getPendingWeeks`. Es el mismo principio que el guard de `ref_id` en el motor.
   */
  ipcHandle('nutrition:closeWeek', (_e, weekStart: string) => {
    const db = getDb();

    return db.transaction(() => {
      if (db.prepare('SELECT 1 FROM nutrition_weekly_closed WHERE week_start = ?').get(weekStart)) {
        return { success: false, error: 'Already closed' };
      }

      const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1').get();
      if (!profile) return { success: false, error: 'No profile' };

      if (weekStart >= mondayOfWeek(nutritionToday(db))) {
        return { success: false, error: 'Week not finished' };
      }

      const report = buildWeekReport(db, weekStart);
      if (!report || report.daysClosed === 0) {
        return { success: false, error: 'No closed days' };
      }

      if (!weeklyGateOpen(db, weekStart)) {
        return { success: false, error: 'Waiting for weigh-in' };
      }

      const stamp = syncStamp();
      db.prepare(`
        INSERT INTO nutrition_weekly_closed
          (week_start, days_closed, days_compliant, avg_consumed, avg_target,
           weight_start, weight_end, days_steps, days_gym, streak_end,
           xp_total, closed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        weekStart, report.daysClosed, report.daysCompliant, report.avgConsumed, report.avgTarget,
        report.weightStart, report.weightEnd, report.daysSteps, report.daysGym, report.streakEnd,
        report.xpTotal, stamp, stamp,
      );

      return { success: true, report: { ...report, sealed: true, closedAt: stamp } };
    })();
  });

  /** Las semanas selladas, más recientes primero. Para releer el archivo. */
  ipcHandle('nutrition:getClosedWeeks', (_e, limit?: number) => {
    const db = getDb();
    // Mismo guard que nutrition:getRecentLoggedDays: en SQLite un LIMIT
    // negativo es "sin límite" y uno no entero tira 'datatype mismatch', así
    // que se acota a un entero positivo antes de que llegue a la query.
    const n = Number.isFinite(limit) && (limit as number) > 0
      ? Math.min(Math.floor(limit as number), 200)
      : 52;
    const rows = db.prepare(
      'SELECT week_start FROM nutrition_weekly_closed ORDER BY week_start DESC LIMIT ?',
    ).all(n) as Array<{ week_start: string }>;
    return rows.map(r => buildWeekReport(db, r.week_start)).filter((r): r is WeekReport => r !== null);
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

    const targetDate = date ?? nutritionToday(db);
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

  // Adaptive (data-derived) TDEE INSIGHT. Reads logged intake + the weight series
  // over the lookback window and infers the user's REAL expenditure via the pure
  // energy-balance helper. Read-only: never recalibrates the goal or touches the
  // day-close math. Returns the estimate with a confidence level and the sample
  // counts so the renderer can either show the number or say what's still missing.
  ipcHandle('nutrition:getAdaptiveTdee', () => {
    const db = getDb();
    const today = nutritionToday(db);
    const start = shiftDateString(today, -(ADAPTIVE_LOOKBACK_DAYS - 1));

    const intake = db.prepare(`
      SELECT date, COALESCE(SUM(calories), 0) AS calories
      FROM food_log
      WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
      GROUP BY date
      HAVING calories > 0
      ORDER BY date ASC
    `).all(start, today) as Array<{ date: string; calories: number }>;

    const weights = db.prepare(`
      SELECT date, weight_kg AS weightKg
      FROM nutrition_weekly_metrics
      WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ?
      ORDER BY date ASC
    `).all(start, today) as Array<{ date: string; weightKg: number }>;

    return estimateAdaptiveTdee(intake, weights);
  });

  // ── Dashboard ──────────────────────────────────────

  ipcHandle('nutrition:getWeights', () => {
    const db = getDb();
    return db.prepare(`
      SELECT date, weight_kg AS weightKg FROM nutrition_weekly_metrics
      WHERE weight_kg IS NOT NULL ORDER BY date ASC
    `).all();
  });

  /**
   * Returns `{ streak, todayPending, graceUsedOn? }` — no longer a bare number.
   *
   * The old rule (`total_calories_in <= target * 1.1`) was goal-blind: on a
   * SURPLUS goal, eating far too little kept the streak alive. Compliance now
   * comes from `scoreNutritionDay`, the same function XP, HP and the ring use.
   * See `computeNutritionStreak` for pending-today and the weekly grace day.
   */
  ipcHandle('nutrition:getStreak', () => {
    const db = getDb();
    const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1')
      .get() as { deficit_target_kcal: number } | undefined;
    if (!profile) return { streak: 0, todayPending: true };

    const today = nutritionToday(db);
    const rows = db.prepare(
      `SELECT date, total_calories_in AS totalCaloriesIn, tdee
       FROM nutrition_daily_summary
       WHERE date <= ? AND total_calories_in > 0
       ORDER BY date DESC LIMIT 366`
    ).all(today) as StreakDay[];

    const deficit = profile.deficit_target_kcal ?? 0;

    // ── Día con evento = presentarse ──────────────────────────────────────
    // Registrar el asado ES cumplir con la racha, sin gastar el día de gracia
    // semanal en algo que la app misma invitó a registrar. En vez de tocar el
    // motor compartido, el día se presenta al scorer con el consumo EN el
    // objetivo (tdee - deficit), que es "compliant" bajo los tres objetivos.
    // Solo afecta a la racha: el heatmap y los cierres siguen viendo las
    // calorías reales.
    const eventDates = new Set(
      (db.prepare(
        `SELECT DISTINCT date FROM food_log WHERE is_event = 1 AND deleted_at IS NULL`,
      ).all() as Array<{ date: string }>).map(r => r.date),
    );
    const streakRows = rows.map(r =>
      eventDates.has(r.date) ? { ...r, totalCaloriesIn: r.tdee - deficit } : r,
    );

    return computeNutritionStreak(streakRows, today, deficit);
  });

  /**
   * Fechas (YYYY-MM-DD) con al menos un evento vivo en el rango, para que el
   * heatmap y el histórico distingan "el domingo del asado" de un hueco.
   */
  ipcHandle('nutrition:getEventDays', (_e, start: string, end: string) => {
    const db = getDb();
    return (db.prepare(
      `SELECT DISTINCT date FROM food_log
       WHERE is_event = 1 AND deleted_at IS NULL AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
    ).all(start, end) as Array<{ date: string }>).map(r => r.date);
  });

  ipcHandle('nutrition:getWeekCalories', () => {
    const db = getDb();
    const today = nutritionToday(db);
    const sevenAgo = shiftDateString(today, -6);
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
    const today = nutritionToday(db);
    const row = db.prepare('SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL').get(today) as { total: number };
    return row.total;
  });

  ipcHandle('nutrition:getTodayMealsCount', () => {
    const db = getDb();
    const today = nutritionToday(db);
    const row = db.prepare('SELECT COUNT(*) AS c FROM food_log WHERE date = ? AND deleted_at IS NULL').get(today) as { c: number };
    return row.c;
  });

  ipcHandle('nutrition:getTodayTarget', () => {
    const db = getDb();
    const today = nutritionToday(db);
    const summary = db.prepare('SELECT tdee FROM nutrition_daily_summary WHERE date = ?').get(today) as { tdee: number } | undefined;
    const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1').get() as { deficit_target_kcal: number } | undefined;
    if (!summary || !profile) return null;
    return summary.tdee - profile.deficit_target_kcal;
  });

  // ── Close Day ──────────────────────────────────────

  ipcHandle('nutrition:closeDay', (_e, date: string) => {
    const db = getDb();

    return db.transaction(() => {
      // Check if day already closed (a soft-deleted row counts as reopened → re-closable)
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
      const { xpPrecision, xpBonus } = score;

      // ── Día con evento: neutro-o-cura, jamás daño ─────────────────────────
      // El asado del domingo es la causa documentada #2/#3 de abandono. La regla
      // de oro del RPG es que la racha mide PRESENTARSE, y registrar el evento ES
      // presentarse — así que pasarse del objetivo un día con evento no puede
      // costar vigor. Si el día igual cumplió el objetivo, la curación se paga
      // completa; si no, el HP queda en 0 en vez de negativo. El XP de precisión
      // no se toca: sigue midiendo precisión, que es otra cosa.
      const eventDay = dayHasEvent(db, date);
      const hpChange = eventDay ? Math.max(0, score.hpChange) : score.hpChange;

      const xpSteps = steps > 0 ? 5 : 0;
      const xpGym = gym ? 5 : 0;
      const xpWeight = weightLogged ? 5 : 0;
      const xpTotal = xpPrecision + xpBonus + xpSteps + xpGym + xpWeight;

      // Save close record. UPSERT so a previously reopened (soft-deleted) day can be
      // re-closed: clear deleted_at and refresh closed_at/updated_at for sync.
      const closedAt = syncStamp();
      db.prepare(`
        INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, closed_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(date) DO UPDATE SET
          xp_precision = excluded.xp_precision, xp_steps = excluded.xp_steps,
          xp_gym = excluded.xp_gym, xp_weight = excluded.xp_weight,
          xp_bonus = excluded.xp_bonus, xp_total = excluded.xp_total,
          hp_change = excluded.hp_change, consumed = excluded.consumed,
          target = excluded.target, closed_at = excluded.closed_at,
          updated_at = excluded.updated_at, deleted_at = NULL
      `).run(date, xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange, consumed, Math.round(target), closedAt, closedAt);

      return {
        success: true,
        breakdown: {
          xpPrecision, xpSteps, xpGym, xpWeight, xpBonus, xpTotal, hpChange,
          consumed, target: Math.round(target),
          compliant: score.compliant,
          eventDay,
          precisionPct: target > 0 ? Math.round(Math.abs(consumed - target) / target * 100) : 0,
        },
      };
    })();
  });

  /**
   * Reopens a closed day so the user can keep logging (they closed at 20:00 and
   * then had dinner). Soft-deletes the closure record and reports what the close
   * had granted — it does NOT touch the player's XP/HP itself.
   *
   * The reversal belongs to the RPG ENGINE. The renderer emits
   * `DAY_REOPENED` with `payload: { date }` after this returns, and
   * `rpg-handlers` treats it as a generic undo of the `DAY_SUMMARY` carrying the
   * same `$.date`: it deletes the event row, refunds the EXACT multiplied
   * xp_gained (not the base xp_total stored here), gives back the daily_combo
   * tick when the close was today's, and reverses the mastery bump.
   *
   * That is also what killed the ' ' < 'T' bug this handler used to carry: it
   * matched the DAY_SUMMARY by `created_at >= closed_at`, comparing an ISO UTC
   * stamp against the engine's LOCAL 'YYYY-MM-DD HH:MM:SS'. Since ' ' < 'T' the
   * event of the same day was NEVER found — the base XP got refunded instead of
   * the multiplied one, the row stayed in the log, and every close/reopen cycle
   * stacked another combo tick. Matching on `payload.date` compares no
   * timestamps at all, so the bug cannot come back.
   *
   * `xpReverted` / `hpReverted` are the STORED BASE values, for the toast only.
   */
  ipcHandle('nutrition:reopenDay', (_e, date: string) => {
    const db = getDb();
    return db.transaction(() => {
      const record = reopenDayRecord(db, date);
      if (!record) return { success: false, notClosed: true, error: 'Day is not closed' };

      // Read-only: tells the renderer whether the engine will have a DAY_SUMMARY
      // to undo. A closure from before payload.date existed has none, and the
      // reopen is then just an unlock (the XP stays paid).
      const eventFound = !!db.prepare(`
        SELECT 1 FROM rpg_events
        WHERE module_id = 'nutrition' AND event_type = 'DAY_SUMMARY'
          AND json_extract(payload, '$.date') = ?
        LIMIT 1
      `).get(date);

      recalcSummary(db, date);

      return {
        success: true,
        xpReverted: record.xpTotal,
        hpReverted: record.hpChange,
        eventFound,
      };
    })();
  });

  ipcHandle('nutrition:shouldAskWeight', () => {
    const db = getDb();
    const profile = db.prepare(
      'SELECT weight_check_day, weight_popup_enabled, initial_weight_kg, updated_at FROM nutrition_profile WHERE id = 1',
    ).get() as {
      weight_check_day: number; weight_popup_enabled: number;
      initial_weight_kg: number | null; updated_at: string | null;
    } | undefined;
    if (!profile) return { shouldAsk: false };
    if (!profile.weight_popup_enabled) return { shouldAsk: false };

    const checkDay = profile.weight_check_day ?? 1;
    // Nutritional today: at 01:00 on Monday with a 4 AM cutoff it is still Sunday,
    // and the reminder must not jump the week ahead of the day being logged.
    const today = nutritionToday(db);
    const dow = new Date(today + 'T12:00:00').getDay() || 7; // Monday=1, Sunday=7

    if (dow < checkDay) return { shouldAsk: false };

    const monday = getMondayOfWeek(today);
    const thisWeekWeight = db.prepare(
      'SELECT weight_kg FROM nutrition_weekly_metrics WHERE date = ? AND weight_kg IS NOT NULL'
    ).get(monday) as { weight_kg: number } | undefined;

    if (thisWeekWeight) return { shouldAsk: false };

    const lastWeight = db.prepare(
      'SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1'
    ).get() as { weight_kg: number } | undefined;

    // The setup form asked for the weight minutes ago: a reminder on the same
    // nutritional day asks for what the user just typed (NUT-06). Only while
    // the profile weight is the only one on record — later a settings save
    // (which re-sends the stored weight) must not eat the weekly reminder.
    if (!lastWeight && profileSavedOn(profile.updated_at, getDayCutoffHour(db)) === today) {
      return { shouldAsk: false };
    }

    const fallbackWeight = lastWeight?.weight_kg ?? profile.initial_weight_kg ?? undefined;

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
    return db.prepare(`
      SELECT id, description, calories, source, ai_breakdown AS aiBreakdown,
             protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
             created_at AS createdAt, updated_at AS updatedAt
      FROM favorite_foods WHERE deleted_at IS NULL ORDER BY created_at DESC
    `).all();
  });

  ipcHandle('nutrition:addFavoriteFood', (_e, food: {
    description: string; calories: number; source?: string; aiBreakdown?: string;
    proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  }) => {
    const db = getDb();
    const now = syncStamp();
    // favorite_foods.description is UNIQUE. The old INSERT OR IGNORE silently did
    // nothing on a repeat and still returned a BRAND NEW uuid that existed nowhere
    // in the database, while the UI toasted "saved". Upsert on the description and
    // return the row that really exists, plus whether it was an insert.
    const existing = db.prepare('SELECT id FROM favorite_foods WHERE description = ?')
      .get(food.description) as { id: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE favorite_foods
        SET calories = ?, source = ?, ai_breakdown = ?,
            protein_g = ?, carbs_g = ?, fat_g = ?,
            updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(food.calories, food.source || 'manual', food.aiBreakdown || null,
        normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG), now, existing.id);
      return { id: existing.id, created: false };
    }

    const id = genId();
    db.prepare(`
      INSERT INTO favorite_foods (id, description, calories, source, ai_breakdown, protein_g, carbs_g, fat_g, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, food.description, food.calories, food.source || 'manual', food.aiBreakdown || null,
      normMacro(food.proteinG), normMacro(food.carbsG), normMacro(food.fatG), now, now);
    return { id, created: true };
  });

  ipcHandle('nutrition:removeFavoriteFood', (_e, id: string) => {
    const db = getDb();
    const now = syncStamp();
    db.prepare('UPDATE favorite_foods SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
  });

  ipcHandle('nutrition:getPendingDays', () => {
    const db = getDb();
    const today = nutritionToday(db);
    const sevenAgo = shiftDateString(today, -7);

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

/**
 * Copy all non-deleted meals from `fromDate` to `toDate`, returning the count
 * copied. New rows get fresh autoincrement IDs AND fresh sync_ids — they are new
 * meals, not the same rows replicated — while description/calories/macros/meal,
 * the event mark with its honest band, and the ORIGINAL time are preserved so the
 * repeated day keeps its shape. Adds on top of existing entries (never replaces).
 * Recalculates the destination summary afterwards.
 *
 * @param demoteAiSource `true` (what `nutrition:copyDay` passes) rewrites
 *   `ai_estimate` to `frequent`: the copy did NOT re-estimate anything, so
 *   claiming the AI produced it would be a lie the badge repeats.
 */
export function repeatDayMeals(
  db: ReturnType<typeof getDb>,
  fromDate: string,
  toDate: string,
  opts: { demoteAiSource?: boolean } = {},
): number {
  const rows = db.prepare(`
    SELECT time, description, calories, source, frequent_food_id, ai_breakdown, meal,
           protein_g, carbs_g, fat_g, is_event, event_kcal_min, event_kcal_max
    FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC
  `).all(fromDate) as Array<{
    time: string; description: string; calories: number; source: string;
    frequent_food_id: number | null; ai_breakdown: string | null; meal: string | null;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    is_event: number | null; event_kcal_min: number | null; event_kcal_max: number | null;
  }>;
  if (rows.length === 0) return 0;
  const insert = db.prepare(`
    INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal,
                          protein_g, carbs_g, fat_g, is_event, event_kcal_min, event_kcal_max, updated_at, sync_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    const source = opts.demoteAiSource && r.source === 'ai_estimate' ? 'frequent' : r.source;
    insert.run(toDate, r.time, r.description, r.calories, source,
      r.frequent_food_id, opts.demoteAiSource ? null : r.ai_breakdown, r.meal,
      r.protein_g, r.carbs_g, r.fat_g,
      r.is_event ? 1 : 0, r.event_kcal_min, r.event_kcal_max, syncStamp(), genId());
  }
  recalcSummary(db, toDate);
  return rows.length;
}

/**
 * Reopen a closed day by soft-deleting its nutrition_daily_closed record.
 * Returns the granted XP/HP (and the closure's `closed_at`, which the IPC handler
 * needs to find the DAY_SUMMARY rpg_event) for the caller to revert, or null if
 * the day was not closed — an idempotent no-op for non-closed / already-reopened
 * days.
 *
 * Soft delete, not DELETE: a hard delete is resurrected by the next pull, because
 * mergeNutritionData re-inserts any closure row it doesn't find locally.
 */
export function reopenDayRecord(
  db: ReturnType<typeof getDb>,
  date: string,
): { xpTotal: number; hpChange: number; closedAt: string | null } | null {
  const row = db.prepare(
    'SELECT xp_total AS xpTotal, hp_change AS hpChange, closed_at AS closedAt FROM nutrition_daily_closed WHERE date = ? AND deleted_at IS NULL'
  ).get(date) as { xpTotal: number; hpChange: number; closedAt: string | null } | undefined;
  if (!row) return null;
  const now = syncStamp();
  db.prepare(
    'UPDATE nutrition_daily_closed SET deleted_at = ?, updated_at = ? WHERE date = ? AND deleted_at IS NULL'
  ).run(now, now, date);
  return { xpTotal: row.xpTotal, hpChange: row.hpChange, closedAt: row.closedAt ?? null };
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
  // The day's steps/gym are NOT read here: they reach the TDEE through
  // getDynamicActivityFactor, which blends the whole 14-day window rather than
  // one day. (Both branches had this dead read; it goes.)

  const latestWeight = db.prepare('SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1').get() as { weight_kg: number } | undefined;
  const weight = latestWeight?.weight_kg ?? (profile.initial_weight_kg as number);

  const dob = profile.date_of_birth as string | null;
  const age = dob ? getAgeFromDob(dob) : (profile.age as number) ?? 30;
  const bmr = calculateBMR(weight, profile.height_cm as number, age, profile.sex as string);

  const dynamicFactor = getDynamicActivityFactor(db, profile.activity_level as string);
  const tdee = calculateTDEEWithFactor(bmr, dynamicFactor);
  const balance = tdee - totalCals.total;

  const roundMacro = (v: number | null): number | null =>
    v != null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;

  db.prepare(`
    INSERT OR REPLACE INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance, protein_g, carbs_g, fat_g, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, totalCals.total, Math.round(bmr), tdee, balance,
    roundMacro(macroTotals.protein), roundMacro(macroTotals.carbs), roundMacro(macroTotals.fat), syncStamp());
}

/**
 * Calculate a dynamic activity factor based on last 14 days of real data.
 * Blends the user's chosen base level with actual gym/steps history.
 * More gym days + more steps → higher factor, fewer → lower factor.
 */
export function getDynamicActivityFactor(db: ReturnType<typeof getDb>, baseLevel: string): number {
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

export function calculateBMR(weight: number, height: number, age: number, sex: string): number {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.max(800, Math.min(3500, sex === 'M' ? base + 5 : base - 161));
}

export function calculateTDEEWithFactor(bmr: number, factor: number): number {
  return Math.round(bmr * factor);
}

/**
 * Arma el `WeekReport` de una semana.
 *
 * Sellada → se lee la fila archivada sin recalcular nada (§Inmutabilidad).
 * Sin sellar → se agrega en vivo desde `nutrition_daily_closed`.
 * Sin perfil → null EN LA RAMA VIVA: `scoreNutritionDay` leería un déficit 0
 * y re-puntuaría la semana en banda de mantenimiento, mintiendo sobre quien
 * está en déficit.
 *
 * El orden de los guards es deliberado: primero se mira si la semana está
 * sellada, y sólo si NO lo está se exige el perfil. Un pergamino sellado es
 * autosuficiente — todo quedó congelado en la fila de `nutrition_weekly_closed`
 * al momento de cerrar — y tiene que sobrevivir a un perfil borrado, porque es
 * dato archivado que nunca se vuelve a calcular. Pedir el perfil ANTES del
 * sello hacía que una semana ya sellada devolviera null sin perfil, y como
 * `nutrition:getClosedWeeks` filtra los null, el pergamino desaparecía del
 * archivo en silencio.
 */
export function buildWeekReport(
  db: ReturnType<typeof getDb>,
  weekStart: string,
): WeekReport | null {
  const weekEnd = weekEndOf(weekStart);

  const sealed = db.prepare('SELECT * FROM nutrition_weekly_closed WHERE week_start = ?')
    .get(weekStart) as Record<string, unknown> | undefined;
  if (sealed) {
    return {
      weekStart, weekEnd,
      daysClosed: sealed.days_closed as number,
      daysCompliant: sealed.days_compliant as number,
      avgConsumed: sealed.avg_consumed as number,
      avgTarget: sealed.avg_target as number,
      weightStart: sealed.weight_start as number | null,
      weightEnd: sealed.weight_end as number | null,
      daysSteps: sealed.days_steps as number,
      daysGym: sealed.days_gym as number,
      streakEnd: sealed.streak_end as number,
      xpTotal: sealed.xp_total as number,
      sealed: true,
      closedAt: sealed.closed_at as string | null,
    };
  }

  const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1')
    .get() as { deficit_target_kcal: number } | undefined;
  if (!profile) return null;

  const rows = db.prepare(`
    SELECT date, consumed, target FROM nutrition_daily_closed
    WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date ASC
  `).all(weekStart, weekEnd) as Array<{ date: string; consumed: number; target: number }>;

  const deficit = profile.deficit_target_kcal ?? 0;
  const daysCompliant = countCompliantDays(rows, deficit);
  const n = rows.length;

  const weightAt = (from: string, to: string): number | null => {
    const r = db.prepare(`
      SELECT weight_kg FROM nutrition_weekly_metrics
      WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date ASC LIMIT 1
    `).get(from, to) as { weight_kg: number } | undefined;
    return r?.weight_kg ?? null;
  };

  const habits = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN steps > 0 THEN 1 ELSE 0 END), 0) AS steps,
           COALESCE(SUM(CASE WHEN gym = 1 THEN 1 ELSE 0 END), 0) AS gym
    FROM nutrition_daily_metrics WHERE date BETWEEN ? AND ?
  `).get(weekStart, weekEnd) as { steps: number; gym: number };

  return {
    weekStart, weekEnd,
    daysClosed: n,
    daysCompliant,
    avgConsumed: n ? Math.round(rows.reduce((s, r) => s + r.consumed, 0) / n) : 0,
    avgTarget: n ? Math.round(rows.reduce((s, r) => s + r.target, 0) / n) : 0,
    weightStart: weightAt(weekStart, weekEnd),
    weightEnd: weightAt(shiftDay(weekStart, 7), shiftDay(weekEnd, 7)),
    daysSteps: habits.steps,
    daysGym: habits.gym,
    streakEnd: weekStreakAt(db, weekEnd, deficit),
    xpTotal: weeklyXp(daysCompliant),
    sealed: false,
    closedAt: null,
  };
}

/**
 * Condición 5: ¿hay con qué medir el peso, o ya se esperó suficiente?
 *
 * El escape es `weekStart+14` y el número no es negociable. `weight_check_day`
 * va de 1 a 7 (clampeado en `nutrition:saveProfile`) y `shouldAskWeight` solo
 * pregunta cuando `dow >= checkDay`, así que el usuario puede RESPONDER en
 * cualquier día entre `+7` y `+13` según su configuración. Pero `saveWeeklyMetrics`
 * no recibe `date` desde la UI: usa `getMondayOfWeek()`, que redondea al lunes de
 * esa semana — la fila SIEMPRE queda fechada en `+7`, sin importar qué día contestó.
 * El escape tiene que sobrevivir a la última RESPUESTA posible (`+13`), no a la
 * fecha de la fila; por eso es `+14` y no algo más corto —`+10`, por ejemplo—
 * dispararía antes que la respuesta para todo `weight_check_day >= 4`: retendría
 * el pergamino tres días y lo soltaría con `weight_end` en NULL igual.
 */
export function weeklyGateOpen(db: ReturnType<typeof getDb>, weekStart: string): boolean {
  const hasWeighIn = db.prepare(`
    SELECT 1 FROM nutrition_weekly_metrics
    WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? LIMIT 1
  `).get(shiftDay(weekStart, 7), shiftDay(weekStart, 13));
  if (hasWeighIn) return true;
  return nutritionToday(db) >= shiftDay(weekStart, 14);
}

/**
 * La racha AL DOMINGO de esa semana, no al momento de sellar.
 *
 * Sellar puede pasar hasta 4 semanas después; calcularla al sellar haría que
 * cuatro pergaminos atrasados cerrados en la misma sesión registraran todos el
 * mismo número, que no describe ninguna de las cuatro semanas.
 */
function weekStreakAt(
  db: ReturnType<typeof getDb>,
  weekEnd: string,
  deficit: number,
): number {
  const rows = db.prepare(
    `SELECT date, total_calories_in AS totalCaloriesIn, tdee
     FROM nutrition_daily_summary
     WHERE date <= ? AND total_calories_in > 0
     ORDER BY date DESC LIMIT 366`,
  ).all(weekEnd) as StreakDay[];

  // ── Día con evento = presentarse ──────────────────────────────────────
  // Mismo indulto que `nutrition:getStreak` (línea ~933): registrar el asado
  // ES cumplir con la racha, no gastar el día de gracia semanal en algo que
  // la app misma invitó a registrar. Si este remap se "simplifica" y se
  // borra, el pergamino sellado archiva una racha DISTINTA a la que la app
  // le mostró al usuario — y como los sellos nunca se recalculan, ese número
  // equivocado queda permanente. Acotado a `date <= weekEnd` para no traer
  // el historial de eventos completo en cada llamada.
  const eventDates = new Set(
    (db.prepare(
      `SELECT DISTINCT date FROM food_log WHERE is_event = 1 AND deleted_at IS NULL AND date <= ?`,
    ).all(weekEnd) as Array<{ date: string }>).map(r => r.date),
  );
  const streakRows = rows.map(r =>
    eventDates.has(r.date) ? { ...r, totalCaloriesIn: r.tdee - deficit } : r,
  );

  return computeNutritionStreak(streakRows, weekEnd, deficit).streak;
}
