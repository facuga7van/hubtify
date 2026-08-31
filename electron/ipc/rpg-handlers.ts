import type Database from 'better-sqlite3';
import { getDb } from './db';
import { ipcHandle } from './ipc-handle';
import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import {
  getLevel,
  getTitle,
  getComboMultiplier,
  rollRandomBonus,
  calculateXpGain,
  clampHp,
  getStreakMilestoneBonus,
  getLocalDateString,
  daysDiff,
  monthKey,
  pardonsRemaining,
} from '../../shared/rpg-engine';
import type { RpgEvent, RpgEventRecord } from '../../shared/types';
import { todayDateString, localTimestamp, daysAgoDateString, nextDateString, formatDateString } from '../../shared/date-utils';
import { getPlayerStats, rolloverVigor, type PlayerStatsV2 } from './rpg-stats';

/**
 * Hard bounds for anything arriving from the renderer (or, via sync, from an
 * external writer). Without them a single `{xp: -99999}` event permanently
 * poisons `rpg:getDashboardStats` with a negative `xpToday`.
 */
const MAX_EVENT_XP = 500;
const MAX_EVENT_HP = 100;

function clampNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

/**
 * Which payload field identifies the entity, per completion event type.
 * Values are fixed literals (never interpolated from user input) so they are
 * safe to inline into SQL.
 */
const REF_FIELD_BY_TYPE: Record<string, string> = {
  TASK_COMPLETED: '$.taskId',
  SUBTASK_COMPLETED: '$.subtaskId',
  HABIT_CHECKED: '$.habitId',
  TASK_UNCOMPLETED: '$.taskId',
  SUBTASK_UNCOMPLETED: '$.subtaskId',
  HABIT_UNCHECKED: '$.habitId',
};

/** The entity id an event refers to — persisted to rpg_events.ref_id on insert. */
function extractRefId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const candidate = payload.taskId ?? payload.subtaskId ?? payload.habitId;
  return typeof candidate === 'string' ? candidate : null;
}

export interface RpgEventResult {
  xpGained: number;
  hpChange: number;
  leveledUp: boolean;
  newTitle: string | null;
  milestoneXp: number;
  comboMultiplier: number;
  bonusMultiplier: number;
  /** True when this event spent one of the month's streak pardons. */
  pardonUsed: boolean;
}

/**
 * Event types that increment `player_stats.total_expenses`.
 *
 * The first two are the LEGACY names this branch used to match — no module has
 * ever emitted them, so the counter was dead. The real handler names declared in
 * `src/modules/finance/index.ts` are EXPENSE_LOGGED / INCOME_LOGGED /
 * LOAN_SETTLED / STATEMENT_IMPORTED / RECURRING_UPDATED; the ones that represent
 * a logged movement are accepted here already, so wiring Coinify to the RPG bus
 * in phase 2 is purely a renderer-side `processRpgEvent()` call.
 *
 * STATEMENT_IMPORTED and RECURRING_UPDATED are deliberately NOT counted: they are
 * bulk/config actions, not individual movements.
 */
const FINANCE_COUNTED_EVENTS = new Set([
  'EXPENSE_TRACKED', // legacy, never emitted
  'LOAN_SETTLED',
  'EXPENSE_LOGGED',
  'INCOME_LOGGED',
]);

/** The day BEFORE a YYYY-MM-DD date (noon anchor, so DST can never shift it). */
function previousDateString(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return formatDateString(d);
}

/** Neutral result, returned when the event could not be processed. */
const EMPTY_RESULT: RpgEventResult = {
  xpGained: 0, hpChange: 0, leveledUp: false, newTitle: null,
  milestoneXp: 0, comboMultiplier: 1.0, bonusMultiplier: 1.0, pardonUsed: false,
};

