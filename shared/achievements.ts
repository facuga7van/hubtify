/**
 * The Achievement catalogue — declarative, pure, zero SQL.
 *
 * Reglas que este archivo obedece:
 *
 *  1. NADA PUNITIVO. Un logro no se pierde nunca, no vence nunca, y ninguno se
 *     paga por EVITAR algo. Un huevo sobre una ausencia solo puede caer en el
 *     REGRESO — mientras el hueco dura no hay evento, no hay contexto y no
 *     corre ningún `check`. Si el copy se lee como reproche, está mal escrito.
 *
 *  2. ESCALERAS SÍ, PERO CON PISO DE CALENDARIO. Una familia I/II/III es
 *     legítima solo cuando sus peldaños no se pueden subir con ganas:
 *       a. Todo peldaño por encima del I se mide en unidades que el calendario
 *          no deja apurar (días distintos, meses, sellos) o en profundidad que
 *          no se fabrica (N hábitos con M marcas CADA UNO). Un peldaño que se
 *          alcanza en una tarde de entusiasmo es el mismo logro dos veces.
 *       b. El peldaño I es la ÚNICA "primera vez" a la que un módulo tiene
 *          derecho. Si un módulo necesita seis medallas de estreno, el que está
 *          mal calibrado es el módulo.
 *       c. Si el camino óptimo para subir un tier es ensuciar los datos del
 *          usuario (partir una compra, crear hábitos falsos), el tier está mal.
 *     CRONISTA sigue siendo la excepción declarada: cuenta filas de rpg_events.
 *
 *  3. RECOMPENSAR MAESTRÍA, VARIEDAD Y DESCUBRIMIENTO. Un logro se paga por
 *     hacer algo BIEN (combo máximo), algo RARO (una tirada de 3.0) o algo que
 *     el jugador no sabía que existía.
 *
 *  4. LOS HUEVOS SON COINCIDENCIA, NO ESFUERZO. Un `hidden: true` de la familia
 *     de coincidencia se ENCUENTRA, no se persigue. Test único: si alguien
 *     puede leer el título y proponérselo, es una misión. Que lo vea el 0,3%
 *     de la gente no es un costo: es el producto.
 *
 *  5. NINGUNA ENTRADA MIDE EL PROPIO CATÁLOGO. Un medidor de completitud
 *     convierte al último huevo en una casilla de checklist.
 *
 *  6. EL BACKFILL RECONOCE, NO REGALA. La barrida sin evento (`event === null`)
 *     debe encontrar únicamente peldaños I y estados de identidad. Toda entrada
 *     por encima exige `!!c.event`: se gana en el acto que la dispara.
 *
 *  7. NUTRIFY NO ESCALONA COMIDA, PESO NI CUMPLIMIENTO. Solo el archivo
 *     (pergaminos, días cerrados como crónica). `the_pact_kept` y
 *     `honest_scales` son terminales por diseño: no admiten tier II jamás.
 *
 * Calibración (verificada por `shared/rpg-engine.test.ts`):
 *   - Dos denominadores. La VÍA DE PROGRESIÓN se calibra; la COLA DE AZAR (los
 *     huevos de coincidencia) no se calibra, se acepta.
 *   - Objetivo sobre el catálogo completo: día 1 <= 2%, semana 1 ~6%,
 *     mes 1 ~15%, mes 6 ~32%, año 1 ~45%, techo asintótico ~62%. El resto que
 *     nunca se completa ES la cola de azar, y es deliberado.
 *   - LA MÉTRICA QUE MANDA: ningún tramo de 30 días del primer año puede
 *     terminar sin un solo desbloqueo.
 *   - `first_step` dispara con el PRIMER evento de cualquier tipo.
 *   - El XP guarda dos decimales (`Math.round(x*100)/100`): toda igualdad
 *     contra XP usa `Math.floor`. `rpg_events` se poda a 365 días: ningún
 *     umbral sobre `countByType` puede superar lo que cabe en un año.
 *
 * Every `check` is a pure predicate over an `AchievementContext` that the main
 * process assembles (shared-logic/modules/rpg-handlers.ts). Checks never touch
 * the database: the engine decides which context fields are worth paying for
 * and memoises them, so a catalogue entry stays trivially unit-testable with a
 * plain object literal.
 */

import { daysDiff } from './rpg-engine';

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

