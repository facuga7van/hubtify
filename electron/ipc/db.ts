import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { SqlDatabase } from '../../shared-logic/db';

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
