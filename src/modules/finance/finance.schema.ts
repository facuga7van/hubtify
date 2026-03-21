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
];
