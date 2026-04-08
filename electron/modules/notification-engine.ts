import type Database from 'better-sqlite3';
import crypto from 'crypto';

const genId = (): string => crypto.randomUUID();

export interface NotificationCandidate {
  type: string;
  module: string;
  title: string;
  body: string;
  actionRoute: string;
  refId: string;
}

// ── Quest Evaluator ─────────────────────────────────────────

export function evaluateQuestNotifications(db: Database.Database): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];

  const dueSoon = db
    .prepare(
      `SELECT id, name FROM tasks
       WHERE due_date = DATE('now', '+1 day')
         AND status = 0
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of dueSoon) {
    candidates.push({
      type: 'quest_due_soon',
      module: 'quests',
      title: `Tarea ${t.name} vence mañana`,
      body: `La tarea "${t.name}" vence mañana. ¡No te olvides!`,
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  const overdue = db
    .prepare(
      `SELECT id, name FROM tasks
       WHERE due_date < DATE('now')
         AND status = 0
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of overdue) {
    candidates.push({
      type: 'quest_overdue',
      module: 'quests',
      title: `Tarea ${t.name} está vencida`,
      body: `La tarea "${t.name}" ya pasó su fecha límite.`,
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  const stale = db
    .prepare(
      `SELECT id, name FROM tasks
       WHERE status = 0
         AND updated_at < datetime('now', '-7 days')
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of stale) {
    candidates.push({
      type: 'quest_stale',
      module: 'quests',
      title: `Tarea ${t.name} no avanza`,
      body: `La tarea "${t.name}" lleva más de 7 días sin cambios.`,
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  return candidates;
}

// ── Nutrition Evaluator ─────────────────────────────────────

export function evaluateNutritionNotifications(db: Database.Database): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];

  const pendingDays = db
    .prepare(
      `SELECT DISTINCT f.date
       FROM food_log f
       LEFT JOIN nutrition_daily_closed c ON c.date = f.date
       WHERE c.date IS NULL
         AND f.date >= DATE('now', '-7 days')
         AND f.date < DATE('now')`
    )
    .all() as { date: string }[];

  for (const row of pendingDays) {
    candidates.push({
      type: 'nutri_pending',
      module: 'nutrition',
      title: `Día ${row.date} sin cerrar`,
      body: `Tenés comidas registradas el ${row.date} pero no cerraste el día.`,
      actionRoute: '/nutrition',
      refId: row.date,
    });
  }

  const hour = new Date().getHours();
  if (hour >= 20) {
    const today = new Date().toISOString().slice(0, 10);
    const count = db
      .prepare(`SELECT COUNT(*) AS cnt FROM food_log WHERE date = ?`)
      .get(today) as { cnt: number };

    if (count.cnt === 0) {
      candidates.push({
        type: 'nutri_no_meals',
        module: 'nutrition',
        title: 'No registraste comidas hoy',
        body: 'Ya son más de las 20hs y no registraste ninguna comida.',
        actionRoute: '/nutrition',
        refId: today,
      });
    }
  }

  return candidates;
}

// ── Finance Evaluator ───────────────────────────────────────

export function evaluateFinanceNotifications(db: Database.Database): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];

  // 1. Installment due within 3 days
  const installmentsDue = db
    .prepare(
      `SELECT ig.id, ig.description, t.date
       FROM finance_transactions t
       JOIN finance_installment_groups ig ON ig.id = t.installment_group_id
       WHERE t.installment_group_id IS NOT NULL
         AND t.date >= DATE('now')
         AND t.date <= DATE('now', '+3 days')
       GROUP BY t.installment_group_id`
    )
    .all() as { id: string; description: string; date: string }[];

  for (const ig of installmentsDue) {
    candidates.push({
      type: 'finance_installment_due',
      module: 'finance',
      title: `Cuota próxima: ${ig.description}`,
      body: `Tenés una cuota de "${ig.description}" que vence el ${ig.date}.`,
      actionRoute: '/finance',
      refId: ig.id,
    });
  }

  // 2. Credit card closing within 2 days
  const currentDay = new Date().getDate();
  const creditCards = db
    .prepare(`SELECT id, name, closing_day FROM finance_credit_cards`)
    .all() as { id: string; name: string; closing_day: number }[];

  for (const cc of creditCards) {
    const daysUntilClosing = ((cc.closing_day - currentDay) + 31) % 31;
    if (daysUntilClosing > 0 && daysUntilClosing <= 2) {
      candidates.push({
        type: 'finance_card_closing',
        module: 'finance',
        title: `Cierre de tarjeta: ${cc.name}`,
        body: `La tarjeta "${cc.name}" cierra en ${daysUntilClosing} día${daysUntilClosing > 1 ? 's' : ''}.`,
        actionRoute: '/finance',
        refId: cc.id,
      });
    }
  }

  // 3. Loans pending for over 30 days
  const pendingLoans = db
    .prepare(
      `SELECT id, person_name, amount, currency
       FROM finance_loans
       WHERE settled = 0
         AND created_at < datetime('now', '-30 days')`
    )
    .all() as { id: string; person_name: string; amount: number; currency: string }[];

  for (const loan of pendingLoans) {
    candidates.push({
      type: 'finance_loan_pending',
      module: 'finance',
      title: `Préstamo pendiente: ${loan.person_name}`,
      body: `El préstamo de ${loan.currency} ${loan.amount} con ${loan.person_name} lleva más de 30 días.`,
      actionRoute: '/finance',
      refId: loan.id,
    });
  }

  // 4. Recurring missing this month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const recurringItems = db
    .prepare(
      `SELECT id, name, billing_day
       FROM finance_recurring
       WHERE active = 1`
    )
    .all() as { id: string; name: string; billing_day: number }[];

  for (const rec of recurringItems) {
    if (currentDay >= rec.billing_day) {
      const txExists = db
        .prepare(
          `SELECT 1 FROM finance_transactions
           WHERE source = 'recurring'
             AND recurring_id = ?
             AND date LIKE ? || '%'
           LIMIT 1`
        )
        .get(rec.id, currentMonth) as unknown;

      if (!txExists) {
        candidates.push({
          type: 'finance_recurring_missing',
          module: 'finance',
          title: `Recurrente faltante: ${rec.name}`,
          body: `No se registró "${rec.name}" este mes (día de facturación: ${rec.billing_day}).`,
          actionRoute: '/finance',
          refId: rec.id,
        });
      }
    }
  }

  return candidates;
}

// ── Deduplication & Insert ──────────────────────────────────

export function deduplicateAndInsert(
  db: Database.Database,
  candidates: NotificationCandidate[]
): number {
  const checkStmt = db.prepare(
    `SELECT 1 FROM notifications
     WHERE type = ? AND ref_id = ? AND status IN ('active', 'snoozed')
     LIMIT 1`
  );

  const insertStmt = db.prepare(
    `INSERT INTO notifications (id, type, module, title, body, action_route, ref_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
  );

  let inserted = 0;

  const runAll = db.transaction(() => {
    for (const c of candidates) {
      const exists = checkStmt.get(c.type, c.refId);
      if (!exists) {
        insertStmt.run(genId(), c.type, c.module, c.title, c.body, c.actionRoute, c.refId);
        inserted++;
      }
    }
  });

  runAll();
  return inserted;
}

// ── Auto-Resolve ────────────────────────────────────────────

interface ActiveNotification {
  id: string;
  type: string;
  ref_id: string;
}

export function autoResolve(db: Database.Database): number {
  const active = db
    .prepare(`SELECT id, type, ref_id FROM notifications WHERE status = 'active'`)
    .all() as ActiveNotification[];

  const resolveStmt = db.prepare(
    `UPDATE notifications SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  );

  let resolved = 0;

  const runAll = db.transaction(() => {
    for (const n of active) {
      let shouldResolve = false;

      if (n.type === 'quest_due_soon' || n.type === 'quest_overdue' || n.type === 'quest_stale') {
        const task = db
          .prepare(`SELECT status, deleted_at FROM tasks WHERE id = ?`)
          .get(n.ref_id) as { status: number; deleted_at: string | null } | undefined;
        if (!task || task.status === 1 || task.deleted_at !== null) {
          shouldResolve = true;
        }
      }

      if (n.type === 'nutri_pending') {
        const closed = db
          .prepare(`SELECT 1 FROM nutrition_daily_closed WHERE date = ?`)
          .get(n.ref_id);
        if (closed) shouldResolve = true;
      }

      if (n.type === 'nutri_no_meals') {
        const count = db
          .prepare(`SELECT COUNT(*) AS cnt FROM food_log WHERE date = ?`)
          .get(n.ref_id) as { cnt: number };
        if (count.cnt > 0) shouldResolve = true;
      }

      if (n.type === 'finance_loan_pending') {
        const loan = db
          .prepare(`SELECT settled FROM finance_loans WHERE id = ?`)
          .get(n.ref_id) as { settled: number } | undefined;
        if (!loan || loan.settled === 1) shouldResolve = true;
      }

      if (n.type === 'finance_installment_due') {
        const tx = db
          .prepare(
            `SELECT 1 FROM finance_transactions
             WHERE installment_group_id = ? AND date < DATE('now')
             LIMIT 1`
          )
          .get(n.ref_id);
        if (tx) shouldResolve = true;
      }

      if (n.type === 'finance_card_closing') {
        const notif = db
          .prepare(`SELECT created_at FROM notifications WHERE id = ?`)
          .get(n.id) as { created_at: string };
        const createdAt = new Date(notif.created_at + 'Z');
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        if (createdAt < threeDaysAgo) shouldResolve = true;
      }

      if (n.type === 'finance_recurring_missing') {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const tx = db
          .prepare(
            `SELECT 1 FROM finance_transactions
             WHERE source = 'recurring' AND recurring_id = ? AND date LIKE ? || '%'
             LIMIT 1`
          )
          .get(n.ref_id, currentMonth);
        if (tx) shouldResolve = true;
      }

      if (shouldResolve) {
        resolveStmt.run(n.id);
        resolved++;
      }
    }
  });

  runAll();

  // Reactivate snoozed notifications whose snooze period expired
  const reactivated = db
    .prepare(
      `UPDATE notifications
       SET status = 'active', snoozed_until = NULL, updated_at = datetime('now')
       WHERE status = 'snoozed' AND snoozed_until <= datetime('now')`
    )
    .run();

  return resolved + reactivated.changes;
}

// ── Cleanup ─────────────────────────────────────────────────

export function cleanupOldNotifications(db: Database.Database): number {
  const result = db
    .prepare(
      `DELETE FROM notifications
       WHERE status IN ('resolved', 'dismissed')
         AND updated_at < datetime('now', '-30 days')`
    )
    .run();

  return result.changes;
}
