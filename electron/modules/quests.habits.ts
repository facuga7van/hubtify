import type Database from 'better-sqlite3';
import { formatDateString } from '../../shared/date-utils';

export interface HabitWithStreakRow {
  id: string;
  name: string;
  frequency: string;
  timesPerWeek: number;
  createdAt: string;
  streak: number;
  checkedToday: boolean;
  checkedYesterday: boolean;
  checksThisPeriod: number;
  targetThisPeriod: number;
}

/**
 * A weekly habit must be checked between 1 and 7 times a week. The local UI can't
 * produce anything else, but the sync path accepts whatever the remote sends.
 */
export function weeklyTarget(timesPerWeek: unknown): number {
  const n = typeof timesPerWeek === 'number' && Number.isFinite(timesPerWeek) ? Math.round(timesPerWeek) : 1;
  return Math.max(1, Math.min(7, n || 1));
}

/**
 * Computes habits with their streak/period stats for a given "today" date.
 *
 * Extracted from the `quests:getHabits` handler so the exact same derivation
 * (weekly Monday-based periods, monthly periods, streak counting) is reused by
 * both the UI handler and the Syl snapshot builder — never duplicated.
 *
 * `today` is injected (not `new Date()`) so callers stay deterministic/testable.
 */
export function computeHabits(db: Database.Database, today: Date): HabitWithStreakRow[] {
  const todayStr = formatDateString(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = formatDateString(yesterday);

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
      targetThisPeriod = weeklyTarget(h.timesPerWeek);
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
        const d = new Date(today); d.setDate(today.getDate() - 1); return formatDateString(d);
      })();
      if (!checkedToday) {
        const y = new Date(today); y.setDate(today.getDate() - 1);
        if (!dates.has(formatDateString(y))) {
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
      // `target` is clamped: a habit with times_per_week = 0 (only reachable via the
      // sync path / an external writer like Syl) makes `count < target` never true,
      // and this loop would spin forever, hanging the whole main process.
      const target = weeklyTarget(h.timesPerWeek);
      const currentMet = checksThisPeriod >= target;
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
        // Second guard: an empty week always terminates the walk, regardless of target.
        if (count === 0 || count < target) break;
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
}
