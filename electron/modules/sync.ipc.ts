import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { recalcSummary } from './nutrition.ipc';

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
  id: number;
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
];

export function registerSyncIpcHandlers(): void {
  ipcHandle('sync:clearUserData', () => {
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        for (const table of USER_DATA_TABLES) {
          db.prepare(`DELETE FROM ${table}`).run();
        }
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

  ipcHandle('sync:setCurrentUser', (_e, uid: string) => {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();
    db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_uid', ?)`).run(uid);
  });

  ipcHandle('sync:getCurrentUser', () => {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();
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

    const rpgEvents = db.prepare(`
      SELECT id, module_id AS moduleId, event_type AS eventType,
             xp_gained AS xpGained, hp_change AS hpChange,
             combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
             payload, created_at AS createdAt
      FROM rpg_events ORDER BY id ASC
    `).all();

    return { tasks, subtasks, projects, categories, habits, habitChecks, drawings, rpgEvents };
  });

  // Merges remote quest data with local using last-write-wins
  ipcHandle('sync:mergeQuestData', (_e, remote: SyncQuestData) => {
    const db = getDb();
    let changed = false;

    const tx = db.transaction(() => {
      // ── Merge projects first (tasks reference them) ──
      if (remote.projects?.length) {
        const getProject = db.prepare('SELECT id, updated_at FROM projects WHERE id = ?');
        const insertProject = db.prepare(`
          INSERT INTO projects (id, name, color, project_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const updateProject = db.prepare(`
          UPDATE projects SET name = ?, color = ?, project_order = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rp of remote.projects) {
          const local = getProject.get(rp.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertProject.run(rp.id, rp.name, rp.color, rp.order, rp.createdAt, rp.updatedAt, rp.deletedAt);
            changed = true;
          } else if (rp.updatedAt > local.updated_at) {
            updateProject.run(rp.name, rp.color, rp.order, rp.updatedAt, rp.deletedAt, rp.id);
            changed = true;
          }
        }
      }

      // ── Merge tasks ──
      if (remote.tasks?.length) {
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

        for (const rt of remote.tasks) {
          const local = getTask.get(rt.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertTask.run(rt.id, rt.name, rt.description, rt.status, rt.tier, rt.category,
              rt.projectId, rt.dueDate, rt.order, rt.completedAt ?? null, rt.createdAt, rt.updatedAt, rt.deletedAt);
            changed = true;
          } else if (rt.updatedAt > local.updated_at) {
            updateTask.run(rt.name, rt.description, rt.status, rt.tier, rt.category,
              rt.projectId, rt.dueDate, rt.order, rt.completedAt ?? null, rt.updatedAt, rt.deletedAt, rt.id);
            changed = true;
          }
        }
      }

      // ── Merge subtasks ──
      if (remote.subtasks?.length) {
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

        for (const rs of remote.subtasks) {
          const local = getSubtask.get(rs.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertSubtask.run(rs.id, rs.taskId, rs.name, rs.description, rs.tier, rs.status,
              rs.order, rs.completedAt, rs.createdAt, rs.updatedAt, rs.deletedAt);
            changed = true;
          } else if (rs.updatedAt > local.updated_at) {
            updateSubtask.run(rs.name, rs.description, rs.tier, rs.status,
              rs.order, rs.completedAt, rs.updatedAt, rs.deletedAt, rs.id);
            changed = true;
          }
        }
      }

      // ── Merge categories (keyed by id) ──
      if (remote.categories?.length) {
        const getCategory = db.prepare('SELECT id, updated_at FROM task_categories WHERE id = ?');
        const insertCategory = db.prepare(`
          INSERT OR IGNORE INTO task_categories (id, name, project_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const updateCategory = db.prepare(`
          UPDATE task_categories SET name = ?, project_id = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rc of remote.categories) {
          const local = getCategory.get(rc.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertCategory.run(rc.id, rc.name, rc.projectId, rc.createdAt, rc.updatedAt, rc.deletedAt);
            changed = true;
          } else if (rc.updatedAt > local.updated_at) {
            updateCategory.run(rc.name, rc.projectId, rc.updatedAt, rc.deletedAt, rc.id);
            changed = true;
          }
        }
      }

      // ── Merge habits ──
      if (remote.habits?.length) {
        const getHabit = db.prepare('SELECT id, updated_at FROM habits WHERE id = ?');
        const insertHabit = db.prepare(`
          INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const updateHabit = db.prepare(`
          UPDATE habits SET name = ?, frequency = ?, times_per_week = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rh of remote.habits) {
          const local = getHabit.get(rh.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertHabit.run(rh.id, rh.name, rh.frequency, rh.timesPerWeek, rh.createdAt, rh.updatedAt ?? rh.createdAt, rh.deletedAt);
            changed = true;
          } else if ((rh.updatedAt ?? rh.createdAt) > local.updated_at) {
            updateHabit.run(rh.name, rh.frequency, rh.timesPerWeek, rh.updatedAt ?? rh.createdAt, rh.deletedAt, rh.id);
            changed = true;
          }
        }
      }

      // ── Merge drawings ──
      if (remote.drawings?.length) {
        const getDrawing = db.prepare('SELECT id, updated_at FROM task_drawings WHERE id = ?');
        const insertDrawing = db.prepare(`
          INSERT INTO task_drawings (id, task_id, data, draw_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const updateDrawing = db.prepare(`
          UPDATE task_drawings SET data = ?, draw_order = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rd of remote.drawings) {
          const local = getDrawing.get(rd.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertDrawing.run(rd.id, rd.taskId, rd.data, rd.order, rd.createdAt, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null);
            changed = true;
          } else if ((rd.updatedAt ?? rd.createdAt) > local.updated_at) {
            updateDrawing.run(rd.data, rd.order, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null, rd.id);
            changed = true;
          }
        }
      }

      // ── Merge habit checks ──
      if (remote.habitChecks?.length) {
        const getCheck = db.prepare('SELECT id, updated_at FROM habit_checks WHERE id = ?');
        const insertCheck = db.prepare(`
          INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const updateCheck = db.prepare(`
          UPDATE habit_checks SET deleted_at = ?, updated_at = ?
          WHERE id = ?
        `);

        for (const rc of remote.habitChecks) {
          const local = getCheck.get(rc.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertCheck.run(rc.id, rc.habitId, rc.date, rc.createdAt, rc.updatedAt, rc.deletedAt);
            changed = true;
          } else if (rc.updatedAt > local.updated_at) {
            updateCheck.run(rc.deletedAt, rc.updatedAt, rc.id);
            changed = true;
          }
        }
      }

      // ── Merge RPG events (insert if not exists by id) ──
      if (remote.rpgEvents?.length) {
        const getEvent = db.prepare('SELECT id FROM rpg_events WHERE id = ?');
        const insertEvent = db.prepare(`
          INSERT INTO rpg_events (id, module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const re of remote.rpgEvents) {
          const exists = getEvent.get(re.id);
          if (!exists) {
            insertEvent.run(re.id, re.moduleId, re.eventType, re.xpGained, re.hpChange,
              re.comboMultiplier, re.bonusMultiplier, re.payload, re.createdAt);
            changed = true;
          }
        }
      }
    });

    tx();
    return { changed };
  });

  // ── Nutrition bulk export ──
  ipcHandle('sync:getAllNutritionData', () => {
    const db = getDb();

    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() || null;
    const foodLog = db.prepare('SELECT id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at FROM food_log ORDER BY date DESC, time DESC').all();
    const frequentFoods = db.prepare('SELECT id, name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at FROM frequent_foods ORDER BY times_used DESC').all();
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

      // Food log — merge by id instead of composite key (Issue #11)
      const affectedDates = new Set<string>();
      if (Array.isArray(d.foodLog)) {
        const getFoodById = db.prepare('SELECT id FROM food_log WHERE id = ?');
        const insertFood = db.prepare('INSERT OR IGNORE INTO food_log (id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const f of d.foodLog) {
          if (f.id != null) {
            const exists = getFoodById.get(f.id);
            if (!exists) {
              insertFood.run(f.id, f.date, f.time, f.description, f.calories, f.source, f.frequent_food_id, f.ai_breakdown ?? null, f.meal ?? null, f.updated_at ?? null, f.deleted_at ?? null);
              affectedDates.add(f.date);
              changed = true;
            }
            if (f.deleted_at || f.updated_at) {
              db.prepare(
                "UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
              ).run(f.deleted_at ?? null, f.updated_at ?? null, f.id, f.updated_at);
            }
          } else {
            // Legacy entries without id — fallback to composite key
            const exists = db.prepare('SELECT 1 FROM food_log WHERE date = ? AND time = ? AND description = ? AND calories = ?').get(f.date, f.time, f.description, f.calories);
            if (!exists) {
              db.prepare('INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                f.date, f.time, f.description, f.calories, f.source, f.frequent_food_id, f.ai_breakdown ?? null, f.meal ?? null, f.updated_at ?? null, f.deleted_at ?? null
              );
              affectedDates.add(f.date);
              changed = true;
            }
          }
        }
      }

      for (const date of affectedDates) {
        recalcSummary(db, date);
      }

      // Frequent foods — merge by id with timestamp update (Issue #10)
      if (Array.isArray(d.frequentFoods)) {
        const getFreq = db.prepare('SELECT id, updated_at FROM frequent_foods WHERE id = ?');
        const getFreqByName = db.prepare('SELECT id FROM frequent_foods WHERE name = ?');
        const insertFreq = db.prepare('INSERT INTO frequent_foods (name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const updateFreq = db.prepare('UPDATE frequent_foods SET calories = ?, ai_breakdown = ?, times_used = ?, updated_at = ?, deleted_at = ? WHERE id = ?');
        for (const f of d.frequentFoods) {
          if (f.id != null) {
            const local = getFreq.get(f.id) as { id: number; updated_at: string | null } | undefined;
            if (!local) {
              insertFreq.run(f.name, f.calories, f.ai_breakdown ?? null, f.times_used, f.created_at, f.updated_at ?? null, f.deleted_at ?? null);
              changed = true;
            } else if ((f.updated_at ?? '') > (local.updated_at || '')) {
              updateFreq.run(f.calories, f.ai_breakdown ?? null, f.times_used, f.updated_at, f.deleted_at ?? null, f.id);
              changed = true;
            }
          } else {
            // Legacy entries without id — fallback to name check
            const exists = getFreqByName.get(f.name);
            if (!exists) {
              insertFreq.run(f.name, f.calories, f.ai_breakdown ?? null, f.times_used, f.created_at, f.updated_at ?? null, f.deleted_at ?? null);
              changed = true;
            }
          }
        }
      }

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

      // Daily closed - merge by date
      if (Array.isArray(d.dailyClosed)) {
        for (const c of d.dailyClosed) {
          const exists = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(c.date);
          if (!exists) {
            db.prepare('INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
              c.date, c.xp_precision ?? 0, c.xp_steps ?? 0, c.xp_gym ?? 0, c.xp_weight ?? 0, c.xp_bonus ?? 0, c.xp_total ?? 0, c.hp_change ?? 0, c.consumed ?? 0, c.target ?? 0
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
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_transactions ORDER BY date DESC
    `).all();

    const loans = db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt, updated_at AS updatedAt
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

    const recurringHistory = db.prepare(`
      SELECT id, recurring_id AS recurringId, amount, currency,
             effective_date AS effectiveDate, created_at AS createdAt
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
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_credit_card_statements
    `).all();

    return {
      transactions, loans, loanPayments, recurring, recurringHistory,
      installmentGroups, categoryMappings, categories, creditCards,
      creditCardStatements,
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
            (id, recurring_id, amount, currency, effective_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const h of data.recurringHistory as Array<Record<string, unknown>>) {
          stmt.run(h.id, h.recurringId, h.amount, h.currency ?? 'ARS', h.effectiveDate, h.createdAt ?? now);
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
             created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateTx = db.prepare(`
          UPDATE finance_transactions SET type = ?, amount = ?, currency = ?, category = ?,
            description = ?, date = ?, payment_method = ?, source = ?, installments = ?,
            installment_group_id = ?, for_third_party = ?, recurring_id = ?,
            import_batch_id = ?, credit_card_id = ?, impacts_balance = ?, updated_at = ?,
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
              t.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt,
            );
            if (result.changes > 0) changed = true;
          } else if (remoteUpdatedAt > local.updated_at) {
            updateTx.run(
              t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
              t.description ?? '', t.date, t.paymentMethod ?? 'cash',
              t.source ?? 'manual', t.installments ?? null, t.installmentGroupId ?? null,
              t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
              t.creditCardId ?? null, t.impactsBalance ?? 1, remoteUpdatedAt,
              remoteDeletedAt, t.id,
            );
            changed = true;
          }
        }
      }

      if (data.loans && Array.isArray(data.loans)) {
        const getLoan = db.prepare('SELECT id, settled FROM finance_loans WHERE id = ?');
        const insertLoan = db.prepare(`
          INSERT OR IGNORE INTO finance_loans
            (id, person_name, direction, type, amount, currency, date, description,
             settled, installment_group_id, settled_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const settleLoan = db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ? WHERE id = ?`);
        for (const l of data.loans as Array<Record<string, unknown>>) {
          const local = getLoan.get(l.id) as { id: string; settled: number } | undefined;
          if (!local) {
            const result = insertLoan.run(
              l.id, l.personName, l.direction, l.type, l.amount, l.currency ?? 'ARS',
              l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
              l.settledDate ?? null, l.createdAt ?? now, l.updatedAt ?? null,
            );
            if (result.changes > 0) changed = true;
          } else if (l.settled === 1 && local.settled === 0) {
            // Settle is a one-way transition — remote settled wins
            settleLoan.run(l.settledDate ?? now, l.id);
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
             status, paid_date, transaction_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateCCS = db.prepare(`
          UPDATE finance_credit_card_statements SET calculated_amount = ?, paid_amount = ?,
                 status = ?, paid_date = ?, transaction_id = ?, updated_at = ?, deleted_at = ?
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
              s.createdAt ?? s.created_at ?? now, remoteUpdatedAt, remoteDeletedAt,
            );
            changed = true;
          } else if (remoteUpdatedAt > (local.updated_at || '')) {
            updateCCS.run(
              s.calculatedAmount ?? s.calculated_amount ?? 0, s.paidAmount ?? s.paid_amount ?? null,
              s.status ?? 'pending', s.paidDate ?? s.paid_date ?? null,
              s.transactionId ?? s.transaction_id ?? null,
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
      for (const s of sessions) {
        const local = getSession.get(s.id) as { id: string; completed: number } | undefined;
        if (!local) {
          const result = insertSession.run(s.id, s.preset_id, s.type, s.duration_minutes, s.completed, s.started_at, s.completed_at, s.created_at, s.updated_at, s.deleted_at);
          if (result.changes > 0) changed = true;
        } else if (s.completed === 1 && local.completed === 0) {
          completeSession.run(s.completed_at, s.updated_at, s.id);
          changed = true;
        }
      }
    }

    return { changed };
  });
}
