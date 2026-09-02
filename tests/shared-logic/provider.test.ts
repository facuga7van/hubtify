import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  getDb, setDbFactory, closeDb, suspendDb, resumeDb, DbSuspended, runModuleMigrations,
} from '../../shared-logic/db';

beforeEach(() => {
  resumeDb();
  closeDb();
});

describe('db provider', () => {
  it('opens through the factory once and applies core tables + core migrations', () => {
    const factory = vi.fn(() => new Database(':memory:'));
    setDbFactory(factory);
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    const applied = a.prepare("SELECT version FROM migrations_applied WHERE namespace = 'core' ORDER BY version").all() as Array<{ version: number }>;
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((a.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1);
  });

  it('closeDb() discards the singleton; the next getDb() reopens through the factory', () => {
    const factory = vi.fn(() => new Database(':memory:'));
    setDbFactory(factory);
    getDb();
    closeDb();
    getDb();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('getDb() throws DbSuspended while suspended and works again after resumeDb()', () => {
    setDbFactory(() => new Database(':memory:'));
    getDb();
    suspendDb();
    expect(() => getDb()).toThrow(DbSuspended);
    resumeDb();
    expect(() => getDb()).not.toThrow();
  });

  it('runModuleMigrations() applies a namespaced migration once', () => {
    setDbFactory(() => new Database(':memory:'));
    const m = [{ namespace: 'probe', version: 1, up: 'CREATE TABLE probe (id TEXT PRIMARY KEY);' }];
    runModuleMigrations(m);
    runModuleMigrations(m); // idempotent: second call is a no-op, not a "table exists" error
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM migrations_applied WHERE namespace = 'probe'").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('throws a clear error when no factory was installed', () => {
    // Fresh module state is per test FILE, so emulate "no factory" explicitly.
    setDbFactory(undefined as never);
    expect(() => getDb()).toThrow(/setDbFactory/);
  });
});
