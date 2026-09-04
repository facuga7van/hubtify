import type { SqlDatabase } from '../db';
import { getDb } from '../db';
import { registerHandler as ipcHandle } from '../registry';
import { genId } from '../ids';
import { emit } from '../events';
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
  masteryInfo,
  isMeaningfulEvent,
  NON_MEANINGFUL_EVENT_TYPES,
  ENGINE_MODULE_ID,
} from '../../shared/rpg-engine';
import {
  SHOP_CATALOG,
  SHOP_CATALOG_BY_ID,
  EQUIPPABLE_KINDS,
  EQUIP_STATE_KEYS,
  PARDON_ITEM_ID,
  PARDON_PURCHASES_PER_MONTH,
  purchaseRowId,
  type ShopItem,
  type ShopItemKind,
} from '../../shared/shop-catalog';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_TOTAL,
  ACHIEVEMENT_OBOLOS,
  ACHIEVEMENT_XP,
  type AchievementContext,
  type AchievementEventContext,
  type AchievementStatsContext,
} from '../../shared/achievements';
import type {
  RpgEvent, RpgEventRecord,
  // The renderer-facing contract (HubtifyApi). The codex handlers below are
  // annotated with THESE so a field renamed on either side fails to compile
  // instead of reaching the UI as `undefined` (the «XP DEL DÍA +NaN» bug).
  DaySummary as DaySummaryContract,
  SealResult as SealResultContract,
  DaySeal as DaySealContract,
  ObolosBalance as ObolosBalanceContract,
  Reward as RewardContract,
  RedeemResult as RedeemResultContract,
  ShopCatalogResult as ShopCatalogResultContract,
  PurchaseShopResult as PurchaseShopResultContract,
  EquipShopResult as EquipShopResultContract,
  MasteryState as MasteryStateContract,
} from '../../shared/types';
import { todayDateString, localTimestamp, daysAgoDateString, nextDateString, formatDateString } from '../../shared/date-utils';
import { getPlayerStats, purchasedPardonExtras, rolloverVigor, type PlayerStatsV2 } from './rpg-stats';

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
  EXPENSE_LOGGED: '$.transactionId',
  INCOME_LOGGED: '$.transactionId',
  MOVEMENT_DELETED: '$.transactionId',
  DAY_SUMMARY: '$.date',
  DAY_REOPENED: '$.date',
};

/**
 * Events that pay a FLAT reward: the declared XP, verbatim. No combo
 * multiplier, no random bonus.
 *
 * Both of them are produced BY the engine (the Códice seal, the achievement
 * matcher). Letting them ride the combo/bonus dice would feed the matcher its
 * own output — an achievement that pays a 3.0x roll that unlocks "Tres Épicas".
 */
const FLAT_XP_EVENTS = new Set(['DAY_SEALED', 'ACHIEVEMENT_UNLOCKED', 'WEEK_SUMMARY']);

/**
 * Flat events that STILL count as showing up for the global streak.
 *
 * Sealing the Códice is presenting yourself — a day where the only thing you
 * did was close the book is still a day you showed up. Unlocking an achievement
 * is DERIVED from an action that was already counted, so it must not advance
 * anything; otherwise the streak could be kept alive by a reward it generated
 * itself. Neither of them ever touches the DAILY combo counter.
 *
 * ONLY when the sealed day is TODAY. A retro seal (`payload.retro === true`)
 * is a memory of yesterday, and yesterday's events already moved the streak
 * — if there were any. Letting it advance the streak with today's date made
 * "seal yesterday" a daily button that kept a streak alive with zero activity.
 */
const FLAT_STREAK_EVENTS = new Set(['DAY_SEALED']);

/**
 * SQL twin of `isMeaningfulEvent` (shared/rpg-engine.ts), for the counting
 * queries. Built from the same list so the two rules can never drift.
 * Types are fixed literals from the catalogue, never user input.
 */
const MEANINGFUL_EVENT_SQL =
  `xp_gained > 0 AND module_id <> '${ENGINE_MODULE_ID}' AND event_type NOT IN (`
  + NON_MEANINGFUL_EVENT_TYPES.map((t) => `'${t}'`).join(', ')
  + ')';

/** A YYYY-MM-DD string, or null. Anything else (garbage from the wire) is null. */
function asDateString(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

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
  // Coinify: a manual movement pays on alta and refunds on delete. Without a
  // ref the delete could not find its alta, and add/delete was an infinite tap.
  EXPENSE_LOGGED: 'transactionId',
  INCOME_LOGGED: 'transactionId',
  MOVEMENT_DELETED: 'transactionId',
  // Nutrify: closing a day writes DAY_SUMMARY, reopening it emits DAY_REOPENED
  // for the SAME date. Routing the reversal through the engine's generic undo
  // path (instead of the module deleting the row by a timestamp heuristic)
  // is what makes the exact XP, the mastery refund and the combo tick line up.
  DAY_SUMMARY: 'date',
  DAY_REOPENED: 'date',
  // Nutrify: el pergamino semanal se identifica por su lunes. Es el balde del
  // guard de unicidad, igual que `month` en BUDGET_MONTH_MET.
  WEEK_SUMMARY: 'weekStart',
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

/** `days` days before a YYYY-MM-DD date (noon anchor, so DST can never shift it). */
function daysAgoFrom(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return formatDateString(d);
}

/** Neutral result, returned when the event could not be processed. */
const EMPTY_RESULT: RpgEventResult = {
  xpGained: 0, hpChange: 0, leveledUp: false, newTitle: null,
  milestoneXp: 0, comboMultiplier: 1.0, bonusMultiplier: 1.0, pardonUsed: false,
  achievementIds: [],
};

interface InnStatsRow {
  inn_since: string | null;
  streak_last_date: string | null;
  streak: number;
  pardons_month: string | null;
  pardons_used: number;
}

/**
 * Whether the streak is still ALIVE on `today`, i.e. the next real action
 * would continue it rather than restart it: last acted today or yesterday, or
 * exactly one day missed with a pardon left to cover it. Mirrors the gap rule
 * in processRpgEvent (gap 1 → continues; gap 2 + pardon → continues; else dies).
 */
function streakIsAlive(db: SqlDatabase, row: InnStatsRow, today: string): boolean {
  if (!row.streak_last_date || row.streak <= 0) return false;
  const gap = daysDiff(row.streak_last_date, today);
  if (gap <= 1) return true;
  if (gap !== 2) return false;
  const month = monthKey(today);
  return pardonsRemaining(row.pardons_month, row.pardons_used ?? 0, month, purchasedPardonExtras(db, month)) > 0;
}

/**
 * Checks the player in/out of the Inn (holiday mode).
 *
 * Model: `inn_since` — a start date, switched off MANUALLY (not an `inn_until`
 * deadline). A holiday that ends by itself on a date picked in advance is just
 * another deadline to miss; this one ends when the player says so.
 *
 * While resting, events still pay full XP (using the app on holiday is neither
 * punished nor blocked) but the streak neither advances nor breaks.
 *
 * The Inn FREEZES a streak; it cannot resurrect one:
 *   - check-in: if the streak is already dead on the check-in date (see
 *     `streakIsAlive`) it is reset to 0 right there, so the sidebar stops
 *     showing a number the next action would wipe anyway. `best_streak`
 *     is never touched.
 *   - check-out: the days spent at the Inn are removed from the calendar, but
 *     the gap that already existed BEFORE check-in is preserved. The last
 *     activity date is moved to `today - max(1, preGap)`, where preGap is the
 *     distance between the last action and the check-in. Acted the day before
 *     (or on) check-in → yesterday, the first day back continues the streak;
 *     one missed day before check-in → the return still needs a pardon; more
 *     → the streak dies exactly as it would have without the holiday.
 *
 * Before this, check-out rewound to YESTERDAY unconditionally, so "Posada →
 * Volver" turned any ten-day silence into a one-day gap for free.
 */
export function setInnMode(db: SqlDatabase, on: boolean, today = getLocalDateString()): { innSince: string | null } {
  const row = db.prepare(
    'SELECT inn_since, streak_last_date, streak, pardons_month, pardons_used FROM player_stats WHERE user_id = ?'
  ).get('default') as InnStatsRow | undefined;
  if (!row) return { innSince: null };

  if (on) {
    // Already resting: keep the original check-in date.
    if (row.inn_since) return { innSince: row.inn_since };
    if (row.streak > 0 && !streakIsAlive(db, row, today)) {
      // Nothing to freeze: the streak had already fallen. Make the state honest
      // now instead of letting the Inn carry a corpse back to life.
      db.prepare("UPDATE player_stats SET inn_since = ?, streak = 0, last_milestone_streak = 0 WHERE user_id = 'default'")
        .run(today);
    } else {
      db.prepare("UPDATE player_stats SET inn_since = ? WHERE user_id = 'default'").run(today);
    }
    return { innSince: today };
  }

  if (!row.inn_since) return { innSince: null };
  // Only rewind when the player has not already acted today — otherwise a
  // check-in/check-out round trip on the same day would let the streak tick twice.
  // With no last activity at all there is nothing to rewind either.
  const lastDate = row.streak_last_date;
  const shouldRewind = lastDate !== null && lastDate !== today;
  if (shouldRewind) {
    const preGap = Math.max(1, daysDiff(lastDate, row.inn_since));
    const rewound = daysAgoFrom(today, preGap);
    // Never move the date backwards: the pre-Inn gap can only be preserved, not
    // enlarged (relevant when the check-in date is later than the last action).
    const restored = rewound > lastDate ? rewound : lastDate;
    db.prepare("UPDATE player_stats SET inn_since = NULL, streak_last_date = ? WHERE user_id = 'default'")
      .run(restored);
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
export function processRpgEvent(db: SqlDatabase, event: RpgEvent): RpgEventResult {
    const isUndo = event.type === 'TASK_UNCOMPLETED' || event.type === 'SUBTASK_UNCOMPLETED'
      || event.type === 'HABIT_UNCHECKED' || event.type === 'MOVEMENT_DELETED'
      || event.type === 'DAY_REOPENED';
    let undoReversedMovement = false;

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

      // El pergamino semanal paga UNA vez por semana. A diferencia de
      // BUDGET_MONTH_MET no hay fallback de balde: el motor solo conoce el reloj
      // de PARED y cualquier lunes que derivara acá apuntaría a la semana pasada,
      // colapsando cuatro pergaminos atrasados en un solo balde y convirtiendo
      // tres pagos legítimos en 0. Sin balde, no se paga.
      if (event.type === 'WEEK_SUMMARY') {
        if (!refId) {
          baseXp = 0;
        } else {
          const alreadyPaid = db.prepare(
            "SELECT 1 FROM rpg_events WHERE event_type = 'WEEK_SUMMARY' AND ref_id = ? LIMIT 1",
          ).get(refId);
          if (alreadyPaid) baseXp = 0;
        }
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
      // Set by the undo branch: the mastery entry the reversed event had added.
      let masteryRefund: { moduleId: string; xp: number } | null = null;

      if (isUndo) {
        // Find the original completion event and reverse its exact XP.
        const undoMap: Record<string, string> = {
          'TASK_UNCOMPLETED': 'TASK_COMPLETED',
          'SUBTASK_UNCOMPLETED': 'SUBTASK_COMPLETED',
          'HABIT_UNCHECKED': 'HABIT_CHECKED',
          'DAY_REOPENED': 'DAY_SUMMARY',
        };
        // A deleted movement names which alta it annuls via movementType.
        const originalType = event.type === 'MOVEMENT_DELETED'
          ? (payload?.movementType === 'income' ? 'INCOME_LOGGED' : 'EXPENSE_LOGGED')
          : undoMap[event.type];
        const itemId = extractRefId(event.type, payload);
        // When the undo names the day it belongs to (a retro habit check carries
        // `payload.date`), only an original of THAT day qualifies. An original
        // without an explicit date belongs to the day it was written.
        const undoDate = asDateString(payload?.date);

        let originalEvent: { id: number; xp_gained: number; created_at: string; module_id: string } | undefined;
        if (itemId && originalType) {
          // Match on ref_id (indexed, backfilled by the `core` v1 migration), with a
          // json_extract fallback for rows whose payload was not valid JSON.
          // The old `payload LIKE '%"<id>"%'` matched the id ANYWHERE in the JSON, so
          // un-completing task `abc` could revert (and delete) the event of a different
          // task that merely carried `projectId: "abc"`.
          const refField = REF_FIELD_BY_TYPE[originalType];
          const dateClause = undoDate
            ? "AND COALESCE(json_extract(payload, '$.date'), substr(created_at, 1, 10)) = ?"
            : '';
          const params: unknown[] = [originalType, itemId, itemId];
          if (undoDate) params.push(undoDate);
          originalEvent = db.prepare(`
            SELECT id, xp_gained, created_at, module_id FROM rpg_events
            WHERE event_type = ?
              AND (ref_id = ? OR (ref_id IS NULL AND json_extract(payload, '${refField}') = ?))
              ${dateClause}
            ORDER BY id DESC LIMIT 1
          `).get(...params as never[]) as typeof originalEvent;
        }

        if (originalEvent) {
          xpGained = -originalEvent.xp_gained;
          if (event.type === 'MOVEMENT_DELETED') undoReversedMovement = true;
          // Delete the original event from the log
          db.prepare('DELETE FROM rpg_events WHERE id = ?').run(originalEvent.id);
          // The mastery bar mirrors the log: the entry it added is taken back
          // too (floored at 0). Not "negative XP" — the annulment of an entry.
          masteryRefund = { moduleId: originalEvent.module_id, xp: originalEvent.xp_gained };
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
        // DAY_SEALED counts as showing up (streak yes, combo no) — but only the
        // seal of TODAY. A retro seal is a memory, and memories do not show up.
        // ACHIEVEMENT_UNLOCKED is derived and advances nothing at all.
        advancesProgress = FLAT_STREAK_EVENTS.has(event.type) && payload?.retro !== true;
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
          } else if (
            gap === 2
            // Capacity = 2 automatic + any pardon BOUGHT this month (shop,
            // max 1). One shared used-counter, so the bought pardon extends
            // the same rule instead of forking a second bookkeeping path.
            && pardonsRemaining(storedPardonMonth, pardonsUsed, month, purchasedPardonExtras(db, month)) > 0
          ) {
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
        JSON.stringify(event.payload), now, refId, genId(),
      );

      // Mastery accumulator: same transaction as the event, so the bar can
      // never drift from the log it mirrors. Only positive XP feeds it (a
      // negative nutrition close must not erode a mastery); an UNDO takes back
      // exactly the entry its original added, because the original row is gone
      // from the log the bar mirrors. Without that, complete/uncomplete was a
      // free mastery pump.
      if (masteryRefund) {
        bumpMasteryXp(db, masteryRefund.moduleId, -masteryRefund.xp, now);
      } else {
        bumpMasteryXp(db, event.moduleId, loggedXp, now);
      }

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
      } else if (undoReversedMovement) {
        db.prepare('UPDATE player_stats SET total_expenses = MAX(0, total_expenses - 1) WHERE user_id = ?').run('default');
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

    // The catch covers ONLY the transaction. Once it has committed, nothing
    // below may write to rpg_events again: the old shape wrapped the reward
    // layer too, so a matcher hiccup after the commit logged a SECOND row of
    // the same event with 0 XP and the same ref_id — the row a later undo
    // would pick, leaving the real XP paid on an open task.
    let committed: ReturnType<typeof processTransaction>;
    try {
      committed = processTransaction();
    } catch (err) {
      console.error(`[RPG] Error processing event "${event.type}":`, err);
      try {
        db.prepare(`
          INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
          VALUES (?, ?, 0, 0, 1.0, 1.0, ?, ?, ?, ?)
        `).run(
          event.moduleId, event.type, JSON.stringify(event.payload), localTimestamp(),
          extractRefId(event.type, event.payload as Record<string, unknown> | null), genId(),
        );
      } catch { /* best effort logging */ }
      return { ...EMPTY_RESULT };
    }

    const { result, seed, previousEventAt, today } = committed;
    try {
      // Central broadcast: callers of processRpgEvent are scattered across four
      // modules; one listener in Layout turns this into the single, discreet
      // "se uso un indulto" toast instead of wiring every call site.
      if (result.pardonUsed) emit('rpg:pardonUsed');

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
      for (const id of result.achievementIds) emit('rpg:achievementUnlocked', { id });
    } catch (err) {
      // The XP is paid and logged; only the decoration failed.
      console.error(`[RPG] reward layer failed after "${event.type}" committed:`, err);
      result.achievementIds = [];
    }
    return result;
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
function safeCount(db: SqlDatabase, sql: string, ...params: unknown[]): number {
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
  db: SqlDatabase,
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

  // `byType` / `byModule` stay RAW: the first_* / day_off / second_chance
  // entries look for the existence of a specific kind of row, zero-XP ones
  // included. `total` (the Cronista ladder, first_step) counts only
  // MEANINGFUL rows — 100 empty QuickAdds are not a chronicle.
  const lifetime = memo(() => {
    const rows = db.prepare(
      `SELECT module_id AS m, event_type AS t, COUNT(*) AS c,
              SUM(CASE WHEN ${MEANINGFUL_EVENT_SQL} THEN 1 ELSE 0 END) AS meaningful
       FROM rpg_events GROUP BY module_id, event_type`
    ).all() as Array<{ m: string; t: string; c: number; meaningful: number }>;
    const byType: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.t] = (byType[r.t] ?? 0) + r.c;
      byModule[r.m] = (byModule[r.m] ?? 0) + r.c;
      total += r.meaningful ?? 0;
    }
    return { total, byType, byModule };
  });

  // Same split for the day: `count` / `modules` / `types` (polymath,
  // sunday_guardian, perfect_day) see only meaningful rows, so an undo, a
  // QuickAdd or the engine's own ACHIEVEMENT_UNLOCKED can never pass as
  // "variety". `byType`, `xp`, `epics` and `maxCombo` stay raw.
  const day = memo(() => {
    const rows = db.prepare(
      `SELECT module_id AS m, event_type AS t, xp_gained AS xp,
              combo_multiplier AS combo, bonus_multiplier AS bonus
       FROM rpg_events WHERE created_at >= ? AND created_at < ?`
    ).all(refDay, dayEnd) as Array<{ m: string; t: string; xp: number; combo: number; bonus: number }>;
    const byType: Record<string, number> = {};
    const modules = new Set<string>();
    const types = new Set<string>();
    let count = 0;
    let xp = 0;
    let epics = 0;
    let maxCombo = 0;
    for (const r of rows) {
      byType[r.t] = (byType[r.t] ?? 0) + 1;
      xp += r.xp;
      if (r.bonus >= 3.0) epics++;
      if (r.combo > maxCombo) maxCombo = r.combo;
      if (isMeaningfulEvent({ moduleId: r.m, eventType: r.t, xpGained: r.xp })) {
        count++;
        modules.add(r.m);
        types.add(r.t);
      }
    }
    return {
      count, byType, xp, epics, maxCombo,
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
 * How an unlock is paid.
 *   - 'live': the event that just landed earned it → flat +25 XP, its own
 *     ACHIEVEMENT_UNLOCKED row, +15 óbolos, one broadcast per id.
 *   - 'backfill': the catalogue sweep found history that already satisfies it
 *     → the unlock is RECORDED (shelf, unlocked_at) and nothing is paid. The
 *     economy is born at zero for old history — the same call as unsealed past
 *     days. Without this, the first boot after an update fired N toasts, N XP
 *     payouts and a level-up out of years-old rows.
 */
export type UnlockMode = 'live' | 'backfill';

/**
 * Evaluates every STILL-LOCKED achievement and awards the ones that fire.
 *
 * An unlocked achievement is never re-checked and never revoked — the filter
 * below is both the cheap path and the guarantee.
 *
 * A LIVE unlock pays a flat +25 XP, logged as its own ACHIEVEMENT_UNLOCKED row so
 * the Códice can show it. The row is written DIRECTLY rather than through
 * processRpgEvent: routing it back would recurse into the matcher that produced
 * it, and would let a reward carry a combo/bonus roll of its own.
 */
export function evaluateAchievements(
  db: SqlDatabase,
  event: AchievementEventContext | null,
  today: string = getLocalDateString(),
  previousEventAt: string | null = null,
  mode: UnlockMode = 'live',
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
      if (mode === 'live') {
        insertEvent.run(ACHIEVEMENT_XP, JSON.stringify({ id, xp: ACHIEVEMENT_XP }), now, id, genId());
      }
    }
    if (mode !== 'live') return;
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

  // Óbolos ride OUTSIDE the award transaction and behind their own guards:
  // a ledger problem must never roll back the unlock it decorates. Idempotent
  // per achievement id, so a re-unlock can never pay one twice. The backfill
  // records without paying (see UnlockMode).
  if (mode === 'live') {
    for (const id of newly) grantObolos(db, 'achievement', id, ACHIEVEMENT_OBOLOS);
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
export function getAchievements(db: SqlDatabase): AchievementState[] {
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
 *
 * Records without paying (UnlockMode 'backfill'): no XP, no óbolos, no
 * ACHIEVEMENT_UNLOCKED rows. And ONE aggregated `rpg:achievementsBackfilled
 * { ids }` broadcast instead of a per-id `rpg:achievementUnlocked` — the
 * renderer shows a single "N logros reconocidos" note, not N toasts.
 */
export function backfillAchievements(
  db: SqlDatabase,
  today: string = getLocalDateString(),
): { unlocked: string[]; total: number } {
  const unlocked = evaluateAchievements(db, null, today, null, 'backfill');
  if (unlocked.length > 0) emit('rpg:achievementsBackfilled', { ids: unlocked });
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
      /**
       * Óbolos this seal minted (0 when the ledger declined — already paid, or
       * pre-v5 handle). Optional so older callers keep compiling.
       */
      obolosGranted?: number;
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

function readSeal(db: SqlDatabase, date: string): DaySeal | null {
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
 * The Vigor a seal for `date` is worth — the Vigor that day really CLOSED at.
 *
 *   1. If `player_stats.hp` still belongs to `date` (`hp_date === date`, i.e.
 *      the rollover has not fired yet), that is the exact value.
 *   2. Otherwise, for TODAY, the day is fresh: MAX_VIGOR.
 *   3. Otherwise (a past day whose live value the rollover wiped) the closing
 *      Vigor is REPLAYED from the day's own rows: the day started at 100 and
 *      every event applied `clampHp(hp + hp_change)` in order — the exact
 *      arithmetic the live path ran, so the number is the same one the sidebar
 *      showed that night.
 *
 * Why not the old "any other day → 100": a night closed at Vigor 40 paid 1.00x
 * when sealed that night and 1.10x when sealed the morning after, so the
 * ritual "close the day" became "close yesterday". Replaying makes sealing
 * tomorrow worth exactly what sealing tonight was worth — never more.
 */
export function sealVigorFor(
  db: SqlDatabase,
  date: string,
  today: string = getLocalDateString(),
): number {
  const row = db.prepare(
    'SELECT hp, hp_date AS hpDate FROM player_stats WHERE user_id = ?'
  ).get('default') as { hp: number; hpDate: string | null } | undefined;
  if (row && row.hpDate === date) return clampHp(row.hp);
  if (date === today) return MAX_VIGOR;

  const deltas = db.prepare(
    `SELECT hp_change AS hp FROM rpg_events
     WHERE created_at >= ? AND created_at < ?
     ORDER BY created_at ASC, id ASC`
  ).all(date, nextDateString(date)) as Array<{ hp: number }>;
  let vigor = MAX_VIGOR;
  for (const d of deltas) vigor = clampHp(vigor + (d.hp || 0));
  return vigor;
}

/** Everything the Códice page renders for one local day. Read-only. */
export function getDaySummary(
  db: SqlDatabase,
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

  // The timeline (`events`, `byModule`) shows EVERYTHING that was written that
  // day. What the seal certifies — `eventsCount`, `modules`, `empty_day` — is
  // only the meaningful rows (see isMeaningfulEvent): the same numbers
  // `sealDay` will pay for, so the invitation never promises what the seal
  // then refuses.
  const grouped = new Map<string, DaySummaryModule>();
  const meaningfulModules = new Set<string>();
  let meaningfulCount = 0;
  let totalXp = 0;
  let maxCombo = 1.0;
  for (const e of events) {
    totalXp += e.xpGained;
    if (e.comboMultiplier > maxCombo) maxCombo = e.comboMultiplier;
    if (isMeaningfulEvent(e)) {
      meaningfulCount++;
      meaningfulModules.add(e.moduleId);
    }
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
    else if (meaningfulCount === 0) sealBlockedReason = 'empty_day';
  }

  return {
    date,
    isToday: date === today,
    events,
    byModule,
    eventsCount: meaningfulCount,
    totalXp: Math.round(totalXp * 100) / 100,
    maxCombo,
    modules: byModule.map((m) => m.moduleId).filter((m) => meaningfulModules.has(m)),
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
 *   - a day with zero MEANINGFUL events cannot be sealed ('empty_day'): the seal
 *     certifies a day that was lived, not a button that was pressed. Engine rows
 *     (a previous seal, an achievement), undos and zero-XP registrations are not
 *     living (see isMeaningfulEvent) — and they never raise the event cap either.
 *   - XP = round((10 + 2 * min(events, 20)) * vigorBonus(vigor)) — 12..55 XP.
 *
 * The reward is emitted as a flat DAY_SEALED event: no combo, no random bonus.
 * Sealing TODAY advances the global streak (sealing IS showing up); sealing
 * yesterday inside the grace window pays but leaves the streak alone.
 *
 * Seal row + DAY_SEALED event + óbolos are ONE transaction: either the day is
 * sealed and paid, or nothing happened and it can be retried.
 */
export function sealDay(
  db: SqlDatabase,
  date: string = getLocalDateString(),
  today: string = getLocalDateString(),
): SealResult {
  const window = sealWindowStatus(date, today);
  if (window !== 'ok') return { ok: false, reason: window };
  if (readSeal(db, date)) return { ok: false, reason: 'already_sealed' };

  const dayEnd = nextDateString(date);
  const rows = db.prepare(
    `SELECT DISTINCT module_id AS moduleId FROM rpg_events
     WHERE created_at >= ? AND created_at < ? AND ${MEANINGFUL_EVENT_SQL}`
  ).all(date, dayEnd) as Array<{ moduleId: string }>;
  const eventsCount = safeCount(
    db,
    `SELECT COUNT(*) AS c FROM rpg_events WHERE created_at >= ? AND created_at < ? AND ${MEANINGFUL_EVENT_SQL}`,
    date, dayEnd,
  );
  if (eventsCount === 0) return { ok: false, reason: 'empty_day' };

  const modules = rows.map((r) => r.moduleId).sort();
  const vigor = sealVigorFor(db, date, today);
  const xpAwarded = sealXp(eventsCount, vigor);
  const now = localTimestamp();

  const seal = db.transaction((): SealResult => {
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
    // `steady_hand` see the new count in the very same pass. Nested inside
    // this transaction (better-sqlite3 turns it into a savepoint).
    const result = processRpgEvent(db, {
      type: 'DAY_SEALED',
      moduleId: ENGINE_MODULE_ID,
      payload: {
        xp: xpAwarded, hp: 0, date, vigor, eventsCount, modules,
        /** Retro-sealed yesterday inside the grace window. */
        retro: date !== today,
      },
      timestamp: Date.now(),
    });
    // processRpgEvent swallows its own failure (EMPTY_RESULT, 0 XP). A seal
    // whose XP never landed must not exist: throw, and the transaction takes
    // the seal row (and the 0-XP failure row) back with it.
    if (result.xpGained <= 0) {
      throw new Error(`[RPG] sealDay: DAY_SEALED for ${date} paid nothing — seal rolled back`);
    }

    // The seal's óbolos: keyed by the sealed date, so even if two devices race
    // (the day_seals PK already makes the seal first-wins) the ledger entry is
    // minted exactly once. A ledger failure degrades to obolosGranted = 0
    // rather than failing the seal.
    const obolosGranted = grantObolos(db, 'day_sealed', date, sealObolos(xpAwarded));

    return {
      ok: true, date, xpAwarded, vigor, eventsCount, modules,
      achievementIds: result.achievementIds, obolosGranted,
    };
  });

  const outcome = seal();
  if (outcome.ok) emit('rpg:daySealed', { date, xpAwarded });
  return outcome;
}

/** Seals in [fromDate, toDate], inclusive, ascending — the seal calendar. */
export function getSeals(db: SqlDatabase, fromDate: string, toDate: string): DaySeal[] {
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

// ═══════════════════════════════════════════════════════════════════════════
// Óbolos + recompensas propias (phase 3)
// ═══════════════════════════════════════════════════════════════════════════
//
// Design rules (Habitica/Duolingo/Riot research, phase-3 brief):
//   - óbolos are earned ONLY by sealing the day and by achievements. Never per
//     individual action — per-action gold is the infinite-faucet anti-pattern.
//   - they are spent on rewards the player defines ("2 h de jueguito"): the
//     elastic drain that keeps the currency meaning something.
//   - the ledger is append-only. No UPDATE, no DELETE — a correction is a
//     counter-entry. Balance = SUM(delta), always.
//   - nothing in here may ever fail a seal or an RPG event: every write is
//     wrapped, every failure degrades to "no óbolos this time".

/**
 * Óbolos minted by one seal: half its XP, rounded.
 *
 *   obolos = round(sealXp / 2)   →  6 … 28 per day (sealXp is 12…55).
 *
 * Calibration: an ordinary day (5-10 events, full vigor) seals for ~22-33 XP
 * → ~11-17 óbolos, so ~3-4 sealed days afford a small (~50) reward. The declared
 * failure metric is a balance nobody spends for 30 days; keeping the faucet
 * this narrow is what keeps the drain interesting.
 */
export function sealObolos(xpAwarded: number): number {
  return Math.max(0, Math.round(xpAwarded / 2));
}

export type ObolosEarnReason = 'day_sealed' | 'achievement';

/**
 * Appends one EARNING entry, idempotently per (reason, ref_id).
 *
 * Returns the amount actually minted: 0 when that seal/achievement was already
 * paid, when amount is not positive, or when the ledger is unavailable (pre-v5
 * handle mid-migration) — never throws, so the seal/achievement that triggered
 * it can never be taken down by its own reward.
 */
export function grantObolos(
  db: SqlDatabase,
  reason: ObolosEarnReason,
  refId: string,
  amount: number,
): number {
  const minted = Math.round(amount);
  if (!Number.isFinite(minted) || minted <= 0 || !refId) return 0;
  try {
    const now = localTimestamp();
    const info = db.prepare(`
      INSERT INTO obolos_ledger (id, delta, reason, ref_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM obolos_ledger WHERE reason = ? AND ref_id = ?)
    `).run(genId(), minted, reason, refId, now, now, reason, refId);
    if (info.changes === 0) return 0;
    emit('rpg:obolosChanged');
    return minted;
  } catch (err) {
    console.error('[RPG] grantObolos failed:', err);
    return 0;
  }
}

export interface ObolosBalance {
  balance: number;
  earned: number;
  spent: number;
}

/** SUM over the whole ledger. Append-only, so there is nothing to filter. */
export function getObolosBalance(db: SqlDatabase): ObolosBalance {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(delta), 0) AS balance,
             COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS earned,
             COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS spent
      FROM obolos_ledger
    `).get() as ObolosBalance | undefined;
    return row ?? { balance: 0, earned: 0, spent: 0 };
  } catch {
    return { balance: 0, earned: 0, spent: 0 };
  }
}

export interface Reward {
  id: string;
  name: string;
  cost: number;
  /** Name of an icon from the app's own SVG set — never an emoji. */
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  /** How many times it was ever redeemed — counted from the ledger. */
  redeemedCount: number;
}

const REWARD_NAME_MAX = 80;
const REWARD_COST_MAX = 1_000_000;

function readReward(db: SqlDatabase, id: string): Reward | null {
  const row = db.prepare(`
    SELECT r.id, r.name, r.cost, r.icon,
           r.created_at AS createdAt, r.updated_at AS updatedAt,
           (SELECT COUNT(*) FROM obolos_ledger l
             WHERE l.reason = 'reward_redeemed' AND l.ref_id = r.id) AS redeemedCount
    FROM rewards r WHERE r.id = ?
  `).get(id) as Reward | undefined;
  return row ?? null;
}

/** Living rewards, cheapest first, each carrying its lifetime redeem count. */
export function getRewards(db: SqlDatabase): Reward[] {
  try {
    return db.prepare(`
      SELECT r.id, r.name, r.cost, r.icon,
             r.created_at AS createdAt, r.updated_at AS updatedAt,
             (SELECT COUNT(*) FROM obolos_ledger l
               WHERE l.reason = 'reward_redeemed' AND l.ref_id = r.id) AS redeemedCount
      FROM rewards r
      WHERE r.deleted_at IS NULL
      ORDER BY r.cost ASC, r.name COLLATE NOCASE ASC
    `).all() as Reward[];
  } catch {
    return [];
  }
}

/**
 * Upsert. Everything arrives from the renderer, so it is sanitised here:
 * name trimmed and bounded, cost a positive integer, icon a plain token.
 * Returns the stored row, or null when the input was unusable.
 */
export function saveReward(
  db: SqlDatabase,
  input: { id?: unknown; name?: unknown; cost?: unknown; icon?: unknown },
): Reward | null {
  try {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, REWARD_NAME_MAX) : '';
    // Validate BEFORE clamping: clampNumber would lift a cost of 0 (or of
    // garbage) up to the minimum, silently storing a reward nobody priced.
    const rawCost = typeof input.cost === 'number' && Number.isFinite(input.cost)
      ? Math.round(input.cost)
      : 0;
    if (!name || rawCost < 1) return null;
    const cost = Math.min(rawCost, REWARD_COST_MAX);
    const icon = typeof input.icon === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(input.icon)
      ? input.icon
      : null;
    const id = typeof input.id === 'string' && input.id ? input.id : genId();
    const now = localTimestamp();
    // deleted_at is deliberately untouched: editing never resurrects a retired
    // reward, and the UI only ever hands back living ids anyway.
    db.prepare(`
      INSERT INTO rewards (id, name, cost, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, cost = excluded.cost, icon = excluded.icon,
        updated_at = excluded.updated_at
    `).run(id, name, cost, icon, now, now);
    return readReward(db, id);
  } catch (err) {
    console.error('[RPG] saveReward failed:', err);
    return null;
  }
}

/** Soft delete. The ledger keeps every entry the reward ever produced. */
export function deleteReward(db: SqlDatabase, id: string): { ok: boolean } {
  try {
    const now = localTimestamp();
    const info = db.prepare(
      'UPDATE rewards SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, now, typeof id === 'string' ? id : '');
    return { ok: info.changes > 0 };
  } catch {
    return { ok: false };
  }
}

export type RedeemResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'insufficient' | 'not_found' };

/**
 * Spends óbolos on one reward.
 *
 * Deliberately NOT idempotent: redeeming twice is two treats, two spends. The
 * balance check and the ledger append share one transaction so two racing
 * redeems can never both pass on the same óbolos.
 */
export function redeemReward(db: SqlDatabase, id: string): RedeemResult {
  try {
    const redeem = db.transaction((): RedeemResult => {
      const reward = db.prepare(
        'SELECT id, cost FROM rewards WHERE id = ? AND deleted_at IS NULL'
      ).get(typeof id === 'string' ? id : '') as { id: string; cost: number } | undefined;
      if (!reward) return { ok: false, reason: 'not_found' };

      const { balance } = getObolosBalance(db);
      if (balance < reward.cost) return { ok: false, reason: 'insufficient' };

      const now = localTimestamp();
      db.prepare(`
        INSERT INTO obolos_ledger (id, delta, reason, ref_id, created_at, updated_at)
        VALUES (?, ?, 'reward_redeemed', ?, ?, ?)
      `).run(genId(), -reward.cost, reward.id, now, now);
      return { ok: true, balance: balance - reward.cost };
    });
    const result = redeem();
    if (result.ok) emit('rpg:obolosChanged');
    return result;
  } catch (err) {
    console.error('[RPG] redeemReward failed:', err);
    return { ok: false, reason: 'not_found' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// La Tienda (phase 4) — the second drain of the óbolos
// ═══════════════════════════════════════════════════════════════════════════
//
// Design rules (phase 4 brief):
//   - the shop sells ONLY things that did not exist before it: seal-matrix
//     variants, one extra monthly pardon, hero-card frames/backgrounds. The
//     avatar picker's 237.600 free combos are not touched and never will be.
//   - what is BOUGHT syncs (shop_purchases, pure union, deterministic ids);
//     what is EQUIPPED does not (app_state, per-device by decision — two
//     devices may dress the card differently, and app_state never syncs).
//   - every spend is a ledger entry (reason 'shop_purchase'), so the balance
//     stays SUM(delta) with zero special cases.

export interface ShopEquipped {
  sealStyle: string | null;
  frame: string | null;
  background: string | null;
}

/** ShopEquipped field per catalogue kind. */
const EQUIPPED_FIELD: Record<string, keyof ShopEquipped> = {
  seal_style: 'sealStyle',
  frame: 'frame',
  background: 'background',
};

function readAppState(db: SqlDatabase, key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
      { value: string | null } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** The per-device equipment, validated against the catalogue. */
export function getShopEquipped(db: SqlDatabase): ShopEquipped {
  const equipped: ShopEquipped = { sealStyle: null, frame: null, background: null };
  const ownsItem = db.prepare('SELECT 1 FROM shop_purchases WHERE item_id = ?');
  for (const kind of EQUIPPABLE_KINDS) {
    const raw = readAppState(db, EQUIP_STATE_KEYS[kind]);
    // Only a real catalogue id of the right kind that this account actually
    // OWNS survives the read; anything else (stale key, hand-edited value, a
    // purchase that lived on another account) degrades to the default look.
    if (raw && SHOP_CATALOG_BY_ID.get(raw)?.kind === kind && ownsItem.get(raw)) {
      equipped[EQUIPPED_FIELD[kind]] = raw;
    }
  }
  return equipped;
}

export interface ShopCatalogEntry extends ShopItem {
  /**
   * Non-consumables: ever purchased. The pardon: purchased THIS month —
   * i.e. `owned === true` on a pardon means the monthly cap is reached.
   */
  owned: boolean;
  equipped: boolean;
  /** Timestamp of the owning purchase, when owned. */
  purchasedAt: string | null;
}

export interface ShopCatalogResult {
  items: ShopCatalogEntry[];
  balance: number;
  equipped: ShopEquipped;
}

/** The whole catalogue with per-entry state, plus balance — one read for the UI. */
export function getShopCatalog(
  db: SqlDatabase,
  today: string = getLocalDateString(),
): ShopCatalogResult {
  let purchases = new Map<string, string>();
  try {
    const rows = db.prepare(
      'SELECT id, purchased_at AS purchasedAt FROM shop_purchases'
    ).all() as Array<{ id: string; purchasedAt: string }>;
    purchases = new Map(rows.map((r) => [r.id, r.purchasedAt]));
  } catch { /* pre-v6 handle: everything reads as not owned */ }

  const month = monthKey(today);
  const equipped = getShopEquipped(db);
  const items = SHOP_CATALOG.map((item): ShopCatalogEntry => {
    const rowId = purchaseRowId(item.id, item.kind, month);
    const purchasedAt = purchases.get(rowId) ?? null;
    const field = EQUIPPED_FIELD[item.kind];
    return {
      ...item,
      owned: purchasedAt !== null,
      equipped: field ? equipped[field] === item.id : false,
      purchasedAt,
    };
  });

  return { items, balance: getObolosBalance(db).balance, equipped };
}

export type PurchaseResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'insufficient' | 'already_owned' | 'not_found' | 'monthly_cap' };

/**
 * Spends óbolos on one catalogue item.
 *
 * Balance check, purchase row and ledger entry share ONE transaction, so two
 * racing purchases can never both pass on the same óbolos. Both row ids are
 * deterministic (see purchaseRowId), so a double purchase across devices
 * merges into a single row AND a single charge after sync.
 */
export function purchaseShopItem(
  db: SqlDatabase,
  itemId: string,
  today: string = getLocalDateString(),
): PurchaseResult {
  const item = SHOP_CATALOG_BY_ID.get(typeof itemId === 'string' ? itemId : '');
  if (!item) return { ok: false, reason: 'not_found' };
  try {
    const buy = db.transaction((): PurchaseResult => {
      const month = monthKey(today);

      if (item.kind === 'pardon') {
        // The automatic pardons are 2/month (rpg-engine); the shop adds at
        // most PARDON_PURCHASES_PER_MONTH on top. Counted from the purchase
        // rows, so the cap survives restarts and converges across devices.
        if (purchasedPardonExtras(db, month) >= PARDON_PURCHASES_PER_MONTH) {
          return { ok: false, reason: 'monthly_cap' };
        }
      } else if (db.prepare('SELECT 1 FROM shop_purchases WHERE item_id = ? LIMIT 1').get(item.id)) {
        return { ok: false, reason: 'already_owned' };
      }

      const { balance } = getObolosBalance(db);
      if (balance < item.cost) return { ok: false, reason: 'insufficient' };

      const now = localTimestamp();
      const rowId = purchaseRowId(item.id, item.kind, month);
      const info = db.prepare(`
        INSERT OR IGNORE INTO shop_purchases (id, item_id, purchased_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(rowId, item.id, now, now);
      // A row that was already there (raced in from sync between the check
      // and here) means the purchase happened elsewhere: charge nothing.
      if (info.changes === 0) {
        return { ok: false, reason: item.kind === 'pardon' ? 'monthly_cap' : 'already_owned' };
      }
      db.prepare(`
        INSERT OR IGNORE INTO obolos_ledger (id, delta, reason, ref_id, created_at, updated_at)
        VALUES (?, ?, 'shop_purchase', ?, ?, ?)
      `).run(`shop:${rowId}`, -item.cost, item.id, now, now);
      return { ok: true, balance: balance - item.cost };
    });
    const result = buy();
    if (result.ok) {
      emit('rpg:obolosChanged');
      emit('rpg:shopChanged');
    }
    return result;
  } catch (err) {
    console.error('[RPG] purchaseShopItem failed:', err);
    return { ok: false, reason: 'not_found' };
  }
}

export type EquipResult =
  | { ok: true; equipped: ShopEquipped }
  | { ok: false; reason: 'not_found' | 'not_owned' | 'not_equippable' };

/**
 * Equips one owned item (or, with itemId null + a kind, restores that kind's
 * default look). Per-device by design: app_state does not sync, so each
 * device dresses its own card. What is OWNED still syncs everywhere.
 */
export function equipShopItem(
  db: SqlDatabase,
  itemId: string | null,
  kind?: ShopItemKind,
): EquipResult {
  try {
    if (itemId === null) {
      const stateKey = kind ? EQUIP_STATE_KEYS[kind] : undefined;
      if (!stateKey || !EQUIPPABLE_KINDS.includes(kind as ShopItemKind)) {
        return { ok: false, reason: 'not_equippable' };
      }
      db.prepare('DELETE FROM app_state WHERE key = ?').run(stateKey);
      emit('rpg:shopChanged');
      return { ok: true, equipped: getShopEquipped(db) };
    }

    const item = SHOP_CATALOG_BY_ID.get(typeof itemId === 'string' ? itemId : '');
    if (!item) return { ok: false, reason: 'not_found' };
    if (!EQUIPPABLE_KINDS.includes(item.kind)) return { ok: false, reason: 'not_equippable' };
    const owned = db.prepare('SELECT 1 FROM shop_purchases WHERE item_id = ? LIMIT 1').get(item.id);
    if (!owned) return { ok: false, reason: 'not_owned' };

    db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)')
      .run(EQUIP_STATE_KEYS[item.kind], item.id);
    emit('rpg:shopChanged');
    return { ok: true, equipped: getShopEquipped(db) };
  } catch (err) {
    console.error('[RPG] equipShopItem failed:', err);
    return { ok: false, reason: 'not_found' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Maestrías por módulo (phase 4)
// ═══════════════════════════════════════════════════════════════════════════
//
// The global level becomes a badge of history; the four per-module bars are
// what makes day 180 feel different from day 30. Fuel: the mastery_xp
// ACCUMULATOR (core v6) — rpg_events is pruned at 365 days, so a mastery can
// never be recomputed from it. Backfilled once by the migration, incremented
// forward by every event, merged across devices by MAX(xp) per module.

/** The four modules that get a mastery bar (same set as "Día Perfecto"). */
export const MASTERY_MODULES = ['quests', 'nutrition', 'finance', 'cauldron'] as const;

/** SQL list of the mastery modules — fixed literals, safe to inline. */
const MASTERY_MODULES_SQL = MASTERY_MODULES.map((m) => `'${m}'`).join(', ');

/**
 * Moves one module's accumulator by `xpDelta`. Same transaction as the event
 * insert — but wrapped, because a pre-v6 handle mid-migration must degrade to
 * "no mastery this time", never take the XP down with it.
 *
 *   - positive delta: an event paid → added.
 *   - negative delta: an UNDO took its original back → subtracted, floored at
 *     0, and never creates a row. (A negative-XP EVENT never reaches here: the
 *     engine passes its logged XP, which is 0 for anything that did not pay.)
 *   - only the four bar modules: the engine's own 'rpg' rows (seal,
 *     achievements) used to grow a phantom `mastery_xp('rpg')` row that
 *     nothing reads but everything syncs.
 */
export function bumpMasteryXp(
  db: SqlDatabase,
  moduleId: string,
  xpDelta: number,
  now: string = localTimestamp(),
): void {
  // Symmetric rounding: Math.round(-7.5) is -7 in JS while Math.round(7.5) is
  // 8, so an add/refund pair on a x1.5 bonus leaked +1 mastery per cycle.
  const delta = Math.sign(xpDelta) * Math.round(Math.abs(xpDelta));
  if (!Number.isFinite(delta) || delta === 0 || !moduleId) return;
  if (!(MASTERY_MODULES as readonly string[]).includes(moduleId)) return;
  try {
    if (delta > 0) {
      db.prepare(`
        INSERT INTO mastery_xp (module_id, xp, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(module_id) DO UPDATE SET xp = xp + excluded.xp, updated_at = excluded.updated_at
      `).run(moduleId, delta, now);
    } else {
      db.prepare(
        'UPDATE mastery_xp SET xp = MAX(0, xp + ?), updated_at = ? WHERE module_id = ?'
      ).run(delta, now, moduleId);
    }
  } catch { /* pre-v6 handle: the accumulator can wait, the event cannot */ }
}

/**
 * Idempotent backfill: seeds the accumulator from the surviving event log for
 * modules that have NO row yet, and never touches a module that already has
 * one (its accumulator is ahead of the pruned log by definition). Same shape
 * as the v6 migration, restricted to the bar modules — exported for tests and
 * self-heal.
 */
export function backfillMasteryXp(db: SqlDatabase): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO mastery_xp (module_id, xp, updated_at)
        SELECT module_id, CAST(ROUND(SUM(MAX(xp_gained, 0))) AS INTEGER), ?
        FROM rpg_events
        WHERE module_id IN (${MASTERY_MODULES_SQL})
        GROUP BY module_id
    `).run(localTimestamp());
  } catch { /* pre-v6 handle */ }
}

export interface MasteryState {
  moduleId: string;
  xp: number;
  level: number;
  /** Untranslated (Spanish) rank name; the UI translates via `levelKey`. */
  levelName: string;
  /** i18n key: `rpg.mastery.ranks.<rank>`. */
  levelKey: string;
  /** Cumulative XP that opens the next level; null at level 10. */
  nextLevelXp: number | null;
  /** 0..1 within the current level (1 at the cap). */
  progress: number;
}

/** One bar per event module, always all four, zeroes included. */
export function getMasteries(db: SqlDatabase): MasteryState[] {
  let byModule = new Map<string, number>();
  try {
    const rows = db.prepare('SELECT module_id AS m, xp FROM mastery_xp').all() as
      Array<{ m: string; xp: number }>;
    byModule = new Map(rows.map((r) => [r.m, Math.max(0, r.xp)]));
  } catch { /* pre-v6 handle: four empty bars */ }

  return MASTERY_MODULES.map((moduleId) => {
    const xp = byModule.get(moduleId) ?? 0;
    return { moduleId, xp, ...masteryInfo(xp) };
  });
}

/** Runs the catalogue sweep once per process, lazily. */
let backfillDone = false;
function ensureBackfill(db: SqlDatabase): void {
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

  ipcHandle('rpg:getDaySummary', (_e, date?: string | null): DaySummaryContract => {
    const db = getDb();
    const today = getLocalDateString();
    rolloverVigor(db, today);
    return getDaySummary(db, asDay(date, today), today);
  });

  ipcHandle('rpg:sealDay', (_e, date?: string | null): SealResultContract => {
    const db = getDb();
    const today = getLocalDateString();
    return sealDay(db, asDay(date, today), today);
  });

  ipcHandle('rpg:getSeals', (_e, fromDate: string, toDate: string): DaySealContract[] =>
    getSeals(getDb(), fromDate, toDate));

  // ── Óbolos + recompensas propias ──
  ipcHandle('rpg:getObolosBalance', (): ObolosBalanceContract => getObolosBalance(getDb()));

  ipcHandle('rpg:getRewards', (): RewardContract[] => getRewards(getDb()));

  ipcHandle('rpg:saveReward', (_e, input: Record<string, unknown>): RewardContract | null =>
    saveReward(getDb(), input ?? {}));

  ipcHandle('rpg:deleteReward', (_e, id: string): { ok: boolean } => deleteReward(getDb(), id));

  ipcHandle('rpg:redeemReward', (_e, id: string): RedeemResultContract => redeemReward(getDb(), id));

  // ── La Tienda + maestrías (phase 4) ──
  ipcHandle('rpg:getShopCatalog', (): ShopCatalogResultContract => getShopCatalog(getDb()));

  ipcHandle('rpg:purchaseShopItem', (_e, itemId: string): PurchaseShopResultContract =>
    purchaseShopItem(getDb(), itemId));

  ipcHandle('rpg:equipShopItem', (_e, itemId: string | null, kind?: string): EquipShopResultContract =>
    equipShopItem(getDb(), itemId, kind as ShopItemKind | undefined));

  ipcHandle('rpg:getMasteries', (): MasteryStateContract[] => {
    const db = getDb();
    // Self-heal for handles whose v6 migration ran against an empty log (a
    // fresh install that then pulled history via sync): fills only modules
    // with no row yet, so it can never double-count. Idempotent and cheap.
    backfillMasteryXp(db);
    return getMasteries(db);
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
export function restorePlayerStats(db: SqlDatabase, stats: Record<string, unknown>): { success: boolean } {
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
