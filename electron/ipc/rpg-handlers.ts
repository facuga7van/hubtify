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
  sealXp,
  sealWindowStatus,
  MAX_VIGOR,
} from '../../shared/rpg-engine';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_TOTAL,
  ACHIEVEMENT_XP,
  type AchievementContext,
  type AchievementEventContext,
  type AchievementStatsContext,
} from '../../shared/achievements';
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

/**
 * Events that pay a FLAT reward: the declared XP, verbatim. No combo
 * multiplier, no random bonus.
 *
 * Both of them are produced BY the engine (the Códice seal, the achievement
 * matcher). Letting them ride the combo/bonus dice would feed the matcher its
 * own output — an achievement that pays a 3.0x roll that unlocks "Tres Épicas".
 */
const FLAT_XP_EVENTS = new Set(['DAY_SEALED', 'ACHIEVEMENT_UNLOCKED']);

/**
 * Flat events that STILL count as showing up for the global streak.
 *
 * Sealing the Códice is presenting yourself — a day where the only thing you
 * did was close the book is still a day you showed up. Unlocking an achievement
 * is DERIVED from an action that was already counted, so it must not advance
 * anything; otherwise the streak could be kept alive by a reward it generated
 * itself. Neither of them ever touches the DAILY combo counter.
 */
const FLAT_STREAK_EVENTS = new Set(['DAY_SEALED']);

/**
 * Events forced to XP 0 / HP 0, whatever the payload claims.
 *
 * POMODORO_ABANDONED is the broken flask. The loss is SYMBOLIC — the cracked
 * jar on the shelf, Forest's withered tree — never numeric. Charging HP for
 * an interrupted focus session is exactly the debt-punishment phase 1 tore out.
 * The event exists so the Códice and the shelf can see it, nothing more.
 */
const ZERO_IMPACT_EVENTS = new Set(['POMODORO_ABANDONED']);

/**
 * Base XP used when the emitter does not spell out `payload.xp`.
 * An explicit `payload.xp` always wins (finance declares 5 for its movements).
 */
const DEFAULT_EVENT_XP: Record<string, number> = {
  BUDGET_MONTH_MET: 100,
  ACHIEVEMENT_UNLOCKED: ACHIEVEMENT_XP,
  POMODORO_ABANDONED: 0,
  DAY_SEALED: 0,
};

/** Payload field that becomes `ref_id`, for events whose identity is not an entity id. */
const REF_PAYLOAD_KEY_BY_TYPE: Record<string, string> = {
  BUDGET_MONTH_MET: 'month',
  DAY_SEALED: 'date',
  ACHIEVEMENT_UNLOCKED: 'id',
};

/** The entity id an event refers to — persisted to rpg_events.ref_id on insert. */
function extractRefId(type: string, payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const typedKey = REF_PAYLOAD_KEY_BY_TYPE[type];
  if (typedKey) {
    const value = payload[typedKey];
    return typeof value === 'string' && value ? value : null;
  }
  const candidate = payload.taskId ?? payload.subtaskId ?? payload.habitId;
  return typeof candidate === 'string' ? candidate : null;
}

/**
 * Base XP for an event, before combo and bonus.
 * Zero-impact types are pinned to 0 here so no payload can talk them up.
 */
function resolveBaseXp(type: string, payload: Record<string, unknown> | null): number {
  if (ZERO_IMPACT_EVENTS.has(type)) return 0;
  const declared = payload?.xp;
  if (typeof declared === 'number' && Number.isFinite(declared)) {
    return clampNumber(declared, -MAX_EVENT_XP, MAX_EVENT_XP);
  }
  return clampNumber(DEFAULT_EVENT_XP[type] ?? 0, -MAX_EVENT_XP, MAX_EVENT_XP);
}

