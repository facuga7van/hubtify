import type Database from 'better-sqlite3';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { todayDateString, formatDateString, yesterdayDateString, localTimestamp, nextDateString } from '../../shared/date-utils';
import { reconcileHabitShields, serializeSpecificDays } from './quests.habits';

function genId(): string {
  return crypto.randomUUID();
}

/**
 * Resolves the new `due_date` for a postponed task.
 *
 * `target` is either a bare 'YYYY-MM-DD' or a full 'YYYY-MM-DDTHH:mm' (what the
 * date picker emits). A bare target keeps whatever time the task already had —
 * "tomorrow" on a 9am standup must stay a 9am standup, not silently become an
 * all-day item — and stays bare when it had none.
 */
export function postponedDueDate(current: string | null | undefined, target: string): string {
  if (target.includes('T')) return target;
  const time = typeof current === 'string' && current.includes('T') ? current.split('T')[1] : '';
  return time ? `${target}T${time}` : target;
}

/**
 * Moves a batch of tasks to a new due date. Neutral by design: no XP, no HP,
 * no completion side effects — the whole point is that rescheduling costs
 * nothing, so the "Overdue" pile stops being a guilt trip nobody clears.
 *
 * Every row moves `updated_at` (LWW sync key) — a bulk write that forgets it is
 * silently discarded on the other device.
 */
export function postponeTasks(
  db: Database.Database,
  ids: string[],
  target: string,
  now: string = new Date().toISOString(),
): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const select = db.prepare('SELECT id, due_date AS dueDate FROM tasks WHERE id = ? AND deleted_at IS NULL');
  const update = db.prepare('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?');
  let moved = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = select.get(id) as { id: string; dueDate: string | null } | undefined;
      if (!row) continue;
      update.run(postponedDueDate(row.dueDate, target), now, id);
      moved++;
    }
  })();
  return moved;
}

// ── Recurring tasks (Fase 3) ─────────────────────────────────────────────────

/**
 * Parsed form of `tasks.repeat_rule` (see quests migration v13).
 * `days` uses JS `Date.getDay()` numbering: 0 = Sunday … 6 = Saturday.
 */
export interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'days';
  days?: number[];
}

/**
 * Defensive parser: `repeat_rule` can arrive from sync or an older build, so
 * anything that isn't a well-formed rule quietly means "never repeats" instead
 * of throwing mid-completion. For freq 'days' the list is deduped, sorted and
 * must be non-empty (a "repeat on no days" rule is not a rule).
 */
export function parseRepeatRule(raw: string | null | undefined): RepeatRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { freq?: unknown; days?: unknown };
    if (parsed.freq === 'daily' || parsed.freq === 'weekly' || parsed.freq === 'monthly') {
      return { freq: parsed.freq };
    }
    if (parsed.freq === 'days' && Array.isArray(parsed.days)) {
      const days = [...new Set(parsed.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
        .sort((a, b) => a - b);
      if (days.length > 0) return { freq: 'days', days };
    }
  } catch { /* malformed JSON → no rule */ }
  return null;
}

