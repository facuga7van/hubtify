import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { buildSylSnapshot } from '../../shared-logic/modules/syl.snapshot';

// computedForDate is a Thursday; its Monday-based week is 2026-07-06 .. 2026-07-12.
const TODAY = '2026-07-09';
const OPTS = { now: '2026-07-09T14:30:00.000Z', computedForDate: TODAY, appVersion: '0.7.3' };

// player_stats is a core table (created in db.ts initCoreTables, not a migration).
const PLAYER_STATS_DDL = `
  CREATE TABLE IF NOT EXISTS player_stats (
    user_id TEXT PRIMARY KEY DEFAULT 'default',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    hp INTEGER NOT NULL DEFAULT 100,
    max_hp INTEGER NOT NULL DEFAULT 100,
    title TEXT NOT NULL DEFAULT 'Campesino',
    streak INTEGER NOT NULL DEFAULT 0,
    daily_combo INTEGER NOT NULL DEFAULT 0,
    combo_date TEXT,
    streak_last_date TEXT,
    total_tasks INTEGER NOT NULL DEFAULT 0,
    total_meals INTEGER NOT NULL DEFAULT 0,
    total_expenses INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default');
`;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  for (const m of financeMigrations) db.exec(m.up);
  for (const m of nutritionMigrations) db.exec(m.up);
  db.exec(PLAYER_STATS_DDL);
  return db;
}

// ── seed helpers ────────────────────────────────────────────────────────────

function addHabit(db: Database.Database, id: string, name: string, frequency: string, timesPerWeek: number): void {
  db.prepare(
    "INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')"
  ).run(id, name, frequency, timesPerWeek);
}

