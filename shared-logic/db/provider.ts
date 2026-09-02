import type { Migration } from '../../shared/types';
import type { SqlDatabase } from './sql-database';
import { applyMigrations, coreMigrations, initCoreTables } from './migrate';

/** Opens a raw connection. Desktop: better-sqlite3 (electron/ipc/db.ts). Android: WASM shim. */
export type DbFactory = () => SqlDatabase;

/** Thrown by getDb() while the app is in background and the DB is closed. */
export class DbSuspended extends Error {
  constructor() {
    super('Database is suspended (app in background)');
    this.name = 'DbSuspended';
  }
}

let factory: DbFactory | null = null;
let db: SqlDatabase | null = null;
let suspended = false;

export function setDbFactory(next: DbFactory): void {
  factory = next;
}

/**
 * Lazy singleton. First call opens through the factory, applies the pragmas
 * shared by every platform (WAL is desktop-only — see openDesktopDb), the core
 * tables and the core migrations. Module migrations run separately
 * (runAllModuleMigrations) because each binding decides when.
 */
export function getDb(): SqlDatabase {
  if (suspended) throw new DbSuspended();
  if (!db) {
    if (!factory) throw new Error('setDbFactory() must run before getDb()');
    const opened = factory();
    opened.pragma('foreign_keys = ON');
    opened.pragma('synchronous = NORMAL');
    opened.pragma('cache_size = 10000');
    opened.pragma('temp_store = MEMORY');
    initCoreTables(opened);
    applyMigrations(opened, coreMigrations);
    db = opened;
  }
  return db;
}

export function runModuleMigrations(migrations: Migration[]): void {
  applyMigrations(getDb(), migrations);
}

/** Closes and discards the singleton; the next getDb() reopens normally. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Worker lifecycle (Fase 2): closed AND refusing to reopen until resumeDb(). */
export function suspendDb(): void {
  closeDb();
  suspended = true;
}

export function resumeDb(): void {
  suspended = false;
}
