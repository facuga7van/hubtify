import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { questsMigrations } from '../../src/modules/quests/quests.schema';
import { financeMigrations } from '../../src/modules/finance/finance.schema';
import { nutritionMigrations } from '../../src/modules/nutrition/nutrition.schema';
import { characterMigrations } from '../../src/modules/character/character.schema';
import {
  processRpgEvent,
  buildAchievementContext,
  readAchievementPriors,
  evaluateAchievements,
  backfillAchievements,
  setInnMode,
} from '../../shared-logic/modules/rpg-handlers';
import type { AchievementEventContext } from '../../shared/achievements';
import { RETURN_GAP_DAYS, ACHIEVEMENT_XP } from '../../shared/achievements';
import { pinClockToNoon } from '../helpers/pin-clock';

/**
 * El contexto que leen los predicados del catálogo (logros v2).
 *
 * Cada getter nuevo con un caso mínimo sobre una base en memoria con TODAS las
 * tablas de módulo (la mayoría lee finance_*, habit_checks, tasks, food_log),
 * más las dos trampas del motor:
 *   - `previousEvent` tiene que ignorar los eventos no significativos (un
 *     QuickAdd en medio del hueco no reinicia el reloj de «El Regreso»);
 *   - los «días desde el último X» se leen ANTES del INSERT del evento; si se
 *     leyeran después, el evento bajo evaluación sería el último X y darían 0.
 */

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, questsMigrations);
  applyMigrations(db, financeMigrations);
  applyMigrations(db, nutritionMigrations);
  applyMigrations(db, characterMigrations);
  return db;
}

/** A local YYYY-MM-DD `offset` days before today. */
function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

interface SeedOpts { xp?: number; hhmm?: string; payload?: Record<string, unknown> | string; refId?: string | null }

/** Writes a raw event on a local day, bypassing the engine (no achievements fired). */
function seedEvent(db: Database.Database, moduleId: string, type: string, date: string, opts: SeedOpts = {}): void {
  const { xp = 10, hhmm = '10:00', payload = {}, refId = null } = opts;
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES (?, ?, ?, 0, 1.0, 1.0, ?, ?, ?, ?)
  `).run(moduleId, type, xp, raw, `${date} ${hhmm}:00`, refId, `seed-${Math.random()}`);
}

/** The event under evaluation, as processRpgEvent would seed it. */
function evt(over: Partial<AchievementEventContext> = {}): AchievementEventContext {
  return {
    type: 'TASK_COMPLETED', moduleId: 'quests', payload: {},
    hour: 12, date: dateAgo(0), weekday: new Date().getDay(),
    comboMultiplier: 1.0, bonusMultiplier: 1.0, xpGained: 10, pardonUsed: false,
    ...over,
  };
}

function ctxFor(db: Database.Database, event: AchievementEventContext | null = evt()) {
  return buildAchievementContext(db, event, dateAgo(0), null);
}

function tx(db: Database.Database, id: string, type: 'expense' | 'income', category: string, date: string, extra: Record<string, unknown> = {}): void {
  db.prepare(`
    INSERT INTO finance_transactions (id, type, amount, category, date, deleted_at)
    VALUES (?, ?, 100, ?, ?, ?)
  `).run(id, type, category, date, (extra.deletedAt as string | null) ?? null);
}

function habitCheck(db: Database.Database, habitId: string, date: string, kind = 'check', deleted = false): void {
  db.prepare(`
    INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`${habitId}-${date}-${kind}`, habitId, date, kind, `${date} 09:00:00`, `${date} 09:00:00`, deleted ? `${date} 10:00:00` : null);
}

pinClockToNoon();

const TODAY = dateAgo(0);

// ─────────────────────── el fix de previousEvent ───────────────────────

