/**
 * The Achievement catalogue — declarative, pure, zero SQL.
 *
 * Design rules this file obeys (phase 2 research: Duolingo, Habitica, Forest):
 *
 *  1. NOTHING PUNITIVE. An achievement is never lost, never expires, and no
 *     achievement is awarded for avoiding something.
 *  2. NO GRIND. "Complete 2000 things" is not a goal, it is a chore. The single
 *     exception the design allows is the CRONISTA family (100/500/2000 logged
 *     events) — it is the chronicle of the account, an I/II/III ladder that
 *     accrues from playing normally, not from farming.
 *  3. REWARD MASTERY, VARIETY AND DISCOVERY. Most entries fire from doing
 *     something *well* (max combo, four modules in a day), something *rare*
 *     (a 3.0x roll — 2% odds), or something the player did not know existed
 *     (`hidden: true` → the UI renders "???" until it pops).
 *
 * Calibration (verified by `shared/rpg-engine.test.ts`):
 *   - 40 entries, 8 hidden (20%).
 *   - ~22 of the 40 are reachable inside a normal first month (~55%).
 *   - `first_step` fires on the FIRST event of any kind — a brand new player
 *     sees the shelf move within their first ten minutes.
 *
 * Every `check` is a pure predicate over an `AchievementContext` that the main
 * process assembles (electron/ipc/rpg-handlers.ts). Checks never touch the
 * database: the engine decides which context fields are worth paying for and
 * memoises them, so a catalogue entry stays trivially unit-testable with a
 * plain object literal.
 */

/** The event that just landed. `null` while sweeping the catalogue (backfill). */
export interface AchievementEventContext {
  /** rpg_events.event_type, e.g. 'TASK_COMPLETED'. */
  type: string;
  /** rpg_events.module_id, e.g. 'quests' | 'nutrition' | 'finance' | 'cauldron' | 'rpg'. */
  moduleId: string;
  /** The event payload, already parsed. `{}` when the event carried none. */
  payload: Record<string, unknown>;
  /** Local hour the event was written at, 0–23. */
  hour: number;
  /** Local date (YYYY-MM-DD) the event belongs to. */
  date: string;
  /** Local weekday of `date`: 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Combo multiplier actually applied (1.0 for flat events). */
  comboMultiplier: number;
  /** Random bonus actually rolled (1.0 / 1.5 / 2.0 / 3.0). */
  bonusMultiplier: number;
  /** XP the event paid, milestone bonus included. */
  xpGained: number;
  /** True when this very event spent one of the month's streak pardons. */
  pardonUsed: boolean;
}

export interface AchievementStatsContext {
  level: number;
  xp: number;
  /** Vigor (today's HP). */
  hp: number;
  streak: number;
  bestStreak: number;
  /** Local date the player checked into the Inn, or null when not resting. */
  innSince: string | null;
}

/**
 * Everything a `check` may read.
 *
 * "Day-scoped" fields (`*Today`, `epicsToday`, `xpToday`, `maxComboToday`) are
 * computed over the REFERENCE DAY: the current event's local date, or today
 * when there is no event (backfill).
 *
 * All fields are conceptually plain data. The engine installs the expensive
 * ones as memoised lazy getters, so an entry that is already unlocked — or a
 * catalogue that never asks — costs nothing.
 */
export interface AchievementContext {
  readonly event: AchievementEventContext | null;
  readonly stats: AchievementStatsContext;
  /** Today's local date (YYYY-MM-DD). */
  readonly today: string;
  /** Rows currently in rpg_events (see CRONISTA note on retention). */
  readonly totalEvents: number;
  /** Lifetime event count per event_type. */
  readonly countByType: Readonly<Record<string, number>>;
  /** Lifetime event count per module_id. */
  readonly countByModule: Readonly<Record<string, number>>;
  /** Events on the reference day. */
  readonly eventsToday: number;
  /** Reference-day event count per event_type. */
  readonly countByTypeToday: Readonly<Record<string, number>>;
  /** Distinct module_ids with at least one event on the reference day. */
  readonly modulesToday: readonly string[];
  /** Distinct event_types on the reference day. */
  readonly typesToday: readonly string[];
  /** Reference-day events that rolled the 2%-odds 3.0x bonus. */
  readonly epicsToday: number;
  /** XP earned on the reference day. */
  readonly xpToday: number;
  /** Highest combo_multiplier reached on the reference day. */
  readonly maxComboToday: number;
  /**
   * Whole days between the previous event and this one. 0 when this is the very
   * first event ever — a new account is not a homecoming.
   */
  readonly daysSinceLastActivity: number;
  /** Distinct habits ever checked (rpg_events.ref_id on HABIT_CHECKED). */
  readonly distinctHabits: number;
  /** Rows in day_seals. */
  readonly sealsCount: number;
  /** The character has been given a name. */
  readonly hasCharacterName: boolean;
}