/** One finance movement of the reference day, as seen by the ledger eggs. */
export interface AchievementMovement {
  type: 'expense' | 'income';
  amount: number;
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
 *
 * Every "days since the last X" field is measured BEFORE the current event is
 * inserted (`previousEvent` pattern): computed afterwards it would always be 0.
 */
export interface AchievementContext {
  readonly event: AchievementEventContext | null;
  readonly stats: AchievementStatsContext;
  /** Today's local date (YYYY-MM-DD). */
  readonly today: string;
  /** Meaningful rows currently in rpg_events (see CRONISTA note on retention). */
  readonly totalEvents: number;
  /** Lifetime event count per event_type (raw: zero-XP rows included). */
  readonly countByType: Readonly<Record<string, number>>;
  /** Lifetime event count per module_id (raw). */
  readonly countByModule: Readonly<Record<string, number>>;
  /** Meaningful events on the reference day. */
  readonly eventsToday: number;
  /** Reference-day event count per event_type (raw). */
  readonly countByTypeToday: Readonly<Record<string, number>>;
  /** Distinct module_ids with at least one meaningful event on the reference day. */
  readonly modulesToday: readonly string[];
  /** Distinct meaningful event_types on the reference day. */
  readonly typesToday: readonly string[];
  /** Reference-day events that rolled the 2%-odds 3.0x bonus. */
  readonly epicsToday: number;
  /** XP earned on the reference day. */
  readonly xpToday: number;
  /** Highest combo_multiplier reached on the reference day. */
  readonly maxComboToday: number;
  /**
   * Whole days between the previous MEANINGFUL event and this one. 0 when this
   * is the very first event ever — a new account is not a homecoming.
   */
  readonly daysSinceLastActivity: number;
  /** Distinct habits ever checked (rpg_events.ref_id on HABIT_CHECKED). */
  readonly distinctHabits: number;
  /** Rows in day_seals. */
  readonly sealsCount: number;
  /** The character has been given a name. */
  readonly hasCharacterName: boolean;

  // ── Coinify ──────────────────────────────────────────────────────────────
  /** Expense categories with 3+ movements each (transfers and card payments excluded). */
  readonly bestiaryCategories: number;
  /** Budgets currently defined with a positive monthly limit. */
  readonly budgetsActive: number;
  /** Distinct calendar months (YYYY-MM) with at least one statement imported. */
  readonly statementImportMonths: number;
  /** Loans settled after being open for 7+ days. */
  readonly loansSettledAged: number;
  /** Distinct calendar months with at least one movement. */
  readonly financeActiveMonths: number;
  /** Credit card statements marked as paid. */
  readonly statementsPaid: number;
  /** The reference day's movements (type + amount), oldest first. */
  readonly financeMovementsToday: readonly AchievementMovement[];
  /**
   * Whole days since the previous event of the CURRENT event's module,
   * measured before the insert. 0 when there is no event or no previous one.
   */
  readonly daysSinceLastInModule: number;
  /** Local date (YYYY-MM-DD) of the first event of the current event's module, or null. */
  readonly firstEventDateInModule: string | null;
  /** Day seals whose `modules` include 'finance'. */
  // TODO(achv2-catalog): not in the contract table — ENGINE: COUNT(*) FROM day_seals
  // WHERE modules carries 'finance' (the column is the JSON array the seal payload
  // also ships). Needed by `sealed_with_gold`.
  readonly sealsWithFinance: number;
  /** Day seals whose `modules` include all four EVENT_MODULES. */
  // TODO(achv2-catalog): not in the contract table — ENGINE: COUNT(*) FROM day_seals
  // whose modules include every id in EVENT_MODULES. Needed by `seal_of_four_hands`.
  readonly sealsWithAllModules: number;

  // ── Questify ─────────────────────────────────────────────────────────────
  /** Check count per habit (kind='check', not deleted), one number per habit. */
  readonly checksPerHabit: readonly number[];
  /** TASK_COMPLETED rows whose payload.tier === 3. */
  readonly epicTasksTotal: number;
  /** TASK_COMPLETED rows whose payload.repeated is true. */
  readonly repeatedTasksTotal: number;
  /** TASK_COMPLETED rows whose payload.overdue is true. */
  readonly overdueClosedTotal: number;
  /** habit_checks rows with kind='shield'. */
  readonly habitShieldsSpent: number;
  /** Tasks still open right now (same rule as `quests:getPendingCount`). */
  readonly pendingTasks: number;
  /**
   * Only for a HABIT_CHECKED event: whole days since that same habit was last
   * checked before this one. 0 for any other event or when there is no previous check.
   */
  readonly daysSinceThisHabit: number;

  // ── Caldero ──────────────────────────────────────────────────────────────
  /** Distinct calendar days with at least one POMODORO_COMPLETED. */
  readonly pomodoroDays: number;
  /** Local hours (0–23) of the reference day's POMODORO_COMPLETED rows. */
  readonly pomodoroHoursToday: readonly number[];
  /** Whole days since the previous POMODORO_COMPLETED, measured before the insert. 0 if none. */
  readonly daysSinceLastPomodoro: number;
  /** POMODORO_COMPLETED rows that carried a payload.taskId. */
  // TODO(achv2-catalog): not in the contract table — ENGINE: COUNT(*) FROM rpg_events
  // WHERE event_type='POMODORO_COMPLETED' AND json_extract(payload,'$.taskId') IS NOT NULL.
  // Needed by `labelled_potion`.
  readonly pomodorosWithTask: number;

  // ── Transversales ────────────────────────────────────────────────────────
  /** Local hour of the reference day's first / last event, or null on an empty day. */
  readonly firstHourToday: number | null;
  readonly lastHourToday: number | null;
  /**
   * Whole days between the last meaningful event BEFORE the reference day and
   * the reference day itself. Unlike `daysSinceLastActivity` it survives the
   * whole day of the comeback. 0 when there is no earlier event.
   */
  readonly gapBeforeToday: number;
  /** Whole days since the account's first event, from a date that is never pruned. */
  readonly daysSinceFirstEvent: number;

  // ── Nutrify ──────────────────────────────────────────────────────────────
  /** Distinct meal slots logged on the reference day. */
  readonly mealSlotsToday: readonly string[];

