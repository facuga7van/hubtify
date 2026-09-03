import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  parseRepeatRule, nextRepeatDueDate, spawnNextRepeatInstance,
  parseRepeatAnchor, clampRepeatInterval, MAX_REPEAT_INTERVAL,
} from '../../../shared-logic/modules/quests.ipc';
import { mergeQuestDataInto } from '../../../shared-logic/modules/sync.ipc';
import {
  buildRepeatRule, describeRepeatRule,
  parseRepeatRule as parseRepeatRuleUi,
  type RepeatRule as UiRepeatRule,
} from '@modules/quests/repeat';
import es from '../../../src/i18n/es.json';
import en from '../../../src/i18n/en.json';

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
  repeatAnchor?: string | null;
  status?: number; deletedAt?: string | null; name?: string; description?: string;
  tier?: number; category?: string; order?: number;
} = {}): void {
  db.prepare(`
    INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order,
                       repeat_rule, repeat_of, repeat_anchor, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', ?)
  `).run(
    id, fields.name ?? `Task ${id}`, fields.description ?? '', fields.status ?? 0,
    fields.tier ?? 2, fields.category ?? '', fields.dueDate ?? null, fields.order ?? 0,
    fields.repeatRule ?? null, fields.repeatOf ?? null, fields.repeatAnchor ?? null,
    fields.deletedAt ?? null,
  );
}

/** completed_at is a LOCAL timestamp (quests v11), never a UTC ISO string. */
function complete(db: Database.Database, id: string, completedAt = '2026-07-08 10:00:00'): void {
  db.prepare('UPDATE tasks SET status = 1, completed_at = ? WHERE id = ?').run(completedAt, id);
}

type Row = {
  id: string; name: string; description: string; tier: number; category: string;
  status: number; dueDate: string | null; repeatRule: string | null; repeatOf: string | null;
  repeatAnchor: string | null; order: number; deletedAt: string | null;
};

