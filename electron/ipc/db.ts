import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { SqlDatabase } from '../../shared-logic/db';
import { getDb as sharedGetDb } from '../../shared-logic/db';

/**
 * Desktop DB binding: better-sqlite3 over userData/hubtify.db.
 * `journal_mode = WAL` lives here and not in the shared provider because the
 * Android VFS (opfs-sahpool) does not support WAL.
 */
export function openDesktopDb(): SqlDatabase {
  const db = new Database(path.join(app.getPath('userData'), 'hubtify.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

// TRANSITIONAL (removed in Task 14): modules still living in electron/ keep
// importing getDb from '../ipc/db' until each one moves to shared-logic. Typed
// as better-sqlite3 on purpose: their helpers still take `Database.Database`
// params, and `SqlDatabase` is NOT assignable in that direction (the object
// really is a better-sqlite3 Database, so the cast is honest).
export function getDb(): Database.Database {
  return sharedGetDb() as unknown as Database.Database;
}