  // ── El Códice / óbolos ───────────────────────────────────────────────────
  /** Rewards ever redeemed at the counter. */
  readonly rewardsRedeemed: number;
  /** Óbolos ever spent (positive number). */
  readonly obolosSpent: number;
  /** Current óbolos balance. */
  readonly obolosBalance: number;
  /** Nights of the LAST completed Inn stay (`player_stats.inn_last_stay_days`). */
  readonly innNightsLastStay: number;
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

/** The two Coinify events that are a movement in the ledger. */
const MOVEMENT_TYPES: readonly string[] = ['EXPENSE_LOGGED', 'INCOME_LOGGED'];

const n = (counts: Readonly<Record<string, number>>, key: string): number => counts[key] ?? 0;

/** `payload[key]` when it is a number, else null — the `radiant_seal` typeof + cast, once. */
function num(e: AchievementEventContext, key: string): number | null {
  return typeof e.payload[key] === 'number' ? (e.payload[key] as number) : null;
}

const isMovement = (e: AchievementEventContext): boolean => MOVEMENT_TYPES.includes(e.type);

/** Amount of the current event when it is a movement carrying one; null otherwise. */
function movementAmount(c: AchievementContext): number | null {
  return c.event && isMovement(c.event) ? num(c.event, 'amount') : null;
}

/** Whole-unit digits of an amount, for the numeric eggs. */
const digits = (amount: number): string => String(Math.round(Math.abs(amount)));

const monthOf = (date: string): number => Number(date.slice(5, 7));
const dayOf = (date: string): number => Number(date.slice(8, 10));
/** 'MM-DD' of a YYYY-MM-DD date. */
const mmdd = (date: string): string => date.slice(5, 10);

/** True when two movements of the day share an amount, optionally of given types. */
function sameAmountPair(
  moves: readonly AchievementMovement[],
  accept: (a: AchievementMovement, b: AchievementMovement) => boolean,
): boolean {
  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      if (moves[i].amount === moves[j].amount && accept(moves[i], moves[j])) return true;
    }
  }
  return false;
}

/** Mean synodic month, in days. */
const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

/**
 * Pure full-moon test for a local date, evaluated at the night the egg asks
 * about (23:30 of that date). Lunar age is the time since the epoch new moon
 * modulo the synodic month; the moon is "full" inside a ±1 day window around
 * the half-month (14.77 days). Drifts a few hours per decade — irrelevant here.
 */
