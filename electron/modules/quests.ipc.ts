import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString, formatDateString, yesterdayDateString } from '../../shared/date-utils';
import { computeNextDue, instanceId, type RecurrenceAnchor } from '../../shared/recurrence';

function genId(): string {
  return crypto.randomUUID();
}

export function registerQuestsIpcHandlers(): void {
  // ── Tasks ──────────────────────────────────────────

  ipcHandle('quests:getTasks', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               recurrence_rule AS recurrenceRule, recurrence_parent_id AS recurrenceParentId,
               recurrence_anchor AS recurrenceAnchor,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL ORDER BY task_order ASC
      `).all();
    } else {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               recurrence_rule AS recurrenceRule, recurrence_parent_id AS recurrenceParentId,
               recurrence_anchor AS recurrenceAnchor,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL AND project_id IS ? ORDER BY task_order ASC
      `).all(projectId);
    }
  });

  ipcHandle('quests:upsertTask', (_e, task: {
    id?: string; name: string; description?: string; tier?: number;
    category?: string; projectId?: string | null; dueDate?: string | null; order?: number; status?: boolean;
    recurrenceRule?: string | null; recurrenceAnchor?: string | null;
  }) => {
    const db = getDb();
    const id = task.id || genId();
    const now = new Date().toISOString();
    const validTier = [1, 2, 3].includes(task.tier ?? 2) ? (task.tier ?? 2) : 2;
    const recurrenceRule = task.recurrenceRule ?? null;
    const recurrenceAnchor = recurrenceRule ? (task.recurrenceAnchor === 'completion' ? 'completion' : 'fixed') : null;

    if (task.id) {
      db.prepare(`
        UPDATE tasks SET name = ?, description = ?, tier = ?, category = ?,
               project_id = ?, due_date = ?, task_order = ?, status = ?,
               recurrence_rule = ?, recurrence_anchor = ?, updated_at = ?
        WHERE id = ?
      `).run(
        task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? 0, task.status ? 1 : 0,
        recurrenceRule, recurrenceAnchor, now, id
      );
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(task_order), -1) + 1 AS next FROM tasks WHERE deleted_at IS NULL').get() as { next: number };
      db.prepare(`
        INSERT INTO tasks (id, name, description, tier, category, project_id, due_date, task_order, status, recurrence_rule, recurrence_anchor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(id, task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? maxOrder.next, recurrenceRule, recurrenceAnchor, now, now);
    }
    return id;
  });

  ipcHandle('quests:deleteTasks', (_e, ids: string[]) => {
    const db = getDb();
    const now = new Date().toISOString();
    const deleteTx = db.transaction((taskIds: string[], timestamp: string) => {
      const placeholders = taskIds.map(() => '?').join(',');
      db.prepare(`UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE task_id IN (${placeholders}) AND deleted_at IS NULL`).run(timestamp, timestamp, ...taskIds);
      db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`).run(timestamp, timestamp, ...taskIds);
    });
    deleteTx(ids, now);
  });

  ipcHandle('quests:setTaskStatus', (_e, taskId: string, status: boolean) => {
    const db = getDb();
    const now = new Date().toISOString();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
    if (!task) return;

    const isRecurringTemplate = !!task.recurrence_rule && !task.recurrence_parent_id;

    if (status && isRecurringTemplate) {
      // Completing a recurring template: record a historical instance for THIS occurrence
      // and advance the template to the next due date (it stays pending).
      const today = todayDateString();
      const occDue = (task.due_date as string | null) ?? today;
      const anchor: RecurrenceAnchor = task.recurrence_anchor === 'completion' ? 'completion' : 'fixed';
      const instId = instanceId(taskId, occDue);
      const nextDue = computeNextDue(task.recurrence_rule as string, anchor, task.due_date as string | null, today, today);

      const advanceTx = db.transaction(() => {
        // Deterministic id → if two devices complete the same occurrence offline, the rows
        // collapse on sync instead of duplicating.
        db.prepare(`
          INSERT OR IGNORE INTO tasks
            (id, name, description, tier, category, project_id, due_date, task_order, status,
             completed_at, recurrence_parent_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          instId, task.name, task.description ?? '', task.tier ?? 2, task.category ?? '',
          task.project_id ?? null, occDue, task.task_order ?? 0, now, taskId, now, now,
        );

        db.prepare('UPDATE tasks SET due_date = ?, status = 0, completed_at = NULL, updated_at = ? WHERE id = ?')
          .run(nextDue, now, taskId);
      });
      advanceTx();
      return { recurred: true, nextDue };
    }

    db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? now : null, now, taskId);
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
    db.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? (completedAt ?? now) : null, now, subtaskId);
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

  // Categories are derived directly from the tasks themselves — tasks.category is the
  // single source of truth. The old task_categories catalog table is no longer read or
  // written (it remains in the sync payload as inert legacy data until a future cleanup,
  // to stay forward-compatible with older clients per the expand-contract pattern).
  ipcHandle('quests:getCategories', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return (db.prepare(
        "SELECT DISTINCT category FROM tasks WHERE deleted_at IS NULL AND category != '' ORDER BY category COLLATE NOCASE ASC"
      ).all() as { category: string }[]).map((r) => r.category);
    }
    return (db.prepare(
      "SELECT DISTINCT category FROM tasks WHERE deleted_at IS NULL AND category != '' AND project_id IS ? ORDER BY category COLLATE NOCASE ASC"
    ).all(projectId) as { category: string }[]).map((r) => r.category);
  });

  // Deprecated: kept as a no-op so the preload bridge and any older renderer that still
  // calls it don't break. Creating a task with a category now implicitly "registers" it.
  ipcHandle('quests:ensureCategory', () => { /* no-op — categories derive from tasks.category */ });

  // ── Stats helpers ──────────────────────────────────

  ipcHandle('quests:countCompletedToday', () => {
    const db = getDb();
    const today = todayDateString(); // YYYY-MM-DD
    const taskCount = db.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND DATE(completed_at) = ?"
    ).get(today) as { c: number };
    const subtaskCount = db.prepare(
      "SELECT COUNT(*) AS c FROM subtasks WHERE status = 1 AND deleted_at IS NULL AND DATE(completed_at) = ?"
    ).get(today) as { c: number };
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
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND DATE(completed_at) = ?"
    ).get(today) as { c: number };
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
    db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?').run(now, id);
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
    const db = getDb();
    const today = new Date();
    const todayStr = formatDateString(today);

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
      const yesterdayStr = yesterdayDateString();
      const checkedYesterday = dates.has(yesterdayStr);

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
        const mondayStr = formatDateString(monday);
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
          const d = new Date(); d.setDate(d.getDate() - 1); return formatDateString(d);
        })();
        if (!checkedToday) {
          const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
          if (!dates.has(formatDateString(yesterday))) {
            return { ...h, streak: 0, checkedToday, checkedYesterday, checksThisPeriod, targetThisPeriod };
          }
        }
        const d = new Date(startDate + 'T00:00:00');
        while (true) {
          if (!dates.has(formatDateString(d))) break;
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
          const wStart = formatDateString(d);
          const wEnd = new Date(d); wEnd.setDate(d.getDate() + 6);
          const wEndStr = formatDateString(wEnd);
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

      return { ...h, streak, checkedToday, checkedYesterday, checksThisPeriod, targetThisPeriod };
    });
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

  // Per-habit history for the individual heatmap: a consecutive run of the last
  // `days` days, each flagged checked/not. Also returns the best (longest) historical
  // run of consecutive checked days as a personal record to beat.
  ipcHandle('quests:getHabitHistory', (_e, habitId: string, days: number = 91) => {
    const db = getDb();
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    const startStr = formatDateString(startDate);

    const rows = db.prepare(
      'SELECT date FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND date >= ?'
    ).all(habitId, startStr) as Array<{ date: string }>;
    const checkedDates = new Set(rows.map((r) => r.date));

    const result: Array<{ date: string; checked: boolean }> = [];
    const d = new Date(startDate);
    for (let i = 0; i < days; i++) {
      const ds = formatDateString(d);
      result.push({ date: ds, checked: checkedDates.has(ds) });
      d.setDate(d.getDate() + 1);
    }

    // Best historical streak across ALL recorded checks (not limited to the window).
    const allDates = (db.prepare(
      'SELECT date FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL ORDER BY date ASC'
    ).all(habitId) as Array<{ date: string }>).map((r) => r.date);
    let bestStreak = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const ds of allDates) {
      const cur = new Date(ds + 'T12:00:00');
      if (prev && Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1) {
        run++;
      } else {
        run = 1;
      }
      if (run > bestStreak) bestStreak = run;
      prev = cur;
    }

    return { days: result, bestStreak };
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
    db.prepare('UPDATE habits SET deleted_at = ? WHERE id = ?').run(now, id);
    db.prepare('UPDATE habit_checks SET deleted_at = ? WHERE habit_id = ?').run(now, id);
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