describe('previousEvent ignores non-meaningful rows (hero_return fix)', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('a QuickAdd in the middle of the gap does NOT reset daysSinceLastActivity', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(20));
    // The QuickAdd: TASK_CREATED, 0 XP. Registered, not lived.
    seedEvent(db, 'quests', 'TASK_CREATED', dateAgo(5), { xp: 0 });
    // Engine rows and undos are not the player showing up either.
    seedEvent(db, 'rpg', 'ACHIEVEMENT_UNLOCKED', dateAgo(4), { xp: 25 });
    seedEvent(db, 'quests', 'TASK_UNCOMPLETED', dateAgo(3), { xp: 0 });

    const priors = readAchievementPriors(db, 'TASK_COMPLETED', 'quests', {}, TODAY);
    expect(priors.previousEventAt).toBe(`${dateAgo(20)} 10:00:00`);

    const ctx = buildAchievementContext(db, evt(), TODAY, priors);
    expect(ctx.daysSinceLastActivity).toBe(20);
  });

  it('end to end: the homecoming fires through processRpgEvent despite the QuickAdd', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(RETURN_GAP_DAYS + 1));
    seedEvent(db, 'quests', 'TASK_CREATED', dateAgo(2), { xp: 0 });

    const result = processRpgEvent(db, {
      type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
    });
    expect(result.achievementIds).toContain('hero_return');
  });

  it('a meaningful event yesterday still counts as showing up', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(20));
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', dateAgo(1), { xp: 5 });

    const priors = readAchievementPriors(db, 'TASK_COMPLETED', 'quests', {}, TODAY);
    expect(buildAchievementContext(db, evt(), TODAY, priors).daysSinceLastActivity).toBe(1);
  });

  it('no priors (backfill) → 0, never Infinity', () => {
    expect(ctxFor(db, null).daysSinceLastActivity).toBe(0);
    expect(ctxFor(db).daysSinceLastActivity).toBe(0);
  });
});

// ─────────────────────── la trampa pre-insert ───────────────────────

