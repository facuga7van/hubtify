import type Database from 'better-sqlite3';
import { xpThreshold } from '../../shared/rpg-engine';
import type { PlayerStats } from '../../shared/types';

/**
 * Pure player-stats helpers, extracted from rpg-handlers so they can be reused
 * by both the `rpg:getStats` IPC handler and the Syl snapshot builder without
 * dragging Electron imports into testable code.
 */

export function defaultStats(): PlayerStats {
  return {
    userId: 'default', level: 1, xp: 0, xpToNextLevel: xpThreshold(2),
    hp: 100, maxHp: 100, title: 'Campesino', streak: 0, dailyCombo: 0,
    comboDate: null, streakLastDate: null, totalTasks: 0, totalMeals: 0, totalExpenses: 0,
  };
}

export function rowToStats(row: Record<string, unknown>): PlayerStats {
  const xp = row.xp as number;
  const level = row.level as number;
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
  };
}

/** Reads the single-player stats row (user_id='default'), falling back to defaults. */
export function getPlayerStats(db: Database.Database): PlayerStats {
  const row = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, unknown> | undefined;
  return row ? rowToStats(row) : defaultStats();
}
