import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  parseRepeatRule, nextRepeatDueDate, spawnNextRepeatInstance,
} from '../../../electron/modules/quests.ipc';

// Calendar cheatsheet (matches quests-fase1.test.ts):
// 2026-07-06 is a Monday → 06 Mon · 07 Tue · 08 Wed · 09 Thu · 10 Fri · 11 Sat · 12 Sun.

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

function addTask(db: Database.Database, id: string, fields: {
  dueDate?: string | null; repeatRule?: string | null; repeatOf?: string | null;
  status?: number; deletedAt?: string | null; name?: string; description?: string;
  tier?: number; category?: string; order?: number;
} = {}): void {
  db.prepare(`
    INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order,
                       repeat_rule, repeat_of, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', ?)
  `).run(
    id, fields.name ?? `Task ${id}`, fields.description ?? '', fields.status ?? 0,
    fields.tier ?? 2, fields.category ?? '', fields.dueDate ?? null, fields.order ?? 0,
    fields.repeatRule ?? null, fields.repeatOf ?? null, fields.deletedAt ?? null,
  );
}

function complete(db: Database.Database, id: string): void {
  db.prepare("UPDATE tasks SET status = 1, completed_at = '2026-07-08 10:00:00' WHERE id = ?").run(id);
}

type Row = {
  id: string; name: string; description: string; tier: number; category: string;
  status: number; dueDate: string | null; repeatRule: string | null; repeatOf: string | null;
  order: number; deletedAt: string | null;
};

function row(db: Database.Database, id: string): Row {
  return db.prepare(`
    SELECT id, name, description, tier, category, status, due_date AS dueDate,
           repeat_rule AS repeatRule, repeat_of AS repeatOf, task_order AS "order",
           deleted_at AS deletedAt
    FROM tasks WHERE id = ?
  `).get(id) as Row;
}

const DAILY = '{"freq":"daily"}';
const WEEKLY = '{"freq":"weekly"}';
const MONTHLY = '{"freq":"monthly"}';

/* ── parseRepeatRule ──────────────────────────────────────────────────────── */

describe('parseRepeatRule', () => {
  it('accepts the three simple frequencies', () => {
    expect(parseRepeatRule(DAILY)).toEqual({ freq: 'daily' });
    expect(parseRepeatRule(WEEKLY)).toEqual({ freq: 'weekly' });
    expect(parseRepeatRule(MONTHLY)).toEqual({ freq: 'monthly' });
  });

  it('dedupes, sorts and bounds a days rule (JS 0=Sunday..6=Saturday)', () => {
    expect(parseRepeatRule('{"freq":"days","days":[5,1,5,3]}')).toEqual({ freq: 'days', days: [1, 3, 5] });
    expect(parseRepeatRule('{"freq":"days","days":[0,6]}')).toEqual({ freq: 'days', days: [0, 6] });
  });

  it('reads garbage as "never repeats" instead of throwing', () => {
    expect(parseRepeatRule(null)).toBeNull();
    expect(parseRepeatRule('')).toBeNull();
    expect(parseRepeatRule('not json')).toBeNull();
    expect(parseRepeatRule('{"freq":"yearly"}')).toBeNull();
    expect(parseRepeatRule('{"freq":"days"}')).toBeNull();
    expect(parseRepeatRule('{"freq":"days","days":[]}')).toBeNull();
    expect(parseRepeatRule('{"freq":"days","days":[7,-1,"x"]}')).toBeNull();
  });
});

/* ── nextRepeatDueDate: the date shift per frequency ──────────────────────── */

describe('nextRepeatDueDate', () => {
  it('daily → +1 day, weekly → +7 days, FROM the original due date', () => {
    expect(nextRepeatDueDate({ freq: 'daily' }, '2026-07-08')).toBe('2026-07-09');
    expect(nextRepeatDueDate({ freq: 'weekly' }, '2026-07-08')).toBe('2026-07-15');
  });

  it('crosses month and year boundaries', () => {
    expect(nextRepeatDueDate({ freq: 'daily' }, '2026-07-31')).toBe('2026-08-01');
    expect(nextRepeatDueDate({ freq: 'weekly' }, '2026-12-29')).toBe('2027-01-05');
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-12-15')).toBe('2027-01-15');
  });

  it('monthly clamps day 31 (and 29/30) to the last day of the target month', () => {
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-01-31')).toBe('2026-02-28');
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-01-30')).toBe('2026-02-28');
    // 2028 is a leap year
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2028-01-31')).toBe('2028-02-29');
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-08-31')).toBe('2026-09-30');
  });

  it('monthly recovers the anchor day after a clamped month', () => {
    // Chain rooted on the 31st: Feb clamps to 28, March goes BACK to 31.
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-02-28', '2026-01-31')).toBe('2026-03-31');
    // Without the anchor it would have drifted to the 28th forever.
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-02-28')).toBe('2026-03-28');
  });

  it('days → the next listed weekday strictly after the due date', () => {
    const mwf = { freq: 'days' as const, days: [1, 3, 5] };
    expect(nextRepeatDueDate(mwf, '2026-07-08')).toBe('2026-07-10'); // Wed → Fri
    expect(nextRepeatDueDate(mwf, '2026-07-10')).toBe('2026-07-13'); // Fri → Mon
    // Single listed day wraps a full week.
    expect(nextRepeatDueDate({ freq: 'days', days: [3] }, '2026-07-08')).toBe('2026-07-15');
    // Sunday is 0 in the stored numbering.
    expect(nextRepeatDueDate({ freq: 'days', days: [0] }, '2026-07-08')).toBe('2026-07-12');
  });

  it('keeps the time of day of a timed quest', () => {
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-07-01T09:30')).toBe('2026-08-01T09:30');
    expect(nextRepeatDueDate({ freq: 'daily' }, '2026-07-08T23:15')).toBe('2026-07-09T23:15');
  });

  it('starts the cadence from today when the task has no due date', () => {
    expect(nextRepeatDueDate({ freq: 'weekly' }, null, null, '2026-07-06')).toBe('2026-07-13');
  });
});

