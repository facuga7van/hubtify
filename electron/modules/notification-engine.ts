import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { isRecurringDueInMonth } from './finance.balance';

const genId = (): string => crypto.randomUUID();

/** Local date string YYYY-MM-DD (avoids UTC offset from toISOString) */
function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SQLite DATE('now') uses UTC — use 'localtime' modifier for local dates */
const SQL_TODAY = "DATE('now', 'localtime')";

let currentLocale: 'es' | 'en' = 'es';

export function setEngineLocale(locale: string): void {
  currentLocale = locale === 'en' ? 'en' : 'es';
}

export function getEngineLocale(): 'es' | 'en' {
  return currentLocale;
}

const MESSAGES: Record<string, Record<'es' | 'en', { title: (name: string) => string; body: string }>> = {
  quest_due_soon: {
    es: { title: (name) => `Tarea "${name}" vence mañana`, body: 'Completala antes de que venza.' },
    en: { title: (name) => `Task "${name}" is due tomorrow`, body: 'Complete it before the deadline.' },
  },
  quest_overdue: {
    es: { title: (name) => `Tarea "${name}" está vencida`, body: 'Esta tarea ya pasó su fecha de vencimiento.' },
    en: { title: (name) => `Task "${name}" is overdue`, body: 'This task is past its due date.' },
  },
  quest_stale: {
    es: { title: (name) => `Tarea "${name}" no avanza`, body: 'Esta tarea no se actualiza hace más de una semana.' },
    en: { title: (name) => `Task "${name}" is stale`, body: 'This task hasn\'t been updated in over a week.' },
  },
  nutri_pending: {
    es: { title: (date) => `Día ${date} sin cerrar`, body: 'Registraste comidas pero no cerraste el día.' },
    en: { title: (date) => `Day ${date} not closed`, body: 'You logged meals but didn\'t close the day.' },
  },
  nutri_no_meals: {
    es: { title: () => 'No registraste comidas hoy', body: 'Todavía estás a tiempo de estimar las calorías del día.' },
    en: { title: () => 'No meals logged today', body: 'You still have time to estimate today\'s calories.' },
  },
  finance_installment_due: {
    es: { title: (name) => `Cuota de ${name} próxima a vencer`, body: 'Revisá tus pagos pendientes.' },
    en: { title: (name) => `Installment for ${name} is due soon`, body: 'Check your pending payments.' },
  },
  finance_card_closing: {
    es: { title: (name) => `Tu tarjeta ${name} cierra pronto`, body: 'Revisá los consumos antes del cierre.' },
    en: { title: (name) => `Card ${name} is closing soon`, body: 'Review your charges before closing.' },
  },
  finance_card_due: {
    es: { title: (name) => `El resumen de ${name} vence en 3 días`, body: 'Pagá el resumen antes del vencimiento para evitar intereses.' },
    en: { title: (name) => `${name} statement is due in 3 days`, body: 'Pay the statement before the due date to avoid interest.' },
  },
  finance_loan_pending: {
    es: { title: (name) => `Préstamo con ${name} lleva más de un mes`, body: 'Considerá saldar este préstamo.' },
    en: { title: (name) => `Loan with ${name} has been open for over a month`, body: 'Consider settling this loan.' },
  },
  finance_recurring_missing: {
    es: { title: (name) => `Gasto recurrente "${name}" no registrado`, body: 'No se generó la transacción recurrente para este mes.' },
    en: { title: (name) => `Recurring expense "${name}" not registered`, body: 'The recurring transaction for this month was not generated.' },
  },
  habit_reminder: {
    es: { title: () => 'Hábitos pendientes', body: 'Tenés hábitos sin marcar hoy.' },
    en: { title: () => 'Habits pending', body: 'You have unchecked habits today.' },
  },
};

