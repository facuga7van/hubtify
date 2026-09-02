import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  computeHabits, reconcileHabitShields, parseSpecificDays, serializeSpecificDays, isoWeekday,
} from '../../../shared-logic/modules/quests.habits';
import { postponedDueDate, postponeTasks } from '../../../electron/modules/quests.ipc';
import { mergeHabitChecks } from '../../../electron/modules/sync.ipc';

// 2026-07-06 is a Monday, so: 06 Mon · 07 Tue · 08 Wed · 09 Thu · 10 Fri · 11 Sat · 12 Sun.
// 2026-07-20 is the Monday two weeks later.

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

function addTask(db: Database.Database, id: string, dueDate: string | null, deletedAt: string | null = null): void {
  db.prepare(`
    INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, '', 0, 2, '', ?, 0, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', ?)
  `).run(id, `Task ${id}`, dueDate, deletedAt);
}

function addHabit(
  db: Database.Database,
  id: string,
  fields: {
    frequency?: string; timesPerWeek?: number; specificDays?: string | null;
    shieldCount?: number; lastShieldStreak?: number; createdAt?: string;
  } = {},
): void {
  db.prepare(`
    INSERT INTO habits (id, name, frequency, times_per_week, specific_days, shield_count,
                        last_shield_streak, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, `Habit ${id}`, fields.frequency ?? 'daily', fields.timesPerWeek ?? 1,
    fields.specificDays ?? null, fields.shieldCount ?? 0, fields.lastShieldStreak ?? 0,
    fields.createdAt ?? '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  );
}

let checkSeq = 0;
function mark(db: Database.Database, habitId: string, date: string, kind = 'check'): void {
  db.prepare(
    'INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`hc${++checkSeq}`, habitId, date, kind, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`);
}

const at = (d: string) => new Date(`${d}T12:00:00`);
const only = (db: Database.Database, today: string) => computeHabits(db, at(today))[0];

/* ── Task 1: postpone ─────────────────────────────────────────────────────── */

describe('postponedDueDate', () => {
  it('keeps the time of day when the target is a bare date', () => {
    expect(postponedDueDate('2026-07-01T09:30', '2026-07-10')).toBe('2026-07-10T09:30');
  });

  it('stays a bare date when the task never had a time', () => {
    expect(postponedDueDate('2026-07-01', '2026-07-10')).toBe('2026-07-10');
    expect(postponedDueDate(null, '2026-07-10')).toBe('2026-07-10');
  });

  it('takes an explicit datetime target verbatim', () => {
    expect(postponedDueDate('2026-07-01T09:30', '2026-07-10T18:00')).toBe('2026-07-10T18:00');
  });
});

describe('postponeTasks', () => {
  it('moves a timed task to the new day at the SAME hour', () => {
    const db = setupDb();
    addTask(db, 't1', '2026-07-01T09:30');
    expect(postponeTasks(db, ['t1'], '2026-07-10', '2026-07-09T12:00:00.000Z')).toBe(1);
    const row = db.prepare('SELECT due_date AS dueDate FROM tasks WHERE id = ?').get('t1') as { dueDate: string };
    expect(row.dueDate).toBe('2026-07-10T09:30');
  });

  it('bumps updated_at on EVERY task of the batch (LWW sync key)', () => {
    const db = setupDb();
    addTask(db, 't1', '2026-07-01');
    addTask(db, 't2', '2026-07-02T08:00');
    addTask(db, 't3', null);

    const now = '2026-07-09T12:00:00.000Z';
    expect(postponeTasks(db, ['t1', 't2', 't3'], '2026-07-10', now)).toBe(3);

    const rows = db.prepare('SELECT id, due_date AS dueDate, updated_at AS updatedAt FROM tasks ORDER BY id').all() as Array<{
      id: string; dueDate: string; updatedAt: string;
    }>;
    expect(rows.map(r => r.updatedAt)).toEqual([now, now, now]);
    expect(rows.map(r => r.dueDate)).toEqual(['2026-07-10', '2026-07-10T08:00', '2026-07-10']);
  });

  it('skips unknown and soft-deleted ids and reports the real count', () => {
    const db = setupDb();
    addTask(db, 't1', '2026-07-01');
    addTask(db, 't-dead', '2026-07-01', '2026-07-02T00:00:00.000Z');
    expect(postponeTasks(db, ['t1', 't-dead', 'nope'], '2026-07-10', '2026-07-09T12:00:00.000Z')).toBe(1);
    const dead = db.prepare('SELECT due_date AS dueDate FROM tasks WHERE id = ?').get('t-dead') as { dueDate: string };
    expect(dead.dueDate).toBe('2026-07-01');
  });

  it('is a no-op on an empty batch', () => {
    expect(postponeTasks(setupDb(), [], '2026-07-10')).toBe(0);
  });
});