/** Defensive broadcast to every renderer. Never allowed to break a transaction. */
function broadcast(channel: string, ...args: unknown[]): void {
  // Under vitest the electron mock has no BrowserWindow, and at real startup
  // there may be no windows yet. Notifications are a nicety — they must never
  // take the XP transaction down with them.
  try {
    for (const win of BrowserWindow?.getAllWindows?.() ?? []) {
      win.webContents.send(channel, ...args);
    }
  } catch { /* headless or test environment */ }
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
  /** Achievement ids this event unlocked (empty most of the time). */
  achievementIds: string[];
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
  achievementIds: [],
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
      let baseXp = resolveBaseXp(event.type, payload);
      const hpChange = ZERO_IMPACT_EVENTS.has(event.type)
        ? 0
        : clampNumber(payload?.hp, -MAX_EVENT_HP, MAX_EVENT_HP);

      let refId = extractRefId(event.type, payload);
      // A BUDGET_MONTH_MET without an explicit month is still bucketed, so the
      // once-per-month guard below can never be bypassed by omitting the field.
      if (event.type === 'BUDGET_MONTH_MET' && !refId) refId = monthKey(today);

      // BUDGET_MONTH_MET pays 100 XP ONCE per month. The emitter guarantees
      // uniqueness; this is the engine declining to trust it. ref_id carries the
      // YYYY-MM bucket, so the check is a single probe on idx_rpg_events_type_ref.
      if (event.type === 'BUDGET_MONTH_MET' && refId) {
        const alreadyPaid = db.prepare(
          "SELECT 1 FROM rpg_events WHERE event_type = 'BUDGET_MONTH_MET' AND ref_id = ? LIMIT 1"
        ).get(refId);
        if (alreadyPaid) baseXp = 0;
      }

      const isFlat = FLAT_XP_EVENTS.has(event.type);

      let xpGained: number;
      let comboMultiplier = 1.0;
      let bonusMultiplier = 1.0;
      let streak = stats.streak as number;
      let combo = (stats.daily_combo as number) || 0;
      let milestoneXp = 0;
      let lastMilestoneStreak = (stats.last_milestone_streak as number) ?? 0;
      // Only a real, XP-bearing action advances the combo/streak bookkeeping.
      let advancesProgress = false;
      // How much this event adds to the DAY's combo counter. Flat events (the
      // seal, an achievement) score 0: they must not inflate tomorrow's — or
      // even this afternoon's — multiplier.
      let comboIncrement = 1;

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
        const itemId = extractRefId(event.type, payload);

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
      } else if (isFlat) {
        // The reward is exactly what was declared — no dice, no multiplier.
        xpGained = baseXp;
        comboIncrement = 0;
        // DAY_SEALED counts as showing up (streak yes, combo no);
        // ACHIEVEMENT_UNLOCKED is derived and advances nothing at all.
        advancesProgress = FLAT_STREAK_EVENTS.has(event.type);
      } else if (baseXp > 0) {
        advancesProgress = true;
        if ((stats.combo_date as string | null) !== today) combo = 0;
        comboMultiplier = getComboMultiplier(combo);
        bonusMultiplier = rollRandomBonus();
        // No HP term: low Vigor never shrinks a reward (see calculateXpGain).
        xpGained = Math.round(calculateXpGain(baseXp, comboMultiplier, bonusMultiplier) * 100) / 100;
      } else {
        // Zero/negative-XP event (e.g. TASK_CREATED, POMODORO_ABANDONED). It is
        // logged, and its HP delta still applies, but it must not inflate the
        // daily combo multiplier nor keep a streak alive.
        xpGained = 0;
      }

      // ── Streak + milestone bookkeeping ──
      // Shared by the scoring path and the flat streak-bearing path (the seal),
      // which is why it lives outside the branch above.
      if (advancesProgress) {
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
      }

      const totalXpGained = xpGained + milestoneXp;
      const finalXp = Math.max(0, (stats.xp as number) + totalXpGained);
      const finalLevel = getLevel(finalXp);
      const finalTitle = getTitle(finalLevel);
      const newHp = clampHp((stats.hp as number) + hpChange);
      const oldLevel = stats.level as number;

      const now = localTimestamp();
      // The last event BEFORE this one — read before the insert, so the
      // achievement matcher can measure the silence the player just broke
      // ("El Regreso del Héroe") without a second scan.
      const previousEvent = db.prepare(
        'SELECT created_at AS createdAt FROM rpg_events ORDER BY id DESC LIMIT 1'
      ).get() as { createdAt: string } | undefined;
      // Undo events: store 0 xp_gained in the log (the original event is already deleted,
      // so storing negative XP here would double-count the reversal in SUM queries)
      const loggedXp = isUndo ? 0 : totalXpGained;
      db.prepare(`
        INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.moduleId, event.type, loggedXp, hpChange, comboMultiplier, bonusMultiplier,
        JSON.stringify(event.payload), now, refId, crypto.randomUUID(),
      );

      if (isUndo) {
        db.prepare(`
          UPDATE player_stats SET level = ?, xp = ?, hp = ?, title = ?, daily_combo = ?
          WHERE user_id = ?
        `).run(finalLevel, finalXp, newHp, finalTitle, Math.max(0, combo), 'default');
      } else if (isFlat) {
        // Flat events never touch daily_combo / combo_date. When the event is
        // streak-bearing (the seal) and the player is NOT at the Inn, the streak
        // columns move; otherwise only xp/level/hp/title do.
        if (advancesProgress && !innActive) {
          db.prepare(`
            UPDATE player_stats SET
              level = ?, xp = ?, hp = ?, title = ?,
              streak = ?, streak_last_date = ?, last_milestone_streak = ?,
              best_streak = ?, pardons_month = ?, pardons_used = ?
            WHERE user_id = ?
          `).run(
            finalLevel, finalXp, newHp, finalTitle, streak, today,
            lastMilestoneStreak, Math.max(bestStreak, streak), month, pardonsUsed, 'default',
          );
        } else {
          db.prepare(`
            UPDATE player_stats SET level = ?, xp = ?, hp = ?, title = ?
            WHERE user_id = ?
          `).run(finalLevel, finalXp, newHp, finalTitle, 'default');
        }
      } else if (advancesProgress && innActive) {
        // Resting at the Inn: XP, level and the DAILY combo still move (the combo
        // belongs to the day, not to the streak). Streak columns stay frozen.
        db.prepare(`
          UPDATE player_stats SET
            level = ?, xp = ?, hp = ?, title = ?, daily_combo = ?, combo_date = ?
          WHERE user_id = ?
        `).run(finalLevel, finalXp, newHp, finalTitle, combo + comboIncrement, today, 'default');
      } else if (advancesProgress) {
        db.prepare(`
          UPDATE player_stats SET
            level = ?, xp = ?, hp = ?, title = ?,
            streak = ?, daily_combo = ?, combo_date = ?, streak_last_date = ?,
            last_milestone_streak = ?, best_streak = ?,
            pardons_month = ?, pardons_used = ?
          WHERE user_id = ?
        `).run(
          finalLevel, finalXp, newHp, finalTitle, streak, combo + comboIncrement, today, today,
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
        result: {
          xpGained: totalXpGained,
          hpChange,
          leveledUp: finalLevel > oldLevel,
          newTitle: finalTitle !== (stats.title as string) ? finalTitle : null,
          milestoneXp,
          comboMultiplier,
          bonusMultiplier,
          pardonUsed,
          achievementIds: [] as string[],
        },
        // Seed for the achievement matcher, gathered while the row was written.
        seed: {
          type: event.type,
          moduleId: event.moduleId,
          payload: payload ?? {},
          hour: Number(now.slice(11, 13)),
          date: now.slice(0, 10),
          weekday: new Date(now.slice(0, 10) + 'T12:00:00').getDay(),
          comboMultiplier,
          bonusMultiplier,
          xpGained: totalXpGained,
          pardonUsed,
        } satisfies AchievementEventContext,
        previousEventAt: previousEvent?.createdAt ?? null,
        today,
      };
    });

    try {
      const { result, seed, previousEventAt, today } = processTransaction();
      // Central broadcast: callers of processRpgEvent are scattered across four
      // modules; one listener in Layout turns this into the single, discreet
      // "se uso un indulto" toast instead of wiring every call site.
      if (result.pardonUsed) broadcast('rpg:pardonUsed');

      // ── Achievement matcher ──
      // Runs AFTER the event transaction commits, in its own transaction, on
      // purpose. The shelf is a reward LAYER: a bug in a check, or a locked
      // achievements table, must never roll back the XP the player just earned.
      // The cost is one extra short transaction and a handful of indexed reads,
      // and only for achievements that are still locked.
      //
      // ACHIEVEMENT_UNLOCKED rows are written directly rather than fed back
      // through processRpgEvent — that would recurse, and the reward would
      // re-enter the matcher that produced it.
      result.achievementIds = evaluateAchievements(db, seed, today, previousEventAt);
      for (const id of result.achievementIds) broadcast('rpg:achievementUnlocked', { id });

      return result;
    } catch (err) {
      console.error(`[RPG] Error processing event "${event.type}":`, err);
      try {
        db.prepare(`
          INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
          VALUES (?, ?, 0, 0, 1.0, 1.0, ?, ?, ?, ?)
        `).run(
          event.moduleId, event.type, JSON.stringify(event.payload), localTimestamp(),
          extractRefId(event.type, event.payload as Record<string, unknown> | null), crypto.randomUUID(),
        );
      } catch { /* best effort logging */ }
      return { ...EMPTY_RESULT };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Achievement engine
// ═══════════════════════════════════════════════════════════════════════════

/** Computes once, on first read. Nothing is paid for an achievement nobody asks about. */
function memo<T>(compute: () => T): () => T {
  let cached: T;
  let done = false;
  return () => {
    if (!done) { cached = compute(); done = true; }
    return cached;
  };
}

/** Installs a memoised lazy getter, so the context still reads as plain data. */
function lazyField<K extends keyof AchievementContext>(
  target: Record<string, unknown>,
  key: K,
  read: () => AchievementContext[K],
): void {
  Object.defineProperty(target, key, { enumerable: true, get: read });
}

/** A count query that degrades to 0 when the table/column is not there yet. */
function safeCount(db: Database.Database, sql: string, ...params: unknown[]): number {
  try {
    const row = db.prepare(sql).get(...params as never[]) as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Assembles the context the catalogue's pure checks read.
 *
 * Two grouped queries answer almost everything:
 *   - one `GROUP BY module_id, event_type` scan → totalEvents / byType / byModule,
 *   - one half-open `created_at` range scan (idx_rpg_events_created_at) → every
 *     day-scoped field at once.
 * Both are lazy, so an account whose counting achievements are all unlocked
 * never runs them.
 */
export function buildAchievementContext(
  db: Database.Database,
  event: AchievementEventContext | null,
  today: string = getLocalDateString(),
  previousEventAt: string | null = null,
): AchievementContext {
  // Day-scoped fields follow the EVENT's day, not the wall clock: an event
  // written at 00:01 must not be measured against yesterday's totals.
  const refDay = event?.date ?? today;
  const dayEnd = nextDateString(refDay);

  const row = db.prepare(
    `SELECT level, xp, hp, streak, best_streak AS bestStreak, inn_since AS innSince
     FROM player_stats WHERE user_id = ?`
  ).get('default') as Record<string, unknown> | undefined;

  const stats: AchievementStatsContext = {
    level: (row?.level as number) ?? 1,
    xp: (row?.xp as number) ?? 0,
    hp: (row?.hp as number) ?? MAX_VIGOR,
    streak: (row?.streak as number) ?? 0,
    bestStreak: (row?.bestStreak as number) ?? 0,
    innSince: (row?.innSince as string | null) ?? null,
  };

  const lifetime = memo(() => {
    const rows = db.prepare(
      'SELECT module_id AS m, event_type AS t, COUNT(*) AS c FROM rpg_events GROUP BY module_id, event_type'
    ).all() as Array<{ m: string; t: string; c: number }>;
    const byType: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.t] = (byType[r.t] ?? 0) + r.c;
      byModule[r.m] = (byModule[r.m] ?? 0) + r.c;
      total += r.c;
    }
    return { total, byType, byModule };
  });

  const day = memo(() => {
    const rows = db.prepare(
      `SELECT module_id AS m, event_type AS t, xp_gained AS xp,
              combo_multiplier AS combo, bonus_multiplier AS bonus
       FROM rpg_events WHERE created_at >= ? AND created_at < ?`
    ).all(refDay, dayEnd) as Array<{ m: string; t: string; xp: number; combo: number; bonus: number }>;
    const byType: Record<string, number> = {};
    const modules = new Set<string>();
    const types = new Set<string>();
    let xp = 0;
    let epics = 0;
    let maxCombo = 0;
    for (const r of rows) {
      byType[r.t] = (byType[r.t] ?? 0) + 1;
      modules.add(r.m);
      types.add(r.t);
      xp += r.xp;
      if (r.bonus >= 3.0) epics++;
      if (r.combo > maxCombo) maxCombo = r.combo;
    }
    return {
      count: rows.length, byType, xp, epics, maxCombo,
      modules: [...modules], types: [...types],
    };
  });

  const ctx: Record<string, unknown> = { event, stats, today };
  lazyField(ctx, 'totalEvents', () => lifetime().total);
  lazyField(ctx, 'countByType', () => lifetime().byType);
  lazyField(ctx, 'countByModule', () => lifetime().byModule);
  lazyField(ctx, 'eventsToday', () => day().count);
  lazyField(ctx, 'countByTypeToday', () => day().byType);
  lazyField(ctx, 'modulesToday', () => day().modules);
  lazyField(ctx, 'typesToday', () => day().types);
  lazyField(ctx, 'epicsToday', () => day().epics);
  lazyField(ctx, 'xpToday', () => day().xp);
  lazyField(ctx, 'maxComboToday', () => day().maxCombo);
  lazyField(ctx, 'daysSinceLastActivity', () => {
    // 0, not Infinity, when there is no previous event: the very first action of
    // a brand new account is not a homecoming after an absence.
    if (!event || !previousEventAt) return 0;
    return daysDiff(previousEventAt.slice(0, 10), event.date);
  });
  lazyField(ctx, 'distinctHabits', () => safeCount(
    db,
    `SELECT COUNT(DISTINCT ref_id) AS c FROM rpg_events
     WHERE event_type = 'HABIT_CHECKED' AND ref_id IS NOT NULL`,
  ));
  lazyField(ctx, 'sealsCount', () => safeCount(db, 'SELECT COUNT(*) AS c FROM day_seals'));
  lazyField(ctx, 'hasCharacterName', () => {
    // user_profile.character_name is added by a MODULE migration ('character'
    // v2), so on a core-only handle the column simply is not there.
    try {
      const profile = db.prepare(
        "SELECT character_name AS name FROM user_profile WHERE id = 'default'"
      ).get() as { name: string | null } | undefined;
      return typeof profile?.name === 'string' && profile.name.trim().length > 0;
    } catch {
      return false;
    }
  });

  return ctx as unknown as AchievementContext;
}

/**
 * Evaluates every STILL-LOCKED achievement and awards the ones that fire.
 *
 * An unlocked achievement is never re-checked and never revoked — the filter
 * below is both the cheap path and the guarantee.
 *
 * Each unlock pays a flat +25 XP, logged as its own ACHIEVEMENT_UNLOCKED row so
 * the Códice can show it. The row is written DIRECTLY rather than through
 * processRpgEvent: routing it back would recurse into the matcher that produced
 * it, and would let a reward carry a combo/bonus roll of its own.
 */
export function evaluateAchievements(
  db: Database.Database,
  event: AchievementEventContext | null,
  today: string = getLocalDateString(),
  previousEventAt: string | null = null,
): string[] {
  let alreadyUnlocked: Set<string>;
  try {
    const rows = db.prepare('SELECT id FROM achievements_unlocked').all() as Array<{ id: string }>;
    alreadyUnlocked = new Set(rows.map((r) => r.id));
  } catch {
    // Pre-v4 handle (or a database mid-migration). The shelf can wait; the
    // event that triggered this must not fail because of it.
    return [];
  }

  const pending = ACHIEVEMENTS.filter((a) => !alreadyUnlocked.has(a.id));
  if (pending.length === 0) return [];

  const ctx = buildAchievementContext(db, event, today, previousEventAt);
  const newly: string[] = [];
  for (const achievement of pending) {
    try {
      if (achievement.check(ctx) === true) newly.push(achievement.id);
    } catch (err) {
      console.error(`[RPG] achievement check "${achievement.id}" threw:`, err);
    }
  }
  if (newly.length === 0) return [];

  const now = localTimestamp();
  const award = db.transaction(() => {
    const insertUnlock = db.prepare(
      'INSERT OR IGNORE INTO achievements_unlocked (id, unlocked_at, updated_at) VALUES (?, ?, ?)'
    );
    const insertEvent = db.prepare(`
      INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change,
                              combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
      VALUES ('rpg', 'ACHIEVEMENT_UNLOCKED', ?, 0, 1.0, 1.0, ?, ?, ?, ?)
    `);
    for (const id of newly) {
      insertUnlock.run(id, now, now);
      insertEvent.run(ACHIEVEMENT_XP, JSON.stringify({ id, xp: ACHIEVEMENT_XP }), now, id, crypto.randomUUID());
    }
    db.prepare('UPDATE player_stats SET xp = xp + ? WHERE user_id = ?')
      .run(ACHIEVEMENT_XP * newly.length, 'default');
    const after = db.prepare('SELECT xp FROM player_stats WHERE user_id = ?').get('default') as { xp: number };
    const level = getLevel(after.xp);
    db.prepare('UPDATE player_stats SET level = ?, title = ? WHERE user_id = ?')
      .run(level, getTitle(level), 'default');
  });

  try {
    award();
  } catch (err) {
    console.error('[RPG] achievement award failed:', err);
    return [];
  }
  return newly;
}

export interface AchievementState {
  id: string;
  /** The UI renders "???" for a hidden entry that is still locked. */
  hidden: boolean;
  unlocked: boolean;
  /** Local 'YYYY-MM-DD HH:MM:SS'. Absent while locked. */
  unlockedAt?: string;
}

/** The whole catalogue with per-entry state — hidden-and-locked ones included. */
export function getAchievements(db: Database.Database): AchievementState[] {
  let unlocked = new Map<string, string>();
  try {
    const rows = db.prepare(
      'SELECT id, unlocked_at AS unlockedAt FROM achievements_unlocked'
    ).all() as Array<{ id: string; unlockedAt: string }>;
    unlocked = new Map(rows.map((r) => [r.id, r.unlockedAt]));
  } catch { /* pre-v4 handle: everything reads as locked */ }

  return ACHIEVEMENTS.map((a) => {
    const at = unlocked.get(a.id);
    return at
      ? { id: a.id, hidden: a.hidden, unlocked: true, unlockedAt: at }
      : { id: a.id, hidden: a.hidden, unlocked: false };
  });
}

/**
 * One full sweep of the catalogue with no event in hand.
 *
 * Idempotent and cheap: only still-locked entries are evaluated, and the two
 * "already true on every existing install" entries (`first_step`,
 * `awakening`) make the shelf read 2/40 instead of 0/40 the first time an
 * upgraded account opens it.
 */
export function backfillAchievements(
  db: Database.Database,
  today: string = getLocalDateString(),
): { unlocked: string[]; total: number } {
  const unlocked = evaluateAchievements(db, null, today, null);
  for (const id of unlocked) broadcast('rpg:achievementUnlocked', { id });
  return { unlocked, total: ACHIEVEMENTS_TOTAL };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cierre del Códice
// ═══════════════════════════════════════════════════════════════════════════

export interface DaySummaryEvent {
  id: number;
  moduleId: string;
  eventType: string;
  xpGained: number;
  hpChange: number;
  comboMultiplier: number;
  bonusMultiplier: number;
  payload: string | null;
  /** Local 'YYYY-MM-DD HH:MM:SS'. */
  createdAt: string;
  /** Local 'HH:MM', for the timeline. */
  time: string;
}

export interface DaySummaryModule {
  moduleId: string;
  count: number;
  xp: number;
  events: DaySummaryEvent[];
}

export interface DaySeal {
  date: string;
  sealedAt: string;
  xpAwarded: number;
  vigor: number;
  eventsCount: number;
  modules: string[];
}

export type SealBlockedReason = 'already_sealed' | 'too_old' | 'future' | 'empty_day';

export interface DaySummary {
  date: string;
  isToday: boolean;
  /** Chronological. */
  events: DaySummaryEvent[];
  /** Same events grouped by module, richest first. */
  byModule: DaySummaryModule[];
  eventsCount: number;
  totalXp: number;
  /** Highest combo multiplier reached that day (1.0 when nothing scored). */
  maxCombo: number;
  modules: string[];
  /** The Vigor the seal would use for this day (see `sealVigorFor`). */
  vigor: number;
  streak: number;
  sealed: boolean;
  seal: DaySeal | null;
  canSeal: boolean;
  /** Why `canSeal` is false. `null` when it is true. */
  sealBlockedReason: SealBlockedReason | null;
}

export type SealResult =
  | {
      ok: true;
      date: string;
      xpAwarded: number;
      vigor: number;
      eventsCount: number;
      modules: string[];
      /** Achievements the seal itself unlocked. */
      achievementIds: string[];
    }
  | { ok: false; reason: SealBlockedReason };

function parseModules(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

function rowToSeal(row: Record<string, unknown>): DaySeal {
  return {
    date: row.date as string,
    sealedAt: row.sealedAt as string,
    xpAwarded: row.xpAwarded as number,
    vigor: row.vigor as number,
    eventsCount: row.eventsCount as number,
    modules: parseModules((row.modules as string) ?? '[]'),
  };
}

function readSeal(db: Database.Database, date: string): DaySeal | null {
  try {
    const row = db.prepare(
      `SELECT date, sealed_at AS sealedAt, xp_awarded AS xpAwarded, vigor,
              events_count AS eventsCount, modules
       FROM day_seals WHERE date = ?`
    ).get(date) as Record<string, unknown> | undefined;
    return row ? rowToSeal(row) : null;
  } catch {
    return null;
  }
}

/**
 * The Vigor a seal for `date` is worth.
 *
 * TODAY uses the live Vigor (`player_stats.hp`, which only describes the day
 * named by `hp_date`).
 *
 * DECISION — ANY OTHER DAY USES MAX_VIGOR (100 → vigorBonus 1.10). We do not
 * store historical Vigor, so yesterday's closing value is simply not available
 * once the lazy rollover has fired, and reading `hp` in that window would make
 * the payout depend on whether the summary happened to be opened first. Given a
 * choice between charging the player for data we failed to keep and being
 * generous, the design rule ("the ritual never punishes") picks generous —
 * and, just as importantly, deterministic.
 */
export function sealVigorFor(
  db: Database.Database,
  date: string,
  today: string = getLocalDateString(),
): number {
  if (date !== today) return MAX_VIGOR;
  const row = db.prepare(
    'SELECT hp, hp_date AS hpDate FROM player_stats WHERE user_id = ?'
  ).get('default') as { hp: number; hpDate: string | null } | undefined;
  if (row && row.hpDate === today) return clampHp(row.hp);
  return MAX_VIGOR;
}

/** Everything the Códice page renders for one local day. Read-only. */
export function getDaySummary(
  db: Database.Database,
  date: string = getLocalDateString(),
  today: string = getLocalDateString(),
): DaySummary {
  const dayEnd = nextDateString(date);
  const rows = db.prepare(
    `SELECT id, module_id AS moduleId, event_type AS eventType,
            xp_gained AS xpGained, hp_change AS hpChange,
            combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
            payload, created_at AS createdAt
     FROM rpg_events
     WHERE created_at >= ? AND created_at < ?
     ORDER BY created_at ASC, id ASC`
  ).all(date, dayEnd) as Array<Omit<DaySummaryEvent, 'time'>>;

  const events: DaySummaryEvent[] = rows.map((r) => ({ ...r, time: r.createdAt.slice(11, 16) }));

  const grouped = new Map<string, DaySummaryModule>();
  let totalXp = 0;
  let maxCombo = 1.0;
  for (const e of events) {
    totalXp += e.xpGained;
    if (e.comboMultiplier > maxCombo) maxCombo = e.comboMultiplier;
    let bucket = grouped.get(e.moduleId);
    if (!bucket) {
      bucket = { moduleId: e.moduleId, count: 0, xp: 0, events: [] };
      grouped.set(e.moduleId, bucket);
    }
    bucket.count++;
    bucket.xp += e.xpGained;
    bucket.events.push(e);
  }
  const byModule = [...grouped.values()].sort((a, b) => b.xp - a.xp || a.moduleId.localeCompare(b.moduleId));

  const seal = readSeal(db, date);
  const stats = db.prepare('SELECT streak FROM player_stats WHERE user_id = ?').get('default') as
    { streak: number } | undefined;

  let sealBlockedReason: SealBlockedReason | null = null;
  if (seal) sealBlockedReason = 'already_sealed';
  else {
    const window = sealWindowStatus(date, today);
    if (window !== 'ok') sealBlockedReason = window;
    else if (events.length === 0) sealBlockedReason = 'empty_day';
  }

  return {
    date,
    isToday: date === today,
    events,
    byModule,
    eventsCount: events.length,
    totalXp: Math.round(totalXp * 100) / 100,
    maxCombo,
    modules: byModule.map((m) => m.moduleId),
    vigor: sealVigorFor(db, date, today),
    streak: stats?.streak ?? 0,
    sealed: seal !== null,
    seal,
    canSeal: sealBlockedReason === null,
    sealBlockedReason,
  };
}

/**
 * Seals a day.
 *
 * Rules (all of them chosen so the ritual can never become a punishment):
 *   - today or yesterday only. The grace window exists precisely so a forgotten
 *     night is recoverable; anything older is 'too_old' and simply stays unsealed,
 *     which costs nothing — there is no seal streak and no decay.
 *   - a day with zero events cannot be sealed ('empty_day'): the seal certifies a
 *     day that was lived, not a button that was pressed.
 *   - XP = round((10 + 2 * min(events, 20)) * vigorBonus(vigor)) — 12..55 XP.
 *
 * The reward is emitted as a flat DAY_SEALED event, so it advances the global
 * streak (sealing IS showing up) while taking no combo and no random bonus.
 */
export function sealDay(
  db: Database.Database,
  date: string = getLocalDateString(),
  today: string = getLocalDateString(),
): SealResult {
  const window = sealWindowStatus(date, today);
  if (window !== 'ok') return { ok: false, reason: window };
  if (readSeal(db, date)) return { ok: false, reason: 'already_sealed' };

  const dayEnd = nextDateString(date);
  const rows = db.prepare(
    'SELECT DISTINCT module_id AS moduleId FROM rpg_events WHERE created_at >= ? AND created_at < ?'
  ).all(date, dayEnd) as Array<{ moduleId: string }>;
  const eventsCount = safeCount(
    db,
    'SELECT COUNT(*) AS c FROM rpg_events WHERE created_at >= ? AND created_at < ?',
    date, dayEnd,
  );
  if (eventsCount === 0) return { ok: false, reason: 'empty_day' };

  const modules = rows.map((r) => r.moduleId).sort();
  const vigor = sealVigorFor(db, date, today);
  const xpAwarded = sealXp(eventsCount, vigor);
  const now = localTimestamp();

  try {
    db.prepare(`
      INSERT INTO day_seals (date, sealed_at, xp_awarded, vigor, events_count, modules, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(date, now, xpAwarded, vigor, eventsCount, JSON.stringify(modules), now);
  } catch (err) {
    // UNIQUE violation = someone sealed it between the check and here.
    console.error('[RPG] sealDay insert failed:', err);
    return { ok: false, reason: 'already_sealed' };
  }

  // Written after the seal row exists, so `first_seal` / `sealed_week` /
  // `steady_hand` see the new count in the very same pass.
  const result = processRpgEvent(db, {
    type: 'DAY_SEALED',
    moduleId: 'rpg',
    payload: {
      xp: xpAwarded, hp: 0, date, vigor, eventsCount, modules,
      /** Retro-sealed yesterday inside the grace window. */
      retro: date !== today,
    },
    timestamp: Date.now(),
  });

  broadcast('rpg:daySealed', { date, xpAwarded });

  return { ok: true, date, xpAwarded, vigor, eventsCount, modules, achievementIds: result.achievementIds };
}

