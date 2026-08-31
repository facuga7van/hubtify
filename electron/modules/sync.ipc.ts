import type Database from 'better-sqlite3';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { recalcSummary } from './nutrition.ipc';
import { weeklyTarget } from './quests.habits';

/**
 * Guards a remote row before it reaches SQLite: rejects non-objects and any row
 * missing a column the schema declares NOT NULL. Without this a single bad record
 * (a task with no `name`, a null entry in the array) raised a constraint error
 * that rolled back the entire pull.
 */
function isUsableRow(row: unknown, table: string, required: string[]): boolean {
  if (!row || typeof row !== 'object') {
    console.warn(`[Sync] ${table}: skipping non-object row`);
    return false;
  }
  const r = row as Record<string, unknown>;
  for (const field of required) {
    const v = r[field];
    if (v === undefined || v === null || v === '') {
      console.warn(`[Sync] ${table}: skipping row missing "${field}"`, r.id ?? '(no id)');
      return false;
    }
  }
  return true;
}

interface SyncTask {
  id: string;
  name: string;
  description: string;
  status: number;
  tier: number;
  category: string;
  projectId: string | null;
  dueDate: string | null;
  order: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncSubtask {
  id: string;
  taskId: string;
  name: string;
  description: string;
  tier: number;
  status: number;
  order: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncProject {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncCategory {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncHabit {
  id: string;
  name: string;
  frequency: string;
  timesPerWeek: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncHabitCheck {
  id: string;
  habitId: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncDrawing {
  id: string;
  taskId: string;
  data: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncRpgEvent {
  /** Cross-device identity. `id` (AUTOINCREMENT) is local-only and no longer sent. */
  syncId?: string;
  id?: number;
  refId?: string | null;
  moduleId: string;
  eventType: string;
  xpGained: number;
  hpChange: number;
  comboMultiplier: number;
  bonusMultiplier: number;
  payload: string;
  createdAt: string;
}

interface SyncQuestData {
  tasks: SyncTask[];
  subtasks: SyncSubtask[];
  projects: SyncProject[];
  categories: SyncCategory[];
  habits: SyncHabit[];
  habitChecks: SyncHabitCheck[];
  drawings: SyncDrawing[];
  rpgEvents?: SyncRpgEvent[];
}

const USER_DATA_TABLES = [
  'player_stats',
  'rpg_events',
  'user_profile',
  'character_data',
  'tasks',
  'subtasks',
  'task_categories',
  'projects',
  'task_drawings',
  'habits',
  'habit_checks',
  'finance_transactions',
  'finance_loans',
  'finance_categories',
  'nutrition_profile',
  'food_log',
  'frequent_foods',
  'nutrition_daily_metrics',
  'nutrition_weekly_metrics',
  'nutrition_daily_summary',
  'nutrition_daily_closed',
  'favorite_foods',
  'dollar_cache',
  'crypto_cache',
  'finance_recurring',
  'finance_recurring_amount_history',
  'finance_installment_groups',
  'finance_loan_payments',
  'finance_category_mappings',
  'finance_credit_cards',
  'finance_credit_card_statements',
  'notifications',
  'cauldron_presets',
  'cauldron_sessions',
  // Holds the real imported-statement metadata, and finance_transactions.import_batch_id
  // points at it — leaving it out leaked one account's imports into the next.
  'finance_import_batches',
  // Legacy but still carries user rows on older installs.
  'finance_income_sources',
];

/**
 * app_state is NOT in USER_DATA_TABLES: it also stores `last_uid`, which must
 * survive an account switch. These keys are per-user preferences and must not.
 */
const USER_PREFERENCE_STATE_KEYS = [
  'dollar_visible_types',
  'crypto_visible_types',
];

/**
 * How much rpg_events history is pushed to Firestore. The whole log used to go
 * into the `questify` field of the main user document — one event per task,
 * habit, meal and expense, never pruned — so an active account eventually
 * crossed Firestore's 1 MB per-document cap and EVERY push started failing.
 */
const RPG_EVENTS_PUSH_DAYS = 90;

/** Local rpg_events older than this are deleted on startup. */
const RPG_EVENTS_RETENTION_DAYS = 365;

function daysAgoStamp(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Drops rpg_events older than the retention window so the log stops growing forever. */
export function pruneRpgEvents(db: Database.Database): number {
  try {
    const info = db.prepare('DELETE FROM rpg_events WHERE created_at < ?')
      .run(daysAgoStamp(RPG_EVENTS_RETENTION_DAYS));
    return info.changes;
  } catch (err) {
    console.error('[Sync] rpg_events prune failed (non-fatal):', err);
    return 0;
  }
}

// Merges remote habit checks into local with last-write-wins.
// The natural key is (habit_id, date) — enforced by UNIQUE in the schema — NOT the
// surrogate `id`. The same logical check can arrive under a different id from another
// device/account; a plain INSERT would then violate UNIQUE(habit_id, date), throw, and
// roll back the ENTIRE questify merge transaction.
// Defense-in-depth: an UPSERT makes that conflict structurally harmless — instead of
// throwing, it reconciles in place. The WHERE on DO UPDATE preserves last-write-wins so
// a stale remote never clobbers a newer local row.
export function mergeHabitChecks(db: Database.Database, checks: SyncHabitCheck[]): boolean {
  let changed = false;
  const upsert = db.prepare(`
    INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET
      deleted_at = excluded.deleted_at,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > habit_checks.updated_at
  `);

  for (const rc of checks) {
    const info = upsert.run(rc.id, rc.habitId, rc.date, rc.createdAt, rc.updatedAt, rc.deletedAt);
    if (info.changes > 0) changed = true;
  }
  return changed;
}

/**
 * Merges the two AUTOINCREMENT-keyed nutrition tables (frequent_foods, then
 * food_log, which references them) and recalculates every affected day's summary.
 *
 * Exported — like mergeHabitChecks — so the cross-device identity rules can be
 * tested directly against an in-memory database.
 */
export function mergeNutritionFoods(
  db: Database.Database,
  d: { frequentFoods?: Array<Record<string, any>>; foodLog?: Array<Record<string, any>> },
): { changed: boolean; affectedDates: Set<string> } {
  const affectedDates = new Set<string>();
  let changed = false;

  // ── Frequent foods ──
  // Merged BEFORE food_log, which references them, and keyed by sync_id rather
  // than the AUTOINCREMENT id (two devices mint the same numbers for different
  // foods, so the old id-keyed merge dropped rows and cross-applied deletes).
  if (Array.isArray(d.frequentFoods)) {
    const getFreqBySync = db.prepare('SELECT id, updated_at FROM frequent_foods WHERE sync_id = ?');
    const getFreqByName = db.prepare('SELECT id, updated_at FROM frequent_foods WHERE name = ? COLLATE NOCASE');
    const insertFreq = db.prepare('INSERT INTO frequent_foods (sync_id, name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updateFreq = db.prepare('UPDATE frequent_foods SET calories = ?, ai_breakdown = ?, times_used = ?, updated_at = ?, deleted_at = ? WHERE id = ?');
    const adoptFreqSync = db.prepare('UPDATE frequent_foods SET sync_id = ? WHERE id = ? AND sync_id IS NULL AND NOT EXISTS (SELECT 1 FROM frequent_foods WHERE sync_id = ?)');

    for (const f of d.frequentFoods) {
      if (!isUsableRow(f, 'frequentFoods', ['name'])) continue;
      // Same deterministic shape the nutrition v10 backfill used, so a payload
      // from a device that has not upgraded yet still lines up.
      const syncId: string = (typeof f.sync_id === 'string' && f.sync_id)
        ? f.sync_id
        : `legacy-${String(f.name).toLowerCase()}`;

      let local = getFreqBySync.get(syncId) as { id: number; updated_at: string | null } | undefined;
      if (!local) {
        // name is UNIQUE COLLATE NOCASE — adopt the existing row instead of
        // colliding with it.
        const byName = getFreqByName.get(f.name) as { id: number; updated_at: string | null } | undefined;
        if (byName) {
          adoptFreqSync.run(syncId, byName.id, syncId);
          local = byName;
        }
      }

      if (!local) {
        insertFreq.run(syncId, f.name, f.calories, f.ai_breakdown ?? null, f.times_used ?? 0, f.created_at, f.updated_at ?? null, f.deleted_at ?? null);
        changed = true;
      } else if ((f.updated_at ?? '') > (local.updated_at || '')) {
        updateFreq.run(f.calories, f.ai_breakdown ?? null, f.times_used ?? 0, f.updated_at, f.deleted_at ?? null, local.id);
        changed = true;
      }
    }
  }

  // ── Food log ──
  // Keyed by sync_id. Verified failure of the old id-keyed merge: 2 own meals on
  // each device merged to 2 rows instead of 4, and the LWW pass then wrote the
  // remote's deleted_at onto whichever unrelated local row shared the number.
  if (Array.isArray(d.foodLog)) {
    const getFoodBySync = db.prepare('SELECT id, date, updated_at FROM food_log WHERE sync_id = ?');
    const getFoodByNatural = db.prepare('SELECT id, date, updated_at FROM food_log WHERE date = ? AND time = ? AND description = ? AND calories = ?');
    const insertFood = db.prepare('INSERT INTO food_log (sync_id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const updateFood = db.prepare('UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE id = ?');
    const adoptFoodSync = db.prepare('UPDATE food_log SET sync_id = ? WHERE id = ? AND sync_id IS NULL AND NOT EXISTS (SELECT 1 FROM food_log WHERE sync_id = ?)');
    const freqBySync = db.prepare('SELECT id FROM frequent_foods WHERE sync_id = ?');

    for (const f of d.foodLog) {
      if (!isUsableRow(f, 'foodLog', ['date', 'time', 'description', 'calories'])) continue;

      // food_log.frequent_food_id points at the LOCAL frequent_foods.id, which
      // identifies a different food on every device — re-resolve it by sync_id.
      let frequentFoodId: number | null = null;
      if (f.frequent_food_sync_id) {
        const ff = freqBySync.get(f.frequent_food_sync_id) as { id: number } | undefined;
        frequentFoodId = ff?.id ?? null;
      }

      const syncId: string = (typeof f.sync_id === 'string' && f.sync_id)
        ? f.sync_id
        : `legacy-${f.date}|${f.time}|${f.calories}|${String(f.description).slice(0, 60)}`;

      let local = getFoodBySync.get(syncId) as { id: number; date: string; updated_at: string | null } | undefined;
      if (!local) {
        const byNatural = getFoodByNatural.get(f.date, f.time, f.description, f.calories) as { id: number; date: string; updated_at: string | null } | undefined;
        if (byNatural) {
          adoptFoodSync.run(syncId, byNatural.id, syncId);
          local = byNatural;
        }
      }

      if (!local) {
        insertFood.run(syncId, f.date, f.time, f.description, f.calories, f.source ?? 'manual', frequentFoodId, f.ai_breakdown ?? null, f.meal ?? null, f.updated_at ?? null, f.deleted_at ?? null);
        affectedDates.add(f.date);
        changed = true;
      } else if ((f.updated_at ?? '') > (local.updated_at || '')) {
        updateFood.run(f.deleted_at ?? null, f.updated_at ?? null, local.id);
        // A row that merely flipped deleted_at changes that day's totals too.
        // Only freshly INSERTED rows used to trigger a recalc, so a delete synced
        // from another device left the two devices showing different daily totals.
        affectedDates.add(local.date);
        if (f.date) affectedDates.add(f.date);
        changed = true;
      }
    }
  }

  for (const date of affectedDates) {
    recalcSummary(db, date);
  }

  return { changed, affectedDates };

}

/**
 * Merges a remote questify payload into the local database with last-write-wins.
 *
 * Exported so the failure modes that used to abort an entire pull — an orphan
 * subtask or habit check, a null payload, a task with no name — can be tested
 * directly against an in-memory database.
 */
export function mergeQuestDataInto(db: Database.Database, remote: SyncQuestData): { changed: boolean } {
  let changed = false;

  // A null payload, or one missing the expected arrays, used to throw
  // "Cannot read properties of null" and abort the whole pull.
  if (!remote || typeof remote !== 'object') {
    console.warn('[Sync] mergeQuestData: ignoring non-object payload');
    return { changed: false };
  }
  const rows = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const tx = db.transaction(() => {
    // Every table runs inside its OWN savepoint. One corrupt record used to
    // abort the ENTIRE transaction — a single subtask whose taskId doesn't exist
    // locally raised FOREIGN KEY constraint failed and the whole pull (tasks,
    // habits, projects, drawings) was rolled back and lost. Now the bad table's
    // work is discarded and the rest of the pull still lands.
    const step = (label: string, fn: () => void) => {
      const sp = db.transaction(fn);
      try {
        sp();
      } catch (err) {
        console.error(`[Sync] mergeQuestData: "${label}" failed, skipping that table:`, err);
      }
    };

    // ── Merge projects first (tasks reference them) ──
    step('projects', () => {
      const getProject = db.prepare('SELECT id, updated_at FROM projects WHERE id = ?');
      const insertProject = db.prepare(`
        INSERT INTO projects (id, name, color, project_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateProject = db.prepare(`
        UPDATE projects SET name = ?, color = ?, project_order = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);

      for (const rp of rows<SyncProject>(remote.projects)) {
        if (!isUsableRow(rp, 'projects', ['id', 'name'])) continue;
        const local = getProject.get(rp.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertProject.run(rp.id, rp.name, rp.color ?? '#8b7355', rp.order ?? 0, rp.createdAt, rp.updatedAt, rp.deletedAt);
          changed = true;
        } else if (rp.updatedAt > local.updated_at) {
          updateProject.run(rp.name, rp.color ?? '#8b7355', rp.order ?? 0, rp.updatedAt, rp.deletedAt, rp.id);
          changed = true;
        }
      }
    });

    // ── Merge tasks ──
    step('tasks', () => {
      const getTask = db.prepare('SELECT id, updated_at FROM tasks WHERE id = ?');
      const insertTask = db.prepare(`
        INSERT INTO tasks (id, name, description, status, tier, category, project_id, due_date, task_order, completed_at, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateTask = db.prepare(`
        UPDATE tasks SET name = ?, description = ?, status = ?, tier = ?, category = ?,
               project_id = ?, due_date = ?, task_order = ?, completed_at = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      // tasks.project_id REFERENCES projects(id): a task pointing at a project this
      // device has never seen would fail the FK. Keep the task, drop the dangling link.
      const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');

      for (const rt of rows<SyncTask>(remote.tasks)) {
        // name is NOT NULL — a nameless task raised NOT NULL constraint failed and
        // took the whole pull down with it.
        if (!isUsableRow(rt, 'tasks', ['id', 'name'])) continue;
        const projectId = rt.projectId && projectExists.get(rt.projectId) ? rt.projectId : null;
        const local = getTask.get(rt.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertTask.run(rt.id, rt.name, rt.description ?? '', rt.status ?? 0, rt.tier ?? 2, rt.category ?? '',
            projectId, rt.dueDate ?? null, rt.order ?? 0, rt.completedAt ?? null, rt.createdAt, rt.updatedAt, rt.deletedAt);
          changed = true;
        } else if (rt.updatedAt > local.updated_at) {
          updateTask.run(rt.name, rt.description ?? '', rt.status ?? 0, rt.tier ?? 2, rt.category ?? '',
            projectId, rt.dueDate ?? null, rt.order ?? 0, rt.completedAt ?? null, rt.updatedAt, rt.deletedAt, rt.id);
          changed = true;
        }
      }
    });

    // ── Merge subtasks ──
    step('subtasks', () => {
      const getSubtask = db.prepare('SELECT id, updated_at FROM subtasks WHERE id = ?');
      const insertSubtask = db.prepare(`
        INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, completed_at, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateSubtask = db.prepare(`
        UPDATE subtasks SET name = ?, description = ?, tier = ?, status = ?,
               subtask_order = ?, completed_at = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      // subtasks.task_id is a NOT NULL foreign key: there is no way to keep an
      // orphan, so it is dropped (logged) instead of aborting the pull.
      const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');

      for (const rs of rows<SyncSubtask>(remote.subtasks)) {
        if (!isUsableRow(rs, 'subtasks', ['id', 'taskId', 'name'])) continue;
        const local = getSubtask.get(rs.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          if (!taskExists.get(rs.taskId)) {
            console.warn(`[Sync] mergeQuestData: dropping orphan subtask ${rs.id} (task ${rs.taskId} not found)`);
            continue;
          }
          insertSubtask.run(rs.id, rs.taskId, rs.name, rs.description ?? '', rs.tier ?? 2, rs.status ?? 0,
            rs.order ?? 0, rs.completedAt ?? null, rs.createdAt, rs.updatedAt, rs.deletedAt);
          changed = true;
        } else if (rs.updatedAt > local.updated_at) {
          updateSubtask.run(rs.name, rs.description ?? '', rs.tier ?? 2, rs.status ?? 0,
            rs.order ?? 0, rs.completedAt ?? null, rs.updatedAt, rs.deletedAt, rs.id);
          changed = true;
        }
      }
    });

    // ── Merge categories (keyed by id) ──
    step('categories', () => {
      const getCategory = db.prepare('SELECT id, updated_at FROM task_categories WHERE id = ?');
      const insertCategory = db.prepare(`
        INSERT OR IGNORE INTO task_categories (id, name, project_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateCategory = db.prepare(`
        UPDATE task_categories SET name = ?, project_id = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');

      for (const rc of rows<SyncCategory>(remote.categories)) {
        if (!isUsableRow(rc, 'categories', ['id', 'name'])) continue;
        const projectId = rc.projectId && projectExists.get(rc.projectId) ? rc.projectId : null;
        const local = getCategory.get(rc.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertCategory.run(rc.id, rc.name, projectId, rc.createdAt, rc.updatedAt, rc.deletedAt);
          changed = true;
        } else if (rc.updatedAt > local.updated_at) {
          updateCategory.run(rc.name, projectId, rc.updatedAt, rc.deletedAt, rc.id);
          changed = true;
        }
      }
    });

    // ── Merge habits ──
    step('habits', () => {
      const getHabit = db.prepare('SELECT id, updated_at FROM habits WHERE id = ?');
      const insertHabit = db.prepare(`
        INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateHabit = db.prepare(`
        UPDATE habits SET name = ?, frequency = ?, times_per_week = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);

      for (const rh of rows<SyncHabit>(remote.habits)) {
        if (!isUsableRow(rh, 'habits', ['id', 'name'])) continue;
        // times_per_week is clamped to 1..7 here, NOT trusted: a 0 arriving from
        // sync (or from Syl via firebase-admin) makes computeHabits' weekly-streak
        // loop non-terminating and hangs the whole main process.
        const timesPerWeek = weeklyTarget(rh.timesPerWeek);
        const frequency = rh.frequency === 'weekly' || rh.frequency === 'monthly' ? rh.frequency : 'daily';
        const local = getHabit.get(rh.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertHabit.run(rh.id, rh.name, frequency, timesPerWeek, rh.createdAt, rh.updatedAt ?? rh.createdAt, rh.deletedAt);
          changed = true;
        } else if ((rh.updatedAt ?? rh.createdAt) > local.updated_at) {
          updateHabit.run(rh.name, frequency, timesPerWeek, rh.updatedAt ?? rh.createdAt, rh.deletedAt, rh.id);
          changed = true;
        }
      }
    });

    // ── Merge drawings ──
    step('drawings', () => {
      const getDrawing = db.prepare('SELECT id, updated_at FROM task_drawings WHERE id = ?');
      const insertDrawing = db.prepare(`
        INSERT INTO task_drawings (id, task_id, data, draw_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateDrawing = db.prepare(`
        UPDATE task_drawings SET data = ?, draw_order = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');

      for (const rd of rows<SyncDrawing>(remote.drawings)) {
        if (!isUsableRow(rd, 'drawings', ['id', 'taskId', 'data'])) continue;
        const local = getDrawing.get(rd.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          if (!taskExists.get(rd.taskId)) {
            console.warn(`[Sync] mergeQuestData: dropping orphan drawing ${rd.id} (task ${rd.taskId} not found)`);
            continue;
          }
          insertDrawing.run(rd.id, rd.taskId, rd.data, rd.order ?? 0, rd.createdAt, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null);
          changed = true;
        } else if ((rd.updatedAt ?? rd.createdAt) > local.updated_at) {
          updateDrawing.run(rd.data, rd.order ?? 0, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null, rd.id);
          changed = true;
        }
      }
    });

    // ── Merge habit checks (keyed by natural key habit_id+date, see mergeHabitChecks) ──
    step('habitChecks', () => {
      // habit_checks.habit_id is a NOT NULL foreign key — same orphan class of
      // failure as subtasks (see commit a4a408a).
      const habitExists = db.prepare('SELECT 1 FROM habits WHERE id = ?');
      const usable = rows<SyncHabitCheck>(remote.habitChecks).filter((rc) => {
        if (!isUsableRow(rc, 'habitChecks', ['id', 'habitId', 'date'])) return false;
        if (!habitExists.get(rc.habitId)) {
          console.warn(`[Sync] mergeQuestData: dropping orphan habit check ${rc.id} (habit ${rc.habitId} not found)`);
          return false;
        }
        return true;
      });
      if (usable.length && mergeHabitChecks(db, usable)) changed = true;
    });

    // ── Merge RPG events (deduplicated by sync_id) ──
    step('rpgEvents', () => {
      // NOT by `id`: rpg_events.id is AUTOINCREMENT, so both devices mint 1, 2, 3…
      // for different events and the old `WHERE id = ?` check silently dropped
      // half of them. `id` is now left to the local sequence entirely.
      const getEvent = db.prepare('SELECT 1 FROM rpg_events WHERE sync_id = ?');
      const insertEvent = db.prepare(`
        INSERT OR IGNORE INTO rpg_events (sync_id, module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const re of rows<SyncRpgEvent>(remote.rpgEvents)) {
        // Pre-sync_id payloads carried only the numeric id; there is no way to
        // identify them across devices, so they are skipped rather than duplicated.
        if (!re || typeof re.syncId !== 'string' || !re.syncId) continue;
        if (getEvent.get(re.syncId)) continue;
        const result = insertEvent.run(
          re.syncId, re.moduleId, re.eventType, re.xpGained ?? 0, re.hpChange ?? 0,
          re.comboMultiplier ?? 1, re.bonusMultiplier ?? 1, re.payload ?? null,
          re.refId ?? null, re.createdAt,
        );
        if (result.changes > 0) changed = true;
      }
    });
  });

  tx();
  return { changed };
}

export function registerSyncIpcHandlers(): void {
  pruneRpgEvents(getDb());

  ipcHandle('sync:clearUserData', () => {
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        for (const table of USER_DATA_TABLES) {
          // A table listed here may not exist yet on a very old install.
          const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
          if (!exists) continue;
          db.prepare(`DELETE FROM ${table}`).run();
        }
        // app_state is keyed, not wholesale: `last_uid` must survive the switch,
        // the user's dollar/crypto visibility preferences must not.
        const clearPref = db.prepare('DELETE FROM app_state WHERE key = ?');
        for (const key of USER_PREFERENCE_STATE_KEYS) clearPref.run(key);
        db.prepare(`INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default')`).run();
        db.prepare(`INSERT OR IGNORE INTO user_profile (id) VALUES ('default')`).run();
        // Re-seed default cauldron presets after clearing
        db.prepare(
          `INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, extension_minutes, is_default)
           VALUES
             ('preset-classic', 'Classic', 25, 5, 15, 4, 5, 1),
             ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 5, 1),
             ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 5, 1)`,
        ).run();
      });
      tx();
      return { success: true };
    } finally {
      db.pragma('foreign_keys = ON');
    }
  });

  // app_state is created by initCoreTables (electron/ipc/db.ts), not ad-hoc here:
  // dollar:getVisibleTypes reads it without creating it, so on a clean install
  // where neither of these handlers had run yet it threw "no such table".
  ipcHandle('sync:setCurrentUser', (_e, uid: string) => {
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_uid', ?)`).run(uid);
  });

  ipcHandle('sync:getCurrentUser', () => {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_state WHERE key = 'last_uid'`).get() as { value: string } | undefined;
    return row?.value ?? null;
  });

  // Returns ALL quest data including soft-deleted, for push to Firebase
  ipcHandle('sync:getAllQuestData', () => {
    const db = getDb();

    const tasks = db.prepare(`
      SELECT id, name, description, status, tier, category,
             project_id AS projectId, due_date AS dueDate, task_order AS "order",
             completed_at AS completedAt,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM tasks
    `).all();

    const subtasks = db.prepare(`
      SELECT id, task_id AS taskId, name, description, tier, status,
             subtask_order AS "order", completed_at AS completedAt,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM subtasks
    `).all();

    const projects = db.prepare(`
      SELECT id, name, color, project_order AS "order",
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM projects
    `).all();

    const categories = db.prepare(`
      SELECT id, name, project_id AS projectId,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM task_categories
    `).all();

    const habits = db.prepare(`
      SELECT id, name, frequency, times_per_week AS timesPerWeek,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM habits
    `).all();

    const habitChecks = db.prepare(`
      SELECT id, habit_id AS habitId, date,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM habit_checks
    `).all();

    const drawings = db.prepare(`
      SELECT id, task_id AS taskId, data, draw_order AS "order",
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM task_drawings
    `).all();

    // Only the recent window is pushed — see RPG_EVENTS_PUSH_DAYS. sync_id (not the
    // local AUTOINCREMENT id) is the cross-device identity.
    const rpgEvents = db.prepare(`
      SELECT sync_id AS syncId, module_id AS moduleId, event_type AS eventType,
             xp_gained AS xpGained, hp_change AS hpChange,
             combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
             payload, ref_id AS refId, created_at AS createdAt
      FROM rpg_events WHERE created_at >= ? ORDER BY id ASC
    `).all(daysAgoStamp(RPG_EVENTS_PUSH_DAYS));

    return { tasks, subtasks, projects, categories, habits, habitChecks, drawings, rpgEvents };
  });

  // Merges remote quest data with local using last-write-wins
  ipcHandle('sync:mergeQuestData', (_e, remote: SyncQuestData) => mergeQuestDataInto(getDb(), remote));


  // ── Nutrition bulk export ──
  ipcHandle('sync:getAllNutritionData', () => {
    const db = getDb();

    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() || null;
    // sync_id is the cross-device identity for these two AUTOINCREMENT tables.
    // `id` is still exported for backward compatibility with older clients, but the
    // merge no longer keys on it.
    // frequent_food_sync_id resolves food_log.frequent_food_id, which points at the
    // LOCAL frequent_foods.id and means something different on every device.
    const foodLog = db.prepare(`
      SELECT f.id, f.sync_id, f.date, f.time, f.description, f.calories, f.source,
             f.frequent_food_id, ff.sync_id AS frequent_food_sync_id,
             f.ai_breakdown, f.meal, f.updated_at, f.deleted_at
      FROM food_log f
      LEFT JOIN frequent_foods ff ON ff.id = f.frequent_food_id
      ORDER BY f.date DESC, f.time DESC
    `).all();
    const frequentFoods = db.prepare('SELECT id, sync_id, name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at FROM frequent_foods ORDER BY times_used DESC').all();
    const dailyMetrics = db.prepare('SELECT date, steps, gym, updated_at FROM nutrition_daily_metrics ORDER BY date DESC').all();
    const weeklyMetrics = db.prepare('SELECT date, weight_kg, waist_cm, updated_at FROM nutrition_weekly_metrics ORDER BY date DESC').all();
    const dailySummary = db.prepare('SELECT date, total_calories_in, bmr, tdee, balance, updated_at FROM nutrition_daily_summary ORDER BY date DESC').all();
    const dailyClosed = db.prepare('SELECT * FROM nutrition_daily_closed ORDER BY date DESC').all();
    const favoriteFoods = db.prepare('SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM favorite_foods ORDER BY created_at DESC').all();

    return { profile, foodLog, frequentFoods, dailyMetrics, weeklyMetrics, dailySummary, dailyClosed, favoriteFoods };
  });

  // ── Nutrition bulk import (merge from Firestore) ──
  ipcHandle('sync:mergeNutritionData', (_e, data: Record<string, unknown>) => {
    const db = getDb();
    const d = data as any;
    let changed = false;

    const tx = db.transaction(() => {
      // Profile — only overwrite if remote is newer (Issue #8)
      if (d.profile) {
        const p = d.profile;
        const local = db.prepare('SELECT updated_at FROM nutrition_profile WHERE id = 1').get() as { updated_at: string | null } | undefined;
        const remoteUpdatedAt = p.updated_at ?? '';
        if (!local || remoteUpdatedAt > (local.updated_at || '')) {
          db.prepare(`INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            p.age, p.sex, p.height_cm, p.initial_weight_kg, p.activity_level,
            p.deficit_target_kcal ?? 500, p.gym_calories ?? 300, p.step_calories_factor ?? 0.04,
            p.date_of_birth ?? null, p.weight_check_day ?? 1, p.weight_popup_enabled ?? 1,
            p.meal_schedule ?? null, remoteUpdatedAt || null
          );
          changed = true;
        }
      }

      const foodsResult = mergeNutritionFoods(db, d);
      if (foodsResult.changed) changed = true;

      // Daily metrics — check timestamp before replacing (Issue #6)
      if (Array.isArray(d.dailyMetrics)) {
        const getDM = db.prepare('SELECT date, updated_at FROM nutrition_daily_metrics WHERE date = ?');
        const insertDM = db.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym, updated_at) VALUES (?, ?, ?, ?)');
        const updateDM = db.prepare('UPDATE nutrition_daily_metrics SET steps = ?, gym = ?, updated_at = ? WHERE date = ?');
        for (const m of d.dailyMetrics) {
          const local = getDM.get(m.date) as { date: string; updated_at: string | null } | undefined;
          if (!local) {
            insertDM.run(m.date, m.steps, m.gym, m.updated_at ?? null);
            changed = true;
          } else if ((m.updated_at ?? '') > (local.updated_at || '')) {
            updateDM.run(m.steps, m.gym, m.updated_at, m.date);
            changed = true;
          }
        }
      }

      // Weekly metrics — check timestamp before replacing (Issue #7)
      if (Array.isArray(d.weeklyMetrics)) {
        const getWM = db.prepare('SELECT date, updated_at FROM nutrition_weekly_metrics WHERE date = ?');
        const insertWM = db.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg, waist_cm, updated_at) VALUES (?, ?, ?, ?)');
        const updateWM = db.prepare('UPDATE nutrition_weekly_metrics SET weight_kg = ?, waist_cm = ?, updated_at = ? WHERE date = ?');
        for (const m of d.weeklyMetrics) {
          const local = getWM.get(m.date) as { date: string; updated_at: string | null } | undefined;
          if (!local) {
            insertWM.run(m.date, m.weight_kg, m.waist_cm, m.updated_at ?? null);
            changed = true;
          } else if ((m.updated_at ?? '') > (local.updated_at || '')) {
            updateWM.run(m.weight_kg, m.waist_cm, m.updated_at, m.date);
            changed = true;
          }
        }
      }

      // Daily summary — check timestamp before replacing
      if (Array.isArray(d.dailySummary)) {
        const getDS = db.prepare('SELECT date, updated_at FROM nutrition_daily_summary WHERE date = ?');
        const insertDS = db.prepare('INSERT INTO nutrition_daily_summary (date, bmr, tdee, total_calories_in, balance, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        const updateDS = db.prepare('UPDATE nutrition_daily_summary SET bmr = ?, tdee = ?, total_calories_in = ?, balance = ?, updated_at = ? WHERE date = ?');
        for (const s of d.dailySummary) {
          const local = getDS.get(s.date) as { date: string; updated_at: string | null } | undefined;
          if (!local) {
            insertDS.run(s.date, s.bmr, s.tdee, s.total_calories_in, s.balance, s.updated_at ?? null);
            changed = true;
          } else if ((s.updated_at ?? '') > (local.updated_at || '')) {
            updateDS.run(s.bmr, s.tdee, s.total_calories_in, s.balance, s.updated_at, s.date);
            changed = true;
          }
        }
      }

      // Daily closed — merge by date, last-write-wins on updated_at.
      // nutrition:reopenDay soft-deletes; an insert-if-missing merge would have
      // resurrected the closure on the next pull and re-locked the day.
      if (Array.isArray(d.dailyClosed)) {
        const getDC = db.prepare('SELECT date, updated_at FROM nutrition_daily_closed WHERE date = ?');
        const insertDC = db.prepare('INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, closed_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const updateDC = db.prepare('UPDATE nutrition_daily_closed SET xp_precision = ?, xp_steps = ?, xp_gym = ?, xp_weight = ?, xp_bonus = ?, xp_total = ?, hp_change = ?, consumed = ?, target = ?, closed_at = ?, updated_at = ?, deleted_at = ? WHERE date = ?');
        for (const c of d.dailyClosed) {
          if (!isUsableRow(c, 'dailyClosed', ['date'])) continue;
          const local = getDC.get(c.date) as { date: string; updated_at: string | null } | undefined;
          if (!local) {
            insertDC.run(
              c.date, c.xp_precision ?? 0, c.xp_steps ?? 0, c.xp_gym ?? 0, c.xp_weight ?? 0, c.xp_bonus ?? 0,
              c.xp_total ?? 0, c.hp_change ?? 0, c.consumed ?? 0, c.target ?? 0,
              c.closed_at ?? null, c.updated_at ?? null, c.deleted_at ?? null,
            );
            changed = true;
          } else if ((c.updated_at ?? '') > (local.updated_at || '')) {
            updateDC.run(
              c.xp_precision ?? 0, c.xp_steps ?? 0, c.xp_gym ?? 0, c.xp_weight ?? 0, c.xp_bonus ?? 0,
              c.xp_total ?? 0, c.hp_change ?? 0, c.consumed ?? 0, c.target ?? 0,
              c.closed_at ?? null, c.updated_at ?? null, c.deleted_at ?? null, c.date,
            );
            changed = true;
          }
        }
      }

      // Favorite foods — dedup by description
      if (Array.isArray(d.favoriteFoods)) {
        const insertFav = db.prepare('INSERT OR IGNORE INTO favorite_foods (id, description, calories, source, ai_breakdown, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const f of d.favoriteFoods) {
          insertFav.run(f.id, f.description, f.calories, f.source ?? 'manual', f.aiBreakdown ?? null, f.createdAt, f.updatedAt ?? null, f.deletedAt ?? f.deleted_at ?? null);
          changed = true;
          // LWW update for existing entries
          db.prepare(
            "UPDATE favorite_foods SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
          ).run(f.deletedAt ?? f.deleted_at ?? null, f.updatedAt ?? f.updated_at ?? null, f.id, f.updatedAt ?? f.updated_at);
        }
      }
    });

    tx();
    return { changed };
  });

  // ── Finance Sync ──────────────────────────────────────

  ipcHandle('sync:getAllFinanceData', () => {
    const db = getDb();

    const transactions = db.prepare(`
      SELECT id, type, amount, currency, category, description, date,
             payment_method AS paymentMethod, source, installments,
             installment_group_id AS installmentGroupId,
             for_third_party AS forThirdParty,
             recurring_id AS recurringId,
             import_batch_id AS importBatchId,
             credit_card_id AS creditCardId,
             impacts_balance AS impactsBalance,
             installment_number AS installmentNumber,
             billed_amount_ars AS billedAmountArs,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_transactions ORDER BY date DESC
    `).all();

    const loans = db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_loans ORDER BY date DESC
    `).all();

    const loanPayments = db.prepare(`
      SELECT id, loan_id AS loanId, amount, currency, date, note,
             created_at AS createdAt, deleted_at AS deletedAt, updated_at AS updatedAt
      FROM finance_loan_payments ORDER BY date ASC
    `).all();

    const recurring = db.prepare(`
      SELECT id, name, type, amount, currency, category, active,
             billing_day AS billingDay,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_recurring ORDER BY created_at ASC
    `).all();

    // previous_amount was neither selected here nor inserted on merge, so the
    // "was X, now Y" history collapsed to NULL on every replicated device.
    const recurringHistory = db.prepare(`
      SELECT id, recurring_id AS recurringId, amount, previous_amount AS previousAmount,
             currency, effective_date AS effectiveDate, created_at AS createdAt
      FROM finance_recurring_amount_history ORDER BY effective_date ASC
    `).all();

    const installmentGroups = db.prepare(`
      SELECT id, description, total_amount AS totalAmount, currency,
             total_installments AS totalInstallments, category, date,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_installment_groups ORDER BY date DESC
    `).all();

    const categoryMappings = db.prepare(`
      SELECT id, keyword, category, created_at AS createdAt
      FROM finance_category_mappings
    `).all();

    const categories = db.prepare(`SELECT name, updated_at AS updatedAt, deleted_at AS deletedAt FROM finance_categories`).all();

    const creditCards = db.prepare(`
      SELECT id, name, closing_day AS closingDay,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_credit_cards
    `).all();

    const creditCardStatements = db.prepare(`
      SELECT id, credit_card_id AS creditCardId, period_month AS periodMonth,
             calculated_amount AS calculatedAmount, paid_amount AS paidAmount,
             status, paid_date AS paidDate, transaction_id AS transactionId,
             calculated_amount_usd AS calculatedAmountUsd,
             paid_amount_usd AS paidAmountUsd,
             transaction_id_usd AS transactionIdUsd,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_credit_card_statements
    `).all();

    // finance_transactions.import_batch_id references this table, and it holds real
    // user data. It was in neither USER_DATA_TABLES nor this export, so it leaked
    // across account switches and never replicated.
    const importBatches = db.prepare(`
      SELECT id, source, filename, row_count AS rowCount, created_at AS createdAt
      FROM finance_import_batches
    `).all();

    // Legacy table, superseded by finance_recurring, but older installs still hold
    // rows in it — same leak.
    const incomeSources = db.prepare(`
      SELECT id, name, estimated_amount AS estimatedAmount, frequency,
             is_variable AS isVariable, active, created_at AS createdAt
      FROM finance_income_sources
    `).all();

    return {
      transactions, loans, loanPayments, recurring, recurringHistory,
      installmentGroups, categoryMappings, categories, creditCards,
      creditCardStatements, importBatches, incomeSources,
    };
  });

  ipcHandle('sync:mergeFinanceData', (_e, data: Record<string, unknown[]>) => {
    const db = getDb();
    let changed = false;
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      if (data.categories && Array.isArray(data.categories)) {
        const getCat = db.prepare('SELECT name, updated_at FROM finance_categories WHERE name = ?');
        const insertCat = db.prepare(`INSERT OR IGNORE INTO finance_categories (name, updated_at, deleted_at) VALUES (?, ?, ?)`);
        const updateCat = db.prepare(`UPDATE finance_categories SET updated_at = ?, deleted_at = ? WHERE name = ?`);
        for (const c of data.categories as Array<Record<string, unknown>>) {
          const remoteUpdatedAt = (c.updatedAt as string) ?? now;
          const remoteDeletedAt = (c.deletedAt as string) ?? null;
          const local = getCat.get(c.name) as { name: string; updated_at: string } | undefined;
          if (!local) {
            insertCat.run(c.name, remoteUpdatedAt, remoteDeletedAt);
            changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateCat.run(remoteUpdatedAt, remoteDeletedAt, c.name);
            changed = true;
          }
        }
      }

      if (data.recurring && Array.isArray(data.recurring)) {
        const getRec = db.prepare('SELECT id, updated_at FROM finance_recurring WHERE id = ?');
        const insertRec = db.prepare(`
          INSERT OR IGNORE INTO finance_recurring
            (id, name, type, amount, currency, category, active, billing_day, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateRec = db.prepare(`
          UPDATE finance_recurring SET name = ?, type = ?, amount = ?, currency = ?, category = ?,
                 active = ?, billing_day = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);
        for (const r of data.recurring as Array<Record<string, unknown>>) {
          const remoteUpdatedAt = (r.updatedAt as string) ?? (r.createdAt as string) ?? now;
          const remoteDeletedAt = (r.deletedAt as string) ?? null;
          const local = getRec.get(r.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            const result = insertRec.run(r.id, r.name, r.type, r.amount, r.currency ?? 'ARS', r.category ?? 'Otros', r.active ?? 1, r.billingDay ?? 1, r.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt);
            if (result.changes > 0) changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateRec.run(r.name, r.type, r.amount, r.currency ?? 'ARS', r.category ?? 'Otros', r.active ?? 1, r.billingDay ?? 1, remoteUpdatedAt, remoteDeletedAt, r.id);
            changed = true;
          }
        }
      }

      if (data.recurringHistory && Array.isArray(data.recurringHistory)) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO finance_recurring_amount_history
            (id, recurring_id, amount, previous_amount, currency, effective_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        // Backfills previous_amount on rows that were replicated before it was
        // carried over — those all have it NULL today.
        const backfill = db.prepare(`
          UPDATE finance_recurring_amount_history SET previous_amount = ?
          WHERE id = ? AND previous_amount IS NULL
        `);
        for (const h of data.recurringHistory as Array<Record<string, unknown>>) {
          const previousAmount = (h.previousAmount ?? h.previous_amount ?? null) as number | null;
          const result = stmt.run(h.id, h.recurringId, h.amount, previousAmount, h.currency ?? 'ARS', h.effectiveDate, h.createdAt ?? now);
          if (result.changes > 0) changed = true;
          else if (previousAmount != null && backfill.run(previousAmount, h.id).changes > 0) changed = true;
        }
      }

      // Installment groups must come before transactions that reference them
      if (data.installmentGroups && Array.isArray(data.installmentGroups)) {
        const getIG = db.prepare('SELECT id, updated_at FROM finance_installment_groups WHERE id = ?');
        const insertIG = db.prepare(`
          INSERT OR IGNORE INTO finance_installment_groups
            (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateIG = db.prepare(`
          UPDATE finance_installment_groups SET description = ?, total_amount = ?, currency = ?,
                 total_installments = ?, category = ?, date = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);
        for (const g of data.installmentGroups as Array<Record<string, unknown>>) {
          const remoteUpdatedAt = (g.updatedAt as string) ?? (g.createdAt as string) ?? now;
          const remoteDeletedAt = (g.deletedAt as string) ?? null;
          const local = getIG.get(g.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            const result = insertIG.run(g.id, g.description, g.totalAmount, g.currency ?? 'ARS', g.totalInstallments, g.category ?? 'Otros', g.date, g.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt);
            if (result.changes > 0) changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateIG.run(g.description, g.totalAmount, g.currency ?? 'ARS', g.totalInstallments, g.category ?? 'Otros', g.date, remoteUpdatedAt, remoteDeletedAt, g.id);
            changed = true;
          }
        }
      }

      if (data.transactions && Array.isArray(data.transactions)) {
        const getTx = db.prepare('SELECT id, updated_at FROM finance_transactions WHERE id = ?');
        const insertTx = db.prepare(`
          INSERT OR IGNORE INTO finance_transactions
            (id, type, amount, currency, category, description, date, payment_method,
             source, installments, installment_group_id, for_third_party,
             recurring_id, import_batch_id, credit_card_id, impacts_balance,
             installment_number, billed_amount_ars,
             created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateTx = db.prepare(`
          UPDATE finance_transactions SET type = ?, amount = ?, currency = ?, category = ?,
            description = ?, date = ?, payment_method = ?, source = ?, installments = ?,
            installment_group_id = ?, for_third_party = ?, recurring_id = ?,
            import_batch_id = ?, credit_card_id = ?, impacts_balance = ?,
            installment_number = ?, billed_amount_ars = ?, updated_at = ?,
            deleted_at = ?
          WHERE id = ?
        `);
        for (const t of data.transactions as Array<Record<string, unknown>>) {
          const local = getTx.get(t.id) as { id: string; updated_at: string } | undefined;
          const remoteUpdatedAt = (t.updatedAt as string) ?? now;
          const remoteDeletedAt = (t.deletedAt as string) ?? null;
          if (!local) {
            const result = insertTx.run(
              t.id, t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
              t.description ?? '', t.date, t.paymentMethod ?? 'cash',
              t.source ?? 'manual', t.installments ?? null, t.installmentGroupId ?? null,
              t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
              t.creditCardId ?? null, t.impactsBalance ?? 1,
              t.installmentNumber ?? null, t.billedAmountArs ?? null,
              t.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt,
            );
            if (result.changes > 0) changed = true;
          } else if (remoteUpdatedAt > local.updated_at) {
            updateTx.run(
              t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
              t.description ?? '', t.date, t.paymentMethod ?? 'cash',
              t.source ?? 'manual', t.installments ?? null, t.installmentGroupId ?? null,
              t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
              t.creditCardId ?? null, t.impactsBalance ?? 1,
              t.installmentNumber ?? null, t.billedAmountArs ?? null, remoteUpdatedAt,
              remoteDeletedAt, t.id,
            );
            changed = true;
          }
        }
      }

      if (data.loans && Array.isArray(data.loans)) {
        const getLoan = db.prepare('SELECT id, settled, updated_at, deleted_at FROM finance_loans WHERE id = ?');
        const insertLoan = db.prepare(`
          INSERT OR IGNORE INTO finance_loans
            (id, person_name, direction, type, amount, currency, date, description,
             settled, installment_group_id, settled_date, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        // Full last-write-wins. The merge used to propagate ONLY the settled 0→1
        // transition, so editing a loan's amount, person, date or description never
        // reached the other device — and a soft delete never did either.
        const updateLoan = db.prepare(`
          UPDATE finance_loans SET person_name = ?, direction = ?, type = ?, amount = ?,
            currency = ?, date = ?, description = ?, settled = ?, installment_group_id = ?,
            settled_date = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);
        const settleLoan = db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ?, updated_at = ? WHERE id = ?`);
        for (const l of data.loans as Array<Record<string, unknown>>) {
          const local = getLoan.get(l.id) as { id: string; settled: number; updated_at: string | null; deleted_at: string | null } | undefined;
          const remoteUpdatedAt = (l.updatedAt as string) ?? (l.createdAt as string) ?? now;
          // A payload written by a client that predates deletedAt in the loans export
          // simply omits the key. Treating that as "not deleted" would resurrect a
          // local tombstone, so an absent key preserves whatever is already local.
          const remoteDeletedAt = 'deletedAt' in l
            ? ((l.deletedAt as string) ?? null)
            : (local?.deleted_at ?? null);
          if (!local) {
            const result = insertLoan.run(
              l.id, l.personName, l.direction, l.type, l.amount, l.currency ?? 'ARS',
              l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
              l.settledDate ?? null, l.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt,
            );
            if (result.changes > 0) changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateLoan.run(
              l.personName, l.direction, l.type, l.amount, l.currency ?? 'ARS',
              l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
              l.settledDate ?? null, remoteUpdatedAt, remoteDeletedAt, l.id,
            );
            changed = true;
          } else if (l.settled === 1 && local.settled === 0) {
            // Settling stays a one-way transition even against a stale timestamp:
            // older clients settle without bumping updated_at.
            settleLoan.run(l.settledDate ?? now, remoteUpdatedAt, l.id);
            changed = true;
          }
        }
      }

      if (data.loanPayments && Array.isArray(data.loanPayments)) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO finance_loan_payments
            (id, loan_id, amount, currency, date, note, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const lww = db.prepare(
          "UPDATE finance_loan_payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
        );
        for (const p of data.loanPayments as Array<Record<string, unknown>>) {
          const result = stmt.run(
            p.id, p.loanId, p.amount, p.currency ?? 'ARS', p.date, p.note ?? '',
            p.createdAt ?? now, p.updatedAt ?? null, p.deletedAt ?? null
          );
          if (result.changes > 0) changed = true;
          // LWW for soft-delete propagation
          if (p.deletedAt || p.updatedAt) {
            const u = lww.run(p.deletedAt ?? null, p.updatedAt ?? null, p.id, p.updatedAt);
            if (u.changes > 0) changed = true;
          }
        }
      }

      if (data.categoryMappings && Array.isArray(data.categoryMappings)) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO finance_category_mappings (id, keyword, category, created_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const m of data.categoryMappings as Array<Record<string, unknown>>) {
          stmt.run(m.id, m.keyword, m.category, m.createdAt ?? now);
        }
      }

      // Import batches — referenced by finance_transactions.import_batch_id, so they
      // must be merged BEFORE nothing in particular (no FK), but they do have to be
      // merged at all: they were previously dropped entirely.
      if (data.importBatches && Array.isArray(data.importBatches)) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO finance_import_batches (id, source, filename, row_count, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const b of data.importBatches as Array<Record<string, unknown>>) {
          if (!isUsableRow(b, 'importBatches', ['id', 'source'])) continue;
          const result = stmt.run(b.id, b.source, b.filename ?? '', b.rowCount ?? b.row_count ?? 0, b.createdAt ?? now);
          if (result.changes > 0) changed = true;
        }
      }

      // Legacy income sources — no longer written by the UI, but older installs
      // still hold rows and they were leaking between accounts.
      if (data.incomeSources && Array.isArray(data.incomeSources)) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO finance_income_sources
            (id, name, estimated_amount, frequency, is_variable, active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of data.incomeSources as Array<Record<string, unknown>>) {
          if (!isUsableRow(s, 'incomeSources', ['id', 'name'])) continue;
          const result = stmt.run(
            s.id, s.name, s.estimatedAmount ?? s.estimated_amount ?? 0,
            s.frequency ?? 'monthly', s.isVariable ?? s.is_variable ?? 0,
            s.active ?? 1, s.createdAt ?? now,
          );
          if (result.changes > 0) changed = true;
        }
      }

      if (data.creditCards && Array.isArray(data.creditCards)) {
        const getCC = db.prepare('SELECT id, updated_at FROM finance_credit_cards WHERE id = ?');
        const insertCC = db.prepare(`
          INSERT OR IGNORE INTO finance_credit_cards
            (id, name, closing_day, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const updateCC = db.prepare(`
          UPDATE finance_credit_cards SET name = ?, closing_day = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);
        for (const card of data.creditCards as Array<Record<string, unknown>>) {
          const remoteUpdatedAt = (card.updatedAt as string) ?? (card.createdAt as string) ?? (card.created_at as string) ?? now;
          const remoteDeletedAt = (card.deletedAt as string) ?? (card.deleted_at as string) ?? null;
          const local = getCC.get(card.id ?? card.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertCC.run(card.id, card.name ?? card.name, card.closingDay ?? card.closing_day, card.createdAt ?? card.created_at ?? now, remoteUpdatedAt, remoteDeletedAt);
            changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateCC.run(card.name ?? card.name, card.closingDay ?? card.closing_day, remoteUpdatedAt, remoteDeletedAt, card.id);
            changed = true;
          }
        }
      }

      if (data.creditCardStatements && Array.isArray(data.creditCardStatements)) {
        const getCCS = db.prepare('SELECT id, updated_at FROM finance_credit_card_statements WHERE id = ?');
        const insertCCS = db.prepare(`
          INSERT OR IGNORE INTO finance_credit_card_statements
            (id, credit_card_id, period_month, calculated_amount, paid_amount,
             status, paid_date, transaction_id,
             calculated_amount_usd, paid_amount_usd, transaction_id_usd,
             created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateCCS = db.prepare(`
          UPDATE finance_credit_card_statements SET calculated_amount = ?, paid_amount = ?,
                 status = ?, paid_date = ?, transaction_id = ?,
                 calculated_amount_usd = ?, paid_amount_usd = ?, transaction_id_usd = ?,
                 updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);
        for (const s of data.creditCardStatements as Array<Record<string, unknown>>) {
          const remoteUpdatedAt = (s.updatedAt as string) ?? (s.createdAt as string) ?? (s.created_at as string) ?? now;
          const remoteDeletedAt = (s.deletedAt as string) ?? (s.deleted_at as string) ?? null;
          const local = getCCS.get(s.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertCCS.run(
              s.id, s.creditCardId ?? s.credit_card_id, s.periodMonth ?? s.period_month,
              s.calculatedAmount ?? s.calculated_amount ?? 0, s.paidAmount ?? s.paid_amount ?? null,
              s.status ?? 'pending', s.paidDate ?? s.paid_date ?? null,
              s.transactionId ?? s.transaction_id ?? null,
              s.calculatedAmountUsd ?? s.calculated_amount_usd ?? null,
              s.paidAmountUsd ?? s.paid_amount_usd ?? null,
              s.transactionIdUsd ?? s.transaction_id_usd ?? null,
              s.createdAt ?? s.created_at ?? now, remoteUpdatedAt, remoteDeletedAt,
            );
            changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateCCS.run(
              s.calculatedAmount ?? s.calculated_amount ?? 0, s.paidAmount ?? s.paid_amount ?? null,
              s.status ?? 'pending', s.paidDate ?? s.paid_date ?? null,
              s.transactionId ?? s.transaction_id ?? null,
              s.calculatedAmountUsd ?? s.calculated_amount_usd ?? null,
              s.paidAmountUsd ?? s.paid_amount_usd ?? null,
              s.transactionIdUsd ?? s.transaction_id_usd ?? null,
              remoteUpdatedAt, remoteDeletedAt, s.id,
            );
            changed = true;
          }
        }
      }
    });

    tx();
    return { success: true, changed };
  });

  ipcHandle('sync:getAllNotificationData', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, module, title, body,
             action_route, status, snoozed_until,
             created_at, updated_at, resolved_at,
             deleted_at, ref_id
      FROM notifications
    `).all();
  });

  ipcHandle('sync:mergeNotificationData', (_e, remote: Record<string, unknown>[]) => {
    const db = getDb();
    let changed = false;

    const tx = db.transaction(() => {
      for (const r of remote) {
        const local = db.prepare('SELECT updated_at FROM notifications WHERE id = ?')
          .get(r.id as string) as { updated_at: string } | undefined;

        if (!local) {
          db.prepare(`
            INSERT OR IGNORE INTO notifications
              (id, type, module, title, body, action_route, status,
               snoozed_until, created_at, updated_at, resolved_at, deleted_at, ref_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            r.id, r.type, r.module, r.title, r.body,
            r.action_route, r.status, r.snoozed_until,
            r.created_at, r.updated_at, r.resolved_at,
            r.deleted_at, r.ref_id
          );
          changed = true;
        } else if (r.updated_at && new Date(r.updated_at as string) > new Date(local.updated_at)) {
          db.prepare(`
            UPDATE notifications SET
              status = ?, snoozed_until = ?, updated_at = ?,
              resolved_at = ?, deleted_at = ?
            WHERE id = ?
          `).run(r.status, r.snoozed_until, r.updated_at, r.resolved_at, r.deleted_at, r.id);
          changed = true;
        }
      }
    });
    tx();

    return { changed };
  });

  // ── Cauldron Sync ──────────────────────────────────────

  ipcHandle('sync:getAllCauldronData', () => {
    const db = getDb();
    return {
      cauldron_presets: db.prepare('SELECT * FROM cauldron_presets').all(),
      cauldron_sessions: db.prepare('SELECT * FROM cauldron_sessions').all(),
    };
  });

  ipcHandle('sync:mergeCauldronData', (_e, data: Record<string, unknown>) => {
    const db = getDb();
    let changed = false;

    if (!data || typeof data !== 'object') return { changed: false };

    // This was the only merge running its loops OUTSIDE a transaction: a failure
    // partway through left presets applied and sessions not, with no rollback.
    const tx = db.transaction(() => {
    const presets = data.cauldron_presets as Array<Record<string, unknown>> | undefined;
    if (presets?.length) {
      const getPreset = db.prepare('SELECT id, updated_at FROM cauldron_presets WHERE id = ?');
      const insertPreset = db.prepare(`INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, extension_minutes, is_default, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const updatePreset = db.prepare(`UPDATE cauldron_presets SET name = ?, work_minutes = ?, break_minutes = ?, long_break_minutes = ?, cycles_before_long = ?, extension_minutes = ?, is_default = ?, updated_at = ?, deleted_at = ? WHERE id = ?`);
      for (const p of presets) {
        const local = getPreset.get(p.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertPreset.run(p.id, p.name, p.work_minutes, p.break_minutes, p.long_break_minutes, p.cycles_before_long, p.extension_minutes ?? 5, p.is_default, p.created_at, p.updated_at, p.deleted_at);
          changed = true;
        } else if (p.updated_at && (!local.updated_at || p.updated_at > local.updated_at)) {
          updatePreset.run(p.name, p.work_minutes, p.break_minutes, p.long_break_minutes, p.cycles_before_long, p.extension_minutes ?? 5, p.is_default, p.updated_at, p.deleted_at, p.id);
          changed = true;
        }
      }
    }

    const sessions = data.cauldron_sessions as Array<Record<string, unknown>> | undefined;
    if (sessions?.length) {
      const getSession = db.prepare('SELECT id, completed FROM cauldron_sessions WHERE id = ?');
      const insertSession = db.prepare(`INSERT OR IGNORE INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const completeSession = db.prepare(`UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ? WHERE id = ?`);
      // preset_id is a FOREIGN KEY: a session whose preset this device has never
      // seen would fail the constraint and (now that this runs in a transaction)
      // roll the whole cauldron merge back. Drop the dangling link, keep the session.
      const presetExists = db.prepare('SELECT 1 FROM cauldron_presets WHERE id = ?');
      for (const s of sessions) {
        if (!isUsableRow(s, 'cauldronSessions', ['id', 'type', 'started_at'])) continue;
        const local = getSession.get(s.id) as { id: string; completed: number } | undefined;
        if (!local) {
          const presetId = s.preset_id && presetExists.get(s.preset_id) ? s.preset_id : null;
          const result = insertSession.run(s.id, presetId, s.type, s.duration_minutes ?? 0, s.completed ?? 0, s.started_at, s.completed_at ?? null, s.created_at, s.updated_at, s.deleted_at ?? null);
          if (result.changes > 0) changed = true;
        } else if (s.completed === 1 && local.completed === 0) {
          completeSession.run(s.completed_at, s.updated_at, s.id);
          changed = true;
        }
      }
    }
    });

    tx();
    return { changed };
  });
}
