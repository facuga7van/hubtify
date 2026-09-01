import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../electron/ipc/db';
import { processRpgEvent } from '../../electron/ipc/rpg-handlers';

vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}));

/**
 * Review RPG #3 (alto): «Coinify agregar/borrar = grifo infinito». A manual
 * movement paid XP on alta and the delete emitted nothing the engine could
 * match, so add → delete → add farmed XP, combo and finance mastery forever.
 * The alta now carries `transactionId` as its ref and the delete emits
 * MOVEMENT_DELETED with the same id; the engine reverses the exact XP.
 */

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  return db;
}

function stats(db: Database.Database) {
  return db.prepare('SELECT xp, daily_combo AS combo, total_expenses AS totalExpenses FROM player_stats WHERE user_id = ?')
    .get('default') as { xp: number; combo: number; totalExpenses: number };
}

/**
 * Achievement XP is permanent by design (an unlock is never refunded), so the
 * economy is measured NET of it: what a cycle of altas and deletes leaves
 * behind once the one-time medallions are set aside.
 */
function achievementXp(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(SUM(xp_gained), 0) AS xp FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'")
    .get() as { xp: number };
  return row.xp;
}

function netXp(db: Database.Database): number {
  return stats(db).xp - achievementXp(db);
}

function mastery(db: Database.Database, moduleId: string): number {
  const row = db.prepare('SELECT xp FROM mastery_xp WHERE module_id = ?').get(moduleId) as { xp: number } | undefined;
  return row?.xp ?? 0;
}

function logMovement(db: Database.Database, transactionId: string, type: 'expense' | 'income' = 'expense') {
  return processRpgEvent(db, {
    type: type === 'income' ? 'INCOME_LOGGED' : 'EXPENSE_LOGGED',
    moduleId: 'finance',
    payload: { xp: 5, hp: 0, movementType: type, transactionId },
    timestamp: Date.now(),
  });
}

function deleteMovement(db: Database.Database, transactionId: string, type: 'expense' | 'income' = 'expense') {
  return processRpgEvent(db, {
    type: 'MOVEMENT_DELETED',
    moduleId: 'finance',
    payload: { xp: -5, hp: 0, movementType: type, transactionId },
    timestamp: Date.now(),
  });
}

describe('Coinify add/delete is no longer a tap', () => {
  it('the alta persists transactionId as ref_id', () => {
    const db = setupDb();
    logMovement(db, 'tx-1');
    const row = db.prepare("SELECT ref_id FROM rpg_events WHERE event_type = 'EXPENSE_LOGGED'").get() as { ref_id: string };
    expect(row.ref_id).toBe('tx-1');
  });

  it('deleting the movement reverses the exact XP, the log row, the combo tick and the counter', () => {
    const db = setupDb();
    const before = stats(db);
    const paid = logMovement(db, 'tx-1');
    expect(paid.xpGained).toBeGreaterThan(0);
    const mid = stats(db);
    expect(mid.totalExpenses).toBe(before.totalExpenses + 1);

    const refund = deleteMovement(db, 'tx-1');
    expect(refund.xpGained).toBe(-paid.xpGained);

    const after = stats(db);
    expect(netXp(db)).toBe(before.xp);
    expect(after.combo).toBe(before.combo);
    expect(after.totalExpenses).toBe(before.totalExpenses);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rpg_events WHERE event_type = 'EXPENSE_LOGGED'").get()).toEqual({ n: 0 });
  });

  it('add → delete → add ×20 leaves exactly one alta worth of XP and mastery', () => {
    const db = setupDb();
    const base = stats(db);
    for (let i = 0; i < 20; i++) {
      logMovement(db, `tx-${i}`);
      deleteMovement(db, `tx-${i}`);
    }
    const one = logMovement(db, 'tx-final');
    const s = stats(db);
    expect(netXp(db)).toBe(base.xp + one.xpGained);
    expect(s.combo).toBe(base.combo + 1);
    // La maestría es un contador entero: guarda el XP redondeado. Comparar
    // contra el XP crudo sólo pasaba cuando el bonus aleatorio caía redondo.
    expect(mastery(db, 'finance')).toBe(Math.round(one.xpGained));
    // And the medallions unlocked exactly once across the 21 altas.
    const unlockedRows = db.prepare("SELECT COUNT(*) AS n FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'").get() as { n: number };
    const unlockedIds = db.prepare('SELECT COUNT(*) AS n FROM achievements_unlocked').get() as { n: number };
    expect(unlockedRows.n).toBe(unlockedIds.n);
  });

  it('a delete with no matching alta refunds nothing (never deducts twice)', () => {
    const db = setupDb();
    const base = stats(db);
    const r = deleteMovement(db, 'ghost');
    expect(r.xpGained).toBe(0);
    expect(stats(db).xp).toBe(base.xp);
  });

  it('movementType picks the right alta: deleting an income never touches an expense with the same id', () => {
    const db = setupDb();
    logMovement(db, 'shared-id', 'expense');
    const r = deleteMovement(db, 'shared-id', 'income');
    expect(r.xpGained).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rpg_events WHERE event_type = 'EXPENSE_LOGGED'").get()).toEqual({ n: 1 });
  });
});
