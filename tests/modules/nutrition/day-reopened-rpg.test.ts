import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// In-memory player DB shared with the mocked db module.
let testDb: Database.Database;

// Capture handlers registered via ipcMain.handle so we can invoke them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

const { initCoreTables, applyMigrations, coreMigrations } =
  await import('../../../shared-logic/db');

import { registerRpgHandlers } from '../../../electron/ipc/rpg-handlers';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Esquema real: el motor lee columnas (vigor, indultos, hp_date, ref_id) y
  // tablas (mastery_xp, achievements_unlocked) que un CREATE TABLE a mano no
  // tiene — sin ellas processRpgEvent aborta en silencio y no paga nada.
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  // hp_date = hoy: si no, el rollover del Vigor pone el HP en 100 antes del
  // primer evento del día y el delta que este test mide se come el techo.
  const today = new Date().toLocaleDateString('en-CA');
  db.prepare("UPDATE player_stats SET xp = 100, hp = 80, hp_date = ? WHERE user_id = 'default'").run(today);
  return db;
}

function process(event: Record<string, unknown>) {
  const handler = getHandler('rpg:processEvent')!;
  return handler({}, event);
}

const DATE = '2026-05-01';

/** XP de logros: permanente por diseño, se descuenta para medir la reversión. */
function achievementXp(): number {
  const r = testDb.prepare(
    "SELECT COALESCE(SUM(xp_gained), 0) AS xp FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'",
  ).get() as { xp: number };
  return r.xp;
}

describe('DAY_REOPENED reverts the close exactly', () => {
  beforeEach(() => {
    testDb = setupDb();
    clearHandlers();
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
    // Neto de logros: el primer cierre destapa una medalla, y una medalla no se devuelve.
    expect(afterReopen.xp - achievementXp()).toBe(before.xp); // exact reversal regardless of the random bonus
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

    const achBefore = achievementXp();
    await process({ type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 30, hp: 0, date: '2026-05-01' }, timestamp: Date.now() });
    const afterDay1 = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };
    // Neto de medallas: el primer cierre destapa un logro, y la reapertura
    // revierte el cierre pero nunca el logro.
    const day1Xp = (afterDay1.xp - before.xp) - (achievementXp() - achBefore);

    await process({ type: 'DAY_SUMMARY', moduleId: 'nutrition', payload: { xp: 40, hp: 0, date: '2026-05-02' }, timestamp: Date.now() });
    const afterDay2 = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };
    const achAfterDay2 = achievementXp();

    // Reopen only day 1.
    await process({ type: 'DAY_REOPENED', moduleId: 'nutrition', payload: { xp: -30, hp: 0, date: '2026-05-01' }, timestamp: Date.now() });

    const afterReopen = testDb.prepare("SELECT xp FROM player_stats WHERE user_id = 'default'").get() as { xp: number };
    // Only day 1's exact contribution is removed; day 2's XP remains. Neto de
    // medallas de los dos lados: reabrir destapa «second_chance», que entra
    // DESPUÉS de haber medido day1Xp y no se revierte.
    expect(afterReopen.xp - achievementXp()).toBeCloseTo(afterDay2.xp - achAfterDay2 - day1Xp, 2);
    expect(afterReopen.xp).toBeGreaterThan(before.xp); // day 2 still counts
    // Day 1's exact contribution is gone.
    const day1Event = testDb.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY' AND payload LIKE '%2026-05-01%'").get() as { c: number };
    expect(day1Event.c).toBe(0);
    const day2Event = testDb.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY' AND payload LIKE '%2026-05-02%'").get() as { c: number };
    expect(day2Event.c).toBe(1);
  });
});