function row(db: Database.Database, id: string): Row {
  return db.prepare(`
    SELECT id, name, description, tier, category, status, due_date AS dueDate,
           repeat_rule AS repeatRule, repeat_of AS repeatOf, repeat_anchor AS repeatAnchor,
           task_order AS "order", deleted_at AS deletedAt
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

/* ═══════════════════════════════════════════════════════════════════════════
 * quests v14 — INTERVAL and the 'completion' anchor
 * ═══════════════════════════════════════════════════════════════════════════ */

const EVERY_2_DAYS = '{"freq":"daily","interval":2}';
const EVERY_3_DAYS = '{"freq":"daily","interval":3}';
const EVERY_2_WEEKS = '{"freq":"weekly","interval":2}';
const EVERY_2_MONTHS = '{"freq":"monthly","interval":2}';

/* ── INTERVAL: parsing and backwards compatibility ────────────────────────── */

describe('parseRepeatRule — INTERVAL (v14)', () => {
  it('a rule WITHOUT the key still means interval 1 (no migration, no rewrite)', () => {
    // The three pre-v14 shapes, byte for byte, must parse to exactly what they
    // parsed to before: no `interval` property at all.
    expect(parseRepeatRule(DAILY)).toEqual({ freq: 'daily' });
    expect(parseRepeatRule(WEEKLY)).toEqual({ freq: 'weekly' });
    expect(parseRepeatRule(MONTHLY)).toEqual({ freq: 'monthly' });
    // …and behave as interval 1 where it counts: the arithmetic.
    expect(nextRepeatDueDate(parseRepeatRule(DAILY)!, '2026-07-08')).toBe('2026-07-09');
    expect(nextRepeatDueDate(parseRepeatRule(WEEKLY)!, '2026-07-08')).toBe('2026-07-15');
    expect(nextRepeatDueDate(parseRepeatRule(MONTHLY)!, '2026-07-08')).toBe('2026-08-08');
  });

  it('an explicit interval of 1 collapses to the pre-v14 shape', () => {
    expect(parseRepeatRule('{"freq":"weekly","interval":1}')).toEqual({ freq: 'weekly' });
  });

  it('reads the interval on the three simple frequencies', () => {
    expect(parseRepeatRule(EVERY_2_DAYS)).toEqual({ freq: 'daily', interval: 2 });
    expect(parseRepeatRule(EVERY_2_WEEKS)).toEqual({ freq: 'weekly', interval: 2 });
    expect(parseRepeatRule(EVERY_2_MONTHS)).toEqual({ freq: 'monthly', interval: 2 });
  });

  it('clamps the interval to 1..30 instead of trusting a remote', () => {
    expect(parseRepeatRule('{"freq":"daily","interval":0}')).toEqual({ freq: 'daily' });
    expect(parseRepeatRule('{"freq":"daily","interval":-5}')).toEqual({ freq: 'daily' });
    expect(parseRepeatRule('{"freq":"daily","interval":"x"}')).toEqual({ freq: 'daily' });
    expect(parseRepeatRule('{"freq":"daily","interval":null}')).toEqual({ freq: 'daily' });
    expect(parseRepeatRule('{"freq":"daily","interval":2.7}')).toEqual({ freq: 'daily', interval: 2 });
    expect(parseRepeatRule('{"freq":"daily","interval":999}'))
      .toEqual({ freq: 'daily', interval: MAX_REPEAT_INTERVAL });
  });

  /**
   * DECISION — "every 2 weeks on Mon and Thu" is NOT offered.
   * It needs a notion of which weeks are "on", and this model has no
   * week-parity anchor: the chain root can be soft-deleted or absent after a
   * partial sync, exactly when the parity would silently flip and move a habit
   * to the wrong week. So the key is dropped on parse and the form hides the
   * control for freq 'days'.
   */
  it('IGNORES an interval on freq "days" (documented: the combination is not offered)', () => {
    expect(parseRepeatRule('{"freq":"days","days":[1,4],"interval":2}'))
      .toEqual({ freq: 'days', days: [1, 4] });
    // Behaviour follows: still the next listed weekday, one week at a time.
    expect(nextRepeatDueDate({ freq: 'days', days: [1, 4] }, '2026-07-06')).toBe('2026-07-09');
  });

  it('clampRepeatInterval is the single gate', () => {
    expect(clampRepeatInterval(undefined)).toBe(1);
    expect(clampRepeatInterval(1)).toBe(1);
    expect(clampRepeatInterval(30)).toBe(30);
    expect(clampRepeatInterval(31)).toBe(30);
    // Not finite is junk, and junk is 1 — never a 30-day "cadence" nobody asked for.
    expect(clampRepeatInterval(Number.NaN)).toBe(1);
    expect(clampRepeatInterval(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

/* ── INTERVAL: the arithmetic ─────────────────────────────────────────────── */

describe('nextRepeatDueDate — INTERVAL (v14)', () => {
  it('daily/weekly/monthly all honour the interval', () => {
    expect(nextRepeatDueDate({ freq: 'daily', interval: 3 }, '2026-07-08')).toBe('2026-07-11');
    expect(nextRepeatDueDate({ freq: 'weekly', interval: 2 }, '2026-07-08')).toBe('2026-07-22');
    expect(nextRepeatDueDate({ freq: 'monthly', interval: 6 }, '2026-07-08')).toBe('2027-01-08');
  });

  it('crosses the year boundary at any interval', () => {
    expect(nextRepeatDueDate({ freq: 'daily', interval: 30 }, '2026-12-15')).toBe('2027-01-14');
    expect(nextRepeatDueDate({ freq: 'weekly', interval: 3 }, '2026-12-20')).toBe('2027-01-10');
    expect(nextRepeatDueDate({ freq: 'monthly', interval: 2 }, '2026-11-15')).toBe('2027-01-15');
  });

  it('monthly + interval clamps AND still recovers the anchor day later', () => {
    // Jan 31 + 2 months → Mar 31: no clamp needed.
    expect(nextRepeatDueDate({ freq: 'monthly', interval: 2 }, '2026-01-31')).toBe('2026-03-31');

    // The interesting chain: every 2 months from Dec 31. Feb and Apr and Jun
    // all clamp; August is the first month that can hold the 31st again, and
    // the anchor has to still be there to give it back.
    const two = { freq: 'monthly' as const, interval: 2 };
    const ANCHOR = '2025-12-31';
    expect(nextRepeatDueDate(two, ANCHOR, ANCHOR)).toBe('2026-02-28');
    expect(nextRepeatDueDate(two, '2026-02-28', ANCHOR)).toBe('2026-04-30');
    expect(nextRepeatDueDate(two, '2026-04-30', ANCHOR)).toBe('2026-06-30');
    expect(nextRepeatDueDate(two, '2026-06-30', ANCHOR)).toBe('2026-08-31'); // ← recovered
    // Without the anchor it drifts down to the 28th and never comes back.
    expect(nextRepeatDueDate(two, '2026-06-30')).toBe('2026-08-30');
  });

  it('keeps the time of day when a timed quest has an interval', () => {
    expect(nextRepeatDueDate({ freq: 'weekly', interval: 2 }, '2026-07-08T09:30')).toBe('2026-07-22T09:30');
    expect(nextRepeatDueDate({ freq: 'monthly', interval: 2 }, '2026-01-31T23:15')).toBe('2026-03-31T23:15');
  });
});

/* ── The 'completion' anchor ──────────────────────────────────────────────── */

describe('nextRepeatDueDate — anchor "completion" vs the fixed default', () => {
  it('the DEFAULT is unchanged: fixed dates measured from the due date (v13 semantics)', () => {
    // Rent due the 1st, paid the 3rd, is still due the 1st next month — with or
    // without an explicit anchor argument.
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-03-01', '2026-03-01', '2026-03-03'))
      .toBe('2026-04-01');
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-03-01', '2026-03-01', '2026-03-03',
      { anchor: 'due', completedOn: '2026-03-03 18:00:00' })).toBe('2026-04-01');
    // NULL in the column reads as the default.
    expect(parseRepeatAnchor(null)).toBe('due');
    expect(parseRepeatAnchor('')).toBe('due');
    expect(parseRepeatAnchor('whatever')).toBe('due');
    expect(parseRepeatAnchor('completion')).toBe('completion');
  });

  it('"completion" counts from the day it was ticked, so completing late shifts the chain', () => {
    // Same quest, same rule, completed 5 days late: the two anchors disagree.
    const rule = { freq: 'daily' as const, interval: 3 };
    const due = '2026-07-08';
    const completedLate = '2026-07-13 20:00:00';
    expect(nextRepeatDueDate(rule, due, due, '2026-07-13')).toBe('2026-07-11');
    expect(nextRepeatDueDate(rule, due, due, '2026-07-13',
      { anchor: 'completion', completedOn: completedLate })).toBe('2026-07-16');
  });

  it('"completion" works on every frequency, including specific days', () => {
    const opts = { anchor: 'completion' as const, completedOn: '2026-07-13 08:00:00' };
    expect(nextRepeatDueDate({ freq: 'weekly', interval: 2 }, '2026-07-01', null, '2026-07-13', opts))
      .toBe('2026-07-27');
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-07-01', '2026-07-01', '2026-07-13', opts))
      .toBe('2026-08-13');
    // 2026-07-13 is a Monday; the next listed weekday after it is Thursday 16.
    expect(nextRepeatDueDate({ freq: 'days', days: [1, 4] }, '2026-07-06', null, '2026-07-13', opts))
      .toBe('2026-07-16');
  });

  it('"completion" keeps the DUE date\'s time of day (a 9am standup stays 9am)', () => {
    expect(nextRepeatDueDate({ freq: 'daily', interval: 3 }, '2026-07-08T09:00', null, '2026-07-13',
      { anchor: 'completion', completedOn: '2026-07-13 20:41:07' })).toBe('2026-07-16T09:00');
  });

  it('monthly + "completion" restarts from the completion day — no 31st to remember', () => {
    expect(nextRepeatDueDate({ freq: 'monthly' }, '2026-01-31', '2026-01-31', '2026-02-05',
      { anchor: 'completion', completedOn: '2026-02-05 12:00:00' })).toBe('2026-03-05');
  });

  it('falls back to today (never to NaN) when completed_at is missing or malformed', () => {
    const rule = { freq: 'daily' as const, interval: 2 };
    for (const bad of [null, '', 'nope', '2026-2-3']) {
      expect(nextRepeatDueDate(rule, '2026-07-08', null, '2026-07-20',
        { anchor: 'completion', completedOn: bad })).toBe('2026-07-22');
    }
    // …and a corrupt due_date cannot produce '2026-02-NaN' either.
    expect(nextRepeatDueDate(rule, 'garbage', null, '2026-07-20')).toBe('2026-07-22');
  });
});

describe('spawnNextRepeatInstance — v14 columns travel with the chain', () => {
  const NOW = '2026-07-13T12:00:00.000Z';

  it('an interval chain advances by the interval and keeps the rule on every link', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-06', repeatRule: EVERY_2_WEEKS });
    complete(db, 'root');
    const second = spawnNextRepeatInstance(db, 'root', NOW)!;
    expect(second.nextDueDate).toBe('2026-07-20');
    expect(row(db, second.nextTaskId).repeatRule).toBe(EVERY_2_WEEKS);

    complete(db, second.nextTaskId);
    const third = spawnNextRepeatInstance(db, second.nextTaskId, NOW)!;
    expect(third.nextDueDate).toBe('2026-08-03');
  });

  it('a v13 row (repeat_anchor NULL) still advances from its due date', () => {
    const db = setupDb();
    addTask(db, 'rent', { dueDate: '2026-03-01', repeatRule: MONTHLY });
    complete(db, 'rent', '2026-03-03 19:00:00'); // paid late
    const next = spawnNextRepeatInstance(db, 'rent', NOW)!;
    expect(next.nextDueDate).toBe('2026-04-01');
    expect(row(db, next.nextTaskId).repeatAnchor).toBeNull();
  });

  it("anchor 'completion' spawns from the tick, and the mode is inherited", () => {
    const db = setupDb();
    addTask(db, 'plants', {
      dueDate: '2026-07-08', repeatRule: EVERY_3_DAYS, repeatAnchor: 'completion',
    });
    complete(db, 'plants', '2026-07-13 20:00:00'); // watered 5 days late
    const next = spawnNextRepeatInstance(db, 'plants', NOW)!;
    expect(next.nextDueDate).toBe('2026-07-16');
    expect(row(db, next.nextTaskId).repeatAnchor).toBe('completion');

    // Same chain, on time this round: 16 → 19.
    complete(db, next.nextTaskId, '2026-07-16 09:00:00');
    const third = spawnNextRepeatInstance(db, next.nextTaskId, NOW)!;
    expect(third.nextDueDate).toBe('2026-07-19');
  });

  it('the SAME quest completed late gives two different dates under the two anchors', () => {
    const db = setupDb();
    addTask(db, 'fixed', { dueDate: '2026-07-08', repeatRule: EVERY_3_DAYS });
    addTask(db, 'loose', { dueDate: '2026-07-08', repeatRule: EVERY_3_DAYS, repeatAnchor: 'completion' });
    complete(db, 'fixed', '2026-07-13 20:00:00');
    complete(db, 'loose', '2026-07-13 20:00:00');
    expect(spawnNextRepeatInstance(db, 'fixed', NOW)!.nextDueDate).toBe('2026-07-11');
    expect(spawnNextRepeatInstance(db, 'loose', NOW)!.nextDueDate).toBe('2026-07-16');
  });

  it('a junk anchor from a remote is normalised to the default on the spawned row', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY, repeatAnchor: 'sometime' });
    complete(db, 'root');
    const next = spawnNextRepeatInstance(db, 'root', NOW)!;
    expect(next.nextDueDate).toBe('2026-07-09'); // fixed-date behaviour
    expect(row(db, next.nextTaskId).repeatAnchor).toBeNull();
  });
});

/* ── describeRepeatRule: both languages, singular and plural ──────────────── */

type Catalog = Record<string, unknown>;

/**
 * A stand-in for i18next good enough for these strings: it resolves the
 * `_one` / `_other` suffix from `count` (es and en share that two-form rule)
 * and interpolates `{{name}}`. Falls back the way `t(key, fallback)` does.
 */
function makeT(catalog: Catalog) {
  const lookup = (k: string): unknown =>
    k.split('.').reduce<unknown>((o, part) => (o && typeof o === 'object' ? (o as Catalog)[part] : undefined), catalog);
  return (key: string, fallback: string, opts?: Record<string, unknown>): string => {
    const count = opts?.count as number | undefined;
    const suffixed = count === undefined ? undefined : lookup(`${key}_${count === 1 ? 'one' : 'other'}`);
    const raw = (suffixed ?? lookup(key) ?? fallback) as string;
    return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? ''));
  };
}

const tEs = makeT(es as Catalog);
const tEn = makeT(en as Catalog);

describe('describeRepeatRule — interval, pluralisation, two languages', () => {
  const cases: Array<[string, UiRepeatRule, string, string]> = [
    ['daily singular',   { freq: 'daily' },                 'Se repite cada día',        'Repeats every day'],
    ['daily plural',     { freq: 'daily', interval: 3 },    'Se repite cada 3 días',     'Repeats every 3 days'],
    ['weekly singular',  { freq: 'weekly' },                'Se repite cada semana',     'Repeats every week'],
    ['weekly plural',    { freq: 'weekly', interval: 2 },   'Se repite cada 2 semanas',  'Repeats every 2 weeks'],
    ['monthly singular', { freq: 'monthly' },               'Se repite cada mes',        'Repeats every month'],
    ['monthly plural',   { freq: 'monthly', interval: 6 },  'Se repite cada 6 meses',    'Repeats every 6 months'],
  ];

  for (const [label, rule, esText, enText] of cases) {
    it(`${label} reads right in both catalogs`, () => {
      expect(describeRepeatRule(rule, tEs)).toBe(esText);
      expect(describeRepeatRule(rule, tEn)).toBe(enText);
    });
  }

  it('specific days keep the Monday-first letter strip', () => {
    const rule: UiRepeatRule = { freq: 'days', days: [1, 3, 5] }; // Mon/Wed/Fri, JS numbering
    expect(describeRepeatRule(rule, tEs)).toBe('Se repite: L, X, V');
    expect(describeRepeatRule(rule, tEn)).toBe('Repeats on: M, W, F');
  });

  it('the completion anchor adds a clause; the default anchor adds nothing', () => {
    const rule: UiRepeatRule = { freq: 'daily', interval: 3 };
    expect(describeRepeatRule(rule, tEs, 'due')).toBe('Se repite cada 3 días');
    expect(describeRepeatRule(rule, tEs, 'completion'))
      .toBe('Se repite cada 3 días · contando desde que la completo');
    expect(describeRepeatRule(rule, tEn, 'completion'))
      .toBe('Repeats every 3 days · counted from when I complete it');
  });

  it('never leaks a hardcoded Spanish string into the English catalog', () => {
    for (const rule of cases.map((c) => c[1])) {
      expect(describeRepeatRule(rule, tEn)).not.toMatch(/repite|día|semana|mes/);
    }
  });
});

/* ── The renderer mirror agrees with the backend parser ───────────────────── */

describe('buildRepeatRule / the renderer mirror', () => {
  it('interval 1 serializes to the pre-v14 shape, byte for byte', () => {
    expect(buildRepeatRule('daily', [], 1)).toBe(DAILY);
    expect(buildRepeatRule('weekly', [])).toBe(WEEKLY);
    expect(buildRepeatRule('monthly', [], 1)).toBe(MONTHLY);
  });

  it('interval > 1 adds the key, clamped to 1..30', () => {
    expect(buildRepeatRule('weekly', [], 2)).toBe(EVERY_2_WEEKS);
    expect(buildRepeatRule('daily', [], 99)).toBe(`{"freq":"daily","interval":${MAX_REPEAT_INTERVAL}}`);
    expect(buildRepeatRule('daily', [], 0)).toBe(DAILY);
  });

  it('a "days" rule never carries an interval, whatever the caller passes', () => {
    expect(buildRepeatRule('days', [1, 4], 2)).toBe('{"freq":"days","days":[1,4]}');
    expect(buildRepeatRule('never', [1, 4], 2)).toBeNull();
    expect(buildRepeatRule('days', [], 2)).toBeNull();
  });

  it('both parsers read every shape identically (renderer vs shared-logic)', () => {
    for (const raw of [DAILY, WEEKLY, MONTHLY, EVERY_2_DAYS, EVERY_2_WEEKS, EVERY_2_MONTHS,
      '{"freq":"days","days":[1,4],"interval":2}', '{"freq":"daily","interval":999}',
      '{"freq":"nope"}', 'not json', '']) {
      expect(parseRepeatRuleUi(raw)).toEqual(parseRepeatRule(raw));
    }
  });
});

/* ── Sync: repeat_anchor survives a client that has never heard of it ─────── */

describe('sync:mergeQuestData — repeat_anchor (v14)', () => {
  const T0 = '2026-07-01T10:00:00.000Z';
  const T1 = '2026-07-02T10:00:00.000Z';

  const remoteTask = (over: Record<string, unknown>) => ({
    id: 't1', name: 'Regar las plantas', description: '', status: 0, tier: 2, category: '',
    projectId: null, dueDate: '2026-07-08', order: 0, completedAt: null,
    createdAt: T0, updatedAt: T1, deletedAt: null, ...over,
  });

  const merge = (db: Database.Database, task: Record<string, unknown>) =>
    mergeQuestDataInto(db, {
      projects: [], tasks: [task], subtasks: [], categories: [],
      habits: [], habitChecks: [], drawings: [],
    } as never);

  const anchorOf = (db: Database.Database, id = 't1') =>
    (db.prepare('SELECT repeat_anchor AS a FROM tasks WHERE id = ?').get(id) as { a: string | null }).a;

  it('a NEWER push from a client that omits the key does NOT wipe the local anchor', () => {
    const db = setupDb();
    addTask(db, 't1', { dueDate: '2026-07-08', repeatRule: EVERY_3_DAYS, repeatAnchor: 'completion' });
    // The old client sends no `repeatAnchor` property at all: that is silence,
    // not "back to fixed dates". Same guard as repeatRule/repeatOf.
    const { repeatAnchor: _omitted, ...withoutKey } = remoteTask({ repeatRule: EVERY_3_DAYS, repeatAnchor: undefined });
    expect('repeatAnchor' in withoutKey).toBe(false);
    merge(db, withoutKey);
    expect(anchorOf(db)).toBe('completion');
  });

  it('an EXPLICIT null from a new client does win (back to fixed dates)', () => {
    const db = setupDb();
    addTask(db, 't1', { dueDate: '2026-07-08', repeatRule: EVERY_3_DAYS, repeatAnchor: 'completion' });
    merge(db, remoteTask({ repeatRule: EVERY_3_DAYS, repeatAnchor: null }));
    expect(anchorOf(db)).toBeNull();
  });

  it('a first-time row carries the anchor in, and junk normalises to NULL', () => {
    const db = setupDb();
    merge(db, remoteTask({ repeatRule: EVERY_3_DAYS, repeatAnchor: 'completion' }));
    expect(anchorOf(db)).toBe('completion');

    const db2 = setupDb();
    merge(db2, remoteTask({ repeatRule: EVERY_3_DAYS, repeatAnchor: 'whenever' }));
    expect(anchorOf(db2)).toBeNull();
  });

  it('the interval rides along inside repeat_rule — no extra column, no extra guard', () => {
    const db = setupDb();
    merge(db, remoteTask({ repeatRule: EVERY_2_WEEKS }));
    const stored = (db.prepare('SELECT repeat_rule AS r FROM tasks WHERE id = ?').get('t1') as { r: string }).r;
    expect(parseRepeatRule(stored)).toEqual({ freq: 'weekly', interval: 2 });
  });
});
