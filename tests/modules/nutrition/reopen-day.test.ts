import { describe, it, expect, vi } from 'vitest';

// nutrition.ipc.ts pulls in electron (ipcMain via ipc-handle, app via db).
// We only exercise the pure reopenDayRecord helper against an in-memory DB,
// so a thin electron mock is enough — getDb() is never called.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));

import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { reopenDayRecord } from '../../../electron/modules/nutrition.ipc';

function runMigrations(db: Database.Database) {
  for (const m of nutritionMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const DATE = '2026-05-01';

function closeDay(db: Database.Database, date = DATE, xpTotal = 50, hpChange = 10) {
  db.prepare(`
    INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, updated_at, deleted_at)
    VALUES (?, ?, 0, 0, 0, 0, ?, ?, 1800, 2000, datetime('now'), NULL)
    ON CONFLICT(date) DO UPDATE SET
      xp_total = excluded.xp_total, hp_change = excluded.hp_change,
      updated_at = datetime('now'), deleted_at = NULL
  `).run(date, xpTotal, xpTotal, hpChange);
}

const isClosed = (db: Database.Database, date = DATE) =>
  !!db.prepare('SELECT 1 FROM nutrition_daily_closed WHERE date = ? AND deleted_at IS NULL').get(date);

describe('nutrition migration V11 — daily_closed soft delete', () => {
  it('nutrition_daily_closed has updated_at and deleted_at columns', () => {
    const db = setupDb();
    const cols = (db.pragma('table_info(nutrition_daily_closed)') as Array<{ name: string }>).map(c => c.name);
    expect(cols).toContain('updated_at');
    expect(cols).toContain('deleted_at');
  });
});

describe('reopenDayRecord', () => {
  it('closing a day marks it as closed', () => {
    const db = setupDb();
    closeDay(db);
    expect(isClosed(db)).toBe(true);
  });

  it('reopening soft-deletes the record, returns the granted XP/HP, and frees the guard', () => {
    const db = setupDb();
    closeDay(db, DATE, 42, 10);

    const result = reopenDayRecord(db, DATE);
    expect(result).toEqual({ xpTotal: 42, hpChange: 10 });

    // The closed guard no longer sees the day → meals become editable again.
    expect(isClosed(db)).toBe(false);

    // Row is kept (soft delete) with deleted_at + updated_at set, so sync can replicate it.
    const row = db.prepare('SELECT deleted_at, updated_at FROM nutrition_daily_closed WHERE date = ?').get(DATE) as { deleted_at: string | null; updated_at: string | null };
    expect(row.deleted_at).not.toBeNull();
    expect(row.updated_at).not.toBeNull();
  });

  it('reopening a day that was never closed is a safe no-op', () => {
    const db = setupDb();
    expect(reopenDayRecord(db, DATE)).toBeNull();
    expect(isClosed(db)).toBe(false);
  });

  it('reopening an already-reopened day is idempotent (no-op)', () => {
    const db = setupDb();
    closeDay(db);
    expect(reopenDayRecord(db, DATE)).not.toBeNull();
    // Second reopen finds nothing live → null, leaves the soft delete untouched.
    expect(reopenDayRecord(db, DATE)).toBeNull();
    expect(isClosed(db)).toBe(false);
  });

  it('a reopened day can be closed again, clearing the soft delete', () => {
    const db = setupDb();
    closeDay(db, DATE, 50, 10);
    reopenDayRecord(db, DATE);
    expect(isClosed(db)).toBe(false);

    // Re-close (UPSERT mirrors nutrition:closeDay) restores the live record.
    closeDay(db, DATE, 60, 10);
    expect(isClosed(db)).toBe(true);
    const row = db.prepare('SELECT xp_total AS xpTotal, deleted_at FROM nutrition_daily_closed WHERE date = ?').get(DATE) as { xpTotal: number; deleted_at: string | null };
    expect(row.xpTotal).toBe(60);
    expect(row.deleted_at).toBeNull();
  });
});
