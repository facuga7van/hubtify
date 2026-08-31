import type Database from 'better-sqlite3';
import { getPlayerStats } from '../ipc/rpg-stats';
import { computeHabits } from './quests.habits';
import { computeMonthlyBalance } from './finance.balance';
import type { SylSnapshot } from '../../shared/types';

/**
 * Options for building the Syl read-projection snapshot.
 * All time inputs are injected (never `Date.now()`/`new Date()` inside the pure
 * function) so the snapshot is fully deterministic and unit-testable.
 */
export interface BuildSylSnapshotOpts {
  /** ISO-8601 UTC timestamp of the push (goes to `computedAt`). */
  now: string;
  /** Local day (YYYY-MM-DD) used for every "today" derivation. */
  computedForDate: string;
  /** App version string (e.g. from `app.getVersion()`). */
  appVersion: string;
}

const RECENT_LIMIT = 20;

/** Whole-days between two YYYY-MM-DD strings (parsed as UTC to avoid DST drift). */
function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function buildPlayer(db: Database.Database): SylSnapshot['player'] {
  const s = getPlayerStats(db);
  return {
    level: s.level,
    xp: s.xp,
    xpToNextLevel: s.xpToNextLevel,
    hp: s.hp,
    maxHp: s.maxHp,
    title: s.title,
    streak: s.streak,
    totalTasks: s.totalTasks,
    totalMeals: s.totalMeals,
    totalExpenses: s.totalExpenses,
  };
}

function buildQuestify(db: Database.Database, computedForDate: string): SylSnapshot['questify'] {
  // ── Habits: reuse the exact same derivation as the UI handler ──
  const habitRows = computeHabits(db, new Date(`${computedForDate}T00:00:00`));
  const habits = habitRows.map((h) => ({
    id: h.id,
    name: h.name,
    frequency: h.frequency,
    timesPerWeek: h.timesPerWeek,
    checkedToday: h.checkedToday,
    checksThisPeriod: h.checksThisPeriod,
    targetThisPeriod: h.targetThisPeriod,
    streak: h.streak,
    pendingToday: h.checksThisPeriod < h.targetThisPeriod,
  }));
  const habitsPendingToday = habits
    .filter((h) => h.pendingToday)
    .map((h) => ({
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      remaining: h.targetThisPeriod - h.checksThisPeriod,
    }));

  // ── Active tasks (status=0, not deleted) ──
  const activeTasks = db.prepare(`
    SELECT id, name, tier, category,
           project_id AS projectId, due_date AS dueDate, created_at AS createdAt
    FROM tasks
    WHERE status = 0 AND deleted_at IS NULL
    ORDER BY task_order ASC
  `).all() as Array<{
    id: string; name: string; tier: number; category: string;
    projectId: string | null; dueDate: string | null; createdAt: string;
  }>;

  // Batch-load non-deleted subtasks for those active tasks
  const subtasksByTask = new Map<string, Array<{ id: string; name: string; tier: number; status: boolean }>>();
  if (activeTasks.length > 0) {
    const placeholders = activeTasks.map(() => '?').join(',');
    const subRows = db.prepare(`
      SELECT id, task_id AS taskId, name, tier, status
      FROM subtasks
      WHERE task_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY subtask_order ASC
    `).all(...activeTasks.map((t) => t.id)) as Array<{
      id: string; taskId: string; name: string; tier: number; status: number;
    }>;
    for (const s of subRows) {
      let list = subtasksByTask.get(s.taskId);
      if (!list) { list = []; subtasksByTask.set(s.taskId, list); }
      list.push({ id: s.id, name: s.name, tier: s.tier, status: !!s.status });
    }
  }

  const tasksActive = activeTasks.map((t) => {
    const subtasks = subtasksByTask.get(t.id) ?? [];
    const done = subtasks.filter((s) => s.status).length;
    return {
      id: t.id,
      name: t.name,
      tier: t.tier,
      category: t.category,
      projectId: t.projectId,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      subtaskProgress: { done, total: subtasks.length },
      subtasks,
    };
  });

  // ── Overdue quests: dueDate < computedForDate, still open ──
  const overdueRows = db.prepare(`
    SELECT id, name, tier, due_date AS dueDate
    FROM tasks
    WHERE status = 0 AND deleted_at IS NULL
      AND due_date IS NOT NULL AND due_date < ?
    ORDER BY due_date ASC
  `).all(computedForDate) as Array<{ id: string; name: string; tier: number; dueDate: string }>;

  const questsOverdue = overdueRows.map((q) => ({
    id: q.id,
    name: q.name,
    tier: q.tier,
    dueDate: q.dueDate,
    daysOverdue: daysBetween(q.dueDate, computedForDate),
  }));

  return {
    habits,
    habitsPendingToday,
    tasksActive,
    questsOverdue,
    counts: {
      habitsTotal: habits.length,
      habitsPending: habitsPendingToday.length,
      tasksActive: tasksActive.length,
      tasksOverdue: questsOverdue.length,
    },
  };
}

