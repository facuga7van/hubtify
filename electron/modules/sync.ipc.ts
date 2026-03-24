import { ipcMain } from 'electron';
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

interface SyncQuestData {
  tasks: SyncTask[];
  subtasks: SyncSubtask[];
  projects: SyncProject[];
  categories: SyncCategory[];
  habits: SyncHabit[];
  habitChecks: SyncHabitCheck[];
}

export function registerSyncIpcHandlers(): void {
  // Returns ALL quest data including soft-deleted, for push to Firebase
  ipcMain.handle('sync:getAllQuestData', () => {
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
             created_at AS createdAt, deleted_at AS deletedAt
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

    return { tasks, subtasks, projects, categories, habits, habitChecks };
  });

  // Merges remote quest data with local using last-write-wins
  ipcMain.handle('sync:mergeQuestData', (_e, remote: SyncQuestData) => {
    const db = getDb();
    let changed = false;

    const tx = db.transaction(() => {
      // ── Merge projects first (tasks reference them) ──
      if (remote.projects?.length) {
        const getProject = db.prepare('SELECT id, created_at, deleted_at FROM projects WHERE id = ?');
        const insertProject = db.prepare(`
          INSERT INTO projects (id, name, color, project_order, created_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const updateProject = db.prepare(`
          UPDATE projects SET name = ?, color = ?, project_order = ?, deleted_at = ?
          WHERE id = ?
        `);

        for (const rp of remote.projects) {
          const local = getProject.get(rp.id) as { id: string; created_at: string; deleted_at: string | null } | undefined;
          if (!local) {
            insertProject.run(rp.id, rp.name, rp.color, rp.order, rp.createdAt, rp.deletedAt);
            changed = true;
          } else {
            // Compare: remote createdAt vs local for updates — use createdAt as proxy since projects lack updatedAt
            // For projects, always take remote if it has a deletedAt we don't, or vice versa
            const remoteDeleted = rp.deletedAt != null;
            const localDeleted = local.deleted_at != null;
            if (remoteDeleted !== localDeleted || rp.name || rp.color) {
              updateProject.run(rp.name, rp.color, rp.order, rp.deletedAt, rp.id);
              changed = true;
            }
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
        const getCategory = db.prepare('SELECT name, updated_at FROM task_categories WHERE name = ? AND project_id IS ?');
        const insertCategory = db.prepare(`
          INSERT INTO task_categories (name, project_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        const updateCategory = db.prepare(`
          UPDATE task_categories SET updated_at = ?, deleted_at = ?
          WHERE name = ? AND project_id IS ?
        `);

        for (const rc of remote.categories) {
          const local = getCategory.get(rc.name, rc.projectId) as { name: string; updated_at: string } | undefined;
          if (!local) {
            insertCategory.run(rc.name, rc.projectId, rc.createdAt, rc.updatedAt, rc.deletedAt);
            changed = true;
          } else if (rc.updatedAt > local.updated_at) {
            updateCategory.run(rc.updatedAt, rc.deletedAt, rc.name, rc.projectId);
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
}
