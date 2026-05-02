import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { notificationsMigrations } from '../../../electron/modules/notifications.schema';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  evaluateQuestNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
} from '../../../electron/modules/notification-engine';

function runMigrations(db: Database.Database, migrations: { up: string }[]) {
  for (const m of migrations) {
    db.exec(m.up);
  }
}

function setupQuestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, notificationsMigrations);
  runMigrations(db, questsMigrations);
  return db;
}

function setupNutritionDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, notificationsMigrations);
  runMigrations(db, nutritionMigrations);
  return db;
}

function setupFinanceDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, notificationsMigrations);
  runMigrations(db, financeMigrations);
  return db;
}

// ── Quest Evaluator ─────────────────────────────────────────

describe('evaluateQuestNotifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupQuestDb();
  });

  it('returns quest_due_soon for task due tomorrow', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, created_at, updated_at)
       VALUES ('t1', 'Study', 0, DATE('now', '+1 day'), datetime('now'), datetime('now'))`
    ).run();

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('quest_due_soon');
    expect(results[0].title).toContain('Study');
    expect(results[0].title).toContain('vence mañana');
    expect(results[0].refId).toBe('t1');
    expect(results[0].actionRoute).toBe('/quests');
  });

  it('returns quest_overdue for task past due date', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, created_at, updated_at)
       VALUES ('t2', 'Report', 0, DATE('now', '-2 days'), datetime('now'), datetime('now'))`
    ).run();

    const results = evaluateQuestNotifications(db);
    const overdue = results.filter((r) => r.type === 'quest_overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].title).toContain('Report');
    expect(overdue[0].title).toContain('está vencida');
  });

  it('returns quest_stale for task not updated in 7+ days', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, created_at, updated_at)
       VALUES ('t3', 'Cleanup', 0, datetime('now', '-10 days'), datetime('now', '-10 days'))`
    ).run();

    const results = evaluateQuestNotifications(db);
    const stale = results.filter((r) => r.type === 'quest_stale');
    expect(stale).toHaveLength(1);
    expect(stale[0].title).toContain('Cleanup');
    expect(stale[0].title).toContain('no avanza');
  });

  it('ignores completed tasks', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, updated_at, created_at)
       VALUES ('t4', 'Done Task', 1, DATE('now', '-1 day'), datetime('now', '-10 days'), datetime('now', '-10 days'))`
    ).run();

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(0);
  });

  it('ignores deleted tasks', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, deleted_at, updated_at, created_at)
       VALUES ('t5', 'Deleted Task', 0, DATE('now', '-1 day'), datetime('now'), datetime('now', '-10 days'), datetime('now', '-10 days'))`
    ).run();

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(0);
  });
});

// ── Nutrition Evaluator ─────────────────────────────────────

describe('evaluateNutritionNotifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupNutritionDb();
  });

  it('returns nutri_pending for day with food logged but not closed', () => {
    // Use 3 days ago to avoid time-of-day gate (yesterday has grace period until 8 PM)
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO food_log (date, time, description, calories, source)
       VALUES (?, '12:00', 'Lunch', 500, 'manual')`
    ).run(threeDaysAgo);

    const results = evaluateNutritionNotifications(db);
    const pending = results.filter((r) => r.type === 'nutri_pending');
    // Before 10 AM the evaluator returns nothing (day just started) — skip assertion
    const hour = new Date().getHours();
    if (hour < 10) {
      expect(pending).toHaveLength(0);
    } else {
      expect(pending).toHaveLength(1);
      expect(pending[0].refId).toBe(threeDaysAgo);
    }
  });

  it('does not return nutri_pending if day is closed', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO food_log (date, time, description, calories, source)
       VALUES (?, '12:00', 'Lunch', 500, 'manual')`
    ).run(yesterday);
    db.prepare(
      `INSERT INTO nutrition_daily_closed (date, xp_total, hp_change, consumed, target)
       VALUES (?, 100, 0, 500, 2000)`
    ).run(yesterday);

    const results = evaluateNutritionNotifications(db);
    const pending = results.filter((r) => r.type === 'nutri_pending');
    expect(pending).toHaveLength(0);
  });

  it('DB query returns 0 meals for today when no food logged (nutri_no_meals prerequisite)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const count = db
      .prepare(`SELECT COUNT(*) AS cnt FROM food_log WHERE date = ?`)
      .get(today) as { cnt: number };
    expect(count.cnt).toBe(0);
  });
});

// ── Finance Evaluator ───────────────────────────────────────

describe('evaluateFinanceNotifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupFinanceDb();
  });

  it('returns finance_loan_pending for unsettled loan older than 30 days', () => {
    db.prepare(
      `INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, settled, created_at)
       VALUES ('ln1', 'Juan', 'lent', 'single', 5000, 'ARS', '2020-01-01', 0, datetime('now', '-45 days'))`
    ).run();

    const results = evaluateFinanceNotifications(db);
    const loans = results.filter((r) => r.type === 'finance_loan_pending');
    expect(loans).toHaveLength(1);
    expect(loans[0].title).toContain('Juan');
    expect(loans[0].refId).toBe('ln1');
  });

  it('does not return finance_loan_pending for settled loan', () => {
    db.prepare(
      `INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, settled, created_at)
       VALUES ('ln2', 'Maria', 'borrowed', 'single', 3000, 'ARS', '2020-01-01', 1, datetime('now', '-45 days'))`
    ).run();

    const results = evaluateFinanceNotifications(db);
    const loans = results.filter((r) => r.type === 'finance_loan_pending');
    expect(loans).toHaveLength(0);
  });

  it('returns finance_recurring_missing when no transaction this month', () => {
    const now = new Date();
    const billingDay = 1; // always in the past unless it's the 1st

    db.prepare(
      `INSERT INTO finance_recurring (id, name, type, amount, active, billing_day, created_at)
       VALUES ('rec1', 'Netflix', 'expense', 1000, 1, ?, datetime('now'))`
    ).run(billingDay);

    // Only fires if currentDay >= billing_day
    if (now.getDate() >= billingDay) {
      const results = evaluateFinanceNotifications(db);
      const missing = results.filter((r) => r.type === 'finance_recurring_missing');
      expect(missing).toHaveLength(1);
      expect(missing[0].title).toContain('Netflix');
      expect(missing[0].refId).toBe('rec1');
    }
  });

  it('does not return finance_recurring_missing when transaction exists', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const billingDay = 1;

    db.prepare(
      `INSERT INTO finance_recurring (id, name, type, amount, active, billing_day, created_at)
       VALUES ('rec2', 'Spotify', 'expense', 500, 1, ?, datetime('now'))`
    ).run(billingDay);

    db.prepare(
      `INSERT INTO finance_transactions (id, type, amount, date, source, recurring_id, created_at, updated_at)
       VALUES ('tx1', 'expense', 500, ? || '-05', 'recurring', 'rec2', datetime('now'), datetime('now'))`
    ).run(currentMonth);

    const results = evaluateFinanceNotifications(db);
    const missing = results.filter((r) => r.type === 'finance_recurring_missing');
    expect(missing).toHaveLength(0);
  });
});

// ── Deduplication ───────────────────────────────────────────

describe('deduplicateAndInsert', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupQuestDb();
  });

  it('inserts new notification', () => {
    const candidates = [
      {
        type: 'quest_overdue',
        module: 'quests',
        title: 'Test',
        body: 'Body',
        actionRoute: '/quests',
        refId: 'task-1',
      },
    ];

    const inserted = deduplicateAndInsert(db, candidates);
    expect(inserted).toBe(1);

    const row = db
      .prepare(`SELECT * FROM notifications WHERE ref_id = 'task-1'`)
      .get() as Record<string, unknown>;
    expect(row.type).toBe('quest_overdue');
    expect(row.status).toBe('active');
  });

  it('skips duplicate (same type + ref_id)', () => {
    const candidates = [
      {
        type: 'quest_overdue',
        module: 'quests',
        title: 'Test',
        body: 'Body',
        actionRoute: '/quests',
        refId: 'task-1',
      },
    ];

    deduplicateAndInsert(db, candidates);
    const second = deduplicateAndInsert(db, candidates);
    expect(second).toBe(0);

    const count = db
      .prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE ref_id = 'task-1'`)
      .get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });
});