export interface AchievementDef {
  /** Stable id. Also the primary key in `achievements_unlocked` and the i18n leaf. */
  id: string;
  /** `rpg.achievements.<id>` — `.title` and `.desc` live underneath. */
  i18nKey: string;
  /** The UI renders "???" for a hidden entry until it is unlocked. */
  hidden: boolean;
  /** Pure predicate. Never throws — the engine still guards it. */
  check: (ctx: AchievementContext) => boolean;
}

/** Flat XP paid once per achievement. No combo, no random bonus. */
export const ACHIEVEMENT_XP = 25;

/**
 * Óbolos paid once per achievement (phase 3). Flat and idempotent — the ledger
 * entry is keyed by (reason='achievement', ref_id=achievementId), so neither a
 * re-unlock nor the backfill can pay it twice.
 */
export const ACHIEVEMENT_OBOLOS = 15;

/**
 * The four modules that emit RPG events. Character has no event surface, so
 * "Día Perfecto" is Questify + Nutrify + Coinify + Caldero.
 */
export const EVENT_MODULES = ['quests', 'nutrition', 'finance', 'cauldron'] as const;

/** Bonus multiplier that counts as an "epic" roll (2% of the table). */
export const EPIC_BONUS = 3.0;

/** Days of silence that turn the next event into a homecoming. */
export const RETURN_GAP_DAYS = 14;

const n = (counts: Readonly<Record<string, number>>, key: string): number => counts[key] ?? 0;