function msg(type: string, name: string = ''): { title: string; body: string } {
  const m = MESSAGES[type]?.[currentLocale] ?? MESSAGES[type]?.es;
  if (!m) return { title: type, body: '' };
  return { title: m.title(name), body: m.body };
}

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
      // Half-open range, not equality: the date picker emits '2026-03-22T14:30'
      // while DATE() yields '2026-03-22', so `due_date = DATE(...)` never matched
      // and the "due tomorrow" notice never fired for any task with a time.
      // The range covers both bare dates and datetimes, and keeps idx_tasks_due_open
      // usable (wrapping the column in DATE() would discard it).
      `SELECT id, name FROM tasks
       WHERE due_date >= DATE('now', 'localtime', '+1 day')
         AND due_date < DATE('now', 'localtime', '+2 days')
         AND status = 0
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of dueSoon) {
    candidates.push({
      type: 'quest_due_soon',
      module: 'quests',
      ...msg('quest_due_soon', t.name),
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  const overdue = db
    .prepare(
      `SELECT id, name FROM tasks
       WHERE due_date < ${SQL_TODAY}
         AND status = 0
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of overdue) {
    candidates.push({
      type: 'quest_overdue',
      module: 'quests',
      ...msg('quest_overdue', t.name),
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  const stale = db
    .prepare(
      `SELECT id, name FROM tasks
       WHERE status = 0
         -- The finance v13 / nutrition v9 migrations normalised these columns to
         -- ISO ('...T...Z'), and this compares strings: 'T' (0x54) > ' ' (0x20),
         -- so a bare datetime('now') bound lost for the whole day and the notice
         -- fired up to 24h late. Compare ISO against ISO.
         AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
         AND updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
         AND deleted_at IS NULL`
    )
    .all() as { id: string; name: string }[];

  for (const t of stale) {
    candidates.push({
      type: 'quest_stale',
      module: 'quests',
      ...msg('quest_stale', t.name),
      actionRoute: '/quests',
      refId: t.id,
    });
  }

  return candidates;
}

// ── Habit Evaluator ─────────────────────────────────────────

export function evaluateHabitNotifications(
  db: Database.Database,
  reminderTime: string,
): NotificationCandidate[] {
  // Gate: only run if current time >= configured reminder time
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (currentTime < reminderTime) return [];

  const todayStr = localDate();

  // Get all active habits
  const habits = db.prepare(`
    SELECT id, name, frequency, times_per_week AS timesPerWeek
    FROM habits WHERE deleted_at IS NULL
  `).all() as Array<{ id: string; name: string; frequency: string; timesPerWeek: number }>;

  if (habits.length === 0) return [];

  // Get all checks for period calculation
  const allChecks = db.prepare(
    'SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL'
  ).all() as Array<{ habit_id: string; date: string }>;

  const checksByHabit = new Map<string, Set<string>>();
  for (const c of allChecks) {
    let set = checksByHabit.get(c.habit_id);
    if (!set) { set = new Set(); checksByHabit.set(c.habit_id, set); }
    set.add(c.date);
  }

  let uncheckedCount = 0;

  for (const h of habits) {
    const dates = checksByHabit.get(h.id) ?? new Set<string>();

    if (h.frequency === 'daily') {
      if (!dates.has(todayStr)) uncheckedCount++;
    } else if (h.frequency === 'weekly') {
      const today = new Date();
      const dayOfWeek = today.getDay() || 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek + 1);
      const mondayStr = localDate(monday);
      let count = 0;
      for (const d of dates) {
        if (d >= mondayStr && d <= todayStr) count++;
      }
      if (count < h.timesPerWeek) uncheckedCount++;
    } else if (h.frequency === 'monthly') {
      const today = new Date();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      if (today.getDate() < lastDay - 2) continue;
      const monthStart = todayStr.slice(0, 7) + '-01';
      let count = 0;
      for (const d of dates) {
        if (d >= monthStart && d <= todayStr) count++;
      }
      if (count < 1) uncheckedCount++;
    }
  }

  if (uncheckedCount === 0) return [];

  return [{
    type: 'habit_reminder',
    module: 'quests',
    ...msg('habit_reminder'),
    actionRoute: '/quests',
    refId: todayStr,
  }];
}

// ── Nutrition Evaluator ─────────────────────────────────────

export function evaluateNutritionNotifications(db: Database.Database): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];
  const hour = new Date().getHours();

  // Before 10 AM: no nutrition notifications — day just started
  if (hour < 10) return candidates;

  // 10 AM+: unclosed days (only 2+ days old — yesterday gets grace period until evening)
  // 20 PM+: unclosed days (including yesterday) + no meals logged today
  const minAge = hour >= 20 ? 0 : 1; // 0 = include yesterday, 1 = skip yesterday
  const pendingDays = db
    .prepare(
      `SELECT DISTINCT f.date
       FROM food_log f
       LEFT JOIN nutrition_daily_closed c ON c.date = f.date
       WHERE c.date IS NULL
         AND f.date >= DATE('now', 'localtime', '-7 days')
         AND f.date < DATE('now', 'localtime', '-${minAge} days')`
    )
    .all() as { date: string }[];

  for (const row of pendingDays) {
    candidates.push({
      type: 'nutri_pending',
      module: 'nutrition',
      ...msg('nutri_pending', row.date),
      actionRoute: '/nutrition',
      refId: row.date,
    });
  }

  // Evening only: no meals logged today
  if (hour >= 20) {
    const today = localDate();
    const count = db
      .prepare(`SELECT COUNT(*) AS cnt FROM food_log WHERE date = ?`)
      .get(today) as { cnt: number };

    if (count.cnt === 0) {
      candidates.push({
        type: 'nutri_no_meals',
        module: 'nutrition',
        ...msg('nutri_no_meals'),
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
         AND t.date >= ${SQL_TODAY}
         AND t.date <= DATE('now', 'localtime', '+3 days')
       GROUP BY t.installment_group_id`
    )
    .all() as { id: string; description: string; date: string }[];

  for (const ig of installmentsDue) {
    candidates.push({
      type: 'finance_installment_due',
      module: 'finance',
      ...msg('finance_installment_due', ig.description),
      actionRoute: '/finance',
      refId: ig.id,
    });
  }

  // 2. Credit card closing within 2 days / statement due within 3 days
  const currentDay = new Date().getDate();
  const creditCards = db
    .prepare(`SELECT id, name, closing_day, due_day FROM finance_credit_cards`)
    .all() as { id: string; name: string; closing_day: number; due_day: number | null }[];

  /** Days until the next occurrence of a day-of-month, from now. */
  const daysUntilDayOfMonth = (day: number): number => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), day);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, day);
    const target = thisMonth.getTime() >= now.getTime() ? thisMonth : nextMonth;
    return Math.ceil((target.getTime() - now.getTime()) / 86400000);
  };

  for (const cc of creditCards) {
    const daysUntilClosing = daysUntilDayOfMonth(cc.closing_day);
    if (daysUntilClosing > 0 && daysUntilClosing <= 2) {
      candidates.push({
        type: 'finance_card_closing',
        module: 'finance',
        ...msg('finance_card_closing', cc.name),
        actionRoute: '/finance',
        refId: cc.id,
      });
    }

    // Same style as the closing rule, against the (optional) due day.
    if (cc.due_day != null) {
      const daysUntilDue = daysUntilDayOfMonth(cc.due_day);
      if (daysUntilDue > 0 && daysUntilDue <= 3) {
        candidates.push({
          type: 'finance_card_due',
          module: 'finance',
          ...msg('finance_card_due', cc.name),
          actionRoute: '/finance/cards',
          refId: cc.id,
        });
      }
    }
  }

  // 3. Loans pending for over 30 days
  const pendingLoans = db
    .prepare(
      `SELECT id, person_name, amount, currency
       FROM finance_loans
       WHERE settled = 0
         -- See the quest-stale query: these columns are ISO now.
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
    )
    .all() as { id: string; person_name: string; amount: number; currency: string }[];

  for (const loan of pendingLoans) {
    candidates.push({
      type: 'finance_loan_pending',
      module: 'finance',
      ...msg('finance_loan_pending', loan.person_name),
      actionRoute: '/finance',
      refId: loan.id,
    });
  }

  // 4. Recurring missing this month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const recurringItems = db
    .prepare(
      `SELECT id, name, billing_day, frequency, created_at
       FROM finance_recurring
       WHERE active = 1`
    )
    .all() as { id: string; name: string; billing_day: number; frequency: string | null; created_at: string }[];

  for (const rec of recurringItems) {
    // A bimonthly/quarterly/… template only "misses" on the months it actually
    // bills — warning about an off month would train the user to ignore the bell.
    if (!isRecurringDueInMonth(rec.frequency, (rec.created_at ?? '').slice(0, 7), currentMonth)) continue;
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
          ...msg('finance_recurring_missing', rec.name),
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
     WHERE type = ? AND ref_id = ? AND status IN ('active', 'snoozed', 'dismissed')
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
        const todayStr = localDate();
        const count = db
          .prepare(`SELECT COUNT(*) AS cnt FROM food_log WHERE date = ?`)
          .get(n.ref_id) as { cnt: number };
        if (count.cnt > 0 || n.ref_id !== todayStr) shouldResolve = true;
      }

      if (n.type === 'finance_loan_pending') {
        const loan = db
          .prepare(`SELECT settled FROM finance_loans WHERE id = ?`)
          .get(n.ref_id) as { settled: number } | undefined;
        if (!loan || loan.settled === 1) shouldResolve = true;
      }

      if (n.type === 'finance_installment_due') {
        const threeDaysFromNow = localDate(new Date(Date.now() + 3 * 86400000));
        const todayStr = localDate();
        const upcoming = db
          .prepare(
            `SELECT 1 FROM finance_transactions
             WHERE installment_group_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL
             LIMIT 1`
          )
          .get(n.ref_id, todayStr, threeDaysFromNow);
        if (!upcoming) shouldResolve = true;
      }

      if (n.type === 'finance_card_closing') {
        const notif = db
          .prepare(`SELECT created_at FROM notifications WHERE id = ?`)
          .get(n.id) as { created_at: string };
        const createdAt = new Date(notif.created_at + 'Z');
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        if (createdAt < threeDaysAgo) shouldResolve = true;
      }

      // Fires 3 days ahead of the due day, so after 4 days the date has passed
      // either way (same time-based retirement as finance_card_closing).
      if (n.type === 'finance_card_due') {
        const notif = db
          .prepare(`SELECT created_at FROM notifications WHERE id = ?`)
          .get(n.id) as { created_at: string };
        const createdAt = new Date(notif.created_at + 'Z');
        const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
        if (createdAt < fourDaysAgo) shouldResolve = true;
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

      if (n.type === 'habit_reminder') {
        // Re-check if all habits are complete for the ref date
        const refDate = n.ref_id;
        const habits = db.prepare(`
          SELECT id, frequency, times_per_week AS timesPerWeek
          FROM habits WHERE deleted_at IS NULL
        `).all() as Array<{ id: string; frequency: string; timesPerWeek: number }>;

        const allChecks = db.prepare(
          'SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL'
        ).all() as Array<{ habit_id: string; date: string }>;

        const checksByHabit = new Map<string, Set<string>>();
        for (const c of allChecks) {
          let set = checksByHabit.get(c.habit_id);
          if (!set) { set = new Set(); checksByHabit.set(c.habit_id, set); }
          set.add(c.date);
        }

        let allComplete = true;
        for (const h of habits) {
          const dates = checksByHabit.get(h.id) ?? new Set<string>();
          if (h.frequency === 'daily') {
            if (!dates.has(refDate)) { allComplete = false; break; }
          } else if (h.frequency === 'weekly') {
            const ref = new Date(refDate + 'T00:00:00');
            const dayOfWeek = ref.getDay() || 7;
            const monday = new Date(ref);
            monday.setDate(ref.getDate() - dayOfWeek + 1);
            const mondayStr = localDate(monday);
            let count = 0;
            for (const d of dates) { if (d >= mondayStr && d <= refDate) count++; }
            if (count < h.timesPerWeek) { allComplete = false; break; }
          } else if (h.frequency === 'monthly') {
            const monthStart = refDate.slice(0, 7) + '-01';
            let count = 0;
            for (const d of dates) { if (d >= monthStart && d <= refDate) count++; }
            if (count < 1) { allComplete = false; break; }
          }
        }
        if (allComplete) shouldResolve = true;

        // Also resolve if the notification is from a previous day (stale)
        if (refDate !== localDate()) shouldResolve = true;
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