function buildNutrify(db: Database.Database, computedForDate: string): SylSnapshot['nutrify'] {
  const summary = db.prepare(
    'SELECT total_calories_in AS totalCaloriesIn, tdee, balance FROM nutrition_daily_summary WHERE date = ?'
  ).get(computedForDate) as { totalCaloriesIn: number; tdee: number; balance: number } | undefined;

  const profile = db.prepare(
    'SELECT sex, activity_level AS activityLevel, deficit_target_kcal AS deficitTargetKcal FROM nutrition_profile WHERE id = 1'
  ).get() as { sex: string; activityLevel: string; deficitTargetKcal: number } | undefined;

  let todayCalories: number;
  if (summary) {
    todayCalories = summary.totalCaloriesIn;
  } else {
    const row = db.prepare(
      'SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL'
    ).get(computedForDate) as { total: number };
    todayCalories = row.total;
  }

  const todayTarget = summary && profile ? summary.tdee - profile.deficitTargetKcal : null;
  const todayBalance = summary ? summary.balance : null;

  const recentFoodLog = db.prepare(`
    SELECT date, time, description, calories, meal
    FROM food_log
    WHERE deleted_at IS NULL
    ORDER BY date DESC, time DESC
    LIMIT ?
  `).all(RECENT_LIMIT) as Array<{ date: string; time: string; description: string; calories: number; meal: string | null }>;

  const profileSummary = profile
    ? { sex: profile.sex, activityLevel: profile.activityLevel, deficitTargetKcal: profile.deficitTargetKcal }
    : null;

  return { todayCalories, todayTarget, todayBalance, recentFoodLog, profileSummary };
}

function buildCoinify(db: Database.Database, computedForDate: string): SylSnapshot['coinify'] {
  const month = computedForDate.slice(0, 7);

  const emptyCcy = (): { ARS: number; USD: number } => ({ ARS: 0, USD: 0 });

  const sumSpend = (rows: Array<{ currency: string; total: number }>): { ARS: number; USD: number } => {
    const out = emptyCcy();
    for (const r of rows) {
      if (r.currency === 'ARS' || r.currency === 'USD') out[r.currency] = r.total;
    }
    return out;
  };

  // todaySpend: expenses, impacts balance, for computedForDate
  const todayRows = db.prepare(`
    SELECT currency, COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    WHERE deleted_at IS NULL AND type = 'expense' AND impacts_balance = 1 AND date = ?
    GROUP BY currency
  `).all(computedForDate) as Array<{ currency: string; total: number }>;

  // monthSpend: same, current month
  const monthRows = db.prepare(`
    SELECT currency, COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    WHERE deleted_at IS NULL AND type = 'expense' AND impacts_balance = 1 AND date LIKE ?
    GROUP BY currency
  `).all(`${month}%`) as Array<{ currency: string; total: number }>;

  // monthBalance: income - expense for the CURRENT month, impacts balance only.
  // Reuses the exact same rule as the `finance:getMonthlyBalance` handler so the
  // snapshot never drifts from what the app shows (the app has no all-time balance).
  const mb = computeMonthlyBalance(db, month);
  const monthBalance = { ARS: mb.ARS.balance, USD: mb.USD.balance };

  const recentTransactions = db.prepare(`
    SELECT id, type, amount, currency, category, description, date
    FROM finance_transactions
    WHERE deleted_at IS NULL
    ORDER BY date DESC, created_at DESC
    LIMIT ?
  `).all(RECENT_LIMIT) as Array<{
    id: string; type: string; amount: number; currency: string;
    category: string; description: string; date: string;
  }>;

  return {
    todaySpend: sumSpend(todayRows),
    monthSpend: sumSpend(monthRows),
    monthBalance,
    recentTransactions,
  };
}

/**
 * Builds the complete Syl read-projection snapshot from local SQLite.
 *
 * PURE + deterministic: no `Date.now()`/`new Date()` for "today" — everything is
 * derived from `opts`. Reuses existing derivations (player stats, habit periods)
 * rather than reimplementing business rules. All output is camelCase, with
 * `deleted_at != null` rows already filtered out (contract invariants).
 */
export function buildSylSnapshot(db: Database.Database, opts: BuildSylSnapshotOpts): SylSnapshot {
  return {
    schemaVersion: 1,
    computedAt: opts.now,
    computedForDate: opts.computedForDate,
    appVersion: opts.appVersion,
    player: buildPlayer(db),
    questify: buildQuestify(db, opts.computedForDate),
    nutrify: buildNutrify(db, opts.computedForDate),
    coinify: buildCoinify(db, opts.computedForDate),
  };
}
