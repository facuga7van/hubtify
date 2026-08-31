import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

/**
 * Regression suite for the "two definitions of today" bug.
 *
 * SQLite's date('now') is UTC; todayDateString() is local. In UTC-3 everything
 * after 21:00 fell on the NEXT day for half the system, so a task completed at
 * 23:00 dropped out of "completed today" and the Cauldron's day (and streak)
 * reset three hours early.
 *
 * Each case builds a real local wall-clock instant and asserts the write is read
 * back as belonging to the same LOCAL day — once in a zone behind UTC and once in
 * one ahead of it, at an hour where the local and UTC dates disagree.
 */
const ZONES = [
  // UTC-3: 23:00 local is already the NEXT day in UTC.
  { tz: 'America/Argentina/Buenos_Aires', hhmm: '23:00:00' },
  // UTC+12/+13: 00:30 local is still the PREVIOUS day in UTC.
  { tz: 'Pacific/Auckland', hhmm: '00:30:00' },
];

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// Mirrors shared/date-utils.ts. Re-derived per call so a process.env.TZ change
// (which Node honours for new Date instances) takes effect.
const todayDateString = () => new Date().toLocaleDateString('en-CA');
function localTimestampOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function nextDateString(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

function questsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

describe.each(ZONES)('local-day round-trip in $tz at $hhmm', ({ tz, hhmm }) => {
  it('a task completed at that hour still counts as completed TODAY', () => {
    process.env.TZ = tz;
    const db = questsDb();

    const today = todayDateString();
    // No trailing Z: ES parses a bare date-time as LOCAL wall-clock time.
    const localInstant = new Date(`${today}T${hhmm}`);
    const nowIso = localInstant.toISOString();

    db.prepare("INSERT INTO tasks (id, name, created_at, updated_at) VALUES ('t1', 'Late quest', ?, ?)").run(nowIso, nowIso);
    // Write side: quests:setTaskStatus now stores a LOCAL timestamp.
    db.prepare('UPDATE tasks SET status = 1, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(localTimestampOf(localInstant), nowIso, 't1');

    // Read side: the half-open local range used by quests:countCompletedToday.
    const count = db.prepare(
      'SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?'
    ).get(today, nextDateString(today)) as { c: number };

    expect(count.c).toBe(1);
  });

  it('storing the UTC ISO instant instead would have missed it (the original bug)', () => {
    process.env.TZ = tz;
    const db = questsDb();

    const today = todayDateString();
    const localInstant = new Date(`${today}T${hhmm}`);
    const nowIso = localInstant.toISOString();

    // Precondition: at this hour the UTC calendar day really does differ.
    expect(nowIso.slice(0, 10)).not.toBe(today);

    db.prepare("INSERT INTO tasks (id, name, created_at, updated_at) VALUES ('t1', 'Late quest', ?, ?)").run(nowIso, nowIso);
    db.prepare('UPDATE tasks SET status = 1, completed_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, 't1');

    const count = db.prepare(
      'SELECT COUNT(*) AS c FROM tasks WHERE status = 1 AND completed_at >= ? AND completed_at < ?'
    ).get(today, nextDateString(today)) as { c: number };
    expect(count.c).toBe(0);
  });

  it('subtask counters agree with the task ones on the same local day', () => {
    process.env.TZ = tz;
    const db = questsDb();

    const today = todayDateString();
    const localInstant = new Date(`${today}T${hhmm}`);
    const nowIso = localInstant.toISOString();

    db.prepare("INSERT INTO tasks (id, name, created_at, updated_at) VALUES ('t1', 'Parent', ?, ?)").run(nowIso, nowIso);
    db.prepare("INSERT INTO subtasks (id, task_id, name, status, completed_at, created_at, updated_at) VALUES ('s1','t1','Sub',1,?,?,?)")
      .run(localTimestampOf(localInstant), nowIso, nowIso);

    const count = db.prepare(
      'SELECT COUNT(*) AS c FROM subtasks WHERE status = 1 AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?'
    ).get(today, nextDateString(today)) as { c: number };
    expect(count.c).toBe(1);
  });
});

/**
 * SQLite's own 'localtime' modifier reads the C runtime's timezone, which does NOT
 * follow a `process.env.TZ` assignment made after the process started — so these
 * run in the machine's real zone and simply assert the conversion is applied.
 */
describe("cauldron reads its day with date(started_at, 'localtime')", () => {
  function cauldronDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const m of cauldronMigrations) db.exec(m.up);
    return db;
  }

  it('a session started at 23:00 local belongs to the local day, not the UTC one', () => {
    const db = cauldronDb();
    const today = todayDateString();
    const startedAtUtc = new Date(`${today}T23:00:00`).toISOString();

    db.prepare(
      `INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, is_extension)
       VALUES ('s1', 'preset-classic', 'work', 25, 1, ?, ?, ?, ?, 0)`
    ).run(startedAtUtc, startedAtUtc, startedAtUtc, startedAtUtc);

    const localised = db.prepare(
      `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0
       AND date(started_at, 'localtime') = ?`
    ).get(today) as { count: number };
    expect(localised.count).toBe(1);

    // In any zone behind UTC this is where the old `date(started_at) = date('now')`
    // lost the session; in UTC itself the two agree and there is nothing to prove.
    if (new Date().getTimezoneOffset() > 0) {
      const naive = db.prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions WHERE date(started_at) = ?`
      ).get(today) as { count: number };
      expect(naive.count).toBe(0);
    }
  });
});

describe('cauldron extensions are excluded from the stats (task 22)', () => {
  it('an extension does not count as another pomodoro', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const m of cauldronMigrations) db.exec(m.up);

    const t = '2026-06-10T12:00:00.000Z';
    db.prepare(`INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, is_extension) VALUES ('s1','preset-classic','work',25,1,?,?,?,?,0)`).run(t, t, t, t);
    db.prepare(`INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, is_extension) VALUES ('s2','preset-classic','work',5,1,?,?,?,?,1)`).run(t, t, t, t);

    const total = db.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(duration_minutes), 0) AS minutes FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0`
    ).get() as { count: number; minutes: number };

    expect(total.count).toBe(1);
    expect(total.minutes).toBe(25);
  });
});