/** due_date is 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' — split date from optional time. */
function splitDueDate(due: string): { date: string; time: string | null } {
  const tIdx = due.indexOf('T');
  return tIdx === -1 ? { date: due, time: null } : { date: due.slice(0, tIdx), time: due.slice(tIdx + 1) };
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** Local calendar date → 'YYYY-MM-DD' without any locale/UTC detour. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * The next occurrence for a rule, advanced FROM the completed instance's own
 * due_date — never from today. Completing March's rent on the 3rd still puts
 * April's on the 1st. All arithmetic is LOCAL (`new Date(y, m, d)`), matching
 * the project's UTC-vs-local unification (shared/date-utils conventions).
 *
 * - daily   → +1 day
 * - weekly  → +7 days
 * - monthly → +1 month, day-of-month = min(anchor day, last day of that month).
 *             `anchorDue` is the chain root's due_date: it remembers "the 31st"
 *             across a Feb 28 hop (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 * - days    → the first listed weekday strictly after the base date.
 *
 * A task with no due_date starts its cadence from today. The time-of-day part,
 * when present, is carried over unchanged.
 */
export function nextRepeatDueDate(
  rule: RepeatRule,
  currentDue: string | null,
  anchorDue?: string | null,
  today: string = todayDateString(),
): string {
  const { date, time } = splitDueDate(currentDue || today);
  const [y, m, d] = date.split('-').map(Number);

  let next: Date;
  if (rule.freq === 'daily') {
    next = new Date(y, m - 1, d + 1);
  } else if (rule.freq === 'weekly') {
    next = new Date(y, m - 1, d + 7);
  } else if (rule.freq === 'monthly') {
    const anchorDate = anchorDue ? splitDueDate(anchorDue).date : date;
    const anchorDay = Number(anchorDate.slice(8, 10)) || d;
    // Target month is index `m` (current is m-1, 0-based); its last day is
    // day 0 of the month after it.
    const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
    next = new Date(y, m, Math.min(anchorDay, lastDayOfTarget));
  } else {
    const days = rule.days ?? [];
    next = new Date(y, m - 1, d + 1);
    for (let i = 0; i < 7; i++) {
      if (days.includes(next.getDay())) break;
      next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1);
    }
  }

  const nextDate = ymd(next);
  return time ? `${nextDate}T${time}` : nextDate;
}

interface RepeatTaskRow {
  id: string; name: string; description: string; tier: number; category: string;
  projectId: string | null; dueDate: string | null;
  repeatRule: string | null; repeatOf: string | null; deletedAt: string | null;
}

/**
 * Spawns the next instance of a recurring chain after `taskId` was completed.
 * Returns the new instance, or null when nothing was (or had to be) generated.
 *
 * IDEMPOTENT by design: completing twice, or a sync merge replaying the same
 * completion, cannot duplicate the next instance — generation is skipped while
 * ANY live, open task of the chain exists (invariant: at most one open instance
 * per chain). Soft-deleted instances don't count, so deleting the generated
 * task doesn't freeze the chain: the next completion regenerates it.
 *
 * What the new instance inherits: name, description, tier, category, project
 * and the rule itself. Deliberately NOT copied: scroll notes/drawings and
 * subtasks — they belong to the specific occurrence, not to the template.
 *
 * Un-completing a recurring task does NOT delete the instance it spawned
 * (simplicity: reverse bookkeeping across a chain isn't worth the edge cases;
 * the invariant above still prevents duplicates on the next completion).
 */
export function spawnNextRepeatInstance(
  db: Database.Database,
  taskId: string,
  now: string = new Date().toISOString(),
): { nextTaskId: string; nextDueDate: string | null } | null {
  return db.transaction(() => {
    const task = db.prepare(`
      SELECT id, name, description, tier, category, project_id AS projectId,
             due_date AS dueDate, repeat_rule AS repeatRule, repeat_of AS repeatOf,
             deleted_at AS deletedAt
      FROM tasks WHERE id = ?
    `).get(taskId) as RepeatTaskRow | undefined;
    if (!task || task.deletedAt) return null;

    const rule = parseRepeatRule(task.repeatRule);
    if (!rule) return null;

    const chainId = task.repeatOf ?? task.id;
    const openInChain = db.prepare(`
      SELECT 1 FROM tasks
      WHERE deleted_at IS NULL AND status = 0 AND id != ?
        AND (id = ? OR repeat_of = ?)
      LIMIT 1
    `).get(taskId, chainId, chainId);
    if (openInChain) return null;

    // Monthly anchor: the root's due day-of-month. The root may be soft-deleted
    // or missing (partial sync) — its date is still a perfectly good anchor,
    // and when it's gone the completed instance's own date fills in.
    const root = db.prepare('SELECT due_date AS dueDate FROM tasks WHERE id = ?')
      .get(chainId) as { dueDate: string | null } | undefined;
    const nextDueDate = nextRepeatDueDate(rule, task.dueDate, root?.dueDate ?? task.dueDate);

    const nextTaskId = genId();
    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(task_order), -1) + 1 AS next FROM tasks WHERE deleted_at IS NULL'
    ).get() as { next: number };
    db.prepare(`
      INSERT INTO tasks (id, name, description, tier, category, project_id, due_date,
                         task_order, status, repeat_rule, repeat_of, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(nextTaskId, task.name, task.description, task.tier, task.category, task.projectId,
      nextDueDate, maxOrder.next, task.repeatRule, chainId, now, now);

    return { nextTaskId, nextDueDate };
  })();
}

/**
 * Whether ANOTHER live instance of `taskId`'s recurring chain was already
 * completed on `today` (local 'YYYY-MM-DD').
 *
 * The chain is `repeat_of ?? id`, so a plain task (no chain) never has
 * siblings and this is simply false. Sync counts: an instance completed today
 * on another device carries its `completed_at` over and blocks the same way.
 */
function chainPaidToday(db: Database.Database, taskId: string, today: string): boolean {
  const task = db.prepare('SELECT repeat_of AS repeatOf FROM tasks WHERE id = ?')
    .get(taskId) as { repeatOf: string | null } | undefined;
  if (!task) return false;
  const chainId = task.repeatOf ?? taskId;
  const paid = db.prepare(`
    SELECT 1 FROM tasks
    WHERE deleted_at IS NULL AND status = 1 AND id != ?
      AND (id = ? OR repeat_of = ?)
      AND completed_at >= ? AND completed_at < ?
    LIMIT 1
  `).get(taskId, chainId, chainId, today, nextDateString(today));
  return !!paid;
}

export interface SetTaskStatusResult {
  /**
   * Whether the renderer should emit TASK_COMPLETED for this completion.
   *
   * Every instance of a recurring chain has its own taskId, so the engine's
   * undo-by-ref_id guard cannot see that "daily" completed three times in a
   * minute is the same quest — each one paid full XP + combo + total_tasks.
   * Rule: at most ONE payment per chain per LOCAL day. A second instance
   * completed the same day still completes (the chain keeps advancing) but
   * is not paid; a new day pays again. Un-completing the paid instance frees
   * the day's slot (the refund already went through TASK_UNCOMPLETED).
   */
  paysXp: boolean;
  repeated?: { nextTaskId: string; nextDueDate: string | null };
}

/**
 * Marks a task (un)completed. `completedAt` is a LOCAL timestamp (see quests
 * migration v11): it is read back against todayDateString(), which is local,
 * and its date part is the "today" of the one-payment-per-chain rule.
 * Returns undefined on un-completion (nothing to pay, nothing spawned).
 */
export function setTaskStatus(
  db: Database.Database,
  taskId: string,
  status: boolean,
  opts: { now?: string; completedAt?: string } = {},
): SetTaskStatusResult | undefined {
  const now = opts.now ?? new Date().toISOString();
  const completedAt = opts.completedAt ?? localTimestamp();
  return db.transaction(() => {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status ? 1 : 0, status ? completedAt : null, now, taskId);
    if (!status) return undefined;

    // Decided BEFORE spawning: the fresh open instance is status 0 and never
    // counts, but the order keeps the rule independent of the spawn.
    const paysXp = !chainPaidToday(db, taskId, completedAt.slice(0, 10));
    // Recurring chain: completing spawns the next instance (idempotent — see
    // spawnNextRepeatInstance). Un-completing deliberately does NOT undo it.
    const spawned = spawnNextRepeatInstance(db, taskId, now);
    return spawned ? { paysXp, repeated: spawned } : { paysXp };
  })();
}

/**
 * Toggles a real check for `date`. A row that is currently a 'skip' or a
 * 'shield' is PROMOTED to a check rather than toggled off — the user asking
 * for a check on an excused day means "actually, I did it", not "undo".
 *
 * Answers with the row's identity (`checkId`, `date`) in both directions, so
 * the renderer can emit the HABIT_UNCHECKED that reverts exactly the
 * HABIT_CHECKED it paid — a retroactive uncheck used to be free, and marking
 * again promoted this same soft-deleted row and paid again.
 */
export function toggleHabitCheck(
  db: Database.Database,
  habitId: string,
  date: string,
): { checked: boolean; checkId: string; date: string } {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const existing = db.prepare(
      'SELECT id, kind, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?'
    ).get(habitId, date) as { id: string; kind: string | null; deleted_at: string | null } | undefined;

    if (existing && !existing.deleted_at && (existing.kind ?? 'check') === 'check') {
      db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id);
      return { checked: false, checkId: existing.id, date };
    }
    if (existing) {
      db.prepare("UPDATE habit_checks SET kind = 'check', deleted_at = NULL, updated_at = ? WHERE id = ?")
        .run(now, existing.id);
      return { checked: true, checkId: existing.id, date };
    }
    const checkId = genId();
    db.prepare("INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at) VALUES (?, ?, ?, 'check', ?, ?)")
      .run(checkId, habitId, date, now, now);
    return { checked: true, checkId, date };
  })();
}

/** 'today' / 'tomorrow' shorthands, or a literal date the picker produced. */
function resolvePostponeTarget(target: string): string {
  if (target === 'today') return todayDateString();
  if (target === 'tomorrow') return nextDateString(todayDateString());
  return target;
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
               completed_at AS completedAt, repeat_rule AS repeatRule, repeat_of AS repeatOf,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL ORDER BY task_order ASC
      `).all();
    } else {
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               completed_at AS completedAt, repeat_rule AS repeatRule, repeat_of AS repeatOf,
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE deleted_at IS NULL AND project_id IS ? ORDER BY task_order ASC
      `).all(projectId);
    }
  });

  ipcHandle('quests:upsertTask', (_e, task: {
    id?: string; name: string; description?: string; tier?: number;
    category?: string; projectId?: string | null; dueDate?: string | null; order?: number; status?: boolean;
    repeatRule?: string | null;
  }) => {
    const db = getDb();
    const id = task.id || genId();
    const now = new Date().toISOString();
    const validTier = [1, 2, 3].includes(task.tier ?? 2) ? (task.tier ?? 2) : 2;
    // Normalized on the way in: a rule that doesn't parse is stored as NULL,
    // never as junk a later completion has to survive.
    const repeatRule = task.repeatRule && parseRepeatRule(task.repeatRule) ? task.repeatRule : null;
    // Callers that don't know about repeat_rule yet (QuickAdd, older widgets)
    // omit the key entirely — updating through them must not wipe the rule.
    const touchRepeat = task.repeatRule !== undefined;

    if (task.id) {
      db.prepare(`
        UPDATE tasks SET name = ?, description = ?, tier = ?, category = ?,
               project_id = ?, due_date = ?, task_order = ?, status = ?, updated_at = ?
               ${touchRepeat ? ', repeat_rule = ?' : ''}
        WHERE id = ?
      `).run(
        task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? 0, task.status ? 1 : 0, now,
        ...(touchRepeat ? [repeatRule] : []), id
      );
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(task_order), -1) + 1 AS next FROM tasks WHERE deleted_at IS NULL').get() as { next: number };
      db.prepare(`
        INSERT INTO tasks (id, name, description, tier, category, project_id, due_date, task_order, status, repeat_rule, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(id, task.name, task.description ?? '', validTier, task.category ?? '',
        task.projectId ?? null, task.dueDate ?? null, task.order ?? maxOrder.next, repeatRule, now, now);
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

  /**
   * `target` is 'today' | 'tomorrow' | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm'.
   * Returns how many tasks actually moved (ids that no longer exist are skipped).
   */
  ipcHandle('quests:postponeTasks', (_e, ids: string[], target: string) => {
    const moved = postponeTasks(getDb(), ids, resolvePostponeTarget(String(target || 'today')));
    return { moved };
  });

  // XP is paid by the renderer per completion, gated on the returned `paysXp`
  // (see SetTaskStatusResult). Older renderers ignore the return value, so
  // widening void → object is safe.
  ipcHandle('quests:setTaskStatus', (_e, taskId: string, status: boolean) =>
    setTaskStatus(getDb(), taskId, status));

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

  // Reconciles (and persists) streak shields on the way out — see
  // reconcileHabitShields. Read-only callers (the Syl snapshot) use computeHabits.
  ipcHandle('quests:getHabits', () => {
    return reconcileHabitShields(getDb(), new Date());
  });

  ipcHandle('quests:getHabitHeatmap', (_e, days: number = 91) => {
    const db = getDb();
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    const startStr = formatDateString(startDate);

    // Skips and shields are NOT achievements: counting them would paint an
    // excused day the same gold as a day actually earned. They come back in
    // their own bucket so the calendar can give them a neutral tone.
    const rows = db.prepare(`
      SELECT date,
             COUNT(DISTINCT CASE WHEN kind = 'check' THEN habit_id END) AS count,
             COUNT(DISTINCT CASE WHEN kind = 'skip'  THEN habit_id END) AS skipCount
      FROM habit_checks
      WHERE deleted_at IS NULL AND date >= ?
      GROUP BY date
    `).all(startStr) as Array<{ date: string; count: number; skipCount: number }>;

    const totalHabits = (db.prepare(
      'SELECT COUNT(*) AS c FROM habits WHERE deleted_at IS NULL'
    ).get() as { c: number }).c;

    const countMap = new Map<string, { count: number; skipCount: number }>();
    for (const row of rows) {
      countMap.set(row.date, { count: row.count, skipCount: row.skipCount });
    }

    const result: Array<{ date: string; count: number; skipCount: number }> = [];
    const d = new Date(startDate);
    for (let i = 0; i < days; i++) {
      const ds = formatDateString(d);
      const hit = countMap.get(ds);
      result.push({ date: ds, count: hit?.count ?? 0, skipCount: hit?.skipCount ?? 0 });
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

    // `kind = 'check'` matters: habit_checks also stores 'skip' rows, and a
    // skipped day painted gold (and counted into the record) would turn the
    // escape hatch into a way to fake a streak.
    const rows = db.prepare(
      "SELECT date FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND kind = 'check' AND date >= ?"
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
      "SELECT date FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND kind = 'check' ORDER BY date ASC"
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

  // `specificDays` (ISO 1=Mon..7=Sun) and `timesPerWeek` are mutually exclusive
  // ways to express a weekly habit: storing days pins times_per_week to their
  // count so any reader that ignores the new column still sees a sane target.
  ipcHandle('quests:addHabit', (_e, habit: { name: string; frequency: string; timesPerWeek: number; specificDays?: number[] | null }) => {
    const db = getDb();
    const id = genId();
    const now = new Date().toISOString();
    const days = habit.frequency === 'weekly' ? serializeSpecificDays(habit.specificDays) : null;
    const times = days ? days.split(',').length : habit.timesPerWeek;
    db.prepare('INSERT INTO habits (id, name, frequency, times_per_week, specific_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, habit.name, habit.frequency, times, days, now, now);
    return id;
  });

  ipcHandle('quests:updateHabit', (_e, id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number; specificDays?: number[] | null }) => {
    const db = getDb();
    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.frequency !== undefined) { fields.push('frequency = ?'); values.push(updates.frequency); }
    if (updates.specificDays !== undefined) {
      const days = updates.frequency === 'weekly' ? serializeSpecificDays(updates.specificDays) : null;
      fields.push('specific_days = ?'); values.push(days);
      // Choosing days wins over the stepper; clearing them hands control back.
      if (days) { fields.push('times_per_week = ?'); values.push(days.split(',').length); }
      else if (updates.timesPerWeek !== undefined) { fields.push('times_per_week = ?'); values.push(updates.timesPerWeek); }
    } else if (updates.timesPerWeek !== undefined) {
      fields.push('times_per_week = ?'); values.push(updates.timesPerWeek);
    }
    // Leaving chosen days behind on a habit that is no longer weekly means they
    // silently resurrect the day it becomes weekly again.
    if (updates.frequency !== undefined && updates.frequency !== 'weekly') {
      fields.push('specific_days = NULL');
    }
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

  ipcHandle('quests:checkHabit', (_e, habitId: string) => toggleHabitCheck(getDb(), habitId, todayDateString()));

  ipcHandle('quests:checkHabitForDate', (_e, habitId: string, date: string) => {
    const yesterday = yesterdayDateString();
    if (date !== yesterday) {
      throw new Error(`Retroactive check only allowed for yesterday (${yesterday}), got: ${date}`);
    }
    return toggleHabitCheck(getDb(), habitId, date);
  });

  /**
   * Toggles "skip this day" — the flu/travel escape hatch.
   *
   * A skip is a `habit_checks` row with `kind = 'skip'`: it respects the
   * existing UNIQUE(habit_id, date), rides the sync path already in place, and
   * the streak walk bridges over it. It is NOT a completion: no XP, it doesn't
   * count towards the period (it lowers the bar instead), and the heatmap gives
   * it a neutral tone.
   */
  ipcHandle('quests:skipHabit', (_e, habitId: string, date?: string) => {
    const db = getDb();
    const day = date || todayDateString();
    const now = new Date().toISOString();
    return db.transaction(() => {
      const existing = db.prepare(
        'SELECT id, kind, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?'
      ).get(habitId, day) as { id: string; kind: string | null; deleted_at: string | null } | undefined;

      if (existing && !existing.deleted_at && existing.kind === 'skip') {
        db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id);
        return { skipped: false };
      }
      if (existing) {
        db.prepare("UPDATE habit_checks SET kind = 'skip', deleted_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, existing.id);
        return { skipped: true };
      }
      db.prepare("INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at) VALUES (?, ?, ?, 'skip', ?, ?)")
        .run(genId(), habitId, day, now, now);
      return { skipped: true };
    })();
  });
}