/* ── Task 2: specific weekdays ────────────────────────────────────────────── */

describe('parseSpecificDays / serializeSpecificDays', () => {
  it('round-trips a sorted, de-duplicated list', () => {
    expect(parseSpecificDays('5,1,3')).toEqual([1, 3, 5]);
    expect(serializeSpecificDays([5, 1, 3, 3])).toBe('1,3,5');
  });

  it('degrades garbage to null (legacy count-based behaviour)', () => {
    expect(parseSpecificDays('')).toBeNull();
    expect(parseSpecificDays('0,8,banana')).toBeNull();
    expect(parseSpecificDays(null)).toBeNull();
    expect(serializeSpecificDays([])).toBeNull();
    expect(serializeSpecificDays('nope')).toBeNull();
  });

  it('maps dates to ISO weekdays (1 = Monday … 7 = Sunday)', () => {
    expect(isoWeekday('2026-07-06')).toBe(1);
    expect(isoWeekday('2026-07-12')).toBe(7);
  });
});

describe('computeHabits — weekly habit pinned to Mon/Wed/Fri', () => {
  const MWF = { frequency: 'weekly', timesPerWeek: 3, specificDays: '1,3,5' };

  it('counts the week as met when the three chosen days are checked', () => {
    const db = setupDb();
    addHabit(db, 'h1', MWF);
    mark(db, 'h1', '2026-07-06'); // Mon
    mark(db, 'h1', '2026-07-08'); // Wed
    mark(db, 'h1', '2026-07-10'); // Fri

    const h = only(db, '2026-07-10');
    expect(h.specificDays).toEqual([1, 3, 5]);
    expect(h.checksThisPeriod).toBe(3);
    expect(h.targetThisPeriod).toBe(3);
    expect(h.weekStreak).toBe(1);
    expect(h.streak).toBe(3); // three consecutive CHOSEN days
    expect(h.pendingToday).toBe(false);
  });

  it('does NOT count a check landing on an unchosen day', () => {
    const db = setupDb();
    addHabit(db, 'h1', MWF);
    mark(db, 'h1', '2026-07-06'); // Mon — chosen
    mark(db, 'h1', '2026-07-07'); // Tue — not chosen, must not inflate progress

    expect(only(db, '2026-07-08').checksThisPeriod).toBe(1);
  });

  it('a Tuesday with no check breaks nothing and is not pending', () => {
    const db = setupDb();
    addHabit(db, 'h1', MWF);
    mark(db, 'h1', '2026-07-06'); // Mon only

    const tuesday = only(db, '2026-07-07');
    expect(tuesday.pendingToday).toBe(false); // Tuesday is simply not this habit's day
    expect(tuesday.streak).toBe(1);           // Monday still counts

    // …and the following Wednesday still sees an unbroken run once checked.
    mark(db, 'h1', '2026-07-08');
    expect(only(db, '2026-07-08').streak).toBe(2);
  });

  it('is pending on a chosen day that is still unchecked', () => {
    const db = setupDb();
    addHabit(db, 'h1', MWF);
    expect(only(db, '2026-07-08').pendingToday).toBe(true); // Wednesday, nothing done
  });

  it('keeps the weekly streak across several fully-met weeks', () => {
    const db = setupDb();
    addHabit(db, 'h1', MWF);
    for (const d of ['2026-06-29', '2026-07-01', '2026-07-03',   // Mon/Wed/Fri
      '2026-07-06', '2026-07-08', '2026-07-10']) mark(db, 'h1', d);

    const h = only(db, '2026-07-10');
    expect(h.weekStreak).toBe(2);
    expect(h.streak).toBe(6);
  });

  it('leaves count-based weekly habits (specific_days NULL) untouched', () => {
    const db = setupDb();
    addHabit(db, 'h1', { frequency: 'weekly', timesPerWeek: 3 });
    mark(db, 'h1', '2026-07-06');
    mark(db, 'h1', '2026-07-07');
    mark(db, 'h1', '2026-07-08');

    const h = only(db, '2026-07-09');
    expect(h.specificDays).toBeNull();
    expect(h.checksThisPeriod).toBe(3);
    expect(h.targetThisPeriod).toBe(3);
    expect(h.pendingToday).toBe(false);
  });
});

/* ── Task 3a: streak shields ──────────────────────────────────────────────── */

describe('computeHabits — streak shields', () => {
  it('awards one shield when the streak crosses 7', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    for (let i = 0; i < 7; i++) mark(db, 'h1', `2026-07-${String(14 + i).padStart(2, '0')}`);

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(7);
    expect(h.shieldCount).toBe(1);
    expect(h.lastShieldStreak).toBe(7);
  });

  it('does NOT re-award the same milestone when the streak wobbles back to it', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 1, lastShieldStreak: 7 });
    for (let i = 0; i < 7; i++) mark(db, 'h1', `2026-07-${String(14 + i).padStart(2, '0')}`);

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(7);
    expect(h.shieldCount).toBe(1); // still one, not two
  });

  it('never stacks past the cap of 3', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 3, lastShieldStreak: 7 });
    for (let i = 0; i < 14; i++) mark(db, 'h1', `2026-07-${String(7 + i).padStart(2, '0')}`);

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(14);
    expect(h.shieldCount).toBe(3);
    expect(h.lastShieldStreak).toBe(14);
  });

  it('spends a shield on a ONE day hole and keeps the streak alive', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 1, lastShieldStreak: 7 });
    for (const d of ['2026-07-16', '2026-07-17', '2026-07-19', '2026-07-20']) mark(db, 'h1', d);
    // 07-18 is the hole.

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(4);           // the hole did not cut it at 2
    expect(h.shieldUsed).toBe(true);
    expect(h.shieldCount).toBe(0);      // paid for
    expect(h.pendingShieldDates).toEqual(['2026-07-18']);
  });

  it('lets a TWO day hole break the streak even with shields in the bank', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 3, lastShieldStreak: 7 });
    for (const d of ['2026-07-16', '2026-07-19', '2026-07-20']) mark(db, 'h1', d);
    // 07-17 and 07-18 are both missing — shields deliberately do not stack.

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(2);
    expect(h.shieldCount).toBe(3);
    expect(h.pendingShieldDates).toEqual([]);
  });

  it('breaks on a one day hole when the bank is empty', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 0 });
    for (const d of ['2026-07-16', '2026-07-17', '2026-07-19', '2026-07-20']) mark(db, 'h1', d);

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(2);
    expect(h.shieldUsed).toBe(false);
  });

  it('re-arms the shield ladder once a streak dies completely', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 0, lastShieldStreak: 7 });
    const h = only(db, '2026-07-20'); // no checks at all
    expect(h.streak).toBe(0);
    expect(h.lastShieldStreak).toBe(0);
  });
});

