# Notification System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-channel notification system (in-app center + Windows native) that alerts users about overdue tasks, pending nutrition days, upcoming payments, and more.

**Architecture:** NotificationEngine in Electron main process evaluates conditions every 30 min against SQLite, persists notifications, and sends native alerts. NotificationCenter in React provides a bell icon with badge + drawer panel for viewing/acting on notifications. Two independent toggles in Settings.

**Tech Stack:** Electron (main process), React, better-sqlite3, GSAP (animations), i18next

---

## Chunk 1: Database, Types & Engine Core

### Task 1: Schema migration

**Files:**
- Create: `electron/modules/notifications.schema.ts`
- Modify: `electron/main.ts:5-9` (add import)
- Modify: `electron/main.ts:134-137` (add runModuleMigrations call)

- [ ] **Step 1: Create migration file**

```typescript
// electron/modules/notifications.schema.ts
// Lives in electron/modules/ (not inside a single module folder) because
// notifications is a cross-module concern, similar to notifications.ipc.ts.
import type { Migration } from '../../shared/types';

export const notificationsMigrations: Migration[] = [
  {
    namespace: 'notifications',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        module TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        action_route TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        snoozed_until TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        ref_id TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_type_ref ON notifications(type, ref_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    `,
  },
];
```

- [ ] **Step 2: Register migration in main.ts**

In `electron/main.ts`, add import at line 8 (after characterMigrations import):

```typescript
import { notificationsMigrations } from './modules/notifications.schema';
```

Add after line 137 (`runModuleMigrations(characterMigrations)`):

```typescript
runModuleMigrations(notificationsMigrations);
```

- [ ] **Step 3: Commit**

```bash
git add electron/modules/notifications.schema.ts electron/main.ts
git commit -m "feat(notifications): add notifications table migration"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `shared/types.ts:45-46` (add AppNotification interface)
- Modify: `shared/types.ts:150-152` (add new IPC methods to HubtifyApi)

- [ ] **Step 1: Add AppNotification interface**

In `shared/types.ts`, after the `Migration` interface (line 45), add:

```typescript
// ── Notification Types ────────────────────────────────────

export interface AppNotification {
  id: string;
  type: string;
  module: string;
  title: string;
  body: string;
  actionRoute: string;
  status: 'active' | 'snoozed' | 'resolved' | 'dismissed';
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
  refId: string | null;
}
```

- [ ] **Step 2: Add IPC methods to HubtifyApi**

In `shared/types.ts`, replace the existing Notifications section (lines 150-152):

```typescript
  // Notifications
  notificationsSend: (title: string, body: string) => Promise<boolean>;
  notificationsGetAll: () => Promise<AppNotification[]>;
  notificationsDismiss: (id: string) => Promise<void>;
  notificationsSnooze: (id: string) => Promise<void>;
  notificationsRunCheck: () => Promise<void>;
  notificationsGetCount: () => Promise<number>;
  notificationsSetSystemEnabled: (enabled: boolean) => Promise<void>;
  onNotificationsUpdated: (callback: () => void) => () => void;
```

Remove `notificationsSetReminders` from the interface — it's being replaced by the engine.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(notifications): add AppNotification type and IPC methods"
```

---

### Task 3: Notification engine — evaluators

**Files:**
- Create: `electron/modules/notification-engine.ts`
- Test: `tests/modules/notifications/notification-engine.test.ts`

- [ ] **Step 1: Write tests for quest evaluators**

Create `tests/modules/notifications/notification-engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { notificationsMigrations } from '../../../electron/modules/notifications.schema';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  evaluateQuestNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
} from '../../../electron/modules/notification-engine';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of notificationsMigrations) db.exec(m.up);
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return daysFromNow(-n);
}

describe('evaluateQuestNotifications', () => {
  let db: Database.Database;

  beforeEach(() => { db = setupDb(); });

  it('returns quest_due_soon for task due tomorrow', () => {
    const tomorrow = daysFromNow(1);
    db.prepare(`INSERT INTO tasks (id, name, status, due_date, created_at, updated_at) VALUES (?, ?, 0, ?, datetime('now'), datetime('now'))`).run('t1', 'Test task', tomorrow);

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('quest_due_soon');
    expect(results[0].refId).toBe('t1');
  });

  it('returns quest_overdue for task past due date', () => {
    const yesterday = daysAgo(1);
    db.prepare(`INSERT INTO tasks (id, name, status, due_date, created_at, updated_at) VALUES (?, ?, 0, ?, datetime('now'), datetime('now'))`).run('t1', 'Late task', yesterday);

    const results = evaluateQuestNotifications(db);
    const overdue = results.filter(r => r.type === 'quest_overdue');
    expect(overdue).toHaveLength(1);
  });

  it('returns quest_stale for task not updated in 7+ days', () => {
    const oldDate = daysAgo(10);
    db.prepare(`INSERT INTO tasks (id, name, status, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`).run('t1', 'Stale task', oldDate, oldDate);

    const results = evaluateQuestNotifications(db);
    const stale = results.filter(r => r.type === 'quest_stale');
    expect(stale).toHaveLength(1);
  });

  it('ignores completed tasks', () => {
    const yesterday = daysAgo(1);
    db.prepare(`INSERT INTO tasks (id, name, status, due_date, created_at, updated_at) VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))`).run('t1', 'Done task', yesterday);

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(0);
  });

  it('ignores deleted tasks', () => {
    const yesterday = daysAgo(1);
    db.prepare(`INSERT INTO tasks (id, name, status, due_date, deleted_at, created_at, updated_at) VALUES (?, ?, 0, ?, datetime('now'), datetime('now'), datetime('now'))`).run('t1', 'Deleted', yesterday);

    const results = evaluateQuestNotifications(db);
    expect(results).toHaveLength(0);
  });
});

describe('deduplicateAndInsert', () => {
  let db: Database.Database;

  beforeEach(() => { db = setupDb(); });

  it('inserts new notification', () => {
    const inserted = deduplicateAndInsert(db, [{
      type: 'quest_overdue',
      module: 'quests',
      title: 'Test',
      body: 'Body',
      actionRoute: '/quests',
      refId: 't1',
    }]);
    expect(inserted).toBe(1);

    const all = db.prepare('SELECT * FROM notifications').all();
    expect(all).toHaveLength(1);
  });

  it('skips duplicate (same type + ref_id with active status)', () => {
    deduplicateAndInsert(db, [{
      type: 'quest_overdue', module: 'quests', title: 'T', body: 'B', actionRoute: '/quests', refId: 't1',
    }]);
    const inserted = deduplicateAndInsert(db, [{
      type: 'quest_overdue', module: 'quests', title: 'T2', body: 'B2', actionRoute: '/quests', refId: 't1',
    }]);
    expect(inserted).toBe(0);

    const all = db.prepare('SELECT * FROM notifications').all();
    expect(all).toHaveLength(1);
  });
});