/* ── spawnNextRepeatInstance: generation, chain, idempotency ──────────────── */

describe('spawnNextRepeatInstance', () => {
  const NOW = '2026-07-08T12:00:00.000Z';

  it('spawns the next instance inheriting template fields, chained via repeat_of', () => {
    const db = setupDb();
    addTask(db, 'rent', {
      dueDate: '2026-07-01', repeatRule: MONTHLY,
      name: 'Pagar alquiler', description: 'transferencia', tier: 3, category: 'casa',
    });
    complete(db, 'rent');

    const spawned = spawnNextRepeatInstance(db, 'rent', NOW);
    expect(spawned).not.toBeNull();
    expect(spawned!.nextDueDate).toBe('2026-08-01');

    const next = row(db, spawned!.nextTaskId);
    expect(next.name).toBe('Pagar alquiler');
    expect(next.description).toBe('transferencia');
    expect(next.tier).toBe(3);
    expect(next.category).toBe('casa');
    expect(next.status).toBe(0);
    expect(next.dueDate).toBe('2026-08-01');
    expect(next.repeatRule).toBe(MONTHLY);
    expect(next.repeatOf).toBe('rent'); // chain root
  });

  it('is IDEMPOTENT: a second completion/replay never duplicates the open instance', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY });
    complete(db, 'root');

    const first = spawnNextRepeatInstance(db, 'root', NOW);
    expect(first).not.toBeNull();
    expect(spawnNextRepeatInstance(db, 'root', NOW)).toBeNull();
    expect(spawnNextRepeatInstance(db, 'root', NOW)).toBeNull();

    const count = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE repeat_of = 'root'").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('chains history: every completed instance stays, repeat_of always points at the root', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-06', repeatRule: WEEKLY });
    complete(db, 'root');
    const second = spawnNextRepeatInstance(db, 'root', NOW)!;
    expect(row(db, second.nextTaskId).dueDate).toBe('2026-07-13');

    complete(db, second.nextTaskId);
    const third = spawnNextRepeatInstance(db, second.nextTaskId, NOW)!;
    expect(third.nextDueDate).toBe('2026-07-20');
    expect(row(db, third.nextTaskId).repeatOf).toBe('root');

    // Both completed links are still in the history.
    const done = db.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND (id = 'root' OR repeat_of = 'root')"
    ).get() as { c: number };
    expect(done.c).toBe(2);
  });

  it('monthly chain recovers the 31st after February (anchor = root due date)', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-01-31', repeatRule: MONTHLY });
    complete(db, 'root');
    const feb = spawnNextRepeatInstance(db, 'root', NOW)!;
    expect(feb.nextDueDate).toBe('2026-02-28');

    complete(db, feb.nextTaskId);
    const mar = spawnNextRepeatInstance(db, feb.nextTaskId, NOW)!;
    expect(mar.nextDueDate).toBe('2026-03-31');
  });

  it('generates NOTHING for a task without repeat_rule (or with a garbage one)', () => {
    const db = setupDb();
    addTask(db, 'plain', { dueDate: '2026-07-08' });
    addTask(db, 'junk', { dueDate: '2026-07-08', repeatRule: '{"freq":"whenever"}' });
    complete(db, 'plain');
    complete(db, 'junk');
    expect(spawnNextRepeatInstance(db, 'plain', NOW)).toBeNull();
    expect(spawnNextRepeatInstance(db, 'junk', NOW)).toBeNull();
    const total = db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number };
    expect(total.c).toBe(2);
  });

  it('ignores soft-deleted and missing tasks', () => {
    const db = setupDb();
    addTask(db, 'dead', { dueDate: '2026-07-08', repeatRule: DAILY, deletedAt: NOW });
    expect(spawnNextRepeatInstance(db, 'dead', NOW)).toBeNull();
    expect(spawnNextRepeatInstance(db, 'nope', NOW)).toBeNull();
  });

  it('a soft-deleted open instance does NOT freeze the chain', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY });
    complete(db, 'root');
    const first = spawnNextRepeatInstance(db, 'root', NOW)!;

    // The user deletes the generated instance...
    db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(NOW, NOW, first.nextTaskId);

    // ...and a later completion replay regenerates the next link.
    const again = spawnNextRepeatInstance(db, 'root', NOW);
    expect(again).not.toBeNull();
    expect(again!.nextTaskId).not.toBe(first.nextTaskId);
  });

  it('skips generation while an OLDER re-opened instance of the chain is live (one open per chain)', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-06', repeatRule: WEEKLY });
    addTask(db, 'inst2', { dueDate: '2026-07-13', repeatRule: WEEKLY, repeatOf: 'root', status: 0 });
    complete(db, 'root');
    // root completed, but inst2 is already open → nothing new.
    expect(spawnNextRepeatInstance(db, 'root', NOW)).toBeNull();
  });

  it('appends the spawned instance at the end of the board order', () => {
    const db = setupDb();
    addTask(db, 'a', { order: 0 });
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY, order: 5 });
    complete(db, 'root');
    const spawned = spawnNextRepeatInstance(db, 'root', NOW)!;
    expect(row(db, spawned.nextTaskId).order).toBe(6);
  });
});
