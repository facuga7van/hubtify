import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';

import { formatDateString, getMondayOfWeek, getAgeFromDob, daysAgoDateString } from '../../shared/date-utils';
import {
  resolveMealType, DEFAULT_MEAL_SCHEDULE, scoreNutritionDay,
  ensureMerienda, clampCutoffHour, nutritionDayString, shiftDateString,
  computeNutritionStreak, DEFAULT_DAY_CUTOFF_HOUR,
} from '../../shared/meal-utils';
import type { MealSchedule, StreakDay } from '../../shared/meal-utils';
import { getLevel, getTitle, clampHp, getLocalDateString } from '../../shared/rpg-engine';
import { bumpMasteryXp } from '../ipc/rpg-handlers';
import { normalizeDescription } from '../../src/modules/nutrition/normalize';
import { rankSuggestions, SEARCH_HISTORY_LIMIT } from '../../src/modules/nutrition/history-search';
import type { RankableSuggestion } from '../../src/modules/nutrition/history-search';

function genId(): string {
  return crypto.randomUUID();
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
 * the row's own insert timestamp. Migration nutrition v10 normalised the history.
 */
function syncStamp(): string {
  return new Date().toISOString();
}

/**
 * A sync stamp (ISO, UTC) rewritten in the engine's `rpg_events.created_at`
 * shape: LOCAL 'YYYY-MM-DD HH:MM:SS' (shared/date-utils localTimestamp).
 *
 * `reopenDay` compares `created_at >= closed_at` as strings. With the raw ISO
 * stamp that was false for every event of the same day (' ' < 'T'), so the
 * DAY_SUMMARY was never found: the closure refunded the BASE xp instead of the
 * multiplied one, the event stayed in the log, and each close/reopen cycle
 * stacked one more DAY_SUMMARY row (and one more combo tick).
 * A stamp that doesn't parse (legacy shapes) is compared as-is.
 */
function toLocalStamp(stamp: string): string {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return stamp;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
 * Objetivo diario de proteína en gramos.
 *
 * `nutrition_profile.protein_target_g` NULL significa "auto": el peso más
 * reciente (o el inicial) × 1.6 g/kg — la referencia estándar para conservar
 * masa magra en déficit y un piso razonable en cualquier objetivo. Exportado
 * para que los tests fijen el contrato del default.
 */
export function getProteinTargetG(db: ReturnType<typeof getDb>): number | null {
  const row = db.prepare(
    'SELECT protein_target_g AS target, initial_weight_kg AS initialWeight FROM nutrition_profile WHERE id = 1',
  ).get() as { target: number | null; initialWeight: number } | undefined;
  if (!row) return null;
  if (row.target != null && Number.isFinite(row.target) && row.target > 0) return Math.round(row.target);
  const latest = db.prepare(
    'SELECT weight_kg AS weightKg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1',
  ).get() as { weightKg: number } | undefined;
  const weight = latest?.weightKg ?? row.initialWeight;
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return Math.round(weight * 1.6);
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
      // NULL = auto (peso × 1.6). El efectivo ya viene resuelto para que la UI
      // nunca tenga que conocer la fórmula ni el peso más reciente.
      proteinTargetG: row.protein_target_g ?? null,
      proteinTargetEffectiveG: getProteinTargetG(db),
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
    /** null = volver al auto (peso × 1.6); undefined = no tocar lo guardado. */
    proteinTargetG?: number | null;
  }) => {
    if (!profile.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) throw new Error('Invalid date of birth format');
    const dobDate = new Date(profile.dateOfBirth + 'T00:00:00');
    if (isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) throw new Error('Invalid date of birth');
    if (!Number.isFinite(profile.heightCm) || profile.heightCm < 100 || profile.heightCm > 250) throw new Error('Invalid height: must be between 100 and 250 cm');
    if (!Number.isFinite(profile.initialWeightKg) || profile.initialWeightKg < 10 || profile.initialWeightKg > 500) throw new Error('Invalid weight: must be between 10 and 500 kg');
    if (profile.deficitTargetKcal !== undefined && (!Number.isFinite(profile.deficitTargetKcal) || Math.abs(profile.deficitTargetKcal) > 2000)) throw new Error('Invalid deficit/surplus target: must be between -2000 and 2000 kcal');
    if (profile.proteinTargetG != null && (!Number.isFinite(profile.proteinTargetG) || profile.proteinTargetG <= 0 || profile.proteinTargetG > 500)) throw new Error('Invalid protein target: must be between 1 and 500 g');
    const age = getAgeFromDob(profile.dateOfBirth);
    const weightCheckDay = Math.max(1, Math.min(7, profile.weightCheckDay ?? 1));
    const weightPopupEnabled = profile.weightPopupEnabled !== false ? 1 : 0;
    const mealScheduleJson = profile.mealSchedule ? JSON.stringify(ensureMerienda(profile.mealSchedule)) : null;
    const db = getDb();
    // Read existing meal_schedule / cutoff / protein target to preserve them when not provided
    const existing = db.prepare('SELECT meal_schedule, day_cutoff_hour, protein_target_g FROM nutrition_profile WHERE id = 1')
      .get() as { meal_schedule: string | null; day_cutoff_hour: number | null; protein_target_g: number | null } | undefined;
    const finalMealSchedule = mealScheduleJson ?? existing?.meal_schedule ?? null;
    const dayCutoffHour = profile.dayCutoffHour !== undefined
      ? clampCutoffHour(profile.dayCutoffHour)
      : (existing?.day_cutoff_hour ?? DEFAULT_DAY_CUTOFF_HOUR);
    // undefined = untouched; null = explicit "back to auto" (peso × 1.6).
    const proteinTargetG = profile.proteinTargetG !== undefined
      ? profile.proteinTargetG
      : (existing?.protein_target_g ?? null);
    db.prepare(`
      INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, day_cutoff_hour, protein_target_g, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(age, profile.sex, profile.heightCm, profile.initialWeightKg,
      profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.dateOfBirth, weightCheckDay, weightPopupEnabled, finalMealSchedule, dayCutoffHour, proteinTargetG, syncStamp());

    // Recalc today's summary with new profile
    recalcSummary(db, nutritionToday(db));
  });

  ipcHandle('nutrition:getMealSchedule', () => readMealSchedule(getDb()));

  // ── Food Log ───────────────────────────────────────

  ipcHandle('nutrition:logFood', (_e, entry: {
    date?: string; description: string; calories: number; source: string;
    frequentFoodId?: number; aiBreakdown?: string; meal?: string;
    /** Gramos de proteína, si se conocen (IA, cache o carga manual). */
    proteinG?: number | null;
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
        INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, protein_g, is_event, event_kcal_min, event_kcal_max, updated_at, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, entry.description, entry.calories, normalizeFoodSource(entry.source),
        entry.frequentFoodId ?? null, entry.aiBreakdown ?? null, meal,
        entry.proteinG ?? null, isEvent, eventMin, eventMax, syncStamp(), genId());
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
    const to = opts?.to ?? nutritionToday(db);
    const from = opts?.from ?? (() => {
      const d = new Date(`${to}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return formatDateString(d);
    })();

    if (isDayClosed(db, to)) return { success: false, reason: 'day_closed', copied: 0 };

    // La copia lleva TODO lo que describe la comida: la marca de evento (y su
    // banda) y la proteína viajan con ella. Sin la marca, el asado de ayer
    // copiado hoy se cerraba como un surplus común y costaba −20 HP injustos;
    // sin protein_g, la proteína del día desaparecía.
    const rows = db.prepare(
      `SELECT description, calories, source, frequent_food_id AS frequentFoodId, meal, time,
              protein_g AS proteinG, is_event AS isEvent,
              event_kcal_min AS eventKcalMin, event_kcal_max AS eventKcalMax
       FROM food_log WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC`,
    ).all(from) as Array<{
      description: string; calories: number; source: string;
      frequentFoodId: number | null; meal: string | null; time: string;
      proteinG: number | null; isEvent: number | null;
      eventKcalMin: number | null; eventKcalMax: number | null;
    }>;

    if (rows.length === 0) return { success: false, reason: 'source_empty', copied: 0 };

    const insert = db.prepare(`
      INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal,
                            protein_g, is_event, event_kcal_min, event_kcal_max, updated_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const r of rows) {
        // La comida original pudo venir de la IA; la copia no vuelve a estimar, asi
        // que su origen es 'frequent' (reutilizada), no 'ai_estimate'.
        const source = r.source === 'ai_estimate' ? 'frequent' : r.source;
        insert.run(to, r.time, r.description, r.calories, source, r.frequentFoodId, r.meal,
          r.proteinG, r.isEvent ? 1 : 0, r.eventKcalMin, r.eventKcalMax, syncStamp(), genId());
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
             meal,
             protein_g AS proteinG,
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
   * (migration v12's generated column) and ranked by frequency x recency; see
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

    // Protein rides along from the AI cache when it happens to know it. The
    // estimate function returns only calories today, so this is almost always
    // NULL — it is here so the field exists the day macros land.
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

  // ── AI estimate cache (local-only; see migration v12) ──────────────

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
      `SELECT calories, ai_breakdown AS aiBreakdown, protein_g AS proteinG, hits
       FROM nutrition_ai_cache WHERE description_norm = ?`,
    ).get(norm) as { calories: number; aiBreakdown: string | null; proteinG: number | null; hits: number } | undefined;
    if (!row) return null;
    db.prepare('UPDATE nutrition_ai_cache SET hits = hits + 1, updated_at = ? WHERE description_norm = ?')
      .run(syncStamp(), norm);
    return { ...row, hits: row.hits + 1 };
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
    proteinG?: number | null; corrected?: boolean;
  }) => {
    const norm = normalizeDescription(entry.description);
    if (!norm) return { cached: false };
    if (!Number.isFinite(entry.calories) || entry.calories <= 0) return { cached: false };
    const breakdown = entry.corrected ? null : (entry.aiBreakdown ?? null);
    const now = syncStamp();
    getDb().prepare(`
      INSERT INTO nutrition_ai_cache (description_norm, calories, ai_breakdown, protein_g, hits, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(description_norm) DO UPDATE SET
        calories = excluded.calories,
        ai_breakdown = excluded.ai_breakdown,
        protein_g = COALESCE(excluded.protein_g, nutrition_ai_cache.protein_g),
        updated_at = excluded.updated_at
    `).run(norm, Math.round(entry.calories), breakdown, entry.proteinG ?? null, now, now);
    return { cached: true };
  });

  ipcHandle('nutrition:updateFood', (_e, id: number, fields: { description?: string; calories?: number; meal?: string; time?: string; aiBreakdown?: string; source?: string; proteinG?: number | null }) => {
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
    if (fields.proteinG !== undefined) { sets.push('protein_g = ?'); vals.push(fields.proteinG); }
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
    db.prepare('INSERT OR REPLACE INTO nutrition_weekly_metrics (date, weight_kg, waist_cm, updated_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .run(date, metrics.weightKg ?? null, metrics.waistCm ?? null);
    recalcSummary(db, nutritionToday(db));
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
          eventDay,
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
   *
   * This mirrors the engine's own undo path (rpg-handlers isUndo): delete the
   * event, refund its XP/HP, and give back the daily_combo tick it earned when
   * it was today's. Without the last step every close/reopen cycle left the
   * combo one notch higher — 4 cycles = 2.0x on everything else that day.
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
      const closedAt = closed.closed_at as string | null;
      const since = closedAt ? toLocalStamp(closedAt) : date;

      const event = db.prepare(`
        SELECT id, xp_gained, hp_change, created_at FROM rpg_events
        WHERE module_id = 'nutrition' AND event_type = 'DAY_SUMMARY'
          AND json_extract(payload, '$.xp') = ?
          AND json_extract(payload, '$.hp') = ?
          AND created_at >= ?
        ORDER BY id DESC LIMIT 1
      `).get(xpTotal, hpChange, since) as { id: number; xp_gained: number; hp_change: number; created_at: string } | undefined;

      const xpToRevert = event ? event.xp_gained : xpTotal;
      const hpToRevert = event ? event.hp_change : hpChange;
      if (event) {
        db.prepare('DELETE FROM rpg_events WHERE id = ?').run(event.id);
        // The close bumped the nutrition mastery; reopening annuls that entry
        // (floor 0 inside) — otherwise close/reopen/close farms mastery.
        bumpMasteryXp(db, 'nutrition', -event.xp_gained);
      }

      const stats = db.prepare('SELECT xp, hp, title, daily_combo AS combo FROM player_stats WHERE user_id = ?')
        .get('default') as { xp: number; hp: number; title: string; combo: number };
      const newXp = Math.max(0, stats.xp - xpToRevert);
      const newLevel = getLevel(newXp);
      // The combo belongs to the calendar day: only a close made TODAY ticked
      // the counter the player still carries, so only that one is given back.
      const today = getLocalDateString();
      const combo = stats.combo || 0;
      const newCombo = event && event.created_at.slice(0, 10) === today && combo > 0 ? combo - 1 : combo;
      db.prepare('UPDATE player_stats SET xp = ?, level = ?, title = ?, hp = ?, daily_combo = ? WHERE user_id = ?')
        .run(newXp, newLevel, getTitle(newLevel), clampHp(stats.hp - hpToRevert), newCombo, 'default');

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
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(date, totalCals.total, Math.round(bmr), tdee, balance, syncStamp());
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

