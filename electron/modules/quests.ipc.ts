import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString, formatDateString, yesterdayDateString, localTimestamp, nextDateString } from '../../shared/date-utils';
import { computeHabits } from './quests.habits';

function genId(): string {
  return crypto.randomUUID();
}

/**
 * SQLite caps a statement at 999 bound parameters (SQLITE_MAX_VARIABLE_NUMBER on
 * the builds we ship), and `IN ()` with zero ids is a syntax error. Chunk well
 * under the cap so a bulk delete of any size is safe.
 */
const IN_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function registerQuestsIpcHandlers(): void {
  // ── Tasks ──────────────────────────────────────────

  ipcHandle('quests:getTasks', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               completed_at AS completedAt,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL ORDER BY task_order ASC
      `).all();
    } else {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               completed_at AS completedAt,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL AND project_id IS ? ORDER BY task_order ASC
      `).all(projectId);
    }
  });

  ipcHandle('quests:upsertTask', (_e, task: {
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
      const maxOrder = db.prepare('SELECT COALESCE(MAX(task_order), -1) + 1 AS next FROM tasks WHERE deleted_at IS NULL').get() as { next: number };
      db.prepare(`
        INSERT INTO tasks (id, name, description, tier, category, project_id, due_date, task_order, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(id, task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? maxOrder.next, now, now);
    }
    return id;
  });

  ipcHandle('quests:deleteTasks', (_e, ids: string[]) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const db = getDb();
    const now = new Date().toISOString();
    const deleteTx = db.transaction((taskIds: string[], timestamp: string) => {
      for (const batch of chunk(taskIds, IN_CHUNK_SIZE)) {
        const placeholders = batch.map(() => '?').join(',');
        db.prepare(`UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE task_id IN (${placeholders}) AND deleted_at IS NULL`).run(timestamp, timestamp, ...batch);
        db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`).run(timestamp, timestamp, ...batch);
      }
    });
    deleteTx(ids, now);
  });

  ipcHandle('quests:setTaskStatus', (_e, taskId: string, status: boolean) => {
    const db = getDb();
    const now = new Date().toISOString();
    // completed_at is a LOCAL timestamp (see quests migration v11): it is read back
    // against todayDateString(), which is local. Writing UTC here dropped everything
    // completed after 21:00 (UTC-3) out of today's counters.
    db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? localTimestamp() : null, now, taskId);
  });

  ipcHandle('quests:syncTaskOrders', (_e, orders: Array<{ id: string; order: number }>) => {
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

  ipcHandle('quests:getSubtasks', (_e, taskId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, task_id AS taskId, name, description, tier, status,
             subtask_order AS "order", completed_at AS completedAt
      FROM subtasks WHERE task_id = ? AND deleted_at IS NULL ORDER BY subtask_order ASC
    `).all(taskId);
  });

  ipcHandle('quests:addSubtask', (_e, taskId: string, subtask: {
    name: string; description?: string; tier?: number;
  }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(subtask_order), -1) + 1 AS next FROM subtasks WHERE task_id = ? AND deleted_at IS NULL'
    ).get(taskId) as { next: number };

    db.prepare(`
      INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, taskId, subtask.name, subtask.description ?? '', subtask.tier ?? 2, maxOrder.next, now, now);
    return id;
  });

  ipcHandle('quests:updateSubtask', (_e, subtaskId: string, changes: {
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

  ipcHandle('quests:deleteSubtask', (_e, subtaskId: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, subtaskId);
  });

  ipcHandle('quests:setSubtaskStatus', (_e, subtaskId: string, status: boolean, completedAt?: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    // completed_at: LOCAL timestamp (or a caller-supplied 'YYYY-MM-DD' for
    // retroactive checks). See quests migration v11.
    db.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? (completedAt ?? localTimestamp()) : null, now, subtaskId);
  });

  ipcHandle('quests:syncSubtaskOrders', (_e, taskId: string, orderedIds: string[]) => {
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

  ipcHandle('quests:getCategories', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return (db.prepare('SELECT id, name FROM task_categories WHERE deleted_at IS NULL ORDER BY created_at ASC').all() as { id: string; name: string }[])
        .map((r) => r.name);
    } else {
      return (db.prepare('SELECT id, name FROM task_categories WHERE deleted_at IS NULL AND project_id IS ? ORDER BY created_at ASC').all(projectId) as { id: string; name: string }[])
        .map((r) => r.name);
    }
  });

  ipcHandle('quests:ensureCategory', (_e, name: string, projectId?: string | null) => {
    const db = getDb();
    const pid = projectId ?? null;
    const existing = db.prepare(
      'SELECT id FROM task_categories WHERE name = ? AND project_id IS ? AND deleted_at IS NULL'
    ).get(name, pid);
    if (existing) return;
    const id = genId();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO task_categories (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, pid, now, now);
  });

  // ── Stats helpers ──────────────────────────────────

  ipcHandle('quests:countCompletedToday', () => {
    const db = getDb();
    // Half-open [today, tomorrow) on the raw column: DATE(completed_at) = ? wraps
    // the column in a function, which makes idx_tasks_completed_status unusable.
    // Both stored shapes ('YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS') start with the
    // date, so plain string comparison selects exactly that local day.
    const today = todayDateString(); // YYYY-MM-DD, local
    const tomorrow = nextDateString(today);
    const taskCount = db.prepare(
      'SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?'
    ).get(today, tomorrow) as { c: number };
    const subtaskCount = db.prepare(
      'SELECT COUNT(*) AS c FROM subtasks WHERE status = 1 AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?'
    ).get(today, tomorrow) as { c: number };
    return taskCount.c + subtaskCount.c;
  });

  ipcHandle('quests:getPendingCount', () => {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE status = 0 AND deleted_at IS NULL').get() as { c: number };
    return result.c;
  });

  ipcHandle('quests:getCompletedTodayCount', () => {
    const db = getDb();
    const today = todayDateString();
    const result = db.prepare(
      'SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?'
    ).get(today, nextDateString(today)) as { c: number };
    return result.c;
  });

  ipcHandle('quests:getOverdueCount', () => {
    const db = getDb();
    const today = todayDateString();
    const result = db.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 0 AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date < ?"
    ).get(today) as { c: number };
    return result.c;
  });

  // ── Projects ─────────────────────────────────────

  ipcHandle('quests:getProjects', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, color, project_order AS "order", created_at AS createdAt
      FROM projects WHERE deleted_at IS NULL ORDER BY project_order ASC
    `).all();
  });

  ipcHandle('quests:upsertProject', (_e, project: {
    id?: string; name: string; color: string;
  }) => {
    const db = getDb();
    const id = project.id || genId();
    const now = new Date().toISOString();

    if (project.id) {
      db.prepare('UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?')
        .run(project.name, project.color, now, id);
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(project_order), -1) + 1 AS next FROM projects WHERE deleted_at IS NULL').get() as { next: number };
      db.prepare('INSERT INTO projects (id, name, color, project_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, project.name, project.color, maxOrder.next, now, now);
    }
    return id;
  });

  ipcHandle('quests:deleteProject', (_e, id: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?').run(now, id);
      // Categories belong to the project. Without this they survive as orphans
      // pointing at a dead project and keep showing up in getCategories().
      db.prepare('UPDATE task_categories SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL')
        .run(now, now, id);
    });
    tx();
  });

  ipcHandle('quests:syncProjectOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE projects SET project_order = ?, updated_at = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const { id, order } of orders) {
        stmt.run(order, now, id);
      }
    });
    tx();
  });

  // ── Drawings ─────────────────────────────────────

  ipcHandle('quests:getDrawings', (_e, taskId: string) => {
    const db = getDb();
    return db.prepare(`
      SELECT id, task_id AS taskId, data, draw_order AS "order", created_at AS createdAt
      FROM task_drawings WHERE task_id = ? AND deleted_at IS NULL ORDER BY draw_order ASC
    `).all(taskId);
  });

  ipcHandle('quests:getDrawingCount', (_e, taskId: string) => {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) AS c FROM task_drawings WHERE task_id = ? AND deleted_at IS NULL').get(taskId) as { c: number };
    return result.c;
  });

  ipcHandle('quests:saveDrawing', (_e, drawing: { id?: string; taskId: string; data: string }) => {
    const db = getDb();
    const now = new Date().toISOString();

    if (drawing.id) {
      db.prepare('UPDATE task_drawings SET data = ?, updated_at = ? WHERE id = ?').run(drawing.data, new Date().toISOString(), drawing.id);
      return drawing.id;
    } else {
      const id = genId();
      const maxOrder = db.prepare('SELECT COALESCE(MAX(draw_order), -1) + 1 AS next FROM task_drawings WHERE task_id = ? AND deleted_at IS NULL')
        .get(drawing.taskId) as { next: number };
      db.prepare('INSERT INTO task_drawings (id, task_id, data, draw_order, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, drawing.taskId, drawing.data, maxOrder.next, now);
      return id;
    }
  });

  ipcHandle('quests:deleteDrawing', (_e, id: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE task_drawings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  });

  ipcHandle('quests:getAllDrawingCounts', () => {
    const db = getDb();
    return db.prepare('SELECT task_id, COUNT(*) as count FROM task_drawings WHERE deleted_at IS NULL GROUP BY task_id').all();
  });

  // ── Habits ───────────────────────────────────────

  ipcHandle('quests:getHabits', () => {
    return computeHabits(getDb(), new Date());
  });

  ipcHandle('quests:getHabitHeatmap', (_e, days: number = 91) => {
    const db = getDb();
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    const startStr = formatDateString(startDate);

    const rows = db.prepare(`
      SELECT date, COUNT(DISTINCT habit_id) AS count
      FROM habit_checks
      WHERE deleted_at IS NULL AND date >= ?
      GROUP BY date
    `).all(startStr) as Array<{ date: string; count: number }>;

    const totalHabits = (db.prepare(
      'SELECT COUNT(*) AS c FROM habits WHERE deleted_at IS NULL'
    ).get() as { c: number }).c;

    const countMap = new Map<string, number>();
    for (const row of rows) {
      countMap.set(row.date, row.count);
    }

    const result: Array<{ date: string; count: number }> = [];
    const d = new Date(startDate);
    for (let i = 0; i < days; i++) {
      const ds = formatDateString(d);
      result.push({ date: ds, count: countMap.get(ds) ?? 0 });
      d.setDate(d.getDate() + 1);
    }

    return { days: result, totalHabits };
  });

  ipcHandle('quests:addHabit', (_e, habit: { name: string; frequency: string; timesPerWeek: number }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, habit.name, habit.frequency, habit.timesPerWeek, now, now);
    return id;
  });

  ipcHandle('quests:updateHabit', (_e, id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number }) => {
    const db = getDb();
    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.frequency !== undefined) { fields.push('frequency = ?'); values.push(updates.frequency); }
    if (updates.timesPerWeek !== undefined) { fields.push('times_per_week = ?'); values.push(updates.timesPerWeek); }
    db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  });

  ipcHandle('quests:deleteHabit', (_e, id: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    // updated_at MUST move with deleted_at: the merge is last-write-wins on
    // updated_at, so a tombstone that leaves it stale is rejected on the other
    // device and the habit (and every check) resurrects on the next pull.
    const tx = db.transaction(() => {
      db.prepare('UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE habit_id = ?').run(now, now, id);
    });
    tx();
  });

  ipcHandle('quests:checkHabit', (_e, habitId: string) => {
    const db = getDb();
    const today = todayDateString();
    const now = new Date().toISOString();
    const checkTx = db.transaction(() => {
      const existing = db.prepare('SELECT id, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?').get(habitId, today) as { id: string; deleted_at: string | null } | undefined;
      if (existing && !existing.deleted_at) {
        db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id);
        return { checked: false };
      } else if (existing && existing.deleted_at) {
        db.prepare('UPDATE habit_checks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, existing.id);
        return { checked: true };
      } else {
        const id = genId();
        db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, habitId, today, now, now);
        return { checked: true };
      }
    });
    return checkTx();
  });

  ipcHandle('quests:checkHabitForDate', (_e, habitId: string, date: string) => {
    const db = getDb();
    const yesterday = yesterdayDateString();
    if (date !== yesterday) {
      throw new Error(`Retroactive check only allowed for yesterday (${yesterday}), got: ${date}`);
    }
    const now = new Date().toISOString();

    const checkTx = db.transaction(() => {
      const existing = db.prepare(
        'SELECT id, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?'
      ).get(habitId, date) as { id: string; deleted_at: string | null } | undefined;

      if (existing && !existing.deleted_at) {
        db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, existing.id);
        return { checked: false };
      } else if (existing && existing.deleted_at) {
        db.prepare('UPDATE habit_checks SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(now, existing.id);
        return { checked: true };
      } else {
        const id = genId();
        db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, habitId, date, now, now);
        return { checked: true };
      }
    });

    return checkTx();
  });
}