/**
 * Checks the player in/out of the Inn (holiday mode).
 *
 * Model: `inn_since` — a start date, switched off MANUALLY (not an `inn_until`
 * deadline). A holiday that ends by itself on a date picked in advance is just
 * another deadline to miss; this one ends when the player says so.
 *
 * While resting, events still pay full XP (using the app on holiday is neither
 * punished nor blocked) but the streak neither advances nor breaks. On check-out
 * `streak_last_date` is rewound to YESTERDAY, so the first day back continues the
 * streak exactly where it was — which also means the rest days never consume a
 * pardon, and no milestone is re-paid (`last_milestone_streak` is untouched).
 */
export function setInnMode(db: Database.Database, on: boolean, today = getLocalDateString()): { innSince: string | null } {
  const row = db.prepare('SELECT inn_since, streak_last_date FROM player_stats WHERE user_id = ?').get('default') as
    { inn_since: string | null; streak_last_date: string | null } | undefined;
  if (!row) return { innSince: null };

  if (on) {
    // Already resting: keep the original check-in date.
    if (row.inn_since) return { innSince: row.inn_since };
    db.prepare("UPDATE player_stats SET inn_since = ? WHERE user_id = 'default'").run(today);
    return { innSince: today };
  }

  if (!row.inn_since) return { innSince: null };
  // Only rewind when the player has not already acted today — otherwise a
  // check-in/check-out round trip on the same day would let the streak tick twice.
  const shouldRewind = row.streak_last_date !== today;
  if (shouldRewind) {
    db.prepare("UPDATE player_stats SET inn_since = NULL, streak_last_date = ? WHERE user_id = 'default'")
      .run(previousDateString(today));
  } else {
    db.prepare("UPDATE player_stats SET inn_since = NULL WHERE user_id = 'default'").run();
  }
  return { innSince: null };
}

/**
 * Applies one RPG event to `player_stats` and appends it to `rpg_events`.
 *
 * Extracted from the `rpg:processEvent` handler (same reasoning as rpg-stats.ts)
 * so the XP/streak/undo rules can be tested against an in-memory database without
 * an Electron main process.
 */