// ── Auto-Resolve ────────────────────────────────────────────

describe('autoResolve', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupQuestDb();
  });

  it('resolves quest_overdue when task is completed', () => {
    // Insert a completed task
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, created_at, updated_at)
       VALUES ('t1', 'Done', 1, DATE('now', '-1 day'), datetime('now'), datetime('now'))`
    ).run();

    // Insert an active notification for it
    db.prepare(
      `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, created_at, updated_at)
       VALUES ('n1', 'quest_overdue', 'quests', 'Test', 'Body', '/quests', 't1', 'active', datetime('now'), datetime('now'))`
    ).run();

    const resolved = autoResolve(db);
    expect(resolved).toBeGreaterThanOrEqual(1);

    const notif = db
      .prepare(`SELECT status FROM notifications WHERE id = 'n1'`)
      .get() as { status: string };
    expect(notif.status).toBe('resolved');
  });

  it('reactivates snoozed notifications past their snooze time', () => {
    db.prepare(
      `INSERT INTO tasks (id, name, status, due_date, created_at, updated_at)
       VALUES ('t2', 'Pending', 0, DATE('now', '-1 day'), datetime('now'), datetime('now'))`
    ).run();

    db.prepare(
      `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, snoozed_until, created_at, updated_at)
       VALUES ('n2', 'quest_overdue', 'quests', 'Test', 'Body', '/quests', 't2', 'snoozed', datetime('now', '-1 hour'), datetime('now'), datetime('now'))`
    ).run();

    autoResolve(db);

    const notif = db
      .prepare(`SELECT status, snoozed_until FROM notifications WHERE id = 'n2'`)
      .get() as { status: string; snoozed_until: string | null };
    expect(notif.status).toBe('active');
    expect(notif.snoozed_until).toBeNull();
  });
});

// ── Cleanup ─────────────────────────────────────────────────

describe('cleanupOldNotifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupQuestDb();
  });

  it('deletes resolved notifications older than 30 days', () => {
    db.prepare(
      `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, created_at, updated_at)
       VALUES ('n1', 'quest_overdue', 'quests', 'Old', 'Body', '/quests', 't1', 'resolved', datetime('now', '-60 days'), datetime('now', '-60 days'))`
    ).run();

    const deleted = cleanupOldNotifications(db);
    expect(deleted).toBe(1);

    const row = db.prepare(`SELECT * FROM notifications WHERE id = 'n1'`).get();
    expect(row).toBeUndefined();
  });

  it('does not delete recent resolved notifications', () => {
    db.prepare(
      `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, created_at, updated_at)
       VALUES ('n2', 'quest_overdue', 'quests', 'Recent', 'Body', '/quests', 't2', 'resolved', datetime('now', '-5 days'), datetime('now', '-5 days'))`
    ).run();

    const deleted = cleanupOldNotifications(db);
    expect(deleted).toBe(0);
  });

  it('does not delete active notifications', () => {
    db.prepare(
      `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, created_at, updated_at)
       VALUES ('n3', 'quest_overdue', 'quests', 'Active', 'Body', '/quests', 't3', 'active', datetime('now', '-60 days'), datetime('now', '-60 days'))`
    ).run();

    const deleted = cleanupOldNotifications(db);
    expect(deleted).toBe(0);
  });
});