describe('pre-insert reads: daysSinceLastInModule / daysSinceLastPomodoro / daysSinceThisHabit', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('daysSinceLastInModule measures the gap to the same module, any event kind', () => {
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(30), { xp: 5 });
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(2));

    const priors = readAchievementPriors(db, 'EXPENSE_LOGGED', 'finance', {}, TODAY);
    const ctx = buildAchievementContext(db, evt({ type: 'EXPENSE_LOGGED', moduleId: 'finance' }), TODAY, priors);
    expect(ctx.daysSinceLastInModule).toBe(30);
  });

  it('daysSinceLastInModule is 0 for a module never touched before', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(2));
    const priors = readAchievementPriors(db, 'POMODORO_COMPLETED', 'cauldron', {}, TODAY);
    expect(buildAchievementContext(db, evt({ moduleId: 'cauldron' }), TODAY, priors).daysSinceLastInModule).toBe(0);
  });

  it('daysSinceLastPomodoro measures the gap to the last POMODORO_COMPLETED only', () => {
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(12), { xp: 15 });
    seedEvent(db, 'cauldron', 'POMODORO_ABANDONED', dateAgo(1), { xp: 0 });

    const priors = readAchievementPriors(db, 'POMODORO_COMPLETED', 'cauldron', {}, TODAY);
    const ctx = buildAchievementContext(db, evt({ type: 'POMODORO_COMPLETED', moduleId: 'cauldron' }), TODAY, priors);
    expect(ctx.daysSinceLastPomodoro).toBe(12);
  });

  it('daysSinceThisHabit: the previous check of THIS habit, other habits ignored', () => {
    db.prepare("INSERT INTO habits (id, name) VALUES ('h1', 'Agua'), ('h2', 'Leer')").run();
    habitCheck(db, 'h1', dateAgo(9));
    habitCheck(db, 'h1', TODAY);            // the check the event is about
    habitCheck(db, 'h2', dateAgo(1));       // another habit, yesterday
    habitCheck(db, 'h1', dateAgo(4), 'skip');            // a skip is not a check
    habitCheck(db, 'h1', dateAgo(3), 'check', true);     // deleted

    const payload = { habitId: 'h1', date: TODAY };
    const priors = readAchievementPriors(db, 'HABIT_CHECKED', 'quests', payload, TODAY);
    expect(priors.lastThisHabitDate).toBe(dateAgo(9));
    const ctx = buildAchievementContext(db, evt({ type: 'HABIT_CHECKED', payload }), TODAY, priors);
    expect(ctx.daysSinceThisHabit).toBe(9);
  });

  it('daysSinceThisHabit on a retro check measures from the checked day, not from today', () => {
    db.prepare("INSERT INTO habits (id, name) VALUES ('h1', 'Agua')").run();
    habitCheck(db, 'h1', dateAgo(5));
    habitCheck(db, 'h1', dateAgo(1));       // AFTER the retro day: must not count
    habitCheck(db, 'h1', dateAgo(2));       // the retro check itself

    const payload = { habitId: 'h1', date: dateAgo(2) };
    const priors = readAchievementPriors(db, 'HABIT_CHECKED', 'quests', payload, TODAY);
    const ctx = buildAchievementContext(db, evt({ type: 'HABIT_CHECKED', payload }), TODAY, priors);
    expect(ctx.daysSinceThisHabit).toBe(3);
  });

  it('daysSinceThisHabit is 0 for a non-habit event and for a first-ever check', () => {
    db.prepare("INSERT INTO habits (id, name) VALUES ('h1', 'Agua')").run();
    habitCheck(db, 'h1', TODAY);
    const payload = { habitId: 'h1', date: TODAY };
    const priors = readAchievementPriors(db, 'HABIT_CHECKED', 'quests', payload, TODAY);
    expect(priors.lastThisHabitDate).toBeNull();
    expect(buildAchievementContext(db, evt({ type: 'HABIT_CHECKED', payload }), TODAY, priors).daysSinceThisHabit).toBe(0);

    const notHabit = readAchievementPriors(db, 'TASK_COMPLETED', 'quests', {}, TODAY);
    expect(notHabit.lastThisHabitDate).toBeNull();
    expect(buildAchievementContext(db, evt(), TODAY, notHabit).daysSinceThisHabit).toBe(0);
  });

  it('the trap: read AFTER the insert, the same gaps collapse to 0', () => {
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(30), { xp: 5 });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(12), { xp: 15 });
    // The rows processRpgEvent would have just written.
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', TODAY, { xp: 5 });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', TODAY, { xp: 15 });

    const late = readAchievementPriors(db, 'EXPENSE_LOGGED', 'finance', {}, TODAY);
    const ctx = buildAchievementContext(db, evt({ type: 'EXPENSE_LOGGED', moduleId: 'finance' }), TODAY, late);
    expect(ctx.daysSinceLastInModule).toBe(0);
    expect(ctx.daysSinceLastPomodoro).toBe(0);
  });

  it('processRpgEvent reads the priors BEFORE it writes the event row', () => {
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(30), { xp: 5 });
    const order: string[] = [];
    const realPrepare = db.prepare.bind(db);
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      order.push(sql.replace(/\s+/g, ' ').trim());
      return realPrepare(sql);
    };

    processRpgEvent(db, {
      type: 'EXPENSE_LOGGED', moduleId: 'finance',
      payload: { xp: 5, hp: 0, transactionId: 'tx1', amount: 100 }, timestamp: Date.now(),
    });

    const insertAt = order.findIndex((s) => s.startsWith('INSERT INTO rpg_events'));
    const moduleGapAt = order.findIndex((s) => s.includes('MAX(created_at)') && s.includes('module_id = ?'));
    const pomodoroGapAt = order.findIndex((s) => s.includes('MAX(created_at)') && s.includes("'POMODORO_COMPLETED'"));
    const previousAt = order.findIndex((s) => s.includes('ORDER BY id DESC LIMIT 1') && s.includes('xp_gained > 0'));
    expect(insertAt).toBeGreaterThan(-1);
    for (const at of [moduleGapAt, pomodoroGapAt, previousAt]) {
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(insertAt);
    }
  });
});

// ─────────────────────── forma del día ───────────────────────

