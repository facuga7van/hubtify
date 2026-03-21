import { ipcMain } from 'electron';
import { getDb, runModuleMigrations } from './db';
import {
  xpThreshold,
  getLevel,
  getTitle,
  getComboMultiplier,
  rollRandomBonus,
  calculateXpGain,
  clampHp,
  getStreakMilestoneBonus,
  getLocalDateString,
  daysDiff,
} from '../../shared/rpg-engine';
import type { PlayerStats, RpgEvent, RpgEventRecord } from '../../shared/types';

function defaultStats(): PlayerStats {
  return {
    userId: 'default', level: 1, xp: 0, xpToNextLevel: xpThreshold(2),
    hp: 100, maxHp: 100, title: 'Campesino', streak: 0, dailyCombo: 0,
    comboDate: null, streakLastDate: null, totalTasks: 0, totalMeals: 0, totalExpenses: 0,
  };
}

function rowToStats(row: Record<string, unknown>): PlayerStats {
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

export function registerRpgHandlers(): void {
  ipcMain.handle('rpg:getStats', (): PlayerStats => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, unknown>;
    return row ? rowToStats(row) : defaultStats();
  });

  ipcMain.handle('rpg:processEvent', (_e, event: RpgEvent) => {
    const db = getDb();
    const stats = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, unknown>;
    const today = getLocalDateString();

    let xpGained = 0;
    let hpChange = 0;
    let comboMultiplier = 1.0;
    let bonusMultiplier = 1.0;

    try {
      let combo = (stats.daily_combo as number) || 0;
      if ((stats.combo_date as string | null) !== today) combo = 0;

      comboMultiplier = getComboMultiplier(combo);
      bonusMultiplier = rollRandomBonus();

      const payload = event.payload as Record<string, unknown> | null;
      const baseXp = (payload && typeof payload.xp === 'number') ? payload.xp : 0;
      hpChange = (payload && typeof payload.hp === 'number') ? payload.hp : 0;

      xpGained = Math.round(calculateXpGain(baseXp, comboMultiplier, bonusMultiplier, stats.hp as number) * 100) / 100;

      const newHp = clampHp((stats.hp as number) + hpChange);
      const oldLevel = stats.level as number;

      let streak = stats.streak as number;
      const lastDate = stats.streak_last_date as string | null;
      if (lastDate !== today) {
        if (lastDate) {
          const diff = daysDiff(lastDate, today);
          streak = diff === 1 ? streak + 1 : 1;
        } else {
          streak = 1;
        }
      }

      const milestoneXp = getStreakMilestoneBonus(streak);
      const totalXpGained = xpGained + milestoneXp;
      const finalXp = Math.max(0, (stats.xp as number) + totalXpGained);
      const finalLevel = getLevel(finalXp);
      const finalTitle = getTitle(finalLevel);

      db.prepare(`
        INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(event.moduleId, event.type, totalXpGained, hpChange, comboMultiplier, bonusMultiplier, JSON.stringify(event.payload));

      db.prepare(`
        UPDATE player_stats SET
          level = ?, xp = ?, hp = ?, title = ?,
          streak = ?, daily_combo = ?, combo_date = ?, streak_last_date = ?
        WHERE user_id = ?
      `).run(finalLevel, finalXp, newHp, finalTitle, streak, combo + 1, today, today, 'default');

      // After the main UPDATE, increment module counters
      const counterMap: Record<string, string> = {
        'TASK_COMPLETED': 'total_tasks',
        'SUBTASK_COMPLETED': 'total_tasks',
        'MEAL_LOGGED': 'total_meals',
        'EXPENSE_TRACKED': 'total_expenses',
        'LOAN_SETTLED': 'total_expenses',
      };
      const counterCol = counterMap[event.type];
      if (counterCol) {
        db.prepare(`UPDATE player_stats SET ${counterCol} = ${counterCol} + 1 WHERE user_id = ?`).run('default');
      }

      return {
        xpGained: totalXpGained,
        hpChange,
        leveledUp: finalLevel > oldLevel,
        newTitle: finalTitle !== (stats.title as string) ? finalTitle : null,
        milestoneXp,
      };
    } catch (err) {
      console.error(`[RPG] Error processing event "${event.type}":`, err);
      db.prepare(`
        INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload)
        VALUES (?, ?, 0, 0, 1.0, 1.0, ?)
      `).run(event.moduleId, event.type, JSON.stringify(event.payload));
      return { xpGained: 0, hpChange: 0, leveledUp: false, newTitle: null, milestoneXp: 0 };
    }
  });

  ipcMain.handle('rpg:getHistory', (_e, limit: number): RpgEventRecord[] => {
    const db = getDb();
    return db.prepare(
      `SELECT id, module_id AS moduleId, event_type AS eventType,
              xp_gained AS xpGained, hp_change AS hpChange,
              combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
              payload, created_at AS createdAt
       FROM rpg_events ORDER BY id DESC LIMIT ?`
    ).all(limit) as RpgEventRecord[];
  });

  ipcMain.handle('db:runMigrations', (_e, migrations) => {
    runModuleMigrations(migrations);
  });
}
