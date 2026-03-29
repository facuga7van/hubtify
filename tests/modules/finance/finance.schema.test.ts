import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

function runMigrations(db: Database.Database, upToVersion?: number) {
  for (const m of financeMigrations) {
    if (upToVersion !== undefined && m.version > upToVersion) break;
    db.exec(m.up);
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name) as { name: string } | undefined;
  return !!row;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

describe('finance schema v3 migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  it('creates all required tables from scratch', () => {
    runMigrations(db);
    const tables = [
      'finance_transactions', 'finance_installment_groups', 'finance_loans',
      'finance_loan_payments', 'finance_recurring', 'finance_recurring_amount_history',
      'finance_category_mappings', 'finance_import_batches', 'finance_categories', 'dollar_cache',
    ];
    for (const t of tables) {
      expect(tableExists(db, t), `table ${t} should exist`).toBe(true);
    }
  });

  it('finance_transactions has all v2 columns', () => {
    runMigrations(db);
    const requiredCols = [
      'id', 'type', 'amount', 'currency', 'category', 'description',
      'date', 'payment_method', 'installments', 'installment_group_id',
      'for_third_party', 'source', 'recurring_id', 'import_batch_id',
      'created_at', 'updated_at',
    ];
    for (const col of requiredCols) {
      expect(columnExists(db, 'finance_transactions', col), `column ${col}`).toBe(true);
    }
  });

  it('finance_loans has direction and type columns', () => {
    runMigrations(db);
    expect(columnExists(db, 'finance_loans', 'direction')).toBe(true);
    expect(columnExists(db, 'finance_loans', 'type')).toBe(true);
    expect(columnExists(db, 'finance_loans', 'installment_group_id')).toBe(true);
  });

  it('finance_recurring replaces income_sources', () => {
    runMigrations(db);
    expect(tableExists(db, 'finance_recurring')).toBe(true);
    expect(columnExists(db, 'finance_recurring', 'type')).toBe(true);
    expect(columnExists(db, 'finance_recurring', 'active')).toBe(true);
  });

  it('inserts default categories including Inversiones', () => {
    runMigrations(db);
    const cats = db.prepare('SELECT name FROM finance_categories').all() as Array<{ name: string }>;
    expect(cats.length).toBeGreaterThanOrEqual(11);
    expect(cats.map((c) => c.name)).toContain('Inversiones');
  });

  it('v1+v2 tables can be migrated to v3 schema', () => {
    // Run v1 and v2 first
    runMigrations(db, 2);

    // Insert v2 data
    db.prepare(`INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, source, created_at, updated_at)
      VALUES ('tx1', 'expense', 100, 'ARS', 'Delivery', 'Rappi', '2026-03-01', 'manual', '2026-03-01', '2026-03-01')`).run();
    db.prepare(`INSERT INTO finance_loans (id, person_name, type, amount, currency, date, description, settled, created_at)
      VALUES ('ln1', 'Juan', 'lent', 5000, 'ARS', '2026-03-01', 'Prestamo', 0, '2026-03-01')`).run();
    db.prepare(`INSERT INTO finance_income_sources (id, name, estimated_amount, frequency, is_variable, active, created_at)
      VALUES ('is1', 'Sueldo', 500000, 'monthly', 0, 1, '2026-03-01')`).run();

    // Run v3 migration only
    const v3 = financeMigrations.find(m => m.version === 3);
    if (v3) db.exec(v3.up);

    // Verify migrated data
    const tx = db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get('tx1') as Record<string, unknown>;
    expect(tx.payment_method).toBe('cash');
    expect(tx.source).toBe('manual');

    const loan = db.prepare('SELECT * FROM finance_loans WHERE id = ?').get('ln1') as Record<string, unknown>;
    expect(loan.direction).toBe('lent');
    expect(loan.type).toBe('single');

    const recurring = db.prepare('SELECT * FROM finance_recurring WHERE id = ?').get('is1') as Record<string, unknown>;
    expect(recurring.name).toBe('Sueldo');
    expect(recurring.type).toBe('income');
    expect(recurring.amount).toBe(500000);
  });
});