describe('day-shape getters', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('financeMovementsToday parses amount from EXPENSE/INCOME_LOGGED payloads', () => {
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', TODAY, { xp: 5, payload: { amount: 1500, transactionId: 'a' } });
    seedEvent(db, 'finance', 'INCOME_LOGGED', TODAY, { xp: 5, payload: { amount: 3000, transactionId: 'b' } });
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', TODAY, { xp: 5, payload: { transactionId: 'c' } });      // no amount: skipped
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', TODAY, { xp: 5, payload: 'not json' });                   // garbage: skipped
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(1), { xp: 5, payload: { amount: 999 } });         // yesterday

    const moves = [...ctxFor(db).financeMovementsToday].sort((a, b) => a.amount - b.amount);
    expect(moves).toEqual([{ type: 'expense', amount: 1500 }, { type: 'income', amount: 3000 }]);
  });

  it('pomodoroHoursToday lists the hour of every POMODORO_COMPLETED of the day', () => {
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', TODAY, { xp: 15, hhmm: '07:15' });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', TODAY, { xp: 15, hhmm: '21:40' });
    seedEvent(db, 'cauldron', 'POMODORO_ABANDONED', TODAY, { xp: 0, hhmm: '13:00' });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(1), { xp: 15, hhmm: '09:00' });

    expect([...ctxFor(db).pomodoroHoursToday].sort((a, b) => a - b)).toEqual([7, 21]);
  });

  it('firstHourToday / lastHourToday span MEANINGFUL rows only', () => {
    seedEvent(db, 'quests', 'TASK_CREATED', TODAY, { xp: 0, hhmm: '05:00' });    // a 05:00 QuickAdd is not a dawn
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, { hhmm: '08:30' });
    seedEvent(db, 'nutrition', 'MEAL_LOGGED', TODAY, { xp: 5, hhmm: '22:10' });
    seedEvent(db, 'rpg', 'DAY_SEALED', TODAY, { xp: 20, hhmm: '23:50' });         // engine row

    const ctx = ctxFor(db);
    expect(ctx.firstHourToday).toBe(8);
    expect(ctx.lastHourToday).toBe(22);
  });

  it('firstHourToday / lastHourToday are null on an empty day', () => {
    const ctx = ctxFor(db);
    expect(ctx.firstHourToday).toBeNull();
    expect(ctx.lastHourToday).toBeNull();
  });

  it('mealSlotsToday lists distinct non-null meals of the reference day', () => {
    const food = db.prepare(`
      INSERT INTO food_log (date, time, description, calories, source, meal, deleted_at)
      VALUES (?, '12:00', 'x', 100, 'manual', ?, ?)
    `);
    food.run(TODAY, 'desayuno', null);
    food.run(TODAY, 'cena', null);
    food.run(TODAY, 'cena', null);
    food.run(TODAY, null, null);
    food.run(TODAY, 'merienda', `${TODAY} 13:00:00`);
    food.run(dateAgo(1), 'almuerzo', null);

    expect([...ctxFor(db).mealSlotsToday].sort()).toEqual(['cena', 'desayuno']);
  });
});

// ─────────────────────── huecos y edad de la cuenta ───────────────────────

describe('gapBeforeToday / daysSinceFirstEvent / firstEventDateInModule', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('gapBeforeToday ignores today and non-meaningful rows', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(6));
    seedEvent(db, 'quests', 'TASK_CREATED', dateAgo(1), { xp: 0 });
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    expect(ctxFor(db).gapBeforeToday).toBe(6);
  });

  it('gapBeforeToday is 0 with no history before the reference day', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY);
    expect(ctxFor(db).gapBeforeToday).toBe(0);
  });

  it('daysSinceFirstEvent comes from user_profile.created_at, not from the pruned log', () => {
    db.prepare("UPDATE user_profile SET created_at = ? WHERE id = 'default'").run(`${dateAgo(400)} 03:00:00`);
    // The log only remembers the last year.
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(300));
    expect(ctxFor(db).daysSinceFirstEvent).toBe(400);
  });

  it('daysSinceFirstEvent takes the EARLIEST anchor (a synced seal outlives an account switch)', () => {
    db.prepare("UPDATE user_profile SET created_at = ? WHERE id = 'default'").run(`${dateAgo(3)} 03:00:00`);
    db.prepare(`
      INSERT INTO day_seals (date, sealed_at, xp_awarded, vigor, events_count, modules, updated_at)
      VALUES (?, ?, 20, 100, 3, '["quests"]', ?)
    `).run(dateAgo(500), `${dateAgo(500)} 23:00:00`, `${dateAgo(500)} 23:00:00`);
    db.prepare('INSERT INTO achievements_unlocked (id, unlocked_at, updated_at) VALUES (?, ?, ?)')
      .run('first_step', `${dateAgo(450)} 10:00:00`, `${dateAgo(450)} 10:00:00`);
    expect(ctxFor(db).daysSinceFirstEvent).toBe(500);
  });

  it('firstEventDateInModule is the module\'s oldest surviving row, null without an event', () => {
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(40), { xp: 5 });
    seedEvent(db, 'finance', 'EXPENSE_LOGGED', dateAgo(3), { xp: 5 });
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(90));

    expect(ctxFor(db, evt({ moduleId: 'finance', type: 'EXPENSE_LOGGED' })).firstEventDateInModule).toBe(dateAgo(40));
    expect(ctxFor(db, evt({ moduleId: 'cauldron' })).firstEventDateInModule).toBeNull();
    expect(ctxFor(db, null).firstEventDateInModule).toBeNull();
  });
});

// ─────────────────────── Coinify ───────────────────────

describe('Coinify getters', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('bestiaryCategories counts expense categories with >= 3 movements, transfers and card payments excluded', () => {
    for (let i = 0; i < 3; i++) tx(db, `d${i}`, 'expense', 'Delivery', '2026-08-0' + (i + 1));
    for (let i = 0; i < 2; i++) tx(db, `s${i}`, 'expense', 'Salud', '2026-08-0' + (i + 1));
    for (let i = 0; i < 3; i++) tx(db, `t${i}`, 'expense', 'Transferencia', '2026-08-0' + (i + 1));
    for (let i = 0; i < 3; i++) tx(db, `p${i}`, 'expense', 'Pago Tarjeta', '2026-08-0' + (i + 1));
    for (let i = 0; i < 3; i++) tx(db, `i${i}`, 'income', 'Sueldo', '2026-08-0' + (i + 1));
    for (let i = 0; i < 3; i++) tx(db, `x${i}`, 'expense', 'Compras', '2026-08-0' + (i + 1), { deletedAt: '2026-08-05' });
    expect(ctxFor(db).bestiaryCategories).toBe(1);
  });

  it('budgetsActive counts living budgets with a positive limit', () => {
    const b = db.prepare('INSERT INTO finance_budgets (category, monthly_limit, deleted_at) VALUES (?, ?, ?)');
    b.run('Delivery', 50000, null);
    b.run('Salud', 0, null);
    b.run('Compras', 1000, '2026-08-01T00:00:00Z');
    expect(ctxFor(db).budgetsActive).toBe(1);
  });

  it('statementImportMonths counts distinct YYYY-MM of import batches', () => {
    const b = db.prepare("INSERT INTO finance_import_batches (id, source, created_at) VALUES (?, 'csv', ?)");
    b.run('b1', '2026-06-02 10:00:00');
    b.run('b2', '2026-06-20 10:00:00');
    b.run('b3', '2026-07-01 10:00:00');
    expect(ctxFor(db).statementImportMonths).toBe(2);
  });

  it('loansSettledAged counts settled loans that lived >= 7 days', () => {
    const l = db.prepare(`
      INSERT INTO finance_loans (id, person_name, direction, amount, date, settled, settled_date, deleted_at)
      VALUES (?, 'Ana', 'lent', 100, ?, ?, ?, ?)
    `);
    l.run('l1', '2026-07-01', 1, '2026-07-15', null);   // 14 days: counts
    l.run('l2', '2026-07-01', 1, '2026-07-05', null);   // 4 days: too quick
    l.run('l3', '2026-07-01', 0, null, null);           // open
    l.run('l4', '2026-07-01', 1, '2026-08-01', '2026-08-02T00:00:00Z'); // deleted
    expect(ctxFor(db).loansSettledAged).toBe(1);
  });

  it('financeActiveMonths counts distinct months with a living movement', () => {
    tx(db, 'a', 'expense', 'Delivery', '2026-01-10');
    tx(db, 'b', 'income', 'Sueldo', '2026-01-25');
    tx(db, 'c', 'expense', 'Salud', '2026-03-02');
    tx(db, 'd', 'expense', 'Salud', '2026-05-02', { deletedAt: '2026-05-03' });
    expect(ctxFor(db).financeActiveMonths).toBe(2);
  });

  it('statementsPaid counts living statements with status paid', () => {
    db.prepare("INSERT INTO finance_credit_cards (id, name, closing_day) VALUES ('card', 'Visa', 20)").run();
    const s = db.prepare(`
      INSERT INTO finance_credit_card_statements (id, credit_card_id, period_month, status, deleted_at)
      VALUES (?, 'card', ?, ?, ?)
    `);
    s.run('s1', '2026-06', 'paid', null);
    s.run('s2', '2026-07', 'paid', null);
    s.run('s3', '2026-08', 'pending', null);
    s.run('s4', '2026-05', 'paid', '2026-06-01T00:00:00Z');
    expect(ctxFor(db).statementsPaid).toBe(2);
  });
});

// ─────────────────────── Questify ───────────────────────

describe('Questify getters', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('checksPerHabit returns one count per habit, checks only', () => {
    db.prepare("INSERT INTO habits (id, name) VALUES ('h1', 'Agua'), ('h2', 'Leer'), ('h3', 'Nada')").run();
    habitCheck(db, 'h1', dateAgo(1));
    habitCheck(db, 'h1', dateAgo(2));
    habitCheck(db, 'h1', dateAgo(3));
    habitCheck(db, 'h1', dateAgo(4), 'skip');
    habitCheck(db, 'h1', dateAgo(5), 'check', true);
    habitCheck(db, 'h2', dateAgo(1));
    expect([...ctxFor(db).checksPerHabit].sort()).toEqual([1, 3]);
  });

  it('epicTasksTotal / repeatedTasksTotal / overdueClosedTotal read the TASK_COMPLETED payload', () => {
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(3), { payload: { tier: 3 } });
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(2), { payload: { tier: 3, repeated: true, overdue: true } });
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(1), { payload: { tier: 2, repeated: false, overdue: false } });
    seedEvent(db, 'quests', 'SUBTASK_COMPLETED', dateAgo(1), { payload: { tier: 3 } });   // not a task
    seedEvent(db, 'quests', 'TASK_COMPLETED', TODAY, { payload: 'not json at all' });     // must not poison the count

    const ctx = ctxFor(db);
    expect(ctx.epicTasksTotal).toBe(2);
    expect(ctx.repeatedTasksTotal).toBe(1);
    expect(ctx.overdueClosedTotal).toBe(1);
  });

  it('habitShieldsSpent counts living shield rows', () => {
    db.prepare("INSERT INTO habits (id, name) VALUES ('h1', 'Agua')").run();
    habitCheck(db, 'h1', dateAgo(1), 'shield');
    habitCheck(db, 'h1', dateAgo(2), 'shield');
    habitCheck(db, 'h1', dateAgo(3), 'shield', true);
    habitCheck(db, 'h1', dateAgo(4));
    expect(ctxFor(db).habitShieldsSpent).toBe(2);
  });

  it('pendingTasks mirrors quests:getPendingCount', () => {
    const t = db.prepare('INSERT INTO tasks (id, name, status, deleted_at) VALUES (?, ?, ?, ?)');
    t.run('t1', 'a', 0, null);
    t.run('t2', 'b', 0, null);
    t.run('t3', 'c', 1, null);
    t.run('t4', 'd', 0, '2026-08-01T00:00:00Z');
    expect(ctxFor(db).pendingTasks).toBe(2);
  });
});

// ─────────────────────── Caldero, óbolos, Posada ───────────────────────

