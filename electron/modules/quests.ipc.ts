import { ipcMain } from 'electron';
import { getDb } from '../ipc/db';
import crypto from 'crypto';

function genId(): string {
  return crypto.randomUUID();
}

export function registerQuestsIpcHandlers(): void {
  // ── Tasks ──────────────────────────────────────────

  ipcMain.handle('quests:getTasks', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks ORDER BY task_order ASC
      `).all();
    } else {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE project_id IS ? ORDER BY task_order ASC
      `).all(projectId);
    }
  });

  ipcMain.handle('quests:upsertTask', (_e, task: {
    id?: string; name: string; description?: string; tier?: number;
    category?: string; projectId?: string | null; dueDate?: string | null; order?: number; status?: boolean;
  }) => {
    const db = getDb();
    const id = task.id || genId();
    const now = new Date().toISOString();
    const validTier = [1, 2, 3].includes(task.tier ?? 2) ? (task.tier ?? 2) : 2;

    if (task.id) {
      db.prepare(`
        UPDATE tasks SET name = ?, description = ?, tier = ?, category = ?,
               project_id = ?, due_date = ?, task_order = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? 0, task.status ? 1 : 0, now, id
      );
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(task_order), -1) + 1 AS next FROM tasks').get() as { next: number };
      db.prepare(`
        INSERT INTO tasks (id, name, description, tier, category, project_id, due_date, task_order, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(id, task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? maxOrder.next, now, now);
    }
    return id;
  });

  ipcMain.handle('quests:deleteTasks', (_e, ids: string[]) => {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM subtasks WHERE task_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
  });

  ipcMain.handle('quests:setTaskStatus', (_e, taskId: string, status: boolean) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status ? 1 : 0, now, taskId);
  });

  ipcMain.handle('quests:syncTaskOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE tasks SET task_order = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const { id, order } of orders) {
        stmt.run(order, now, id);
      }
    });
    tx();
  });

  // ── Subtasks ───────────────────────────────────────

  ipcMain.handle('quests:getSubtasks', (_e, taskId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, task_id AS taskId, name, description, tier, status,
             subtask_order AS "order", completed_at AS completedAt
      FROM subtasks WHERE task_id = ? ORDER BY subtask_order ASC
    `).all(taskId);
  });

  ipcMain.handle('quests:addSubtask', (_e, taskId: string, subtask: {
    name: string; description?: string; tier?: number;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(subtask_order), -1) + 1 AS next FROM subtasks WHERE task_id = ?'
    ).get(taskId) as { next: number };

    db.prepare(`
      INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, taskId, subtask.name, subtask.description ?? '', subtask.tier ?? 2, maxOrder.next, now, now);
    return id;
  });

  ipcMain.handle('quests:updateSubtask', (_e, subtaskId: string, changes: {
    name?: string; description?: string; tier?: number;
  }) => {
    const db = getDb();
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    if (changes.name !== undefined) { sets.push('name = ?'); vals.push(changes.name); }
    if (changes.description !== undefined) { sets.push('description = ?'); vals.push(changes.description); }
    if (changes.tier !== undefined) { sets.push('tier = ?'); vals.push(changes.tier); }

    vals.push(subtaskId);
    db.prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  });

  ipcMain.handle('quests:deleteSubtask', (_e, subtaskId: string) => {
    const db = getDb();
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(subtaskId);
  });

  ipcMain.handle('quests:setSubtaskStatus', (_e, subtaskId: string, status: boolean, completedAt?: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? (completedAt ?? now) : null, now, subtaskId);
  });

  ipcMain.handle('quests:syncSubtaskOrders', (_e, taskId: string, orderedIds: string[]) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE subtasks SET subtask_order = ?, updated_at = ? WHERE id = ? AND task_id = ?');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      orderedIds.forEach((id, index) => {
        stmt.run(index, now, id, taskId);
      });
    });
    tx();
  });

  // ── Categories ─────────────────────────────────────

  ipcMain.handle('quests:getCategories', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return (db.prepare('SELECT name FROM task_categories ORDER BY created_at ASC').all() as { name: string }[])
        .map((r) => r.name);
    } else {
      return (db.prepare('SELECT name FROM task_categories WHERE project_id IS ? ORDER BY created_at ASC').all(projectId) as { name: string }[])
        .map((r) => r.name);
    }
  });

  ipcMain.handle('quests:ensureCategory', (_e, name: string, projectId?: string | null) => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO task_categories (name, project_id) VALUES (?, ?)').run(name, projectId ?? null);
  });

  // ── Stats helpers ──────────────────────────────────

  // NOTE: For tasks, we use updated_at as a proxy for completion date since there's no
  // dedicated completed_at column. This is acceptable because we also filter by status = 1,
  // but it may miscount if a completed task is edited (updating updated_at) on a different day.
  ipcMain.handle('quests:countCompletedToday', () => {
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const taskCount = db.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND DATE(updated_at) = ?"
    ).get(today) as { c: number };
    const subtaskCount = db.prepare(
      "SELECT COUNT(*) AS c FROM subtasks WHERE status = 1 AND completed_at = ?"
    ).get(today) as { c: number };
    return taskCount.c + subtaskCount.c;
  });

  ipcMain.handle('quests:getPendingCount', () => {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE status = 0').get() as { c: number };
    return result.c;
  });

  ipcMain.handle('quests:getCompletedTodayCount', () => {
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA');
    const result = db.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND DATE(updated_at) = ?"
    ).get(today) as { c: number };
    return result.c;
  });

  // ── Projects ─────────────────────────────────────

  ipcMain.handle('quests:getProjects', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, color, project_order AS "order", created_at AS createdAt
      FROM projects ORDER BY project_order ASC
    `).all();
  });

  ipcMain.handle('quests:upsertProject', (_e, project: {
    id?: string; name: string; color: string;
  }) => {
    const db = getDb();
    const id = project.id || genId();
    const now = new Date().toISOString();

    if (project.id) {
      db.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?')
        .run(project.name, project.color, id);
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(project_order), -1) + 1 AS next FROM projects').get() as { next: number };
      db.prepare('INSERT INTO projects (id, name, color, project_order, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, project.name, project.color, maxOrder.next, now);
    }
    return id;
  });

  ipcMain.handle('quests:deleteProject', (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  ipcMain.handle('quests:syncProjectOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE projects SET project_order = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const { id, order } of orders) {
        stmt.run(order, id);
      }
    });
    tx();
  });
}