export function isFullMoon(date: string): boolean {
  const y = Number(date.slice(0, 4));
  const at = Date.UTC(y, monthOf(date) - 1, dayOf(date), 23, 30);
  const days = (at - NEW_MOON_EPOCH_MS) / 86_400_000;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  return Math.abs(age - SYNODIC_MONTH / 2) < 1;
}

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
  // already satisfies: the shelf moves the moment the backfill runs.
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
  ach('perfect_day', false, (c) =>
    !!c.event && EVENT_MODULES.every((m) => c.modulesToday.includes(m))),
  ach('three_epics', false, (c) => !!c.event && c.epicsToday >= 3),
  // The app REWARDS coming back. There is no penalty anywhere for the 14 days
  // of silence — the homecoming is the only thing the absence produces.
  ach('hero_return', false, (c) => !!c.event && c.daysSinceLastActivity >= RETURN_GAP_DAYS),
  ach('sunday_guardian', false, (c) => !!c.event && c.event.weekday === 0 && c.eventsToday >= 5),
  // Lifetime, not same-day: the four modules have met the player at some point.
  ach('fellowship', false, (c) =>
    !!c.event && EVENT_MODULES.every((m) => n(c.countByModule, m) >= 1)),
  ach('dawn_to_dusk', false, (c) =>
    !!c.event && c.firstHourToday !== null && c.firstHourToday < 7
    && c.lastHourToday !== null && c.lastHourToday >= 22),
  ach('long_night', true, (c) => !!c.event && c.event.hour < 5 && c.eventsToday >= 5),
  ach('unlucky_thirteen', true, (c) =>
    !!c.event && c.event.weekday === 2 && dayOf(c.event.date) === 13),
  ach('suns_edge', true, (c) =>
    !!c.event && (mmdd(c.event.date) === '06-21' || mmdd(c.event.date) === '12-21')),

  // ── Maestría y variación ──────────────────────────────────────────────────
  ach('combo_master', false, (c) => !!c.event && c.maxComboToday >= 2.0),
  ach('lucky_strike', true, (c) => !!c.event && c.event.bonusMultiplier >= EPIC_BONUS),
  ach('polymath', false, (c) => !!c.event && c.typesToday.length >= 7),
  ach('golden_day', false, (c) => !!c.event && c.xpToday >= 350),
  ach('critical_hit', true, (c) =>
    !!c.event && c.event.bonusMultiplier >= 2.0 && c.event.xpGained >= 150),
  ach('million_to_one', true, (c) =>
    !!c.event && c.event.bonusMultiplier >= EPIC_BONUS && c.event.comboMultiplier >= 2.0),
  // The context is built BEFORE the unlock rows of the current event are
  // written, so this pops on the event AFTER the third medallion, not on it.
  ach('medallion_night', true, (c) =>
    !!c.event && n(c.countByTypeToday, 'ACHIEVEMENT_UNLOCKED') >= 3),
  ach('last_ember', true, (c) => !!c.event && c.event.xpGained > 0 && c.stats.hp <= 40),

  // ── Coinify ───────────────────────────────────────────────────────────────
  ach('debt_free', false, (c) => n(c.countByType, 'LOAN_SETTLED') >= 1),
  ach('ledger_closed', false, (c) => n(c.countByType, 'BUDGET_MONTH_MET') >= 1),
  ach('scribe_of_accounts', true, (c) => n(c.countByType, 'STATEMENT_IMPORTED') >= 1),
  // El Banco de Hierro: distinct calendar months with a statement archived.
  ach('iron_bank_i', false, (c) => c.statementImportMonths >= 3),
  ach('iron_bank_ii', false, (c) => !!c.event && c.statementImportMonths >= 12),
  ach('iron_bank_iii', false, (c) => !!c.event && c.statementImportMonths >= 30),
  // Las deudas: only loans that lived 7+ days count — three loans opened and
  // settled in a minute are not debts, they are clicks.
  ach('lannister_i', false, (c) => c.loansSettledAged >= 3),
  ach('lannister_ii', false, (c) => !!c.event && c.loansSettledAged >= 10),
  ach('lannister_iii', false, (c) => !!c.event && c.loansSettledAged >= 25),
  // El invierno: BUDGET_MONTH_MET is de-duplicated by month, one per calendar
  // month at most. Capped at 10 because rpg_events keeps a year at most.
  ach('winter_i', false, (c) => n(c.countByType, 'BUDGET_MONTH_MET') >= 3),
  ach('winter_ii', false, (c) => !!c.event && n(c.countByType, 'BUDGET_MONTH_MET') >= 6),
  ach('winter_iii', false, (c) => !!c.event && n(c.countByType, 'BUDGET_MONTH_MET') >= 10),
  // El bestiario: categories with 3+ real movements each.
  ach('bestiary_i', false, (c) => c.bestiaryCategories >= 8),
  ach('bestiary_ii', false, (c) => !!c.event && c.bestiaryCategories >= 14),
  ach('bestiary_iii', false, (c) => !!c.event && c.bestiaryCategories >= 22),
  // La Senda: distinct calendar months with movements. Months arrive one at a time.
  ach('path_i', false, (c) => c.financeActiveMonths >= 6),
  ach('path_ii', false, (c) => !!c.event && c.financeActiveMonths >= 18),
  ach('path_iii', false, (c) => !!c.event && c.financeActiveMonths >= 36),
  ach('master_of_coin', false, (c) =>
    !!c.event
    && n(c.countByType, 'EXPENSE_LOGGED') + n(c.countByType, 'INCOME_LOGGED') >= 2
    && n(c.countByType, 'LOAN_SETTLED') >= 2
    && n(c.countByType, 'BUDGET_MONTH_MET') >= 2
    && n(c.countByType, 'STATEMENT_IMPORTED') >= 2),
  ach('heavy_tome', true, (c) =>
    c.event?.type === 'STATEMENT_IMPORTED' && (num(c.event, 'count') ?? 0) >= 120),
  // Tied to the two Coinify events nobody can fabricate: x2 combo alone is a
  // first-week thing, x2 combo on a settled loan or a closed month is not.
  ach('contract_collected', true, (c) =>
    !!c.event && (c.event.type === 'LOAN_SETTLED' || c.event.type === 'BUDGET_MONTH_MET')
    && c.event.comboMultiplier >= 2.0),
  ach('sealed_with_gold', false, (c) => !!c.event && c.sealsWithFinance >= 10),
  ach('drawn_ward', false, (c) =>
    !!c.event && c.budgetsActive >= 3 && n(c.countByType, 'BUDGET_MONTH_MET') >= 1),
  ach('coin_from_overseas', true, (c) =>
    !!c.event && isMovement(c.event) && typeof c.event.payload.currency === 'string'
    && c.event.payload.currency !== 'ARS'),
  ach('statement_settled', false, (c) => !!c.event && c.statementsPaid >= 6),
  ach('twelve_moons', true, (c) =>
    !!c.event && isMovement(c.event) && (num(c.event, 'installments') ?? 0) >= 18),

  // ── Questify ──────────────────────────────────────────────────────────────
  ach('ritualist', false, (c) => !!c.event && c.distinctHabits >= 5),
  ach('epic_quest', false, (c) => !!c.event && n(c.countByTypeToday, 'TASK_COMPLETED') >= 12),
  // Gremio de Aventureros: quests closed on one day.
  ach('fighters_guild_i', false, (c) => n(c.countByTypeToday, 'TASK_COMPLETED') >= 8),
  ach('fighters_guild_ii', false, (c) => !!c.event && n(c.countByTypeToday, 'TASK_COMPLETED') >= 15),
  ach('fighters_guild_iii', false, (c) => !!c.event && n(c.countByTypeToday, 'TASK_COMPLETED') >= 25),
  // La Escalera Interminable: MAX_SUBTASKS is 30 per quest, so 35 in a day
  // needs at least two quests — anti-farm by construction.
  ach('endless_stair_i', false, (c) => n(c.countByTypeToday, 'SUBTASK_COMPLETED') >= 10),
  ach('endless_stair_ii', false, (c) => !!c.event && n(c.countByTypeToday, 'SUBTASK_COMPLETED') >= 20),
  ach('endless_stair_iii', false, (c) => !!c.event && n(c.countByTypeToday, 'SUBTASK_COMPLETED') >= 35),
  // Los Nueve Divinos: II and III ask for DEPTH (N habits with M checks EACH),
  // so fifteen fake habits buy the tier I and nothing else.
  ach('nine_divines_i', false, (c) => c.distinctHabits >= 9),
  ach('nine_divines_ii', false, (c) =>
    !!c.event && c.checksPerHabit.filter((k) => k >= 15).length >= 5),
  ach('nine_divines_iii', false, (c) =>
    !!c.event && c.checksPerHabit.filter((k) => k >= 30).length >= 10),
  ach('the_company', false, (c) =>
    !!c.event
    && n(c.countByTypeToday, 'TASK_COMPLETED') >= 5
    && n(c.countByTypeToday, 'SUBTASK_COMPLETED') >= 5
    && n(c.countByTypeToday, 'HABIT_CHECKED') >= 5),
  ach('great_undertaking', false, (c) => !!c.event && c.epicTasksTotal >= 5),
  // Before 09:00 every event of the day is also before 09:00, so the day's
  // tally IS the morning tally.
  ach('dawn_ride', false, (c) =>
    c.event?.type === 'TASK_COMPLETED' && c.event.hour < 9
    && n(c.countByTypeToday, 'TASK_COMPLETED') >= 5),
  ach('turning_wheel', false, (c) => !!c.event && c.repeatedTasksTotal >= 10),
  // Onboarding quotas, threshold 1 on purpose: each one reveals a knob
  // (undo is free, QuickAdd exists) that nobody would guess alone.
  ach('rewritten', true, (c) => n(c.countByType, 'TASK_UNCOMPLETED') >= 1),
  ach('marginalia', true, (c) => n(c.countByType, 'TASK_CREATED') >= 1),
  // Shields are earned at streak multiples, so the engine already time-gates this.
  ach('raised_shield', true, (c) => c.habitShieldsSpent >= 1),
  ach('cleared_board', false, (c) =>
    !!c.event && c.pendingTasks === 0 && n(c.countByTypeToday, 'TASK_COMPLETED') >= 5),
  ach('in_its_own_hour', true, (c) => !!c.event && c.overdueClosedTotal >= 3),
  // A habit checked for a day other than the one the event lands on.
  ach('cold_trail', true, (c) =>
    c.event?.type === 'HABIT_CHECKED' && typeof c.event.payload.date === 'string'
    && c.event.payload.date !== c.event.date),
  ach('day_off', true, (c) => n(c.countByType, 'HABIT_SKIPPED') >= 1),

  // ── Caldero ───────────────────────────────────────────────────────────────
  ach('deep_work', false, (c) => !!c.event && n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 6),
  ach('cauldron_master', false, (c) => !!c.event && n(c.countByType, 'POMODORO_COMPLETED') >= 100),
  // Las Fraguas de Isengard: pomodoros on one day. III is ~5h20 of wall clock.
  ach('isengard_i', false, (c) => n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 6),
  ach('isengard_ii', false, (c) => !!c.event && n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 9),
  ach('isengard_iii', false, (c) => !!c.event && n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 13),
  // Hoguera Encendida: DISTINCT calendar days, on purpose — no streak to break.
  ach('beacons_i', false, (c) => c.pomodoroDays >= 7),
  ach('beacons_ii', false, (c) => !!c.event && c.pomodoroDays >= 30),
  ach('beacons_iii', false, (c) => !!c.event && c.pomodoroDays >= 100),
  ach('midnight_oil', false, (c) =>
    !!c.event && c.pomodoroHoursToday.filter((h) => h >= 22).length >= 4),
  ach('perfect_boil', false, (c) =>
    c.event?.type === 'POMODORO_COMPLETED'
    && c.event.comboMultiplier >= 2.0 && c.event.bonusMultiplier >= 2.0),
  ach('anvil_and_edge', false, (c) =>
    !!c.event
    && n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 5
    && n(c.countByTypeToday, 'TASK_COMPLETED') >= 5),
  // Onboarding quota: teaches that abandoning a brew costs no XP.
  ach('broken_flask', true, (c) => n(c.countByType, 'POMODORO_ABANDONED') >= 1),
  ach('labelled_potion', true, (c) => !!c.event && c.pomodorosWithTask >= 5),
  ach('embers', true, (c) =>
    c.event?.type === 'DAY_SEALED' && n(c.countByTypeToday, 'POMODORO_COMPLETED') >= 5),
  ach('full_circle', false, (c) => n(c.countByType, 'CAULDRON_LAP_COMPLETED') >= 1),
  // Discovery of an invisible knob, so it fires on the act itself. Extending a
  // BREAK is not what the copy promises: only a work session counts.
  ach('one_more_log', true, (c) =>
    c.event?.type === 'POMODORO_EXTENDED' && c.event.payload.sessionType === 'work'),
  ach('sun_to_sun', false, (c) =>
    !!c.event && c.pomodoroHoursToday.some((h) => h < 12) && c.pomodoroHoursToday.some((h) => h >= 20)),

  // ── Nutrify: archive only, never food, weight or compliance ladders ───────
  ach('table_guardian', false, (c) => !!c.event && n(c.countByType, 'DAY_SUMMARY') >= 7),
  ach('tome_of_clear_thought', false, (c) => !!c.event && n(c.countByType, 'DAY_SUMMARY') >= 180),
  ach('scroll_keeper', false, (c) => !!c.event && n(c.countByType, 'WEEK_SUMMARY') >= 12),
  ach('library_unending', false, (c) => !!c.event && n(c.countByType, 'WEEK_SUMMARY') >= 52),
  // Rewards RECORDING, never compliance.
  ach('seven_nights_written', false, (c) =>
    c.event?.type === 'WEEK_SUMMARY' && (num(c.event, 'daysClosed') ?? 0) >= 7),
  // Terminal by design (rule 7): never gets a tier II. `onTarget` is the
  // module's own verdict (xpBonus > 0) — NOT hp > 0, which heals on a deficit.
  ach('the_pact_kept', false, (c) =>
    c.event?.type === 'DAY_SUMMARY' && c.event.payload.onTarget === true),
  ach('yesterdays_pantry', true, (c) =>
    c.event?.type === 'MEAL_LOGGED' && c.event.payload.source === 'copy_day'),
  ach('the_feast', false, (c) =>
    c.event?.type === 'MEAL_LOGGED' && c.event.payload.isEvent === true),
  // Terminal by design (rule 7): rewards the act of measuring, never the value.
  ach('honest_scales', true, (c) =>
    c.event?.type === 'DAY_SUMMARY' && c.event.payload.weighed === true),
  ach('archive_caught_up', true, (c) => !!c.event && n(c.countByTypeToday, 'WEEK_SUMMARY') >= 3),
  ach('second_breakfast', true, (c) =>
    c.event?.type === 'MEAL_LOGGED' && c.event.hour < 11
    && n(c.countByTypeToday, 'MEAL_LOGGED') >= 2),
  // Nutrify's reopen used to be NUTRITION_DAY_REOPENED; today `Today.tsx`
  // emits DAY_REOPENED through the engine's undo path, so this DOES fire.
  ach('second_chance', true, (c) => n(c.countByType, 'DAY_REOPENED') >= 1),

  // ── El Códice ─────────────────────────────────────────────────────────────
  ach('sealed_week', false, (c) => !!c.event && c.sealsCount >= 7),
  ach('steady_hand', false, (c) => !!c.event && c.sealsCount >= 30),
  ach('bound_volume', false, (c) => !!c.event && c.sealsCount >= 100),
  ach('oghma_infinium', false, (c) => !!c.event && c.sealsCount >= 365),
  // Retro-sealing yesterday is a first-class move, not a loophole: the ritual
  // is skippable and back-sealable by design, so it gets its own reward.
  ach('late_memory', true, (c) =>
    c.event?.type === 'DAY_SEALED' && c.event.payload.retro === true),
  ach('radiant_seal', true, (c) =>
    c.event?.type === 'DAY_SEALED' && typeof c.event.payload.vigor === 'number'
    && (c.event.payload.vigor as number) >= 90),
  ach('seal_of_four_hands', false, (c) => !!c.event && c.sealsWithAllModules >= 3),
  ach('overflowing_page', true, (c) =>
    c.event?.type === 'DAY_SEALED' && (num(c.event, 'eventsCount') ?? 0) >= 20),
  ach('ashless_flame', true, (c) =>
    c.event?.type === 'DAY_SEALED' && num(c.event, 'vigor') === 100
    && (num(c.event, 'eventsCount') ?? 0) >= 10),
  // Óbolos spent: spending can never exceed earning, and the faucet is capped
  // by the seal, so the ladder is time-gated by construction.
  ach('ferrymans_coin', false, (c) => c.rewardsRedeemed >= 1),
  ach('bag_of_tricks', false, (c) => !!c.event && c.obolosSpent >= 500),
  ach('horn_of_valhalla', false, (c) => !!c.event && c.obolosSpent >= 2500),
  ach('the_pardon', true, (c) => !!c.event?.pardonUsed),
  ach('saving_throw', true, (c) => !!c.event?.pardonUsed && c.stats.streak >= 30),
  // The Inn family. Identity states: resting IS the state, not an effort.
  ach('deserved_rest', true, (c) => c.stats.innSince !== null),
  ach('long_rest', false, (c) =>
    c.stats.innSince !== null && daysDiff(c.stats.innSince, c.today) >= 3),
  ach('well_rested', true, (c) =>
    !!c.event && c.stats.innSince === null && c.innNightsLastStay >= 2 && c.xpToday >= 60),

  // ── Cronista: the ONE counting family the design allows ───────────────────
  // Counts meaningful rows currently in rpg_events. The sync layer prunes at
  // 365 days, so Cronista III means "2000 events inside a year" (~5.5/day)
  // rather than a literal lifetime total. Once unlocked it is never re-checked
  // nor revoked, so pruning can never take it away.
  ach('chronicler_i', false, (c) => c.totalEvents >= 200),
  ach('chronicler_ii', false, (c) => !!c.event && c.totalEvents >= 750),
  ach('chronicler_iii', false, (c) => !!c.event && c.totalEvents >= 2000),

  // ── Progresión (identity states: level and streak) ────────────────────────
  ach('squire', false, (c) => c.stats.level >= 5),
  ach('knight_errant', false, (c) => c.stats.level >= 20),
  ach('dragonborn', false, (c) => c.stats.level >= 50),
  ach('steadfast', false, (c) => c.stats.streak >= 7 || c.stats.bestStreak >= 7),
  ach('monthly_vow', false, (c) => c.stats.streak >= 30 || c.stats.bestStreak >= 30),
  ach('centenary_vow', false, (c) => c.stats.streak >= 100 || c.stats.bestStreak >= 100),
  // Reads bestStreak, which never resets: once earned, never lost.
  ach('lord_of_cinder', false, (c) => c.stats.streak >= 365 || c.stats.bestStreak >= 365),

  // ── Huevos · El regreso ───────────────────────────────────────────────────
  // Every one of these fires on the COMEBACK event. While the gap lasts there
  // is no event, no context and no check — nothing here can read as a reproach.
  ach('gate_guard', true, (c) =>
    !!c.event && c.daysSinceLastActivity >= 30 && c.stats.bestStreak >= 30),
  ach('knee_healed', true, (c) => c.event?.type === 'HABIT_CHECKED' && c.daysSinceThisHabit >= 30),
  ach('no_haste', true, (c) => !!c.event && c.daysSinceLastActivity >= 60),
  // 300 and NOT 365: rpg_events is pruned at a year, after which the getter
  // reads 0, not infinity. At 365 this would be unreachable by construction.
  ach('seat_kept', true, (c) => !!c.event && c.daysSinceLastActivity >= 300),
  ach('cold_hearth', true, (c) =>
    c.event?.type === 'POMODORO_COMPLETED' && c.daysSinceLastPomodoro >= 45),
  // Exactly 100 — the strict equality is what makes it an egg.
  ach('hundred_days_gone', true, (c) =>
    !!c.event && isMovement(c.event) && c.daysSinceLastInModule === 100),
  ach('the_answer', true, (c) => !!c.event && c.daysSinceLastActivity === 42),
  ach('the_same_bell', true, (c) =>
    !!c.event && c.daysSinceLastActivity >= 7 && c.daysSinceLastActivity % 7 === 0),
  ach('back_through_the_forge', true, (c) =>
    !!c.event && c.daysSinceLastActivity >= 7 && c.event.moduleId === 'cauldron'),
  // Needs the DAY-level gap: `daysSinceLastActivity` is only non-zero on the
  // first event back, where the combo is 1.0 and xpToday cannot be 200 yet.
  ach('like_nothing_happened', true, (c) => !!c.event && c.gapBeforeToday >= 14 && c.xpToday >= 200),

  // ── Huevos · Números ──────────────────────────────────────────────────────
  ach('capicua', true, (c) => {
    const amount = movementAmount(c);
    if (amount === null) return false;
    const s = digits(amount);
    return s.length >= 4 && s === [...s].reverse().join('');
  }),
  ach('perfect_figure', true, (c) => {
    const amount = movementAmount(c);
    return amount !== null && /^(\d)\1{3,}$/.test(digits(amount));
  }),
  ach('the_mirror', true, (c) =>
    !!c.event && isMovement(c.event) && sameAmountPair(c.financeMovementsToday, () => true)),
  ach('lead_into_gold', true, (c) =>
    !!c.event && isMovement(c.event)
    && sameAmountPair(c.financeMovementsToday, (a, b) => a.type !== b.type)),
  ach('a_single_coin', true, (c) => movementAmount(c) === 1),
  ach('the_blessed_penny', true, (c) => {
    const amount = movementAmount(c);
    return amount !== null && amount < 10 && c.event!.bonusMultiplier >= EPIC_BONUS;
  }),
  ach('the_date_in_the_sum', true, (c) => {
    const amount = movementAmount(c);
    if (amount === null) return false;
    const d = c.event!.date;
    return Math.round(amount) === Number(`${d.slice(8, 10)}${d.slice(5, 7)}`);
  }),
  ach('the_ledgers_name_day', true, (c) =>
    !!c.event && isMovement(c.event) && c.firstEventDateInModule !== null
    && mmdd(c.firstEventDateInModule) === mmdd(c.event.date)
    && c.firstEventDateInModule.slice(0, 4) < c.event.date.slice(0, 4)),
  // XP keeps two decimals: without the floor, === 666 would never be true.
  ach('the_number', true, (c) => !!c.event && Math.floor(c.xpToday) === 666),
  // A sync merge that inserts several rows at once can skip 1000. Losing it
  // that way is part of being an egg.
  ach('the_thousandth', true, (c) =>
    !!c.event && c.totalEvents === 1000 && c.event.bonusMultiplier >= EPIC_BONUS),

  // ── Huevos · Calendario y reloj ───────────────────────────────────────────
  // Any module, not only the cauldron (closed decision).
  ach('day_that_isnt', true, (c) => !!c.event && mmdd(c.event.date) === '02-29'),
  ach('eleventy_one', true, (c) => !!c.event && mmdd(c.event.date) === '11-11' && c.event.hour === 11),
  ach('three_sevens', true, (c) =>
    !!c.event && monthOf(c.event.date) === dayOf(c.event.date) && dayOf(c.event.date) === c.event.hour),
  ach('palindrome_day', true, (c) => {
    if (!c.event) return false;
    const s = c.event.date.replace(/-/g, '');
    return s === [...s].reverse().join('');
  }),
  // From a sign-up date that is never pruned — rpg_events loses exactly the
  // row this needs on the very day it needs it.
  ach('long_expected', true, (c) => !!c.event && c.daysSinceFirstEvent === 365),
  ach('still_standing', true, (c) => !!c.event && mmdd(c.event.date) === '01-01' && c.event.hour < 6),
  ach('last_two_hours', true, (c) =>
    c.event?.type === 'TASK_COMPLETED' && mmdd(c.event.date) === '12-31' && c.event.hour >= 22),
  ach('omens_and_portents', true, (c) =>
    !!c.event && isMovement(c.event) && c.event.weekday === 5 && dayOf(c.event.date) === 13),
  ach('dice_did_notice', true, (c) =>
    !!c.event && c.event.weekday === 2 && dayOf(c.event.date) === 13
    && c.event.bonusMultiplier >= EPIC_BONUS),
  ach('hour_of_the_wolf', true, (c) => c.event?.type === 'EXPENSE_LOGGED' && c.event.hour === 4),
  ach('night_watch', true, (c) =>
    c.event?.type === 'POMODORO_COMPLETED' && c.event.hour >= 2 && c.event.hour < 5),
  ach('blood_moon', true, (c) => !!c.event && c.event.hour >= 23 && isFullMoon(c.event.date)),

  // ── Huevos · Los dados ────────────────────────────────────────────────────
  ach('full_word', true, (c) =>
    c.event?.type === 'TASK_COMPLETED' && num(c.event, 'tier') === 3
    && c.event.comboMultiplier >= 2.0 && c.event.bonusMultiplier >= EPIC_BONUS),
  ach('loaded_dice', true, (c) => !!c.event && c.epicsToday >= 5),
  ach('witching_hour', true, (c) =>
    !!c.event && c.event.hour === 3 && c.event.bonusMultiplier >= EPIC_BONUS),

  // ── Huevos · El estado contradictorio ─────────────────────────────────────
  ach('enemies_nearby', true, (c) =>
    c.event?.type === 'POMODORO_COMPLETED' && c.stats.innSince !== null),
  ach('working_holiday', true, (c) =>
    !!c.event && c.stats.innSince !== null && EVENT_MODULES.every((m) => c.modulesToday.includes(m))),
  // bestStreak never drops: a beginner's window that closes on its own.
  ach('shall_we_rest', true, (c) => c.stats.innSince !== null && c.stats.bestStreak <= 3),
  ach('always_the_same_trick', true, (c) =>
    !!c.event && c.eventsToday >= 10 && c.typesToday.length === 1),
  // Naming the character afterwards does not revoke it.
  ach('no_name_on_the_door', true, (c) => c.stats.level >= 10 && !c.hasCharacterName),
  // Skipping the seal costs nothing by design — and this PAYS for having skipped it.
  ach('takes_no_notes', true, (c) => !!c.event && c.totalEvents >= 500 && c.sealsCount <= 3),
  ach('just_in_case', true, (c) => !!c.event && c.obolosBalance >= 500 && c.rewardsRedeemed === 0),
  // The current event is already counted: "first event of the module" is count 1.
  ach('door_never_opened', true, (c) =>
    !!c.event && c.totalEvents >= 500
    && (EVENT_MODULES as readonly string[]).includes(c.event.moduleId)
    && n(c.countByModule, c.event.moduleId) === 1),

  // ── Huevos · Coincidencias del juego ──────────────────────────────────────
  ach('solvent_crown', true, (c) =>
    !!c.event && n(c.countByTypeToday, 'LOAN_SETTLED') >= 1 && n(c.countByTypeToday, 'BUDGET_MONTH_MET') >= 1),
  ach('a_hundred_lines', true, (c) =>
    c.event?.type === 'STATEMENT_IMPORTED' && num(c.event, 'count') === 100),
  ach('buzzer_pardon', true, (c) => !!c.event?.pardonUsed && c.event.hour >= 23),

  // ── Huevos · Papeles y tinta ──────────────────────────────────────────────
  ach('a_single_line', true, (c) =>
    c.event?.type === 'DAY_SEALED' && num(c.event, 'eventsCount') === 1),
  ach('session_notes', true, (c) =>
    c.event?.type === 'DAY_SEALED' && c.event.payload.retro === true && c.event.hour < 5),
  // The seal is required as the EVENT (not as a count) so insertion order does
  // not matter; countByTypeToday is raw, so it sees the non-meaningful WEEK_SUMMARY.
  ach('three_keys', true, (c) =>
    c.event?.type === 'DAY_SEALED'
    && n(c.countByTypeToday, 'DAY_SUMMARY') >= 1 && n(c.countByTypeToday, 'WEEK_SUMMARY') >= 1),
  ach('hole_in_the_sheet', true, (c) => !!c.event && n(c.countByTypeToday, 'DAY_REOPENED') >= 2),
  // The subject is THE PAGE, not the person: no amount, no direction, no body.
  ach('long_table', true, (c) => !!c.event && c.mealSlotsToday.length >= 4),
];

/** Catalogue size, exported so the UI can render "n / TOTAL" without importing the array. */
export const ACHIEVEMENTS_TOTAL = ACHIEVEMENTS.length;

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, AchievementDef> =
  new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