export function processRpgEvent(db: Database.Database, event: RpgEvent): RpgEventResult {
    const isUndo = event.type === 'TASK_UNCOMPLETED' || event.type === 'SUBTASK_UNCOMPLETED' || event.type === 'HABIT_UNCHECKED';

    const processTransaction = db.transaction(() => {
      const today = getLocalDateString();
      // Vigor first: a new day always starts at 100 HP, BEFORE this event's delta
      // is applied. The bad day died with the day.
      rolloverVigor(db, today);

      const stats = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default') as Record<string, unknown>;

      const payload = event.payload as Record<string, unknown> | null;
      const baseXp = clampNumber(payload?.xp, -MAX_EVENT_XP, MAX_EVENT_XP);
      const hpChange = clampNumber(payload?.hp, -MAX_EVENT_HP, MAX_EVENT_HP);

      let xpGained: number;
      let comboMultiplier = 1.0;
      let bonusMultiplier = 1.0;
      let streak = stats.streak as number;
      let combo = (stats.daily_combo as number) || 0;
      let milestoneXp = 0;
      let lastMilestoneStreak = (stats.last_milestone_streak as number) ?? 0;
      // Only a real, XP-bearing action advances the combo/streak bookkeeping.
      let advancesProgress = false;

      // ── Streak pardons (2 per calendar month, lazily rolled) ──
      const month = monthKey(today);
      const storedPardonMonth = (stats.pardons_month as string | null) ?? null;
      let pardonsUsed = storedPardonMonth === month ? ((stats.pardons_used as number) ?? 0) : 0;
      let pardonUsed = false;

      let bestStreak = (stats.best_streak as number) ?? 0;
      // Inn (holiday) mode: XP flows normally, the streak is frozen.
      const innActive = !!(stats.inn_since as string | null);

      if (isUndo) {
        // Find the original completion event and reverse its exact XP.
        const undoMap: Record<string, string> = {
          'TASK_UNCOMPLETED': 'TASK_COMPLETED',
          'SUBTASK_UNCOMPLETED': 'SUBTASK_COMPLETED',
          'HABIT_UNCHECKED': 'HABIT_CHECKED',
        };
        const originalType = undoMap[event.type];
        const itemId = extractRefId(payload);

        let originalEvent: { id: number; xp_gained: number; created_at: string } | undefined;
        if (itemId && originalType) {
          // Match on ref_id (indexed, backfilled by the `core` v1 migration), with a
          // json_extract fallback for rows whose payload was not valid JSON.
          // The old `payload LIKE '%"<id>"%'` matched the id ANYWHERE in the JSON, so
          // un-completing task `abc` could revert (and delete) the event of a different
          // task that merely carried `projectId: "abc"`.
          const refField = REF_FIELD_BY_TYPE[originalType];
          originalEvent = db.prepare(`
            SELECT id, xp_gained, created_at FROM rpg_events
            WHERE event_type = ?
              AND (ref_id = ? OR (ref_id IS NULL AND json_extract(payload, '${refField}') = ?))
            ORDER BY id DESC LIMIT 1
          `).get(originalType, itemId, itemId) as typeof originalEvent;
        }

        if (originalEvent) {
          xpGained = -originalEvent.xp_gained;
          // Delete the original event from the log
          db.prepare('DELETE FROM rpg_events WHERE id = ?').run(originalEvent.id);
          // Decrement combo if it was from today
          const eventDate = originalEvent.created_at.slice(0, 10);
          if (eventDate === today && combo > 0) {
            combo = combo - 1;
          }
        } else {
          // Nothing to reverse. Callers pass an ALREADY-NEGATIVE baseXp, so falling
          // back to it here would deduct the XP a second time.
          xpGained = 0;
        }
      } else if (baseXp > 0) {
        advancesProgress = true;
        if ((stats.combo_date as string | null) !== today) combo = 0;
        comboMultiplier = getComboMultiplier(combo);
        bonusMultiplier = rollRandomBonus();
        // No HP term: low Vigor never shrinks a reward (see calculateXpGain).
        xpGained = Math.round(calculateXpGain(baseXp, comboMultiplier, bonusMultiplier) * 100) / 100;

        const lastDate = stats.streak_last_date as string | null;
        // While resting at the Inn the streak neither advances nor breaks; it is
        // resumed on check-out by rewinding streak_last_date to yesterday.
        if (lastDate !== today && !innActive) {
          const gap = lastDate ? daysDiff(lastDate, today) : Number.POSITIVE_INFINITY;
          if (gap === 1) {
            streak = streak + 1;
          } else if (gap === 2 && pardonsRemaining(storedPardonMonth, pardonsUsed, month) > 0) {
            // Exactly ONE missed day, and the month still has a pardon: the streak
            // continues as if the gap never happened — milestones included.
            // A gap > 2 falls normally; pardons do not stack.
            pardonsUsed = pardonsUsed + 1;
            pardonUsed = true;
            streak = streak + 1;
          } else {
            // Streak broken (or first ever action) — restart, and clear the
            // milestone watermark so future milestones can be earned again.
            streak = 1;
            lastMilestoneStreak = 0;
          }
          bestStreak = Math.max(bestStreak, streak);

          // Milestone bonuses live INSIDE this block: `streak` is constant for the
          // whole day, so computing them per-event paid 3/7/14/30/60/100-day bonuses
          // again on every task, habit, meal and expense of that day.
          // `last_milestone_streak` makes it once-ever-per-streak, which also blocks
          // the complete/uncomplete loop (undo refunds the bonus but never rewinds
          // the streak, so the same milestone could be farmed indefinitely).
          const bonus = getStreakMilestoneBonus(streak);
          if (bonus > 0 && streak > lastMilestoneStreak) {
            milestoneXp = bonus;
            lastMilestoneStreak = streak;
          }
        }
      } else {
        // Zero/negative-XP event (e.g. TASK_CREATED). It is logged, and its HP
        // delta still applies, but it must not inflate the daily combo multiplier
        // nor keep a streak alive.
        xpGained = 0;
      }

      const totalXpGained = xpGained + milestoneXp;
      const finalXp = Math.max(0, (stats.xp as number) + totalXpGained);
      const finalLevel = getLevel(finalXp);
      const finalTitle = getTitle(finalLevel);
      const newHp = clampHp((stats.hp as number) + hpChange);
      const oldLevel = stats.level as number;

      const now = localTimestamp();
      // Undo events: store 0 xp_gained in the log (the original event is already deleted,
      // so storing negative XP here would double-count the reversal in SUM queries)
      const loggedXp = isUndo ? 0 : totalXpGained;
      db.prepare(`
        INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.moduleId, event.type, loggedXp, hpChange, comboMultiplier, bonusMultiplier,
        JSON.stringify(event.payload), now, extractRefId(payload), crypto.randomUUID(),
      );

      if (isUndo) {
        db.prepare(`
          UPDATE player_stats SET level = ?, xp = ?, hp = ?, title = ?, daily_combo = ?
          WHERE user_id = ?
        `).run(finalLevel, finalXp, newHp, finalTitle, Math.max(0, combo), 'default');
      } else if (advancesProgress && innActive) {
        // Resting at the Inn: XP, level and the DAILY combo still move (the combo
        // belongs to the day, not to the streak). Streak columns stay frozen.
        db.prepare(`
          UPDATE player_stats SET
            level = ?, xp = ?, hp = ?, title = ?, daily_combo = ?, combo_date = ?
          WHERE user_id = ?
        `).run(finalLevel, finalXp, newHp, finalTitle, combo + 1, today, 'default');
      } else if (advancesProgress) {
        db.prepare(`
          UPDATE player_stats SET
            level = ?, xp = ?, hp = ?, title = ?,
            streak = ?, daily_combo = ?, combo_date = ?, streak_last_date = ?,
            last_milestone_streak = ?, best_streak = ?,
            pardons_month = ?, pardons_used = ?
          WHERE user_id = ?
        `).run(
          finalLevel, finalXp, newHp, finalTitle, streak, combo + 1, today, today,
          lastMilestoneStreak, Math.max(bestStreak, streak), month, pardonsUsed, 'default',
        );
      } else {
        db.prepare(`
          UPDATE player_stats SET level = ?, xp = ?, hp = ?, title = ?
          WHERE user_id = ?
        `).run(finalLevel, finalXp, newHp, finalTitle, 'default');
      }

      if (event.type === 'TASK_COMPLETED' || event.type === 'SUBTASK_COMPLETED') {
        db.prepare('UPDATE player_stats SET total_tasks = total_tasks + 1 WHERE user_id = ?').run('default');
      } else if (event.type === 'TASK_UNCOMPLETED' || event.type === 'SUBTASK_UNCOMPLETED') {
        db.prepare('UPDATE player_stats SET total_tasks = MAX(0, total_tasks - 1) WHERE user_id = ?').run('default');
      } else if (event.type === 'MEAL_LOGGED') {
        db.prepare('UPDATE player_stats SET total_meals = total_meals + 1 WHERE user_id = ?').run('default');
      } else if (FINANCE_COUNTED_EVENTS.has(event.type)) {
        db.prepare('UPDATE player_stats SET total_expenses = total_expenses + 1 WHERE user_id = ?').run('default');
      }

      return {
        xpGained: totalXpGained,
        hpChange,
        leveledUp: finalLevel > oldLevel,
        newTitle: finalTitle !== (stats.title as string) ? finalTitle : null,
        milestoneXp,
        comboMultiplier,
        bonusMultiplier,
        pardonUsed,
      };
    });

    try {
      const result = processTransaction();
      // Central broadcast: callers of processRpgEvent are scattered across four
      // modules; one listener in Layout turns this into the single, discreet
      // "se uso un indulto" toast instead of wiring every call site.
      if (result.pardonUsed) {
        // Defensive: under vitest the electron mock has no BrowserWindow, and at
        // real startup there may be no windows yet. The toast is a nicety — it
        // must never take the XP transaction down with it.
        try {
          for (const win of BrowserWindow?.getAllWindows?.() ?? []) {
            win.webContents.send('rpg:pardonUsed');
          }
        } catch { /* headless or test environment */ }
      }
      return result;
    } catch (err) {
      console.error(`[RPG] Error processing event "${event.type}":`, err);
      try {
        db.prepare(`
          INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
          VALUES (?, ?, 0, 0, 1.0, 1.0, ?, ?, ?, ?)
        `).run(
          event.moduleId, event.type, JSON.stringify(event.payload), localTimestamp(),
          extractRefId(event.payload as Record<string, unknown> | null), crypto.randomUUID(),
        );
      } catch { /* best effort logging */ }
      return { ...EMPTY_RESULT };
    }
}

export function registerRpgHandlers(): void {
  ipcHandle('rpg:getStats', (): PlayerStatsV2 => {
    const db = getDb();
    // Normalise Vigor on READ too, so the sidebar shows 100 first thing in the
    // morning instead of yesterday's leftovers waiting for an event.
    rolloverVigor(db);
    return getPlayerStats(db);
  });

  ipcHandle('rpg:processEvent', (_e, event: RpgEvent) => processRpgEvent(getDb(), event));

  /** Check in/out of the Inn (holiday mode). Returns the resulting state. */
  ipcHandle('rpg:setInnMode', (_e, on: boolean) => setInnMode(getDb(), !!on));

  ipcHandle('rpg:getHistory', (_e, limit: number): RpgEventRecord[] => {
    const db = getDb();
    return db.prepare(
      `SELECT id, module_id AS moduleId, event_type AS eventType,
              xp_gained AS xpGained, hp_change AS hpChange,
              combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
              payload, created_at AS createdAt
       FROM rpg_events ORDER BY id DESC LIMIT ?`
    ).all(limit) as RpgEventRecord[];
  });

  ipcHandle('rpg:getDashboardStats', () => {
    const db = getDb();
    const today = todayDateString();
    // Half-open [today, tomorrow) range instead of DATE(created_at) = ?: wrapping the
    // column in a function makes idx_rpg_events_created_at unusable. created_at is a
    // sortable 'YYYY-MM-DD HH:MM:SS' local timestamp, so plain string comparison works.
    const tomorrow = nextDateString(today);

    // XP gained today
    const xpToday = db.prepare(
      'SELECT COALESCE(SUM(xp_gained), 0) AS total FROM rpg_events WHERE created_at >= ? AND created_at < ?'
    ).get(today, tomorrow) as { total: number };

    // XP per day for last 7 days
    const sixDaysAgo = daysAgoDateString(6);
    const xpHistory = db.prepare(`
      SELECT substr(created_at, 1, 10) AS date, COALESCE(SUM(xp_gained), 0) AS xp
      FROM rpg_events
      WHERE created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).all(sixDaysAgo) as Array<{ date: string; xp: number }>;

    // Events today count
    const eventsToday = db.prepare(
      'SELECT COUNT(*) AS count FROM rpg_events WHERE created_at >= ? AND created_at < ?'
    ).get(today, tomorrow) as { count: number };

    return {
      xpToday: xpToday.total,
      xpHistory,
      eventsToday: eventsToday.count,
    };
  });

  ipcHandle('sync:restoreStats', (_e, stats: Record<string, unknown>) => restorePlayerStats(getDb(), stats));
}