/** Seals in [fromDate, toDate], inclusive, ascending — the seal calendar. */
export function getSeals(db: Database.Database, fromDate: string, toDate: string): DaySeal[] {
  try {
    const rows = db.prepare(
      `SELECT date, sealed_at AS sealedAt, xp_awarded AS xpAwarded, vigor,
              events_count AS eventsCount, modules
       FROM day_seals WHERE date >= ? AND date <= ? ORDER BY date ASC`
    ).all(fromDate, toDate) as Array<Record<string, unknown>>;
    return rows.map(rowToSeal);
  } catch {
    return [];
  }
}

/** Runs the catalogue sweep once per process, lazily. */
let backfillDone = false;
function ensureBackfill(db: Database.Database): void {
  if (backfillDone) return;
  backfillDone = true;
  try {
    backfillAchievements(db);
  } catch (err) {
    console.error('[RPG] achievement backfill failed:', err);
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

  // ── Achievements ──
  ipcHandle('rpg:getAchievements', (): AchievementState[] => {
    const db = getDb();
    // Lazy self-heal: even if nothing calls rpg:backfillAchievements at boot,
    // the first time the shelf is opened it already reads 2/40.
    ensureBackfill(db);
    return getAchievements(db);
  });

  /** Idempotent full sweep. Safe to call at startup and after an account switch. */
  ipcHandle('rpg:backfillAchievements', () => {
    backfillDone = true;
    return backfillAchievements(getDb());
  });

  // ── Cierre del Códice ──
  // `daysDiff` on a malformed string yields NaN, which would slip past every
  // comparison in sealWindowStatus, so anything that is not YYYY-MM-DD is
  // treated as "no date given" and falls back to today.
  const asDay = (value: unknown, today: string): string =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;

  ipcHandle('rpg:getDaySummary', (_e, date?: string | null): DaySummary => {
    const db = getDb();
    const today = getLocalDateString();
    rolloverVigor(db, today);
    return getDaySummary(db, asDay(date, today), today);
  });

  ipcHandle('rpg:sealDay', (_e, date?: string | null): SealResult => {
    const db = getDb();
    const today = getLocalDateString();
    return sealDay(db, asDay(date, today), today);
  });

  ipcHandle('rpg:getSeals', (_e, fromDate: string, toDate: string): DaySeal[] =>
    getSeals(getDb(), fromDate, toDate));

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
