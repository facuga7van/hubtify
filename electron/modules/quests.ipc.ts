import { ipcMain } from 'electron';
import { getDb } from '../ipc/db';
import crypto from 'crypto';

function genId(): string {
  return crypto.randomUUID();
}

export function registerQuestsIpcHandlers(): void {
  // ── Tasks ──────────────────────────────────────────

  ipcMain.handle('quests:getTasks', (_e, projectId?: string | null) => {
    try {
      const db = getDb();
      if (projectId === undefined) {
        return db.prepare(`
          SELECT id, name, description, status, tier, category,
                 project_id AS projectId, due_date AS dueDate, task_order AS "order",
                 created_at AS createdAt, updated_at AS updatedAt
          FROM tasks WHERE deleted_at IS NULL ORDER BY task_order ASC
        `).all();
      } else {
        return db.prepare(`
          SELECT id, name, description, status, tier, category,
                 project_id AS projectId, due_date AS dueDate, task_order AS "order",
                 created_at AS createdAt, updated_at AS updatedAt
          FROM tasks WHERE deleted_at IS NULL AND project_id IS ? ORDER BY task_order ASC
        `).all(projectId);
      }
    } catch (err) {
      console.error('[quests:getTasks]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:upsertTask', (_e, task: {
    id?: string; name: string; description?: string; tier?: number;
    category?: string; projectId?: string | null; dueDate?: string | null; order?: number; status?: boolean;
  }) => {
    try {
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
    } catch (err) {
      console.error('[quests:upsertTask]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:deleteTasks', (_e, ids: string[]) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const deleteTx = db.transaction((taskIds: string[], timestamp: string) => {
        const placeholders = taskIds.map(() => '?').join(',');
        db.prepare(`UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE task_id IN (${placeholders}) AND deleted_at IS NULL`).run(timestamp, timestamp, ...taskIds);
        db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`).run(timestamp, timestamp, ...taskIds);
      });
      deleteTx(ids, now);
    } catch (err) {
      console.error('[quests:deleteTasks]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:setTaskStatus', (_e, taskId: string, status: boolean) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status ? 1 : 0, now, taskId);
    } catch (err) {
      console.error('[quests:setTaskStatus]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:syncTaskOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    try {
      const db = getDb();
      const stmt = db.prepare('UPDATE tasks SET task_order = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        for (const { id, order } of orders) {
          stmt.run(order, now, id);
        }
      });
      tx();
    } catch (err) {
      console.error('[quests:syncTaskOrders]', err);
      throw err;
    }
  });

  // ── Subtasks ───────────────────────────────────────

  ipcMain.handle('quests:getSubtasks', (_e, taskId: string) => {
    try {
      const db = getDb();
      return db.prepare(`
        SELECT id, task_id AS taskId, name, description, tier, status,
               subtask_order AS "order", completed_at AS completedAt
        FROM subtasks WHERE task_id = ? AND deleted_at IS NULL ORDER BY subtask_order ASC
      `).all(taskId);
    } catch (err) {
      console.error('[quests:getSubtasks]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:addSubtask', (_e, taskId: string, subtask: {
    name: string; description?: string; tier?: number;
  }) => {
    try {
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
    } catch (err) {
      console.error('[quests:addSubtask]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:updateSubtask', (_e, subtaskId: string, changes: {
    name?: string; description?: string; tier?: number;
  }) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const sets: string[] = ['updated_at = ?'];
      const vals: unknown[] = [now];

      if (changes.name !== undefined) { sets.push('name = ?'); vals.push(changes.name); }
      if (changes.description !== undefined) { sets.push('description = ?'); vals.push(changes.description); }
      if (changes.tier !== undefined) { sets.push('tier = ?'); vals.push(changes.tier); }

      vals.push(subtaskId);
      db.prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    } catch (err) {
      console.error('[quests:updateSubtask]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:deleteSubtask', (_e, subtaskId: string) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, subtaskId);
    } catch (err) {
      console.error('[quests:deleteSubtask]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:setSubtaskStatus', (_e, subtaskId: string, status: boolean, completedAt?: string) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
        .run(status ? 1 : 0, status ? (completedAt ?? now) : null, now, subtaskId);
    } catch (err) {
      console.error('[quests:setSubtaskStatus]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:syncSubtaskOrders', (_e, taskId: string, orderedIds: string[]) => {
    try {
      const db = getDb();
      const stmt = db.prepare('UPDATE subtasks SET subtask_order = ?, updated_at = ? WHERE id = ? AND task_id = ?');
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        orderedIds.forEach((id, index) => {
          stmt.run(index, now, id, taskId);
        });
      });
      tx();
    } catch (err) {
      console.error('[quests:syncSubtaskOrders]', err);
      throw err;
    }
  });

  // ── Categories ─────────────────────────────────────

  ipcMain.handle('quests:getCategories', (_e, projectId?: string | null) => {
    try {
      const db = getDb();
      if (projectId === undefined) {
        return (db.prepare('SELECT name FROM task_categories WHERE deleted_at IS NULL ORDER BY created_at ASC').all() as { name: string }[])
          .map((r) => r.name);
      } else {
        return (db.prepare('SELECT name FROM task_categories WHERE deleted_at IS NULL AND project_id IS ? ORDER BY created_at ASC').all(projectId) as { name: string }[])
          .map((r) => r.name);
      }
    } catch (err) {
      console.error('[quests:getCategories]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:ensureCategory', (_e, name: string, projectId?: string | null) => {
    try {
      const db = getDb();
      db.prepare('INSERT OR IGNORE INTO task_categories (name, project_id) VALUES (?, ?)').run(name, projectId ?? null);
    } catch (err) {
      console.error('[quests:ensureCategory]', err);
      throw err;
    }
  });

  // ── Stats helpers ──────────────────────────────────

  // NOTE: For tasks, we use updated_at as a proxy for completion date since there's no
  // dedicated completed_at column. This is acceptable because we also filter by status = 1,
  // but it may miscount if a completed task is edited (updating updated_at) on a different day.
  ipcMain.handle('quests:countCompletedToday', () => {
    try {
      const db = getDb();
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      const taskCount = db.prepare(
        "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND DATE(updated_at) = ?"
      ).get(today) as { c: number };
      const subtaskCount = db.prepare(
        "SELECT COUNT(*) AS c FROM subtasks WHERE status = 1 AND deleted_at IS NULL AND completed_at = ?"
      ).get(today) as { c: number };
      return taskCount.c + subtaskCount.c;
    } catch (err) {
      console.error('[quests:countCompletedToday]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:getPendingCount', () => {
    try {
      const db = getDb();
      const result = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE status = 0 AND deleted_at IS NULL').get() as { c: number };
      return result.c;
    } catch (err) {
      console.error('[quests:getPendingCount]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:getCompletedTodayCount', () => {
    try {
      const db = getDb();
      const today = new Date().toLocaleDateString('en-CA');
      const result = db.prepare(
        "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND DATE(updated_at) = ?"
      ).get(today) as { c: number };
      return result.c;
    } catch (err) {
      console.error('[quests:getCompletedTodayCount]', err);
      throw err;
    }
  });

  // ── Projects ─────────────────────────────────────

  ipcMain.handle('quests:getProjects', () => {
    try {
      const db = getDb();
      return db.prepare(`
        SELECT id, name, color, project_order AS "order", created_at AS createdAt
        FROM projects WHERE deleted_at IS NULL ORDER BY project_order ASC
      `).all();
    } catch (err) {
      console.error('[quests:getProjects]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:upsertProject', (_e, project: {
    id?: string; name: string; color: string;
  }) => {
    try {
      const db = getDb();
      const id = project.id || genId();
      const now = new Date().toISOString();

      if (project.id) {
        db.prepare('UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?')
          .run(project.name, project.color, now, id);
      } else {
        const maxOrder = db.prepare('SELECT COALESCE(MAX(project_order), -1) + 1 AS next FROM projects').get() as { next: number };
        db.prepare('INSERT INTO projects (id, name, color, project_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, project.name, project.color, maxOrder.next, now, now);
      }
      return id;
    } catch (err) {
      console.error('[quests:upsertProject]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:deleteProject', (_e, id: string) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    } catch (err) {
      console.error('[quests:deleteProject]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:syncProjectOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const stmt = db.prepare('UPDATE projects SET project_order = ?, updated_at = ? WHERE id = ?');
      const tx = db.transaction(() => {
        for (const { id, order } of orders) {
          stmt.run(order, now, id);
        }
      });
      tx();
    } catch (err) {
      console.error('[quests:syncProjectOrders]', err);
      throw err;
    }
  });

  // ── Drawings ─────────────────────────────────────

  ipcMain.handle('quests:getDrawings', (_e, taskId: string) => {
    try {
      const db = getDb();
      return db.prepare(`
        SELECT id, task_id AS taskId, data, draw_order AS "order", created_at AS createdAt
        FROM task_drawings WHERE task_id = ? ORDER BY draw_order ASC
      `).all(taskId);
    } catch (err) {
      console.error('[quests:getDrawings]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:getDrawingCount', (_e, taskId: string) => {
    try {
      const db = getDb();
      const result = db.prepare('SELECT COUNT(*) AS c FROM task_drawings WHERE task_id = ?').get(taskId) as { c: number };
      return result.c;
    } catch (err) {
      console.error('[quests:getDrawingCount]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:saveDrawing', (_e, drawing: { id?: string; taskId: string; data: string }) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      if (drawing.id) {
        db.prepare('UPDATE task_drawings SET data = ? WHERE id = ?').run(drawing.data, drawing.id);
        return drawing.id;
      } else {
        const id = genId();
        const maxOrder = db.prepare('SELECT COALESCE(MAX(draw_order), -1) + 1 AS next FROM task_drawings WHERE task_id = ?')
          .get(drawing.taskId) as { next: number };
        db.prepare('INSERT INTO task_drawings (id, task_id, data, draw_order, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, drawing.taskId, drawing.data, maxOrder.next, now);
        return id;
      }
    } catch (err) {
      console.error('[quests:saveDrawing]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:deleteDrawing', (_e, id: string) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM task_drawings WHERE id = ?').run(id);
    } catch (err) {
      console.error('[quests:deleteDrawing]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:getAllDrawingCounts', () => {
    try {
      const db = getDb();
      return db.prepare('SELECT task_id, COUNT(*) as count FROM task_drawings GROUP BY task_id').all();
    } catch (err) {
      console.error('[quests:getAllDrawingCounts]', err);
      throw err;
    }
  });

  // ── Habits ───────────────────────────────────────

  ipcMain.handle('quests:getHabits', () => {
    try {
      const db = getDb();
      const today = new Date();
      const todayStr = today.toLocaleDateString('en-CA');

      const habits = db.prepare(`
        SELECT id, name, frequency, times_per_week AS timesPerWeek, created_at AS createdAt
        FROM habits WHERE deleted_at IS NULL ORDER BY created_at ASC
      `).all() as Array<{ id: string; name: string; frequency: string; timesPerWeek: number; createdAt: string }>;

      // Batch-load ALL checks in one query, group by habit_id
      const allChecks = db.prepare(
        'SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL ORDER BY date DESC'
      ).all() as Array<{ habit_id: string; date: string }>;

      const checksByHabit = new Map<string, Set<string>>();
      for (const check of allChecks) {
        let set = checksByHabit.get(check.habit_id);
        if (!set) { set = new Set(); checksByHabit.set(check.habit_id, set); }
        set.add(check.date);
      }

      return habits.map((h) => {
        const dates = checksByHabit.get(h.id) ?? new Set<string>();
        const checkedToday = dates.has(todayStr);

        // Checks this period
        let checksThisPeriod = 0;
        let targetThisPeriod = 1;

        if (h.frequency === 'daily') {
          checksThisPeriod = checkedToday ? 1 : 0;
          targetThisPeriod = 1;
        } else if (h.frequency === 'weekly') {
          // Count checks this week (Monday-Sunday)
          const dayOfWeek = today.getDay() || 7; // 1=Mon..7=Sun
          const monday = new Date(today);
          monday.setDate(today.getDate() - dayOfWeek + 1);
          const mondayStr = monday.toLocaleDateString('en-CA');
          checksThisPeriod = 0;
          for (const d of dates) {
            if (d >= mondayStr && d <= todayStr) checksThisPeriod++;
          }
          targetThisPeriod = h.timesPerWeek;
        } else if (h.frequency === 'monthly') {
          const monthStart = todayStr.slice(0, 7) + '-01';
          checksThisPeriod = 0;
          for (const d of dates) {
            if (d >= monthStart && d <= todayStr) checksThisPeriod++;
          }
          targetThisPeriod = 1;
        }

        // Streak: consecutive completed periods backwards
        let streak = 0;
        if (h.frequency === 'daily') {
          // Count consecutive days backwards
          const startDate = checkedToday ? todayStr : (() => {
            const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA');
          })();
          if (!checkedToday) {
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            if (!dates.has(yesterday.toLocaleDateString('en-CA'))) {
              return { ...h, streak: 0, checkedToday, checksThisPeriod, targetThisPeriod };
            }
          }
          const d = new Date(startDate);
          while (true) {
            if (!dates.has(d.toLocaleDateString('en-CA'))) break;
            streak++;
            d.setDate(d.getDate() - 1);
          }
        } else if (h.frequency === 'weekly') {
          // Count consecutive weeks where target was met, backwards from last week (or current if met)
          const currentMet = checksThisPeriod >= h.timesPerWeek;
          const dayOfWeek = today.getDay() || 7;
          const weekStart = new Date(today);
          weekStart.setDate(today.getDate() - dayOfWeek + 1);
          if (!currentMet) weekStart.setDate(weekStart.getDate() - 7); // start from last week

          const d = new Date(weekStart);
          while (true) {
            const wStart = d.toLocaleDateString('en-CA');
            const wEnd = new Date(d); wEnd.setDate(d.getDate() + 6);
            const wEndStr = wEnd.toLocaleDateString('en-CA');
            let count = 0;
            for (const dt of dates) {
              if (dt >= wStart && dt <= wEndStr) count++;
            }
            if (count < h.timesPerWeek) break;
            streak++;
            d.setDate(d.getDate() - 7);
          }
        } else if (h.frequency === 'monthly') {
          // Count consecutive months with at least 1 check
          const currentMet = checksThisPeriod >= 1;
          let year = today.getFullYear();
          let month = today.getMonth(); // 0-indexed
          if (!currentMet) { month--; if (month < 0) { month = 11; year--; } }

          while (true) {
            const mStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const mEnd = `${year}-${String(month + 1).padStart(2, '0')}-31`;
            let count = 0;
            for (const d of dates) {
              if (d >= mStart && d <= mEnd) count++;
            }
            if (count < 1) break;
            streak++;
            month--; if (month < 0) { month = 11; year--; }
          }
        }

        return { ...h, streak, checkedToday, checksThisPeriod, targetThisPeriod };
      });
    } catch (err) {
      console.error('[quests:getHabits]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:addHabit', (_e, habit: { name: string; frequency: string; timesPerWeek: number }) => {
    try {
      const db = getDb();
      const id = genId();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO habits (id, name, frequency, times_per_week, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, habit.name, habit.frequency, habit.timesPerWeek, now);
      return id;
    } catch (err) {
      console.error('[quests:addHabit]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:deleteHabit', (_e, id: string) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE habits SET deleted_at = ? WHERE id = ?').run(now, id);
    } catch (err) {
      console.error('[quests:deleteHabit]', err);
      throw err;
    }
  });

  ipcMain.handle('quests:checkHabit', (_e, habitId: string) => {
    try {
      const db = getDb();
      const today = new Date().toLocaleDateString('en-CA');
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
    } catch (err) {
      console.error('[quests:checkHabit]', err);
      throw err;
    }
  });
}
