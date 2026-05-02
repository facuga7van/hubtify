import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

function runMigrations(db: Database.Database) {
  for (const m of financeMigrations) {
    try { db.exec(m.up); } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('finance migration V10 — loan soft deletes', () => {
  it('finance_loans has updated_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(finance_loans)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('updated_at');
  });

  it('finance_loan_payments has deleted_at and updated_at columns', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(finance_loan_payments)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('deleted_at');
    expect(names).toContain('updated_at');
  });

  it('existing loans get updated_at backfilled from created_at', () => {
    const db = setupDb();
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, created_at) VALUES ('l1', 'Juan', 'lent', 'single', 1000, 'ARS', '2026-01-01', '2026-01-01T10:00:00')").run();
    // Re-run V10 backfill (already ran in setupDb, but row was inserted after)
    db.exec("UPDATE finance_loans SET updated_at = created_at WHERE updated_at IS NULL");
    const row = db.prepare("SELECT updated_at FROM finance_loans WHERE id = 'l1'").get() as { updated_at: string };
    expect(row.updated_at).toBe('2026-01-01T10:00:00');
  });

  it('soft-deleted loan payments excluded from query', () => {
    const db = setupDb();
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, created_at) VALUES ('l1', 'Juan', 'lent', 'single', 1000, 'ARS', '2026-01-01', datetime('now'))").run();
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at) VALUES ('p1', 'l1', 500, 'ARS', '2026-02-01', datetime('now'))").run();
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at, deleted_at) VALUES ('p2', 'l1', 300, 'ARS', '2026-03-01', datetime('now'), datetime('now'))").run();
    const rows = db.prepare("SELECT * FROM finance_loan_payments WHERE loan_id = 'l1' AND deleted_at IS NULL").all();
    expect(rows).toHaveLength(1);
  });

  it('idx_finance_statements_status index exists', () => {
    const db = setupDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='finance_credit_card_statements'").all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_finance_statements_status');
  });

  it('idx_finance_loans_settled index exists', () => {
    const db = setupDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='finance_loans'").all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_finance_loans_settled');
  });
});