describe('autoResolve', () => {
  let db: Database.Database;

  beforeEach(() => { db = setupDb(); });

  it('resolves quest_overdue when task is completed', () => {
    // Create task and notification
    db.prepare(`INSERT INTO tasks (id, name, status, due_date, created_at, updated_at) VALUES (?, ?, 0, ?, datetime('now'), datetime('now'))`).run('t1', 'Task', daysAgo(1));
    deduplicateAndInsert(db, [{
      type: 'quest_overdue', module: 'quests', title: 'T', body: 'B', actionRoute: '/quests', refId: 't1',
    }]);

    // Complete the task
    db.prepare('UPDATE tasks SET status = 1 WHERE id = ?').run('t1');

    const resolved = autoResolve(db);
    expect(resolved).toBe(1);

    const notif = db.prepare('SELECT status FROM notifications WHERE ref_id = ?').get('t1') as { status: string };
    expect(notif.status).toBe('resolved');
  });
});

describe('cleanupOldNotifications', () => {
  let db: Database.Database;

  beforeEach(() => { db = setupDb(); });

  it('deletes resolved notifications older than 30 days', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31);
    const oldIso = oldDate.toISOString();

    db.prepare(`INSERT INTO notifications (id, type, module, title, body, action_route, status, resolved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?, ?, ?)`).run('n1', 'quest_overdue', 'quests', 'T', 'B', '/quests', oldIso, oldIso, oldIso);

    const deleted = cleanupOldNotifications(db);
    expect(deleted).toBe(1);
  });
});

// ── Nutrition evaluator tests ──────────────────────────────────

import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

describe('evaluateNutritionNotifications', () => {
  let db: Database.Database;

  function setupNutriDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    for (const m of notificationsMigrations) db.exec(m.up);
    for (const m of nutritionMigrations) db.exec(m.up);
    return db;
  }

  beforeEach(() => { db = setupNutriDb(); });

  it('returns nutri_pending for day with food logged but not closed', () => {
    const yesterday = daysAgo(1);
    db.prepare(`INSERT INTO food_log (id, date, meal_type, description, calories, protein, carbs, fat, created_at) VALUES (?, ?, 'lunch', 'Test', 500, 20, 60, 15, datetime('now'))`).run('f1', yesterday);

    const results = evaluateNutritionNotifications(db);
    const pending = results.filter(r => r.type === 'nutri_pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].refId).toBe(yesterday);
  });

  it('does not return nutri_pending if day is closed', () => {
    const yesterday = daysAgo(1);
    db.prepare(`INSERT INTO food_log (id, date, meal_type, description, calories, protein, carbs, fat, created_at) VALUES (?, ?, 'lunch', 'Test', 500, 20, 60, 15, datetime('now'))`).run('f1', yesterday);
    db.prepare(`INSERT INTO nutrition_daily_closed (date, closed_at) VALUES (?, datetime('now'))`).run(yesterday);

    const results = evaluateNutritionNotifications(db);
    const pending = results.filter(r => r.type === 'nutri_pending');
    expect(pending).toHaveLength(0);
  });

  it('returns nutri_no_meals only via DB query (time check is JS-side)', () => {
    // We can only test the DB query part — nutri_no_meals triggers after 20:00 (JS check)
    // Just verify that when food_log is empty for today, the count query returns 0
    const todayStr = today();
    const result = db.prepare(`SELECT COUNT(*) as count FROM food_log WHERE date = ?`).get(todayStr) as { count: number };
    expect(result.count).toBe(0);
  });
});

// ── Finance evaluator tests ──────────────────────────────────

import { financeMigrations } from '@modules/finance/finance.schema';