describe('Caldero / óbolos / Posada getters', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('pomodoroDays counts distinct days with a completed pomodoro', () => {
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(5), { xp: 15 });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(5), { xp: 15, hhmm: '18:00' });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', dateAgo(2), { xp: 15 });
    seedEvent(db, 'cauldron', 'POMODORO_COMPLETED', TODAY, { xp: 15 });
    seedEvent(db, 'cauldron', 'POMODORO_ABANDONED', dateAgo(1), { xp: 0 });
    expect(ctxFor(db).pomodoroDays).toBe(3);
  });

  it('rewardsRedeemed / obolosSpent / obolosBalance read the ledger', () => {
    const l = db.prepare(`
      INSERT INTO obolos_ledger (id, delta, reason, ref_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, '2026-08-01 10:00:00', '2026-08-01 10:00:00')
    `);
    l.run('e1', 30, 'day_sealed', '2026-08-01');
    l.run('e2', 15, 'achievement', 'first_step');
    l.run('r1', -20, 'reward_redeemed', 'rw1');
    l.run('r2', -10, 'reward_redeemed', 'rw1');

    const ctx = ctxFor(db);
    expect(ctx.rewardsRedeemed).toBe(2);
    expect(ctx.obolosSpent).toBe(30);
    expect(ctx.obolosBalance).toBe(15);
  });

  it('an empty ledger reads as zeros', () => {
    const ctx = ctxFor(db);
    expect(ctx.rewardsRedeemed).toBe(0);
    expect(ctx.obolosSpent).toBe(0);
    expect(ctx.obolosBalance).toBe(0);
  });

  it('core v9 adds player_stats.inn_last_stay_days, defaulting to 0', () => {
    const cols = (db.prepare('PRAGMA table_info(player_stats)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('inn_last_stay_days');
    expect(ctxFor(db).innNightsLastStay).toBe(0);
  });

  it('checking out of the Inn writes the nights of the stay', () => {
    setInnMode(db, true, dateAgo(5));
    setInnMode(db, false, TODAY);
    const row = db.prepare("SELECT inn_since, inn_last_stay_days AS nights FROM player_stats WHERE user_id = 'default'")
      .get() as { inn_since: string | null; nights: number };
    expect(row.inn_since).toBeNull();
    expect(row.nights).toBe(5);
    expect(ctxFor(db).innNightsLastStay).toBe(5);
  });

  it('check-out also records the stay when the player had already acted (no rewind path)', () => {
    db.prepare("UPDATE player_stats SET streak = 3, streak_last_date = ? WHERE user_id = 'default'").run(TODAY);
    setInnMode(db, true, dateAgo(2));
    setInnMode(db, false, TODAY);
    expect(ctxFor(db).innNightsLastStay).toBe(2);
  });

  it('a same-day round trip records 0 nights and a later stay overwrites the previous one', () => {
    setInnMode(db, true, dateAgo(7));
    setInnMode(db, false, TODAY);
    expect(ctxFor(db).innNightsLastStay).toBe(7);

    setInnMode(db, true, TODAY);
    setInnMode(db, false, TODAY);
    expect(ctxFor(db).innNightsLastStay).toBe(0);
  });
});

// ─────────────────────── eventos de registro puro del caldero ───────────────────────

describe('CAULDRON_LAP_COMPLETED / POMODORO_EXTENDED are pinned to 0 XP', () => {
  it.each(['CAULDRON_LAP_COMPLETED', 'POMODORO_EXTENDED'])('%s pays nothing even when the payload claims XP', (type) => {
    const db = setupDb();
    const result = processRpgEvent(db, {
      type, moduleId: 'cauldron', payload: { xp: 50, hp: -20 }, timestamp: Date.now(),
    });
    expect(result.xpGained).toBe(0);
    expect(result.hpChange).toBe(0);
    const row = db.prepare('SELECT xp_gained AS xp, hp_change AS hp FROM rpg_events WHERE event_type = ?').get(type) as { xp: number; hp: number };
    expect(row).toEqual({ xp: 0, hp: 0 });
    const s = db.prepare("SELECT xp, hp, streak, daily_combo AS combo FROM player_stats WHERE user_id = 'default'").get() as Record<string, number>;
    // The only XP allowed on the sheet is what a live unlock paid (the
    // catalogue may greet a first registration); the event itself adds nothing.
    expect(s.xp).toBe(ACHIEVEMENT_XP * result.achievementIds.length);
    expect(s.hp).toBe(100);
    expect(s.streak).toBe(0);
    expect(s.combo).toBe(0);
  });
});

// ─────────────────────── el backfill sigue compilando y corriendo ───────────────────────

describe('backfill signature', () => {
  it('evaluateAchievements(db, null, today, null, "backfill") still works with no priors', () => {
    const db = setupDb();
    seedEvent(db, 'quests', 'TASK_COMPLETED', dateAgo(1));
    expect(() => evaluateAchievements(db, null, TODAY, null, 'backfill')).not.toThrow();
    expect(() => backfillAchievements(db)).not.toThrow();
    const ctx = buildAchievementContext(db, null, TODAY, null);
    expect(ctx.daysSinceLastInModule).toBe(0);
    expect(ctx.daysSinceLastPomodoro).toBe(0);
    expect(ctx.daysSinceThisHabit).toBe(0);
  });
});
