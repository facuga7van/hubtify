import type Database from 'better-sqlite3';
import { xpThreshold, monthKey, pardonsRemaining, getLocalDateString, MAX_VIGOR } from '../../shared/rpg-engine';
import type { PlayerStats } from '../../shared/types';

/**
 * Pure player-stats helpers, extracted from rpg-handlers so they can be reused
 * by both the `rpg:getStats` IPC handler and the Syl snapshot builder without
 * dragging Electron imports into testable code.
 */

/** Fase-1 fields folded into PlayerStats (shared/types.ts); alias kept for internal call sites. */
export type PlayerStatsV2 = PlayerStats;

export function defaultStats(): PlayerStatsV2 {
  return {
    userId: 'default', level: 1, xp: 0, xpToNextLevel: xpThreshold(2),
    hp: MAX_VIGOR, maxHp: 100, title: 'Campesino', streak: 0, dailyCombo: 0,
    comboDate: null, streakLastDate: null, totalTasks: 0, totalMeals: 0, totalExpenses: 0,
    hpDate: null, pardonsMonth: null, pardonsUsed: 0,
    pardonsRemaining: pardonsRemaining(null, 0, monthKey(getLocalDateString())),
    bestStreak: 0, innSince: null,
  };
}

export function rowToStats(row: Record<string, unknown>, today = getLocalDateString()): PlayerStatsV2 {
  const xp = row.xp as number;
  const level = row.level as number;
  const pardonsMonth = (row.pardons_month as string | null) ?? null;
  const pardonsUsed = (row.pardons_used as number | null) ?? 0;
  return {
    userId: row.user_id as string,
    level,
    xp,
    xpToNextLevel: xpThreshold(level + 1) - xp,
    hp: row.hp as number,
    maxHp: row.max_hp as number,
    title: row.title as string,
    streak: row.streak as number,
    dailyCombo: row.daily_combo as number,
    comboDate: row.combo_date as string | null,
    streakLastDate: row.streak_last_date as string | null,
    totalTasks: row.total_tasks as number,
    totalMeals: row.total_meals as number,
    totalExpenses: row.total_expenses as number,
    hpDate: (row.hp_date as string | null) ?? null,
    pardonsMonth,
    pardonsUsed,
    // Month-rolled on read: the stored counter is stale as soon as the month
    // turns, and nothing writes to player_stats until the next event.
    pardonsRemaining: pardonsRemaining(pardonsMonth, pardonsUsed, monthKey(today)),
    bestStreak: (row.best_streak as number | null) ?? 0,
    innSince: (row.inn_since as string | null) ?? null,
  };
}

/**
 * Vigor rollover: a new local day always starts at full HP.
 *
 * HP is the state of TODAY, not a debt. Called lazily — at the start of every
 * event and by `rpg:getStats` — so the sidebar shows 100 in the morning without
 * waiting for the player to do something. Idempotent, and a no-op within a day.
 *
 * NOT called from `getPlayerStats`: the Syl snapshot reads through that path and
 * must stay side-effect free.
 */
export function rolloverVigor(db: Database.Database, today = getLocalDateString()): void {
  db.prepare(
    `UPDATE player_stats SET hp = ?, hp_date = ?
     WHERE user_id = 'default' AND (hp_date IS NULL OR hp_date <> ?)`
  ).run(MAX_VIGOR, today, today);
}

/** Reads the single-player stats row (user_id='default'), falling back to defaults. */
export function getPlayerStats(db: Database.Database): PlayerStatsV2 {
  const row = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, unknown> | undefined;
  return row ? rowToStats(row) : defaultStats();
}