describe('reconcileHabitShields', () => {
  it('persists the spent shield as a shield row and is idempotent', () => {
    const db = setupDb();
    addHabit(db, 'h1', { shieldCount: 1, lastShieldStreak: 7 });
    for (const d of ['2026-07-16', '2026-07-17', '2026-07-19', '2026-07-20']) mark(db, 'h1', d);

    const first = reconcileHabitShields(db, at('2026-07-20'))[0];
    expect(first.streak).toBe(4);
    expect(first.pendingShieldDates).toEqual([]); // flushed

    const stored = db.prepare('SELECT shield_count AS sc, updated_at AS updatedAt FROM habits WHERE id = ?')
      .get('h1') as { sc: number; updatedAt: string };
    expect(stored.sc).toBe(0);
    expect(stored.updatedAt).not.toBe('2026-01-01T00:00:00.000Z'); // updated_at MUST move

    const shieldRow = db.prepare("SELECT kind FROM habit_checks WHERE habit_id = 'h1' AND date = '2026-07-18'")
      .get() as { kind: string };
    expect(shieldRow.kind).toBe('shield');

    // Second pass: the hole is already paid for, so nothing more is spent.
    const second = reconcileHabitShields(db, at('2026-07-20'))[0];
    expect(second.streak).toBe(4);
    expect(second.shieldCount).toBe(0);
    expect(second.shieldUsed).toBe(true);
    const after = db.prepare("SELECT COUNT(*) AS c FROM habit_checks WHERE habit_id = 'h1' AND kind = 'shield'")
      .get() as { c: number };
    expect(after.c).toBe(1);
  });

  it('writes nothing when no shield moved', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mark(db, 'h1', '2026-07-20');
    reconcileHabitShields(db, at('2026-07-20'));
    const stored = db.prepare('SELECT updated_at AS updatedAt FROM habits WHERE id = ?').get('h1') as { updatedAt: string };
    expect(stored.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

/* ── Task 3b: skipping a day ──────────────────────────────────────────────── */

describe('computeHabits — skipped days', () => {
  it('bridges the streak without counting as done', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mark(db, 'h1', '2026-07-17');
    mark(db, 'h1', '2026-07-18');
    mark(db, 'h1', '2026-07-19', 'skip'); // sick day
    mark(db, 'h1', '2026-07-20');

    const h = only(db, '2026-07-20');
    expect(h.streak).toBe(3);        // 20 + 18 + 17 — the skip added nothing
    expect(h.shieldUsed).toBe(false); // and cost no shield
    expect(h.shieldCount).toBe(0);
  });

  it('excuses today instead of nagging for it', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mark(db, 'h1', '2026-07-20', 'skip');

    const h = only(db, '2026-07-20');
    expect(h.skippedToday).toBe(true);
    expect(h.checkedToday).toBe(false);
    expect(h.pendingToday).toBe(false);
    expect(h.checksThisPeriod).toBe(0);
    expect(h.targetThisPeriod).toBe(0); // 0/0 reads as "nothing owed today"
  });

  it('lowers the weekly bar for a skipped chosen day', () => {
    const db = setupDb();
    addHabit(db, 'h1', { frequency: 'weekly', timesPerWeek: 3, specificDays: '1,3,5' });
    mark(db, 'h1', '2026-07-06');          // Mon done
    mark(db, 'h1', '2026-07-08', 'skip');  // Wed excused

    const h = only(db, '2026-07-08');
    expect(h.checksThisPeriod).toBe(1);
    expect(h.targetThisPeriod).toBe(2);
    expect(h.pendingToday).toBe(false);
  });

  it('gives skips no weight in the heatmap check count', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mark(db, 'h1', '2026-07-20', 'skip');
    const row = db.prepare(`
      SELECT COUNT(DISTINCT CASE WHEN kind = 'check' THEN habit_id END) AS count,
             COUNT(DISTINCT CASE WHEN kind = 'skip'  THEN habit_id END) AS skipCount
      FROM habit_checks WHERE deleted_at IS NULL AND date = '2026-07-20'
    `).get() as { count: number; skipCount: number };
    expect(row.count).toBe(0);
    expect(row.skipCount).toBe(1);
  });
});

/* ── kind: backwards compatibility and sync survival ──────────────────────── */

describe('habit_checks.kind', () => {
  it('reads a pre-migration row (no kind supplied) as a real check', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    // Exactly the INSERT the old code (and any remote that ignores the column) uses.
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('legacy', 'h1', '2026-07-20', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z');

    const h = only(db, '2026-07-20');
    expect(h.checkedToday).toBe(true);
    expect(h.streak).toBe(1);
  });

  it('survives a merge of the same natural key coming back from sync', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mark(db, 'h1', '2026-07-20', 'skip');

    // A remote that does not know about `kind` pushes the same (habit_id, date)
    // under its own surrogate id and a newer updated_at.
    mergeHabitChecks(db, [{
      id: 'remote-1', habitId: 'h1', date: '2026-07-20',
      createdAt: '2026-07-20T11:00:00.000Z', updatedAt: '2026-07-20T11:00:00.000Z', deletedAt: null,
    }] as never);

    const row = db.prepare("SELECT kind FROM habit_checks WHERE habit_id = 'h1' AND date = '2026-07-20'")
      .get() as { kind: string };
    expect(row.kind).toBe('skip'); // the local intent is not clobbered
    expect(only(db, '2026-07-20').skippedToday).toBe(true);
  });

  it('defaults a brand new row arriving from sync to a real check', () => {
    const db = setupDb();
    addHabit(db, 'h1');
    mergeHabitChecks(db, [{
      id: 'remote-2', habitId: 'h1', date: '2026-07-20',
      createdAt: '2026-07-20T11:00:00.000Z', updatedAt: '2026-07-20T11:00:00.000Z', deletedAt: null,
    }] as never);

    expect(only(db, '2026-07-20').checkedToday).toBe(true);
  });
});