/**
 * Applies a remote `playerStats` document over the local row.
 *
 * Extracted from the `sync:restoreStats` handler so the sanitising rules — most
 * of all the phase-1 columns, which older payloads simply do not carry — can be
 * exercised against an in-memory database.
 */
export function restorePlayerStats(db: Database.Database, stats: Record<string, unknown>): { success: boolean } {
    try {
      // Everything here comes off the wire. Level/title are DERIVED from xp rather
      // than trusted, so a corrupt remote can never produce a negative
      // `xpToNextLevel` (xpThreshold(level+1) - xp) that sticks forever.
      const maxHp = Math.max(1, Math.round(clampNumber(stats.maxHp ?? stats.max_hp ?? 100, 1, 1000)) || 100);
      const xp = Math.max(0, Math.round(clampNumber(stats.xp ?? 0, 0, Number.MAX_SAFE_INTEGER)));
      const hp = Math.max(0, Math.min(maxHp, Math.round(clampNumber(stats.hp ?? 100, 0, maxHp))));
      const level = getLevel(xp);
      const title = typeof stats.title === 'string' && stats.title ? stats.title : getTitle(level);
      const streak = Math.max(0, Math.round(clampNumber(stats.streak ?? 0, 0, 100000)));
      const dailyCombo = Math.max(0, Math.round(clampNumber(stats.dailyCombo ?? stats.daily_combo ?? 0, 0, 10000)));
      const totalTasks = Math.max(0, Math.round(clampNumber(stats.totalTasks ?? stats.total_tasks ?? 0, 0, Number.MAX_SAFE_INTEGER)));
      const totalMeals = Math.max(0, Math.round(clampNumber(stats.totalMeals ?? stats.total_meals ?? 0, 0, Number.MAX_SAFE_INTEGER)));
      const totalExpenses = Math.max(0, Math.round(clampNumber(stats.totalExpenses ?? stats.total_expenses ?? 0, 0, Number.MAX_SAFE_INTEGER)));

      // ── Phase-1 fields. A payload written by an older build (or by Syl) has
      // none of them; every branch below degrades to a sane default rather than
      // throwing or writing NULL into a NOT NULL column.
      const today = getLocalDateString();
      const asDate = (v: unknown): string | null =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      // The restored HP belongs to whatever day the remote says; with no date it
      // is treated as today's Vigor (the next local morning resets it anyway).
      const hpDate = asDate(stats.hpDate ?? stats.hp_date) ?? today;
      const pardonsMonth = typeof stats.pardonsMonth === 'string' && /^\d{4}-\d{2}$/.test(stats.pardonsMonth)
        ? stats.pardonsMonth
        : (typeof stats.pardons_month === 'string' && /^\d{4}-\d{2}$/.test(stats.pardons_month) ? stats.pardons_month : null);
      const pardonsUsed = Math.max(0, Math.round(clampNumber(stats.pardonsUsed ?? stats.pardons_used ?? 0, 0, 100)));
      const bestStreak = Math.max(0, Math.round(clampNumber(stats.bestStreak ?? stats.best_streak ?? 0, 0, 100000)));
      const innSince = asDate(stats.innSince ?? stats.inn_since);

      db.prepare(`
        UPDATE player_stats SET level = ?, xp = ?, hp = ?, max_hp = ?, title = ?,
          streak = ?, daily_combo = ?, combo_date = ?, streak_last_date = ?,
          total_tasks = ?, total_meals = ?, total_expenses = ?,
          last_milestone_streak = ?, hp_date = ?,
          pardons_month = ?, pardons_used = ?, inn_since = ?,
          best_streak = MAX(best_streak, ?, ?)
        WHERE user_id = 'default'
      `).run(
        level, xp, hp, maxHp, title,
        streak, dailyCombo,
        (stats.comboDate ?? stats.combo_date ?? null) as string | null,
        (stats.streakLastDate ?? stats.streak_last_date ?? null) as string | null,
        totalTasks, totalMeals, totalExpenses,
        // The device that earned this streak already paid its milestone bonus (and
        // that XP is part of the restored `xp`), so mark it as collected here too.
        streak,
        hpDate, pardonsMonth, pardonsUsed, innSince,
        // The record is the high-water mark across devices — a restore may only
        // raise it, never lower it.
        bestStreak, streak,
      );
      return { success: true };
    } catch (err) {
      console.error('[Sync] Restore stats failed:', err);
      return { success: false };
    }
}