function checkHabit(db: Database.Database, id: string, habitId: string, date: string, deletedAt: string | null = null): void {
  db.prepare(
    "INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, habitId, date, date, date, deletedAt);
}

function addTask(
  db: Database.Database,
  id: string,
  fields: { name?: string; status?: number; tier?: number; category?: string; dueDate?: string | null; deletedAt?: string | null; order?: number } = {},
): void {
  db.prepare(`
    INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', ?)
  `).run(
    id, fields.name ?? 'Task', fields.status ?? 0, fields.tier ?? 2,
    fields.category ?? '', fields.dueDate ?? null, fields.order ?? 0, fields.deletedAt ?? null,
  );
}

function addSubtask(
  db: Database.Database,
  id: string,
  taskId: string,
  fields: { name?: string; status?: number; tier?: number; deletedAt?: string | null } = {},
): void {
  db.prepare(`
    INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, '', ?, ?, 0, '2026-07-01', '2026-07-01', ?)
  `).run(id, taskId, fields.name ?? 'Sub', fields.tier ?? 1, fields.status ?? 0, fields.deletedAt ?? null);
}

function addTx(
  db: Database.Database,
  id: string,
  fields: {
    type?: 'expense' | 'income'; amount: number; currency?: string; category?: string;
    description?: string; date: string; impactsBalance?: number; deletedAt?: string | null;
  },
): void {
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       installments, impacts_balance, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'manual', 1, ?, ?, ?, ?)
  `).run(
    id, fields.type ?? 'expense', fields.amount, fields.currency ?? 'ARS',
    fields.category ?? 'Otros', fields.description ?? '', fields.date,
    fields.impactsBalance ?? 1, '2026-07-09T00:00:00Z', '2026-07-09T00:00:00Z', fields.deletedAt ?? null,
  );
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('buildSylSnapshot — metadata', () => {
  it('produces the fixed envelope from opts', () => {
    const db = setupDb();
    const snap = buildSylSnapshot(db, OPTS);
    expect(snap.schemaVersion).toBe(1);
    expect(snap.computedAt).toBe(OPTS.now);
    expect(snap.computedForDate).toBe(TODAY);
    expect(snap.appVersion).toBe('0.7.3');
  });
});

describe('questify.habits — pendingToday per frequency', () => {
  it('daily: pending when not checked today, not pending when checked', () => {
    const db = setupDb();
    addHabit(db, 'd1', 'Meditate', 'daily', 1);
    addHabit(db, 'd2', 'Read', 'daily', 1);
    checkHabit(db, 'c1', 'd2', TODAY); // d2 checked today

    const { habits } = buildSylSnapshot(db, OPTS).questify;
    const d1 = habits.find(h => h.id === 'd1')!;
    const d2 = habits.find(h => h.id === 'd2')!;
    expect(d1.pendingToday).toBe(true);
    expect(d1.targetThisPeriod).toBe(1);
    expect(d2.pendingToday).toBe(false);
    expect(d2.checkedToday).toBe(true);
  });

  it('weekly (timesPerWeek): pending until target met within Monday-based week', () => {
    const db = setupDb();
    addHabit(db, 'w1', 'Gym', 'weekly', 3);
    addHabit(db, 'w2', 'Run', 'weekly', 3);
    // w1 met: 3 checks in the same week (Mon 07-06 .. today)
    checkHabit(db, 'wc1', 'w1', '2026-07-06');
    checkHabit(db, 'wc2', 'w1', '2026-07-07');
    checkHabit(db, 'wc3', 'w1', '2026-07-08');
    // w2 partial: 1 check
    checkHabit(db, 'wc4', 'w2', '2026-07-06');

    const { habits } = buildSylSnapshot(db, OPTS).questify;
    const w1 = habits.find(h => h.id === 'w1')!;
    const w2 = habits.find(h => h.id === 'w2')!;
    expect(w1.checksThisPeriod).toBe(3);
    expect(w1.pendingToday).toBe(false);
    expect(w2.checksThisPeriod).toBe(1);
    expect(w2.pendingToday).toBe(true);
  });

  it('monthly: pending until at least one check this month', () => {
    const db = setupDb();
    addHabit(db, 'm1', 'Barber', 'monthly', 1);
    addHabit(db, 'm2', 'Dentist', 'monthly', 1);
    checkHabit(db, 'mc1', 'm1', '2026-07-01'); // m1 done this month
    checkHabit(db, 'mc2', 'm2', '2026-06-15'); // m2 last month only → still pending

    const { habits } = buildSylSnapshot(db, OPTS).questify;
    const m1 = habits.find(h => h.id === 'm1')!;
    const m2 = habits.find(h => h.id === 'm2')!;
    expect(m1.pendingToday).toBe(false);
    expect(m2.checksThisPeriod).toBe(0);
    expect(m2.pendingToday).toBe(true);
  });

  it('habitsPendingToday holds remaining and excludes met habits', () => {
    const db = setupDb();
    addHabit(db, 'w1', 'Gym', 'weekly', 3);
    checkHabit(db, 'wc1', 'w1', '2026-07-06'); // 1/3
    addHabit(db, 'd1', 'Done', 'daily', 1);
    checkHabit(db, 'dc1', 'd1', TODAY); // met, excluded

    const { habitsPendingToday, counts } = buildSylSnapshot(db, OPTS).questify;
    expect(habitsPendingToday).toHaveLength(1);
    expect(habitsPendingToday[0]).toMatchObject({ id: 'w1', remaining: 2, frequency: 'weekly' });
    expect(counts.habitsTotal).toBe(2);
    expect(counts.habitsPending).toBe(1);
  });

  it('excludes soft-deleted habit checks', () => {
    const db = setupDb();
    addHabit(db, 'd1', 'Read', 'daily', 1);
    checkHabit(db, 'c1', 'd1', TODAY, '2026-07-09T10:00:00Z'); // deleted check
    const d1 = buildSylSnapshot(db, OPTS).questify.habits.find(h => h.id === 'd1')!;
    expect(d1.checkedToday).toBe(false);
    expect(d1.pendingToday).toBe(true);
  });
});

describe('questify.questsOverdue', () => {
  it('includes only past-due, open, non-deleted tasks with correct daysOverdue', () => {
    const db = setupDb();
    addTask(db, 't-overdue', { name: 'Pay bill', tier: 1, dueDate: '2026-07-05' });          // 4 days overdue
    addTask(db, 't-future', { name: 'Future', dueDate: '2026-07-20' });                        // not due yet
    addTask(db, 't-today', { name: 'Today', dueDate: TODAY });                                 // due today, not < today
    addTask(db, 't-done', { name: 'Done', status: 1, dueDate: '2026-07-01' });                 // completed
    addTask(db, 't-del', { name: 'Deleted', dueDate: '2026-07-01', deletedAt: '2026-07-02' }); // deleted
    addTask(db, 't-nodue', { name: 'No due' });                                                // no due date

    const { questsOverdue, counts } = buildSylSnapshot(db, OPTS).questify;
    expect(questsOverdue).toHaveLength(1);
    expect(questsOverdue[0]).toMatchObject({ id: 't-overdue', name: 'Pay bill', tier: 1, dueDate: '2026-07-05', daysOverdue: 4 });
    expect(counts.tasksOverdue).toBe(1);
  });
});

describe('questify.tasksActive + subtasks', () => {
  it('nests non-deleted subtasks with correct progress, and excludes completed/deleted tasks', () => {
    const db = setupDb();
    addTask(db, 'ta', { name: 'Report' });
    addSubtask(db, 's1', 'ta', { name: 'A', status: 1 });
    addSubtask(db, 's2', 'ta', { name: 'B', status: 0 });
    addSubtask(db, 's3', 'ta', { name: 'Gone', status: 1, deletedAt: '2026-07-02' }); // excluded
    // A completed task with a subtask — must not appear, nor its subtasks
    addTask(db, 'tb', { name: 'Done', status: 1 });
    addSubtask(db, 's4', 'tb', { name: 'X', status: 0 });
    // A deleted task
    addTask(db, 'tc', { name: 'Del', deletedAt: '2026-07-02' });

    const { tasksActive, counts } = buildSylSnapshot(db, OPTS).questify;
    expect(tasksActive).toHaveLength(1);
    const task = tasksActive[0];
    expect(task.id).toBe('ta');
    expect(task.subtasks).toHaveLength(2);              // s3 excluded
    expect(task.subtasks.map(s => s.id).sort()).toEqual(['s1', 's2']);
    expect(task.subtaskProgress).toEqual({ done: 1, total: 2 });
    expect(task.subtasks[0].status).toBe(true);         // boolean, not 0/1
    expect(counts.tasksActive).toBe(1);
  });
});

describe('coinify — multi-currency spend & balance', () => {
  it('todaySpend excludes credit-card (impacts_balance=0) and deleted rows, splits by currency', () => {
    const db = setupDb();
    addTx(db, 'e1', { amount: 12500, currency: 'ARS', date: TODAY });                       // counts
    addTx(db, 'e2', { amount: 30, currency: 'USD', date: TODAY });                          // counts
    addTx(db, 'e3', { amount: 9999, currency: 'ARS', date: TODAY, impactsBalance: 0 });     // credit card, excluded
    addTx(db, 'e4', { amount: 8888, currency: 'ARS', date: TODAY, deletedAt: '2026-07-09T01:00:00Z' }); // deleted
    addTx(db, 'e5', { amount: 500, currency: 'ARS', date: '2026-07-08' });                  // not today
    addTx(db, 'i1', { type: 'income', amount: 100000, currency: 'ARS', date: TODAY });      // income, not spend

    const { todaySpend, monthSpend } = buildSylSnapshot(db, OPTS).coinify;
    expect(todaySpend).toEqual({ ARS: 12500, USD: 30 });
    // monthSpend includes 07-08 expense too (same month), still excludes cc/deleted
    expect(monthSpend).toEqual({ ARS: 13000, USD: 30 });
  });

  it('monthBalance = income - expense per currency for the current month (impacts_balance=1 only)', () => {
    const db = setupDb();
    addTx(db, 'i1', { type: 'income', amount: 100000, currency: 'ARS', date: TODAY });
    addTx(db, 'e1', { type: 'expense', amount: 12000, currency: 'ARS', date: TODAY });
    addTx(db, 'e2', { type: 'expense', amount: 5000, currency: 'ARS', date: TODAY, impactsBalance: 0 }); // credit card, ignored
    addTx(db, 'x1', { type: 'expense', amount: 7777, currency: 'ARS', date: TODAY, deletedAt: '2026-07-09T01:00:00Z' }); // deleted, ignored
    addTx(db, 'i2', { type: 'income', amount: 320, currency: 'USD', date: TODAY });

    const { monthBalance } = buildSylSnapshot(db, OPTS).coinify;
    expect(monthBalance).toEqual({ ARS: 88000, USD: 320 });
  });

  it('monthBalance counts only the current month, excluding other months', () => {
    const db = setupDb();
    // current month (2026-07)
    addTx(db, 'i1', { type: 'income', amount: 50000, currency: 'ARS', date: '2026-07-01' });
    addTx(db, 'e1', { type: 'expense', amount: 8000, currency: 'ARS', date: TODAY });
    // other months — must NOT count toward the current month's balance
    addTx(db, 'i-prev', { type: 'income', amount: 999999, currency: 'ARS', date: '2026-06-30' });
    addTx(db, 'e-next', { type: 'expense', amount: 999999, currency: 'ARS', date: '2026-08-01' });

    const { monthBalance } = buildSylSnapshot(db, OPTS).coinify;
    expect(monthBalance).toEqual({ ARS: 42000, USD: 0 });
  });

  it('monthBalance is zeros (not null) when there are no balance-impacting transactions this month', () => {
    const db = setupDb();
    addTx(db, 'e1', { amount: 500, currency: 'ARS', date: TODAY, impactsBalance: 0 }); // credit card only
    const { monthBalance } = buildSylSnapshot(db, OPTS).coinify;
    expect(monthBalance).toEqual({ ARS: 0, USD: 0 });
  });

  it('recentTransactions excludes deleted rows', () => {
    const db = setupDb();
    addTx(db, 'e1', { amount: 100, currency: 'ARS', date: TODAY });
    addTx(db, 'e2', { amount: 200, currency: 'ARS', date: TODAY, deletedAt: '2026-07-09T01:00:00Z' });
    const { recentTransactions } = buildSylSnapshot(db, OPTS).coinify;
    expect(recentTransactions).toHaveLength(1);
    expect(recentTransactions[0].id).toBe('e1');
  });
});

describe('nutrify — camelCase normalization', () => {
  function seedProfile(db: Database.Database): void {
    db.prepare(`
      INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal)
      VALUES (1, 30, 'M', 180, 80, 'moderate', 500)
    `).run();
  }

  it('todayCalories/todayTarget/todayBalance come from the daily summary', () => {
    const db = setupDb();
    seedProfile(db);
    db.prepare(
      'INSERT INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance) VALUES (?, ?, ?, ?, ?)'
    ).run(TODAY, 1420, 1700, 2300, 880);

    const { nutrify } = buildSylSnapshot(db, OPTS);
    expect(nutrify.todayCalories).toBe(1420);
    expect(nutrify.todayTarget).toBe(2300 - 500); // tdee - deficit
    expect(nutrify.todayBalance).toBe(880);
    expect(nutrify.profileSummary).toEqual({ sex: 'M', activityLevel: 'moderate', deficitTargetKcal: 500 });
  });

  it('recentFoodLog is camelCase and excludes deleted rows (no snake_case leaks)', () => {
    const db = setupDb();
    seedProfile(db);
    db.prepare(
      "INSERT INTO food_log (date, time, description, calories, source, meal) VALUES (?, '13:00', 'Milanesa', 530, 'manual', 'almuerzo')"
    ).run(TODAY);
    db.prepare(
      "INSERT INTO food_log (date, time, description, calories, source, meal, deleted_at) VALUES (?, '20:00', 'Deleted', 200, 'manual', 'cena', '2026-07-09T01:00:00Z')"
    ).run(TODAY);

    const { recentFoodLog } = buildSylSnapshot(db, OPTS).nutrify;
    expect(recentFoodLog).toHaveLength(1);
    const entry = recentFoodLog[0];
    expect(entry).toEqual({ date: TODAY, time: '13:00', description: 'Milanesa', calories: 530, meal: 'almuerzo' });
    // no snake_case keys leaked through
    expect(Object.keys(entry).some(k => k.includes('_'))).toBe(false);
  });

  it('falls back to food_log sum when no summary exists; target null without summary', () => {
    const db = setupDb();
    seedProfile(db);
    db.prepare(
      "INSERT INTO food_log (date, time, description, calories, source) VALUES (?, '09:00', 'Cafe', 120, 'manual')"
    ).run(TODAY);
    db.prepare(
      "INSERT INTO food_log (date, time, description, calories, source) VALUES (?, '13:00', 'Almuerzo', 600, 'manual')"
    ).run(TODAY);

    const { nutrify } = buildSylSnapshot(db, OPTS);
    expect(nutrify.todayCalories).toBe(720);
    expect(nutrify.todayTarget).toBeNull();
    expect(nutrify.todayBalance).toBeNull();
  });
});

describe('player projection', () => {
  it('maps player_stats to the contract shape', () => {
    const db = setupDb();
    db.prepare(
      "UPDATE player_stats SET level = 12, xp = 340, hp = 85, max_hp = 100, title = 'Aventurero', streak = 7, total_tasks = 214, total_meals = 530, total_expenses = 388 WHERE user_id = 'default'"
    ).run();

    const { player } = buildSylSnapshot(db, OPTS);
    expect(player.level).toBe(12);
    expect(player.xp).toBe(340);
    expect(player.hp).toBe(85);
    expect(player.maxHp).toBe(100);
    expect(player.title).toBe('Aventurero');
    expect(player.streak).toBe(7);
    expect(player.totalTasks).toBe(214);
    expect(player.totalMeals).toBe(530);
    expect(player.totalExpenses).toBe(388);
    expect(typeof player.xpToNextLevel).toBe('number');
  });
});
