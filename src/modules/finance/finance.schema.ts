import type { Migration } from '../../../shared/types';

export const financeMigrations: Migration[] = [
  {
    namespace: 'finance',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS finance_transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        category TEXT NOT NULL DEFAULT 'Otros',
        description TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_tx_date ON finance_transactions(date);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_type ON finance_transactions(type);

      CREATE TABLE IF NOT EXISTS finance_loans (
        id TEXT PRIMARY KEY,
        person_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('lent', 'borrowed')),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        date TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        settled INTEGER NOT NULL DEFAULT 0,
        settled_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS finance_income_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        estimated_amount REAL NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'monthly',
        is_variable INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS finance_categories (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO finance_categories (name) VALUES
        ('Entretenimiento'), ('Delivery'), ('Servicios'), ('Suscripciones'),
        ('Transporte'), ('Compras'), ('Supermercado'), ('Salud'), ('Educacion'), ('Otros');
    `,
  },
  {
    namespace: 'finance',
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS dollar_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    namespace: 'finance',
    version: 3,
    up: `
      ALTER TABLE finance_transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
      ALTER TABLE finance_transactions ADD COLUMN installments INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE finance_transactions ADD COLUMN installment_group_id TEXT;
      ALTER TABLE finance_transactions ADD COLUMN for_third_party INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE finance_transactions ADD COLUMN recurring_id TEXT;
      ALTER TABLE finance_transactions ADD COLUMN import_batch_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_finance_tx_installment_group ON finance_transactions(installment_group_id);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_recurring ON finance_transactions(recurring_id);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_import_batch ON finance_transactions(import_batch_id);

      CREATE TABLE IF NOT EXISTS finance_installment_groups (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        total_amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        total_installments INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'Otros',
        date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE finance_loans RENAME COLUMN type TO direction;
      ALTER TABLE finance_loans ADD COLUMN type TEXT NOT NULL DEFAULT 'single';
      ALTER TABLE finance_loans ADD COLUMN installment_group_id TEXT;

      CREATE TABLE IF NOT EXISTS finance_loan_payments (
        id TEXT PRIMARY KEY,
        loan_id TEXT NOT NULL REFERENCES finance_loans(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_loan_payments_loan ON finance_loan_payments(loan_id);

      CREATE TABLE IF NOT EXISTS finance_recurring (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')) DEFAULT 'income',
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        frequency TEXT NOT NULL DEFAULT 'monthly',
        is_variable INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        category TEXT NOT NULL DEFAULT 'Otros',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO finance_recurring (id, name, type, amount, currency, frequency, is_variable, active, created_at)
        SELECT id, name, 'income', estimated_amount, 'ARS', frequency, is_variable, active, created_at
        FROM finance_income_sources;

      CREATE TABLE IF NOT EXISTS finance_recurring_amount_history (
        id TEXT PRIMARY KEY,
        recurring_id TEXT NOT NULL REFERENCES finance_recurring(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'ARS',
        effective_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_recurring_history ON finance_recurring_amount_history(recurring_id);

      CREATE TABLE IF NOT EXISTS finance_category_mappings (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_category_mappings_keyword ON finance_category_mappings(keyword);

      CREATE TABLE IF NOT EXISTS finance_import_batches (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        filename TEXT NOT NULL DEFAULT '',
        row_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO finance_categories (name) VALUES ('Inversiones');
    `,
  },
];