/** Builds an entry, deriving `i18nKey` so the two can never drift apart. */
function ach(
  id: string,
  hidden: boolean,
  check: (ctx: AchievementContext) => boolean,
): AchievementDef {
  return { id, i18nKey: `rpg.achievements.${id}`, hidden, check };
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ── Primeros pasos ────────────────────────────────────────────────────────
  // `first_step` and `awakening` are the two entries every existing install
  // already satisfies: the shelf reads 2/40 the moment the backfill runs.
  ach('first_step', false, (c) => c.totalEvents >= 1),
  ach('awakening', false, (c) => c.hasCharacterName),
  ach('first_quest', false, (c) => n(c.countByType, 'TASK_COMPLETED') >= 1),
  ach('first_habit', false, (c) => n(c.countByType, 'HABIT_CHECKED') >= 1),
  ach('first_meal', false, (c) => n(c.countByType, 'MEAL_LOGGED') >= 1),
  ach('first_coin', false, (c) =>
    n(c.countByType, 'EXPENSE_LOGGED') + n(c.countByType, 'INCOME_LOGGED') >= 1),
  ach('first_brew', false, (c) => n(c.countByType, 'POMODORO_COMPLETED') >= 1),
  ach('first_seal', false, (c) => c.sealsCount >= 1),

  // ── Ritmo y tiempo ────────────────────────────────────────────────────────
  // Madrugador and Trasnochador are deliberately disjoint (< 06:00 vs >= 23:00)
  // so a single 01:00 event cannot pop both at once.
  ach('early_bird', false, (c) => !!c.event && c.event.hour < 6),
  ach('night_owl', false, (c) => !!c.event && c.event.hour >= 23),
  ach('perfect_day', false, (c) => EVENT_MODULES.every((m) => c.modulesToday.includes(m))),
  ach('three_epics', false, (c) => c.epicsToday >= 3),
  // The app REWARDS coming back. There is no penalty anywhere for the 14 days
  // of silence — the homecoming is the only thing the absence produces.
  ach('hero_return', false, (c) => !!c.event && c.daysSinceLastActivity >= RETURN_GAP_DAYS),
  ach('sunday_guardian', false, (c) => !!c.event && c.event.weekday === 0 && c.eventsToday >= 5),

  // ── Maestría y variación ──────────────────────────────────────────────────
  ach('combo_master', false, (c) => c.maxComboToday >= 2.0),
  ach('lucky_strike', true, (c) => !!c.event && c.event.bonusMultiplier >= EPIC_BONUS),
  ach('polymath', false, (c) => c.typesToday.length >= 5),
  ach('golden_day', false, (c) => c.xpToday >= 200),
  ach('epic_quest', false, (c) => n(c.countByTypeToday, 'TASK_COMPLETED') >= 10),
  ach('deep_work', false, (c) => n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 4),

  // ── Familias por módulo ───────────────────────────────────────────────────
  ach('ritualist', false, (c) => c.distinctHabits >= 5),
  ach('table_guardian', false, (c) => n(c.countByType, 'DAY_SUMMARY') >= 7),
  ach('debt_free', false, (c) => n(c.countByType, 'LOAN_SETTLED') >= 1),
  ach('ledger_closed', false, (c) => n(c.countByType, 'BUDGET_MONTH_MET') >= 1),
  ach('scribe_of_accounts', true, (c) => n(c.countByType, 'STATEMENT_IMPORTED') >= 1),
  ach('cauldron_master', false, (c) => n(c.countByType, 'POMODORO_COMPLETED') >= 100),

  // ── El Códice ─────────────────────────────────────────────────────────────
  ach('sealed_week', false, (c) => c.sealsCount >= 7),
  ach('steady_hand', false, (c) => c.sealsCount >= 30),
  // Retro-sealing yesterday is a first-class move, not a loophole: the ritual
  // is skippable and back-sealable by design, so it gets its own reward.
  ach('late_memory', true, (c) =>
    c.event?.type === 'DAY_SEALED' && c.event.payload.retro === true),
  ach('radiant_seal', true, (c) =>
    c.event?.type === 'DAY_SEALED' && typeof c.event.payload.vigor === 'number'
    && (c.event.payload.vigor as number) >= 90),

  // ── Cronista: the ONE counting family the design allows ───────────────────
  // Counts rows currently in rpg_events. The sync layer prunes at 365 days, so
  // Cronista III means "2000 events inside a year" (~5.5/day) rather than a
  // literal lifetime total. Once unlocked it is never re-checked nor revoked,
  // so pruning can never take it away.
  ach('chronicler_i', false, (c) => c.totalEvents >= 100),
  ach('chronicler_ii', false, (c) => c.totalEvents >= 500),
  ach('chronicler_iii', false, (c) => c.totalEvents >= 2000),

  // ── Progresión ────────────────────────────────────────────────────────────
  ach('squire', false, (c) => c.stats.level >= 5),
  ach('steadfast', false, (c) => c.stats.streak >= 7 || c.stats.bestStreak >= 7),
  ach('monthly_vow', false, (c) => c.stats.streak >= 30 || c.stats.bestStreak >= 30),

  // ── Rarezas de descubrimiento (todas ocultas) ─────────────────────────────
  ach('the_pardon', true, (c) => !!c.event?.pardonUsed),
  ach('deserved_rest', true, (c) => c.stats.innSince !== null),
  ach('day_off', true, (c) => n(c.countByType, 'HABIT_SKIPPED') >= 1),
  // El evento se llamó NUTRITION_DAY_REOPENED hasta que la reapertura pasó a
  // ir por la vía de undo del motor: quedó esperando un tipo que ya nadie emite.
  ach('second_chance', true, (c) => n(c.countByType, 'DAY_REOPENED') >= 1),
];

/** Catalogue size, exported so the UI can render "n / TOTAL" without importing the array. */
export const ACHIEVEMENTS_TOTAL = ACHIEVEMENTS.length;

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, AchievementDef> =
  new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
