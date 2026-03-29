import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';

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
}

interface SyncQuestData {
  tasks: SyncTask[];
  subtasks: SyncSubtask[];
  projects: SyncProject[];
  categories: SyncCategory[];
  habits: SyncHabit[];
  habitChecks: SyncHabitCheck[];
  drawings: SyncDrawing[];
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
  'finance_income_sources',
  'finance_categories',
  'nutrition_profile',
  'food_log',
  'frequent_foods',
  'nutrition_daily_metrics',
  'nutrition_weekly_metrics',
  'nutrition_daily_summary',
  'nutrition_daily_closed',
  'dollar_cache',
];

export function registerSyncIpcHandlers(): void {
  ipcHandle('sync:clearUserData', () => {
    const db = getDb();
    const tx = db.transaction(() => {
      for (const table of USER_DATA_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.prepare(`INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default')`).run();
      db.prepare(`INSERT OR IGNORE INTO user_profile (id) VALUES ('default')`).run();
    });
    tx();
    return { success: true };
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
      SELECT name, project_id AS projectId,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM task_categories
    `).all();

    const habits = db.prepare(`
      SELECT id, name, frequency, times_per_week AS timesPerWeek,
             created_at AS createdAt, deleted_at AS deletedAt
      FROM habits
    `).all();

    const habitChecks = db.prepare(`
      SELECT id, habit_id AS habitId, date,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM habit_checks
    `).all();

    const drawings = db.prepare(`
      SELECT id, task_id AS taskId, data, draw_order AS "order", created_at AS createdAt
      FROM task_drawings
    `).all();

    return { tasks, subtasks, projects, categories, habits, habitChecks, drawings };
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
          INSERT INTO tasks (id, name, description, status, tier, category, project_id, due_date, task_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateTask = db.prepare(`
          UPDATE tasks SET name = ?, description = ?, status = ?, tier = ?, category = ?,
                 project_id = ?, due_date = ?, task_order = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rt of remote.tasks) {
          const local = getTask.get(rt.id) as { id: string; updated_at: string } | undefined;
          if (!local) {
            insertTask.run(rt.id, rt.name, rt.description, rt.status, rt.tier, rt.category,
              rt.projectId, rt.dueDate, rt.order, rt.createdAt, rt.updatedAt, rt.deletedAt);
            changed = true;
          } else if (rt.updatedAt > local.updated_at) {
            updateTask.run(rt.name, rt.description, rt.status, rt.tier, rt.category,
              rt.projectId, rt.dueDate, rt.order, rt.updatedAt, rt.deletedAt, rt.id);
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

      // ── Merge categories (keyed by name + projectId) ──
      if (remote.categories?.length) {
        const getCategoryWithProject = db.prepare('SELECT name, updated_at FROM task_categories WHERE name = ? AND project_id = ?');
        const getCategoryNoProject = db.prepare('SELECT name, updated_at FROM task_categories WHERE name = ? AND project_id IS NULL');
        const insertCategory = db.prepare(`
          INSERT INTO task_categories (name, project_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        const updateCategoryWithProject = db.prepare(`
          UPDATE task_categories SET updated_at = ?, deleted_at = ?
          WHERE name = ? AND project_id = ?
        `);
        const updateCategoryNoProject = db.prepare(`
          UPDATE task_categories SET updated_at = ?, deleted_at = ?
          WHERE name = ? AND project_id IS NULL
        `);

        for (const rc of remote.categories) {
          const local = rc.projectId != null
            ? getCategoryWithProject.get(rc.name, rc.projectId) as { name: string; updated_at: string } | undefined
            : getCategoryNoProject.get(rc.name) as { name: string; updated_at: string } | undefined;
          if (!local) {
            insertCategory.run(rc.name, rc.projectId, rc.createdAt, rc.updatedAt, rc.deletedAt);
            changed = true;
          } else if (rc.updatedAt > local.updated_at) {
            if (rc.projectId != null) {
              updateCategoryWithProject.run(rc.updatedAt, rc.deletedAt, rc.name, rc.projectId);
            } else {
              updateCategoryNoProject.run(rc.updatedAt, rc.deletedAt, rc.name);
            }
            changed = true;
          }
        }
      }

      // ── Merge habits ──
      if (remote.habits?.length) {
        const getHabit = db.prepare('SELECT id, created_at, deleted_at FROM habits WHERE id = ?');
        const insertHabit = db.prepare(`
          INSERT INTO habits (id, name, frequency, times_per_week, created_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const updateHabit = db.prepare(`
          UPDATE habits SET name = ?, frequency = ?, times_per_week = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rh of remote.habits) {
          const local = getHabit.get(rh.id) as { id: string; created_at: string; deleted_at: string | null } | undefined;
          if (!local) {
            insertHabit.run(rh.id, rh.name, rh.frequency, rh.timesPerWeek, rh.createdAt, rh.deletedAt);
            changed = true;
          } else {
            // For habits without updated_at, use deletedAt comparison
            const remoteDeleted = rh.deletedAt != null;
            const localDeleted = local.deleted_at != null;
            if (remoteDeleted !== localDeleted) {
              updateHabit.run(rh.name, rh.frequency, rh.timesPerWeek, rh.deletedAt, rh.id);
              changed = true;
            }
          }
        }
      }

      // ── Merge drawings (immutable — insert if not exists) ──
      if (remote.drawings?.length) {
        const getDrawing = db.prepare('SELECT id FROM task_drawings WHERE id = ?');
        const insertDrawing = db.prepare('INSERT INTO task_drawings (id, task_id, data, draw_order, created_at) VALUES (?, ?, ?, ?, ?)');

        for (const rd of remote.drawings) {
          const exists = getDrawing.get(rd.id);
          if (!exists) {
            insertDrawing.run(rd.id, rd.taskId, rd.data, rd.order, rd.createdAt);
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
    });

    tx();
    return { changed };
  });

  // ── Nutrition bulk export ──
  ipcHandle('sync:getAllNutritionData', () => {
    const db = getDb();

    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() || null;
    const foodLog = db.prepare('SELECT * FROM food_log ORDER BY date DESC, time DESC').all();
    const frequentFoods = db.prepare('SELECT * FROM frequent_foods ORDER BY times_used DESC').all();
    const dailyMetrics = db.prepare('SELECT * FROM nutrition_daily_metrics ORDER BY date DESC').all();
    const weeklyMetrics = db.prepare('SELECT * FROM nutrition_weekly_metrics ORDER BY date DESC').all();
    const dailySummary = db.prepare('SELECT * FROM nutrition_daily_summary ORDER BY date DESC').all();
    const dailyClosed = db.prepare('SELECT * FROM nutrition_daily_closed ORDER BY date DESC').all();

    return { profile, foodLog, frequentFoods, dailyMetrics, weeklyMetrics, dailySummary, dailyClosed };
  });

  // ── Nutrition bulk import (merge from Firestore) ──
  ipcHandle('sync:mergeNutritionData', (_e, data: Record<string, unknown>) => {
    const db = getDb();
    const d = data as any;

    const tx = db.transaction(() => {
      // Profile
      if (d.profile) {
        const p = d.profile;
        db.prepare(`INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, date_of_birth, weight_check_day) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          p.age, p.sex, p.height_cm, p.initial_weight_kg, p.activity_level,
          p.deficit_target_kcal ?? 500, p.gym_calories ?? 300, p.step_calories_factor ?? 0.04,
          p.date_of_birth ?? null, p.weight_check_day ?? 1
        );
      }

      // Food log - merge by date+time+description
      if (Array.isArray(d.foodLog)) {
        for (const f of d.foodLog) {
          const exists = db.prepare('SELECT 1 FROM food_log WHERE date = ? AND time = ? AND description = ?').get(f.date, f.time, f.description);
          if (!exists) {
            db.prepare('INSERT INTO food_log (date, time, description, calories, source, frequent_food_id, ai_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              f.date, f.time, f.description, f.calories, f.source, f.frequent_food_id, f.ai_breakdown
            );
          }
        }
      }

      // Frequent foods - merge by name
      if (Array.isArray(d.frequentFoods)) {
        for (const f of d.frequentFoods) {
          const exists = db.prepare('SELECT 1 FROM frequent_foods WHERE name = ?').get(f.name);
          if (!exists) {
            db.prepare('INSERT INTO frequent_foods (name, calories, ai_breakdown, times_used, created_at) VALUES (?, ?, ?, ?, ?)').run(
              f.name, f.calories, f.ai_breakdown, f.times_used, f.created_at
            );
          }
        }
      }

      // Daily metrics - merge by date
      if (Array.isArray(d.dailyMetrics)) {
        for (const m of d.dailyMetrics) {
          db.prepare('INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)').run(m.date, m.steps, m.gym);
        }
      }

      // Weekly metrics - merge by date
      if (Array.isArray(d.weeklyMetrics)) {
        for (const m of d.weeklyMetrics) {
          db.prepare('INSERT OR REPLACE INTO nutrition_weekly_metrics (date, weight_kg, waist_cm) VALUES (?, ?, ?)').run(m.date, m.weight_kg, m.waist_cm);
        }
      }

      // Daily summary - merge by date
      if (Array.isArray(d.dailySummary)) {
        for (const s of d.dailySummary) {
          db.prepare('INSERT OR REPLACE INTO nutrition_daily_summary (date, bmr, tdee, total_calories_in, balance) VALUES (?, ?, ?, ?, ?)').run(
            s.date, s.bmr, s.tdee, s.total_calories_in, s.balance
          );
        }
      }

      // Daily closed - merge by date
      if (Array.isArray(d.dailyClosed)) {
        for (const c of d.dailyClosed) {
          const exists = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(c.date);
          if (!exists) {
            db.prepare('INSERT INTO nutrition_daily_closed (date, closed_at, calories_in, tdee, balance, xp_earned, hp_change, steps, gym, weight_logged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
              c.date, c.closed_at, c.calories_in, c.tdee, c.balance, c.xp_earned, c.hp_change, c.steps, c.gym, c.weight_logged
            );
          }
        }
      }
    });

    tx();
    return { changed: true };
  });
}
