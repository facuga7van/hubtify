import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// In-memory player DB shared with the mocked db module.
let testDb: Database.Database;

// Capture handlers registered via ipcMain.handle so we can invoke them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

vi.mock('../../../electron/ipc/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerRpgHandlers } from '../../../electron/ipc/rpg-handlers';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE player_stats (
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
    CREATE TABLE rpg_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      xp_gained REAL NOT NULL DEFAULT 0,
      hp_change REAL NOT NULL DEFAULT 0,
      combo_multiplier REAL NOT NULL DEFAULT 1.0,
      bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO player_stats (user_id, xp, hp) VALUES ('default', 100, 80);
  `);
  return db;
}

function process(event: Record<string, unknown>) {
  const handler = handlers.get('rpg:processEvent')!;
  return handler({}, event);
}

const DATE = '2026-05-01';

describe('DAY_REOPENED reverts the close exactly', () => {
  beforeEach(() => {
    testDb = setupDb();
    handlers.clear();
    registerRpgHandlers();
  });

  it('restores XP and HP to their pre-close values and removes the close event', async () => {
    const before = testDb.prepare("SELECT xp, hp FROM player_stats WHERE user_id = 'default'").get() as { xp: number; hp: number };

    // Close the day (mirrors Today.tsx doCloseDay → DAY_SUMMARY with date in payload).
    await process({ type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 50, hp: 10, date: DATE }, timestamp: Date.now() });

    const afterClose = testDb.prepare("SELECT xp, hp FROM player_stats WHERE user_id = 'default'").get() as { xp: number; hp: number };
    expect(afterClose.xp).toBeGreaterThan(before.xp); // some XP was granted (combo/bonus applied)
    expect(afterClose.hp).toBe(before.hp + 10);

    // Reopen the day → revert through the undo path.
    await process({ type: 'DAY_REOPENED', moduleId: 'nutrition', payload: { xp: -50, hp: -10, date: DATE }, timestamp: Date.now() });

    const afterReopen = testDb.prepare("SELECT xp, hp FROM player_stats WHERE user_id = 'default'").get() as { xp: number; hp: number };
    expect(afterReopen.xp).toBe(before.xp); // exact reversal regardless of the random bonus
    expect(afterReopen.hp).toBe(before.hp);

    // The original DAY_SUMMARY event is removed so SUM-based XP queries stay consistent.
    const summaryEvents = testDb.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY'").get() as { c: number };
    expect(summaryEvents.c).toBe(0);
    // The undo event itself is logged with 0 xp to avoid double counting.
    const undoEvent = testDb.prepare("SELECT xp_gained AS xp FROM rpg_events WHERE event_type = 'DAY_REOPENED'").get() as { xp: number };
    expect(undoEvent.xp).toBe(0);
  });

  it('only reverts the matching day when several days are closed', async () => {
    const before = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };

    await process({ type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 30, hp: 0, date: '2026-05-01' }, timestamp: Date.now() });
    const afterDay1 = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };
    const day1Xp = afterDay1.xp - before.xp;

    await process({ type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 40, hp: 0, date: '2026-05-02' }, timestamp: Date.now() });
    const afterDay2 = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };

    // Reopen only day 1.
    await process({ type: 'DAY_REOPENED', moduleId: 'nutrition', payload: { xp: -30, hp: 0, date: '2026-05-01' }, timestamp: Date.now() });

    const afterReopen = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };
    // Only day 1's exact contribution is removed; day 2's XP remains.
    expect(afterReopen.xp).toBe(afterDay2.xp - day1Xp);
    expect(afterReopen.xp).toBeGreaterThan(before.xp); // day 2 still counts
    // Day 1's exact contribution is gone.
    const day1Event = testDb.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY' AND payload LIKE '%2026-05-01%'").get() as { c: number };
    expect(day1Event.c).toBe(0);
    const day2Event = testDb.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY' AND payload LIKE '%2026-05-02%'").get() as { c: number };
    expect(day2Event.c).toBe(1);
  });
});