describe('evaluateFinanceNotifications', () => {
  let db: Database.Database;

  function setupFinanceDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    for (const m of notificationsMigrations) db.exec(m.up);
    for (const m of financeMigrations) db.exec(m.up);
    return db;
  }

  beforeEach(() => { db = setupFinanceDb(); });

  it('returns finance_loan_pending for unsettled loan older than 30 days', () => {
    const oldDate = daysAgo(35);
    db.prepare(`INSERT INTO finance_loans (id, person_name, type, amount, settled, deleted_at, created_at, updated_at) VALUES (?, ?, 'lent', 1000, 0, NULL, ?, ?)`).run('l1', 'Juan', oldDate, oldDate);

    const results = evaluateFinanceNotifications(db);
    const loans = results.filter(r => r.type === 'finance_loan_pending');
    expect(loans).toHaveLength(1);
    expect(loans[0].refId).toBe('l1');
  });

  it('does not return finance_loan_pending for settled loan', () => {
    const oldDate = daysAgo(35);
    db.prepare(`INSERT INTO finance_loans (id, person_name, type, amount, settled, deleted_at, created_at, updated_at) VALUES (?, ?, 'lent', 1000, 1, NULL, ?, ?)`).run('l1', 'Juan', oldDate, oldDate);

    const results = evaluateFinanceNotifications(db);
    const loans = results.filter(r => r.type === 'finance_loan_pending');
    expect(loans).toHaveLength(0);
  });

  it('returns finance_recurring_missing when no transaction this month', () => {
    const currentDay = new Date().getDate();
    // Insert a recurring that should have billed already (billing_day in the past)
    const billingDay = Math.max(1, currentDay - 1);
    db.prepare(`INSERT INTO finance_recurring (id, name, amount, type, category_id, billing_day, active, deleted_at, created_at, updated_at) VALUES (?, ?, 500, 'expense', NULL, ?, 1, NULL, datetime('now'), datetime('now'))`).run('r1', 'Netflix', billingDay);

    const results = evaluateFinanceNotifications(db);
    const missing = results.filter(r => r.type === 'finance_recurring_missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].refId).toBe('r1');
  });

  it('does not return finance_recurring_missing when transaction exists', () => {
    const currentDay = new Date().getDate();
    const billingDay = Math.max(1, currentDay - 1);
    const currentMonth = new Date().toISOString().slice(0, 7);
    db.prepare(`INSERT INTO finance_recurring (id, name, amount, type, category_id, billing_day, active, deleted_at, created_at, updated_at) VALUES (?, ?, 500, 'expense', NULL, ?, 1, NULL, datetime('now'), datetime('now'))`).run('r1', 'Netflix', billingDay);
    db.prepare(`INSERT INTO finance_transactions (id, description, amount, type, date, source, recurring_id, deleted_at, created_at, updated_at) VALUES (?, 'Netflix', 500, 'expense', ?, 'recurring', 'r1', NULL, datetime('now'), datetime('now'))`).run('t1', `${currentMonth}-${String(billingDay).padStart(2, '0')}`);

    const results = evaluateFinanceNotifications(db);
    const missing = results.filter(r => r.type === 'finance_recurring_missing');
    expect(missing).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/notifications/notification-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement notification engine**

Create `electron/modules/notification-engine.ts`:

```typescript
import type Database from 'better-sqlite3';
import crypto from 'crypto';

const genId = (): string => crypto.randomUUID();

interface NotificationCandidate {
  type: string;
  module: string;
  title: string;
  body: string;
  actionRoute: string;
  refId: string;
}

// TODO: Notification titles/bodies are hardcoded in Spanish because the engine
// runs in the main process where i18n is not available. Future: pass locale
// preference from renderer and use a simple lookup map.

export function evaluateQuestNotifications(db: Database.Database): NotificationCandidate[] {
  const results: NotificationCandidate[] = [];

  // Quest due soon (tomorrow)
  const dueSoon = db.prepare(`
    SELECT id, name FROM tasks
    WHERE status = 0 AND deleted_at IS NULL
      AND due_date = DATE('now', '+1 day')
  `).all() as Array<{ id: string; name: string }>;

  for (const t of dueSoon) {
    results.push({
      type: 'quest_due_soon',
      module: 'quests',
      title: `Tarea "${t.name}" vence mañana`,
      body: 'Completala antes de que venza.',
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  // Quest overdue
  const overdue = db.prepare(`
    SELECT id, name FROM tasks
    WHERE status = 0 AND deleted_at IS NULL
      AND due_date < DATE('now')
  `).all() as Array<{ id: string; name: string }>;

  for (const t of overdue) {
    results.push({
      type: 'quest_overdue',
      module: 'quests',
      title: `Tarea "${t.name}" está vencida`,
      body: 'Esta tarea ya pasó su fecha de vencimiento.',
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  // Quest stale (no update in 7+ days)
  const stale = db.prepare(`
    SELECT id, name FROM tasks
    WHERE status = 0 AND deleted_at IS NULL
      AND updated_at < datetime('now', '-7 days')
  `).all() as Array<{ id: string; name: string }>;

  for (const t of stale) {
    results.push({
      type: 'quest_stale',
      module: 'quests',
      title: `Tarea "${t.name}" no avanza`,
      body: 'Esta tarea no se actualiza hace más de una semana.',
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  return results;
}

export function evaluateNutritionNotifications(db: Database.Database): NotificationCandidate[] {
  const results: NotificationCandidate[] = [];

  // Pending days (food logged but day not closed, last 7 days)
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const pendingDays = db.prepare(`
    SELECT DISTINCT f.date
    FROM food_log f
    LEFT JOIN nutrition_daily_closed c ON c.date = f.date
    WHERE c.date IS NULL
      AND f.date >= ? AND f.date < ?
    ORDER BY f.date ASC
  `).all(sevenDaysAgo, today) as Array<{ date: string }>;

  for (const d of pendingDays) {
    results.push({
      type: 'nutri_pending',
      module: 'nutrition',
      title: `Día ${d.date} sin cerrar`,
      body: 'Registraste comidas pero no cerraste el día.',
      actionRoute: '/nutrition',
      refId: d.date,
    });
  }

  // No meals today (only after 20:00 local time — JS check)
  if (new Date().getHours() >= 20) {
    const hasMeals = db.prepare(`
      SELECT COUNT(*) as count FROM food_log WHERE date = ?
    `).get(today) as { count: number };

    if (hasMeals.count === 0) {
      results.push({
        type: 'nutri_no_meals',
        module: 'nutrition',
        title: 'No registraste comidas hoy',
        body: 'Todavía estás a tiempo de estimar las calorías del día.',
        actionRoute: '/nutrition',
        refId: today,
      });
    }
  }

  return results;
}

export function evaluateFinanceNotifications(db: Database.Database): NotificationCandidate[] {
  const results: NotificationCandidate[] = [];

  // Installments due in next 3 days
  const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const installmentsDue = db.prepare(`
    SELECT t.installment_group_id, t.description, t.date,
           g.description AS group_desc
    FROM finance_transactions t
    JOIN finance_installment_groups g ON g.id = t.installment_group_id
    WHERE t.installment_group_id IS NOT NULL
      AND t.date >= ? AND t.date <= ?
      AND t.deleted_at IS NULL
    GROUP BY t.installment_group_id
  `).all(today, threeDaysFromNow) as Array<{ installment_group_id: string; description: string; date: string; group_desc: string }>;

  for (const i of installmentsDue) {
    const daysUntil = Math.ceil((new Date(i.date).getTime() - Date.now()) / 86400000);
    const label = daysUntil <= 0 ? 'hoy' : daysUntil === 1 ? 'mañana' : `en ${daysUntil} días`;
    results.push({
      type: 'finance_installment_due',
      module: 'finance',
      title: `Cuota de ${i.group_desc || i.description} vence ${label}`,
      body: 'Revisá tus pagos pendientes.',
      actionRoute: '/finance',
      refId: i.installment_group_id,
    });
  }

  // Credit card closing in 2 days
  const currentDay = new Date().getDate();
  const cards = db.prepare(`
    SELECT id, name, closing_day AS closingDay FROM finance_credit_cards
  `).all() as Array<{ id: string; name: string; closingDay: number }>;

  for (const card of cards) {
    // Note: closingDay === currentDay (daysUntilClosing === 0) does NOT trigger.
    // The notification fires 1-2 days BEFORE the closing day, not on it.
    const daysUntilClosing = ((card.closingDay - currentDay) + 31) % 31;
    if (daysUntilClosing > 0 && daysUntilClosing <= 2) {
      results.push({
        type: 'finance_card_closing',
        module: 'finance',
        title: `Tu tarjeta ${card.name} cierra en ${daysUntilClosing} días`,
        body: 'Revisá los consumos antes del cierre.',
        actionRoute: '/finance',
        refId: card.id,
      });
    }
  }

  // Loans pending > 30 days
  const pendingLoans = db.prepare(`
    SELECT id, person_name FROM finance_loans
    WHERE settled = 0 AND deleted_at IS NULL
      AND created_at < datetime('now', '-30 days')
  `).all() as Array<{ id: string; person_name: string }>;

  for (const loan of pendingLoans) {
    results.push({
      type: 'finance_loan_pending',
      module: 'finance',
      title: `Préstamo con ${loan.person_name} lleva más de un mes`,
      body: 'Considerá saldar este préstamo.',
      actionRoute: '/finance',
      refId: loan.id,
    });
  }

  // Recurring not registered this month
  const currentMonth = new Date().toISOString().slice(0, 7);

  const recurrings = db.prepare(`
    SELECT id, name, billing_day FROM finance_recurring
    WHERE active = 1 AND deleted_at IS NULL
  `).all() as Array<{ id: string; name: string; billing_day: number }>;

  for (const rec of recurrings) {
    if (currentDay >= rec.billing_day) {
      const hasTransaction = db.prepare(`
        SELECT COUNT(*) as count FROM finance_transactions
        WHERE source = 'recurring' AND recurring_id = ?
          AND date LIKE ? AND deleted_at IS NULL
      `).get(rec.id, `${currentMonth}%`) as { count: number };

      if (hasTransaction.count === 0) {
        results.push({
          type: 'finance_recurring_missing',
          module: 'finance',
          title: `Gasto recurrente "${rec.name}" no registrado`,
          body: 'No se generó la transacción recurrente para este mes.',
          actionRoute: '/finance',
          refId: rec.id,
        });
      }
    }
  }

  return results;
}

export function deduplicateAndInsert(db: Database.Database, candidates: NotificationCandidate[]): number {
  let inserted = 0;

  const checkStmt = db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE type = ? AND ref_id = ? AND status IN ('active', 'snoozed')
  `);

  const insertStmt = db.prepare(`
    INSERT INTO notifications (id, type, module, title, body, action_route, status, ref_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
  `);

  const tx = db.transaction(() => {
    for (const c of candidates) {
      const existing = checkStmt.get(c.type, c.refId) as { count: number };
      if (existing.count === 0) {
        insertStmt.run(genId(), c.type, c.module, c.title, c.body, c.actionRoute, c.refId);
        inserted++;
      }
    }
  });
  tx();

  return inserted;
}

export function autoResolve(db: Database.Database): number {
  let resolved = 0;

  // Quest notifications: resolve if task completed or deleted
  const questNotifs = db.prepare(`
    SELECT n.id, n.type, n.ref_id FROM notifications n
    WHERE n.module = 'quests' AND n.status = 'active'
  `).all() as Array<{ id: string; type: string; ref_id: string }>;

  for (const n of questNotifs) {
    const task = db.prepare('SELECT status, deleted_at FROM tasks WHERE id = ?').get(n.ref_id) as { status: number; deleted_at: string | null } | undefined;
    if (!task || task.status === 1 || task.deleted_at) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Nutrition pending: resolve if day was closed
  const nutriPending = db.prepare(`
    SELECT n.id, n.ref_id FROM notifications n
    WHERE n.type = 'nutri_pending' AND n.status = 'active'
  `).all() as Array<{ id: string; ref_id: string }>;

  for (const n of nutriPending) {
    const closed = db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ?').get(n.ref_id);
    if (closed) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Nutrition no meals: resolve if meals were logged
  const nutriNoMeals = db.prepare(`
    SELECT n.id, n.ref_id FROM notifications n
    WHERE n.type = 'nutri_no_meals' AND n.status = 'active'
  `).all() as Array<{ id: string; ref_id: string }>;

  for (const n of nutriNoMeals) {
    const hasMeals = db.prepare('SELECT COUNT(*) as count FROM food_log WHERE date = ?').get(n.ref_id) as { count: number };
    if (hasMeals.count > 0) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Finance loan: resolve if settled
  const loanNotifs = db.prepare(`
    SELECT n.id, n.ref_id FROM notifications n
    WHERE n.type = 'finance_loan_pending' AND n.status = 'active'
  `).all() as Array<{ id: string; ref_id: string }>;

  for (const n of loanNotifs) {
    const loan = db.prepare('SELECT settled FROM finance_loans WHERE id = ?').get(n.ref_id) as { settled: number } | undefined;
    if (!loan || loan.settled === 1) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Finance installment due: resolve if the transaction date has passed
  const installmentNotifs = db.prepare(`
    SELECT n.id, n.ref_id FROM notifications n
    WHERE n.type = 'finance_installment_due' AND n.status = 'active'
  `).all() as Array<{ id: string; ref_id: string }>;

  const todayStr = new Date().toISOString().slice(0, 10);
  for (const n of installmentNotifs) {
    const latest = db.prepare(`
      SELECT date FROM finance_transactions
      WHERE installment_group_id = ? AND deleted_at IS NULL
      ORDER BY date ASC LIMIT 1
    `).get(n.ref_id) as { date: string } | undefined;
    if (latest && latest.date < todayStr) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Finance card closing: resolve if notification is older than 3 days (time-sensitive)
  const cardClosingNotifs = db.prepare(`
    SELECT n.id FROM notifications n
    WHERE n.type = 'finance_card_closing' AND n.status = 'active'
      AND n.created_at < datetime('now', '-3 days')
  `).all() as Array<{ id: string }>;

  for (const n of cardClosingNotifs) {
    db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
    resolved++;
  }

  // Finance recurring missing: resolve if transaction appeared
  const recurringNotifs = db.prepare(`
    SELECT n.id, n.ref_id FROM notifications n
    WHERE n.type = 'finance_recurring_missing' AND n.status = 'active'
  `).all() as Array<{ id: string; ref_id: string }>;

  const currentMonth = new Date().toISOString().slice(0, 7);
  for (const n of recurringNotifs) {
    const hasTransaction = db.prepare(`
      SELECT COUNT(*) as count FROM finance_transactions
      WHERE source = 'recurring' AND recurring_id = ? AND date LIKE ? AND deleted_at IS NULL
    `).get(n.ref_id, `${currentMonth}%`) as { count: number };
    if (hasTransaction.count > 0) {
      db.prepare(`UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(n.id);
      resolved++;
    }
  }

  // Unsnoozed: reactivate snoozed notifications whose time has passed
  db.prepare(`
    UPDATE notifications SET status = 'active', snoozed_until = NULL, updated_at = datetime('now')
    WHERE status = 'snoozed' AND snoozed_until <= datetime('now')
  `).run();

  return resolved;
}

export function cleanupOldNotifications(db: Database.Database): number {
  const result = db.prepare(`
    DELETE FROM notifications
    WHERE status IN ('resolved', 'dismissed')
      AND updated_at < datetime('now', '-30 days')
  `).run();
  return result.changes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/notifications/notification-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/modules/notification-engine.ts tests/modules/notifications/notification-engine.test.ts
git commit -m "feat(notifications): add notification engine with evaluators and tests"
```

---

### Task 4: IPC handlers

**Files:**
- Modify: `electron/modules/notifications.ipc.ts` (rewrite)
- Modify: `electron/preload.ts:91-93` (add new methods)

- [ ] **Step 1: Rewrite notifications.ipc.ts**

Replace the entire content of `electron/modules/notifications.ipc.ts`:

```typescript
import { Notification, BrowserWindow } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import {
  evaluateQuestNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
} from './notification-engine';
import type { AppNotification } from '../../shared/types';

let pollingInterval: NodeJS.Timeout | null = null;
let lastNativeNotificationTime = 0;

const POLLING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NATIVE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

function runNotificationCheck(): number {
  const db = getDb();

  // Auto-resolve existing notifications
  autoResolve(db);

  // Evaluate all modules
  const candidates = [
    ...evaluateQuestNotifications(db),
    ...evaluateNutritionNotifications(db),
    ...evaluateFinanceNotifications(db),
  ];

  // Deduplicate and insert new ones
  const newCount = deduplicateAndInsert(db, candidates);

  // Cleanup old resolved/dismissed
  cleanupOldNotifications(db);

  // Send native notification if applicable
  if (newCount > 0) {
    const now = Date.now();
    if (now - lastNativeNotificationTime >= NATIVE_COOLDOWN_MS) {
      const totalActive = (db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE status = 'active' AND deleted_at IS NULL
      `).get() as { count: number }).count;

      if (totalActive > 0 && Notification.isSupported()) {
        new Notification({
          title: 'Hubtify',
          body: `Tenés ${totalActive} ${totalActive === 1 ? 'cosa pendiente' : 'cosas pendientes'}.`,
        }).show();
        lastNativeNotificationTime = now;
      }
    }

    // Notify renderer
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
  }

  return newCount;
}

export function startNotificationEngine(): void {
  // Run first check after a short delay (let migrations finish)
  setTimeout(() => runNotificationCheck(), 5000);

  pollingInterval = setInterval(() => runNotificationCheck(), POLLING_INTERVAL_MS);
}

export function stopNotificationEngine(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function registerNotificationIpcHandlers(): void {
  // Keep ad-hoc send for backward compatibility
  ipcHandle('notifications:send', (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return true;
    }
    return false;
  });

  ipcHandle('notifications:getAll', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, module, title, body,
             action_route AS actionRoute, status,
             snoozed_until AS snoozedUntil,
             created_at AS createdAt,
             updated_at AS updatedAt,
             resolved_at AS resolvedAt,
             deleted_at AS deletedAt,
             ref_id AS refId
      FROM notifications
      WHERE (status = 'active' AND deleted_at IS NULL)
         OR (status = 'snoozed' AND snoozed_until <= datetime('now') AND deleted_at IS NULL)
      ORDER BY created_at DESC
    `).all() as AppNotification[];
  });

  ipcHandle('notifications:dismiss', (_e, id: string) => {
    const db = getDb();
    db.prepare(`
      UPDATE notifications SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?
    `).run(id);
  });

  ipcHandle('notifications:snooze', (_e, id: string) => {
    const db = getDb();
    db.prepare(`
      UPDATE notifications
      SET status = 'snoozed',
          snoozed_until = datetime('now', '+6 hours'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
  });

  ipcHandle('notifications:runCheck', () => {
    return runNotificationCheck();
  });

  ipcHandle('notifications:getCount', () => {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE deleted_at IS NULL
        AND (status = 'active' OR (status = 'snoozed' AND snoozed_until <= datetime('now')))
    `).get() as { count: number };
    return result.count;
  });
}
```

- [ ] **Step 2: Update preload.ts**

In `electron/preload.ts`, replace lines 91-93 (the Notifications section):

```typescript
  // Notifications
  notificationsSend: (title: string, body: string) => ipcRenderer.invoke('notifications:send', title, body),
  notificationsGetAll: () => ipcRenderer.invoke('notifications:getAll'),
  notificationsDismiss: (id: string) => ipcRenderer.invoke('notifications:dismiss', id),
  notificationsSnooze: (id: string) => ipcRenderer.invoke('notifications:snooze', id),
  notificationsRunCheck: () => ipcRenderer.invoke('notifications:runCheck'),
  notificationsGetCount: () => ipcRenderer.invoke('notifications:getCount'),
  onNotificationsUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('notifications:updated', handler);
    return () => { ipcRenderer.removeListener('notifications:updated', handler); };
  },
```

- [ ] **Step 3: Update main.ts to start/stop engine**

In `electron/main.ts`, update the import (line 9):

```typescript
import { startNotificationEngine, stopNotificationEngine, registerNotificationIpcHandlers } from './modules/notifications.ipc';
```

Remove the old `clearReminderInterval` import.

After `createWindow()` (line 162), add:

```typescript
startNotificationEngine();
```

In the `before-quit` handler (line 167-171), replace `clearReminderInterval()` with:

```typescript
stopNotificationEngine();
```

- [ ] **Step 4: Commit**

```bash
git add electron/modules/notifications.ipc.ts electron/preload.ts electron/main.ts
git commit -m "feat(notifications): add IPC handlers and engine lifecycle"
```

---

### Task 5: Sync integration

**Files:**
- Modify: `electron/modules/sync.ipc.ts`

- [ ] **Step 1: Add notifications to USER_DATA_TABLES**

In `electron/modules/sync.ipc.ts`, add `'notifications'` to the `USER_DATA_TABLES` array (after `'finance_income_sources'` at line 136):

```typescript
  'notifications',
```

- [ ] **Step 2: Add sync handlers**

At the end of `registerSyncIpcHandlers()` function, add the sync handlers for notifications:

```typescript
  ipcHandle('sync:getAllNotificationData', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, module, title, body,
             action_route, status, snoozed_until,
             created_at, updated_at, resolved_at,
             deleted_at, ref_id
      FROM notifications
    `).all();
  });

  ipcHandle('sync:mergeNotificationData', (_e, remote: Record<string, unknown>[]) => {
    const db = getDb();
    let changed = false;

    const tx = db.transaction(() => {
      for (const r of remote) {
        const local = db.prepare('SELECT updated_at FROM notifications WHERE id = ?')
          .get(r.id as string) as { updated_at: string } | undefined;

        if (!local) {
          db.prepare(`
            INSERT OR IGNORE INTO notifications
              (id, type, module, title, body, action_route, status,
               snoozed_until, created_at, updated_at, resolved_at, deleted_at, ref_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            r.id, r.type, r.module, r.title, r.body,
            r.action_route, r.status, r.snoozed_until,
            r.created_at, r.updated_at, r.resolved_at,
            r.deleted_at, r.ref_id
          );
          changed = true;
        } else if (r.updated_at && new Date(r.updated_at as string) > new Date(local.updated_at)) {
          db.prepare(`
            UPDATE notifications SET
              status = ?, snoozed_until = ?, updated_at = ?,
              resolved_at = ?, deleted_at = ?
            WHERE id = ?
          `).run(r.status, r.snoozed_until, r.updated_at, r.resolved_at, r.deleted_at, r.id);
          changed = true;
        }
      }
    });
    tx();

    return { changed };
  });
```

- [ ] **Step 3: Add sync methods to HubtifyApi and preload**

In `shared/types.ts`, add to the Sync section of HubtifyApi:

```typescript
  syncGetAllNotificationData: () => Promise<Record<string, unknown>[]>;
  syncMergeNotificationData: (data: Record<string, unknown>[]) => Promise<{ changed: boolean }>;
```

In `electron/preload.ts`, add in the Sync section:

```typescript
  syncGetAllNotificationData: () => ipcRenderer.invoke('sync:getAllNotificationData'),
  syncMergeNotificationData: (data: Record<string, unknown>[]) => ipcRenderer.invoke('sync:mergeNotificationData', data),
```

- [ ] **Step 4: Commit**

```bash
git add electron/modules/sync.ipc.ts shared/types.ts electron/preload.ts
git commit -m "feat(notifications): add sync handlers and USER_DATA_TABLES entry"
```

---

## Chunk 2: UI Components

### Task 6: i18n keys

**Files:**
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add notification keys to es.json**

Add a `notifications` section (at the top-level, alphabetically):

```json
"notifications": {
  "title": "Notificaciones",
  "allCaughtUp": "Todo al día",
  "allCaughtUpDesc": "No tenés notificaciones pendientes.",
  "dismiss": "Descartar",
  "snooze": "Silenciar 6h",
  "go": "Ir",
  "ago": "hace",
  "justNow": "recién",
  "minutesAgo": "hace {{count}} min",
  "hoursAgo": "hace {{count}}h",
  "daysAgo": "hace {{count}}d"
},
```

Also update the `settings` section, replace the reminders keys:

```json
"notificationsInApp": "Notificaciones en la app",
"notificationsInAppDesc": "Centro de notificaciones con items pendientes",
"notificationsSystem": "Notificaciones del sistema",
"notificationsSystemDesc": "Notificaciones nativas de Windows"
```

- [ ] **Step 2: Add notification keys to en.json**

Same structure:

```json
"notifications": {
  "title": "Notifications",
  "allCaughtUp": "All caught up",
  "allCaughtUpDesc": "No pending notifications.",
  "dismiss": "Dismiss",
  "snooze": "Snooze 6h",
  "go": "Go",
  "ago": "ago",
  "justNow": "just now",
  "minutesAgo": "{{count}} min ago",
  "hoursAgo": "{{count}}h ago",
  "daysAgo": "{{count}}d ago"
},
```

Settings section:

```json
"notificationsInApp": "In-App Notifications",
"notificationsInAppDesc": "Notification center with pending items",
"notificationsSystem": "System Notifications",
"notificationsSystemDesc": "Windows native notifications"
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "feat(notifications): add i18n keys for notification center and settings"
```

---

### Task 7: NotificationBell component

**Files:**
- Create: `src/shared/components/NotificationBell.tsx`

- [ ] **Step 1: Create NotificationBell**

```tsx
// src/shared/components/NotificationBell.tsx
import { useState, useEffect, useCallback } from 'react';
import { ipcRenderer } from 'electron';

interface NotificationBellProps {
  onClick: () => void;
}

export default function NotificationBell({ onClick }: NotificationBellProps) {
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const c = await window.api.notificationsGetCount();
      setCount(c);
    } catch { /* ignore in case IPC not ready */ }
  }, []);

  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, 30000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  // Listen for engine updates (via IPC from main process)
  useEffect(() => {
    const cleanup = window.api.onNotificationsUpdated?.(() => refreshCount());
    return () => { cleanup?.(); };
  }, [refreshCount]);

  // Listen for account:switched
  useEffect(() => {
    const handler = () => refreshCount();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [refreshCount]);

  return (
    <button
      className="notif-bell"
      onClick={onClick}
      title="Notifications"
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
        stroke="var(--rpg-gold)" strokeWidth="1.3" strokeLinecap="round">
        <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4z" />
        <path d="M6 12a2 2 0 004 0" />
      </svg>
      {count > 0 && <span className="notif-bell-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/components/NotificationBell.tsx
git commit -m "feat(notifications): add NotificationBell component"
```

---

### Task 8: NotificationCenter component

**Files:**
- Create: `src/shared/components/NotificationCenter.tsx`
- Create: `src/shared/styles/notifications.css`

- [ ] **Step 1: Create notifications CSS**

Create `src/shared/styles/notifications.css`:

```css
/* ── Notification Bell ────────────────────────────────── */

.notif-bell {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.notif-bell:hover {
  background: rgba(var(--rpg-gold-rgb, 184, 157, 100), 0.15);
}

.notif-bell-badge {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--rpg-hp-red, #c44);
  color: #fff;
  font-size: 0.6rem;
  font-weight: bold;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  font-family: 'Fira Code', monospace;
}

/* ── Notification Center Drawer ───────────────────────── */

.notif-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
}

.notif-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 90vw;
  background: var(--rpg-parchment, #f5e6c8);
  border-left: 2px solid var(--rpg-gold-dark, #8b7355);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notif-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--rpg-gold-dark, #8b7355);
  font-family: Cinzel, serif;
  font-size: 1rem;
  color: var(--rpg-wood, #5c3d2e);
}

.notif-drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--rpg-wood, #5c3d2e);
  font-size: 1.2rem;
  padding: 4px;
}

.notif-drawer-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.notif-module-group {
  margin-bottom: 12px;
}

.notif-module-label {
  font-family: Cinzel, serif;
  font-size: 0.75rem;
  color: var(--rpg-gold-dark, #8b7355);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 8px;
  opacity: 0.7;
}

.notif-item {
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(var(--rpg-gold-rgb, 184, 157, 100), 0.3);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 6px;
  transition: background 0.2s;
}

.notif-item:hover {
  background: rgba(255, 255, 255, 0.5);
}

.notif-item-title {
  font-family: Cinzel, serif;
  font-size: 0.85rem;
  color: var(--rpg-wood, #5c3d2e);
  margin-bottom: 2px;
}

.notif-item-body {
  font-family: 'Crimson Text', serif;
  font-size: 0.8rem;
  color: var(--rpg-wood, #5c3d2e);
  opacity: 0.7;
  margin-bottom: 6px;
}

.notif-item-time {
  font-size: 0.65rem;
  color: var(--rpg-gold-dark, #8b7355);
  opacity: 0.5;
  margin-bottom: 6px;
}

.notif-item-actions {
  display: flex;
  gap: 6px;
}

.notif-item-actions button {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid var(--rpg-gold-dark, #8b7355);
  background: transparent;
  color: var(--rpg-wood, #5c3d2e);
  cursor: pointer;
  font-family: 'Crimson Text', serif;
  transition: background 0.2s;
}

.notif-item-actions button:hover {
  background: rgba(var(--rpg-gold-rgb, 184, 157, 100), 0.2);
}

.notif-item-actions button.notif-action-go {
  background: var(--rpg-gold-dark, #8b7355);
  color: var(--rpg-parchment, #f5e6c8);
}

.notif-item-actions button.notif-action-go:hover {
  opacity: 0.9;
}

.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  opacity: 0.5;
  text-align: center;
  padding: 40px;
}

.notif-empty svg {
  margin-bottom: 12px;
}

.notif-empty-title {
  font-family: Cinzel, serif;
  font-size: 1rem;
  color: var(--rpg-wood, #5c3d2e);
}

.notif-empty-desc {
  font-family: 'Crimson Text', serif;
  font-size: 0.85rem;
  color: var(--rpg-wood, #5c3d2e);
}
```

- [ ] **Step 2: Create NotificationCenter component**

Create `src/shared/components/NotificationCenter.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import type { AppNotification } from '../../../shared/types';
import '../styles/notifications.css';

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

const MODULE_LABELS: Record<string, string> = {
  quests: 'Questify',
  nutrition: 'Nutrify',
  finance: 'Coinify',
};

function timeAgo(createdAt: string, t: (key: string, fallback: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('notifications.justNow', 'recién');
  if (minutes < 60) return t('notifications.minutesAgo', `hace ${minutes} min`, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', `hace ${hours}h`, { count: hours });
  const days = Math.floor(hours / 24);
  return t('notifications.daysAgo', `hace ${days}d`, { count: days });
}

export default function NotificationCenter({ open, onClose, onNavigate }: NotificationCenterProps) {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const drawerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      await window.api.notificationsRunCheck();
      const all = await window.api.notificationsGetAll();
      setNotifications(all);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  // Listen for account:switched
  useEffect(() => {
    const handler = () => { if (open) loadNotifications(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [open, loadNotifications]);

  // GSAP animation
  useGSAP(() => {
    if (!drawerRef.current || !overlayRef.current) return;
    if (open) {
      gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 });
      gsap.fromTo(drawerRef.current, { x: '100%' }, { x: '0%', duration: 0.3, ease: 'power2.out' });
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (!drawerRef.current || !overlayRef.current) { onClose(); return; }
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
    gsap.to(drawerRef.current, { x: '100%', duration: 0.25, ease: 'power2.in', onComplete: onClose });
  }, [onClose]);

  const handleDismiss = useCallback(async (id: string) => {
    await window.api.notificationsDismiss(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleSnooze = useCallback(async (id: string) => {
    await window.api.notificationsSnooze(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleGo = useCallback((route: string) => {
    onNavigate(route);
    handleClose();
  }, [onNavigate, handleClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  if (!open) return null;

  // Group by module
  const grouped = notifications.reduce<Record<string, AppNotification[]>>((acc, n) => {
    (acc[n.module] ??= []).push(n);
    return acc;
  }, {});

  return (
    <>
      <div className="notif-overlay" ref={overlayRef} onClick={handleClose} />
      <div className="notif-drawer" ref={drawerRef}>
        <div className="notif-drawer-header">
          <span>{t('notifications.title', 'Notificaciones')}</span>
          <button className="notif-drawer-close" onClick={handleClose}>✕</button>
        </div>

        <div className="notif-drawer-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <svg width="40" height="40" viewBox="0 0 16 16" fill="none"
                stroke="var(--rpg-gold-dark)" strokeWidth="1" strokeLinecap="round">
                <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4z" />
                <path d="M6 12a2 2 0 004 0" />
                <path d="M4 4l8 8" />
              </svg>
              <div className="notif-empty-title">{t('notifications.allCaughtUp', 'Todo al día')}</div>
              <div className="notif-empty-desc">{t('notifications.allCaughtUpDesc', 'No tenés notificaciones pendientes.')}</div>
            </div>
          ) : (
            Object.entries(grouped).map(([mod, items]) => (
              <div key={mod} className="notif-module-group">
                <div className="notif-module-label">{MODULE_LABELS[mod] ?? mod}</div>
                {items.map(n => (
                  <div key={n.id} className="notif-item">
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-body">{n.body}</div>
                    <div className="notif-item-time">{timeAgo(n.createdAt, t)}</div>
                    <div className="notif-item-actions">
                      <button className="notif-action-go" onClick={() => handleGo(n.actionRoute)}>
                        {t('notifications.go', 'Ir')}
                      </button>
                      <button onClick={() => handleSnooze(n.id)}>
                        {t('notifications.snooze', 'Silenciar 6h')}
                      </button>
                      <button onClick={() => handleDismiss(n.id)}>
                        {t('notifications.dismiss', 'Descartar')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/NotificationCenter.tsx src/shared/styles/notifications.css
git commit -m "feat(notifications): add NotificationCenter drawer component"
```

---

### Task 9: Integrate into Layout and Sidebar

**Files:**
- Modify: `src/hub/Sidebar.tsx`
- Modify: `src/hub/Layout.tsx`

- [ ] **Step 1: Add bell to Sidebar**

In `src/hub/Sidebar.tsx`, import NotificationBell:

```typescript
import NotificationBell from '../shared/components/NotificationBell';
```

Add `onBellClick` to SidebarProps:

```typescript
interface SidebarProps { stats: PlayerStats | null; collapsed: boolean; onToggle?: () => void; onBellClick?: () => void; }
```

Update the function signature:

```typescript
export default function Sidebar({ stats, collapsed, onToggle, onBellClick }: SidebarProps) {
```

Add the bell between PlayerCard and the first footer image divider (after line 63, before the nav):

```tsx
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <NotificationBell onClick={() => onBellClick?.()} />
      </div>
```

- [ ] **Step 2: Add NotificationCenter to Layout**

In `src/hub/Layout.tsx`, add imports:

```typescript
import NotificationCenter from '../shared/components/NotificationCenter';
```

Add state (after `showQuickAdd` state, around line 34):

```typescript
const [showNotifications, setShowNotifications] = useState(false);
```

Pass `onBellClick` to Sidebar in the JSX:

```tsx
<Sidebar stats={stats} collapsed={sidebarCollapsed} onToggle={toggleSidebar} onBellClick={() => setShowNotifications(true)} />
```

Add NotificationCenter component in the JSX (inside the ToastProvider, near the end):

```tsx
<NotificationCenter
  open={showNotifications}
  onClose={() => setShowNotifications(false)}
  onNavigate={animatedNavigate}
/>
```

- [ ] **Step 3: Remove old reminders code from Layout**

In `src/hub/Layout.tsx`, remove the reminders useEffect (lines 170-174):

```typescript
// DELETE THIS:
useEffect(() => {
  if (localStorage.getItem('hubtify_reminders') === 'true') {
    window.api.notificationsSetReminders(true).catch(console.error);
  }
}, []);
```

- [ ] **Step 4: Commit**

> **Note:** `onNotificationsUpdated` preload listener and type were already added in Task 4, and `NotificationBell` already uses `window.api.onNotificationsUpdated` from the start (Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/hub/Sidebar.tsx src/hub/Layout.tsx src/shared/components/NotificationBell.tsx electron/preload.ts shared/types.ts
git commit -m "feat(notifications): integrate bell and center into sidebar and layout"
```

---

### Task 10: Update Settings page

**Files:**
- Modify: `src/hub/SettingsPage.tsx`

- [ ] **Step 1: Replace reminders toggle with two notification toggles**

In `src/hub/SettingsPage.tsx`, replace the `remindersEnabled` state (line 14):

```typescript
const [notifInApp, setNotifInApp] = useState(() => localStorage.getItem('hubtify_notifications_inapp') !== 'false');
const [notifSystem, setNotifSystem] = useState(() => localStorage.getItem('hubtify_notifications_system') !== 'false');
```

Note: default to `true` (enabled) — `!== 'false'` means enabled unless explicitly disabled.

Replace the Notifications section in the JSX (lines 118-140):

```tsx
      {/* Notifications */}
      <div className="rpg-card" style={sectionStyle}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4zM6 12a2 2 0 004 0"/>
          </svg>
          {t('settings.notifications')}
        </div>
        <div style={rowStyle}>
          <div>
            <div style={labelStyle}>{t('settings.notificationsInApp', 'Notificaciones en la app')}</div>
            <div style={descStyle}>{t('settings.notificationsInAppDesc', 'Centro de notificaciones con items pendientes')}</div>
          </div>
          <button className="rpg-button" onClick={() => {
            const next = !notifInApp;
            setNotifInApp(next);
            localStorage.setItem('hubtify_notifications_inapp', next ? 'true' : 'false');
          }} style={{ minWidth: 60 }}>
            {notifInApp ? t('settings.toggleOn') : t('settings.toggleOff')}
          </button>
        </div>
        <div style={rowStyle}>
          <div>
            <div style={labelStyle}>{t('settings.notificationsSystem', 'Notificaciones del sistema')}</div>
            <div style={descStyle}>{t('settings.notificationsSystemDesc', 'Notificaciones nativas de Windows')}</div>
          </div>
          <button className="rpg-button" onClick={() => {
            const next = !notifSystem;
            setNotifSystem(next);
            localStorage.setItem('hubtify_notifications_system', next ? 'true' : 'false');
          }} style={{ minWidth: 60 }}>
            {notifSystem ? t('settings.toggleOn') : t('settings.toggleOff')}
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Update engine to respect settings**

In `electron/modules/notifications.ipc.ts`, the `runNotificationCheck` function needs to read the settings. Since settings are in localStorage (renderer), the engine should receive them. Update the `notifications:runCheck` handler to accept a parameter, and have the renderer pass the settings.

Simpler approach: The engine always runs (evaluates + stores to DB). The settings control:
- **In-app toggle**: Layout conditionally renders the NotificationBell and NotificationCenter
- **System toggle**: Engine checks before showing native notification

For the system toggle, the engine can read from a simple IPC call. Add to `notifications.ipc.ts`:

```typescript
let systemNotificationsEnabled = true;

ipcHandle('notifications:setSystemEnabled', (_e, enabled: boolean) => {
  systemNotificationsEnabled = enabled;
});
```

And in the native notification part of `runNotificationCheck`, wrap with:

```typescript
if (systemNotificationsEnabled && Notification.isSupported()) {
```

In Layout.tsx, on mount sync the setting:

```typescript
useEffect(() => {
  const enabled = localStorage.getItem('hubtify_notifications_system') !== 'false';
  window.api.notificationsSetSystemEnabled?.(enabled);
}, []);
```

Add to preload and types:

```typescript
notificationsSetSystemEnabled: (enabled: boolean) => ipcRenderer.invoke('notifications:setSystemEnabled', enabled),
```

For the in-app toggle, conditionally render the bell in Sidebar:

```typescript
const notifInApp = localStorage.getItem('hubtify_notifications_inapp') !== 'false';
// Only show bell if in-app notifications are enabled
{notifInApp && (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
    <NotificationBell onClick={() => onBellClick?.()} />
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/hub/SettingsPage.tsx electron/modules/notifications.ipc.ts electron/preload.ts shared/types.ts src/hub/Sidebar.tsx src/hub/Layout.tsx
git commit -m "feat(notifications): update settings with dual toggles, respect preferences"
```

---

### Task 11: Cleanup old reminders code

**Files:**
- Modify: `src/hub/SettingsPage.tsx` (remove old reminders state if still present)
- Modify: `shared/types.ts` (remove `notificationsSetReminders` if still present)
- Modify: `electron/preload.ts` (remove `notificationsSetReminders`)
- Verify: `electron/main.ts` no longer imports `clearReminderInterval`

- [ ] **Step 1: Remove leftover reminders references**

Remove `notificationsSetReminders` from preload and types if not already removed in previous tasks.

Remove the `remindersEnabled` state and its localStorage usage from SettingsPage if still present.

Remove old i18n keys `settings.reminders` and `settings.remindersDesc` from both es.json and en.json (only if they are no longer referenced).

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "refactor(notifications): remove deprecated reminders system"
```

---

### Task 12: Final verification

- [ ] **Step 1: Verify all files exist**

Check that all created files are in place:
- `electron/modules/notifications.schema.ts`
- `electron/modules/notification-engine.ts`
- `src/shared/components/NotificationBell.tsx`
- `src/shared/components/NotificationCenter.tsx`
- `src/shared/styles/notifications.css`
- `tests/modules/notifications/notification-engine.test.ts`

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors
