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
  {
    namespace: 'finance',
    version: 4,
    up: `
      -- Delete transactions generated by duplicate recurring templates
      DELETE FROM finance_transactions
      WHERE source = 'recurring' AND recurring_id IN (
        SELECT r.id FROM finance_recurring r
        WHERE r.id NOT IN (
          SELECT MIN(id) FROM finance_recurring
          GROUP BY name, type, currency
        )
      );

      -- Delete amount history for duplicate recurring templates
      DELETE FROM finance_recurring_amount_history
      WHERE recurring_id NOT IN (
        SELECT MIN(id) FROM finance_recurring
        GROUP BY name, type, currency
      );

      -- Delete duplicate recurring templates, keeping the oldest per name+type+currency
      DELETE FROM finance_recurring
      WHERE id NOT IN (
        SELECT MIN(id) FROM finance_recurring
        GROUP BY name, type, currency
      );
    `,
  },
  {
    namespace: 'finance',
    version: 5,
    up: `
      CREATE TABLE IF NOT EXISTS finance_credit_cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        closing_day INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS finance_credit_card_statements (
        id TEXT PRIMARY KEY,
        credit_card_id TEXT NOT NULL REFERENCES finance_credit_cards(id),
        period_month TEXT NOT NULL,
        calculated_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        paid_date TEXT,
        transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cc_statements_card ON finance_credit_card_statements(credit_card_id);
      CREATE INDEX IF NOT EXISTS idx_cc_statements_month ON finance_credit_card_statements(period_month);

      ALTER TABLE finance_transactions ADD COLUMN credit_card_id TEXT;
      ALTER TABLE finance_transactions ADD COLUMN impacts_balance INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_finance_tx_credit_card ON finance_transactions(credit_card_id);

      INSERT OR IGNORE INTO finance_categories (name) VALUES ('Pago Tarjeta');
    `,
  },
  {
    namespace: 'finance',
    version: 6,
    up: `
      ALTER TABLE finance_recurring ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    namespace: 'finance',
    version: 7,
    up: `
      ALTER TABLE finance_recurring_amount_history ADD COLUMN previous_amount REAL;
    `,
  },
  {
    namespace: 'finance',
    version: 8,
    up: `
      -- Soft-delete support: add deleted_at to 6 tables with DELETE operations
      ALTER TABLE finance_transactions ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_categories ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_credit_cards ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_credit_card_statements ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_installment_groups ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_recurring ADD COLUMN deleted_at TEXT DEFAULT NULL;

      -- Add updated_at to tables missing it
      ALTER TABLE finance_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE finance_credit_cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE finance_credit_card_statements ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE finance_installment_groups ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE finance_recurring ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

      -- Backfill updated_at from created_at where available
      UPDATE finance_credit_cards SET updated_at = created_at WHERE updated_at = '';
      UPDATE finance_credit_card_statements SET updated_at = created_at WHERE updated_at = '';
      UPDATE finance_installment_groups SET updated_at = created_at WHERE updated_at = '';
      UPDATE finance_recurring SET updated_at = created_at WHERE updated_at = '';
      -- finance_categories has no created_at — backfill with now
      UPDATE finance_categories SET updated_at = datetime('now') WHERE updated_at = '';

      -- Indexes for soft-delete filtering
      CREATE INDEX IF NOT EXISTS idx_finance_tx_deleted ON finance_transactions(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_cat_deleted ON finance_categories(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_cc_deleted ON finance_credit_cards(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_ccs_deleted ON finance_credit_card_statements(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_ig_deleted ON finance_installment_groups(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_rec_deleted ON finance_recurring(deleted_at);
    `,
  },
  {
    namespace: 'finance',
    version: 9,
    up: `
      CREATE TABLE IF NOT EXISTS crypto_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    namespace: 'finance',
    version: 10,
    up: `
      ALTER TABLE finance_loans ADD COLUMN updated_at TEXT DEFAULT NULL;
      ALTER TABLE finance_loan_payments ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE finance_loan_payments ADD COLUMN updated_at TEXT DEFAULT NULL;
      UPDATE finance_loans SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE finance_loan_payments SET updated_at = created_at WHERE updated_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_finance_statements_status ON finance_credit_card_statements(status);
      CREATE INDEX IF NOT EXISTS idx_finance_loans_settled ON finance_loans(settled);
    `,
  },
  {
    namespace: 'finance',
    version: 11,
    up: `
      -- Persisted instalment number. It used to be derived as a month diff against
      -- the group start date, which is off-by-one for credit-card plans (those start
      -- a month later), so gauges showed "2/6" first and "7/6" last.
      ALTER TABLE finance_transactions ADD COLUMN installment_number INTEGER;

      -- For USD credit-card lines, the amount the card actually charged in ARS.
      -- Previously discarded by the PDF importer.
      ALTER TABLE finance_transactions ADD COLUMN billed_amount_ars REAL;

      -- finance_loans was the only finance table without soft-delete support.
      ALTER TABLE finance_loans ADD COLUMN deleted_at TEXT DEFAULT NULL;

      -- Statements used to collapse ARS + USD purchases into one number.
      ALTER TABLE finance_credit_card_statements ADD COLUMN calculated_amount_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE finance_credit_card_statements ADD COLUMN paid_amount_usd REAL;
      ALTER TABLE finance_credit_card_statements ADD COLUMN transaction_id_usd TEXT;

      -- Backfill instalment numbers by chronological position inside each group.
      UPDATE finance_transactions
      SET installment_number = (
        SELECT ranked.rn FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY installment_group_id
            ORDER BY date ASC, created_at ASC, id ASC
          ) AS rn
          FROM finance_transactions
          WHERE installment_group_id IS NOT NULL
        ) AS ranked
        WHERE ranked.id = finance_transactions.id
      )
      WHERE installment_group_id IS NOT NULL AND installment_number IS NULL;
    `,
  },
  {
    namespace: 'finance',
    version: 12,
    up: `
      -- Composite indexes matching the real query shapes. The old single-column
      -- idx_finance_tx_date was unusable anyway while month filters used LIKE.
      CREATE INDEX IF NOT EXISTS idx_finance_tx_live_date  ON finance_transactions(deleted_at, date);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_type_date  ON finance_transactions(type, impacts_balance, deleted_at, date);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_rec_date   ON finance_transactions(source, recurring_id, date);
      CREATE INDEX IF NOT EXISTS idx_finance_tx_card_stmt  ON finance_transactions(credit_card_id, impacts_balance, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_loans_person  ON finance_loans(person_name, settled, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_ccs_card_period       ON finance_credit_card_statements(credit_card_id, period_month, deleted_at);
    `,
  },
  {
    namespace: 'finance',
    version: 13,
    up: `
      -- Normalise SQLite datetime('now') stamps ("2026-08-31 14:12:01") to ISO
      -- ("2026-08-31T14:12:01Z"). Last-write-wins compares these as plain strings
      -- and 'T' > ' ', so a newer space-separated delete used to lose against an
      -- older ISO insert and resurrect the row. Rows already in ISO have no space,
      -- so the LIKE '% %' guard leaves them untouched.
      UPDATE finance_transactions              SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_transactions              SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_categories                SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_categories                SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_credit_cards              SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_credit_cards              SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_credit_card_statements    SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_credit_card_statements    SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_installment_groups        SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_installment_groups        SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_recurring                 SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_recurring                 SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_loans                     SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_loans                     SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';
      UPDATE finance_loan_payments             SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z' WHERE updated_at LIKE '% %';
      UPDATE finance_loan_payments             SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z' WHERE deleted_at LIKE '% %';

      -- A recurring template that was soft-deleted but left active = 1 kept being
      -- regenerated every month by the bootstrap job.
      UPDATE finance_recurring SET active = 0 WHERE deleted_at IS NOT NULL AND active = 1;
    `,
  },
  {
    namespace: 'finance',
    version: 14,
    up: `
      -- Reserved category for the taxes, perceptions and financing interest a
      -- card statement charges. The PDF importer used to throw those lines away,
      -- so the imported total never matched the paper the bank sends.
      -- ISO stamp on purpose: last-write-wins compares updated_at as a plain
      -- string, and datetime('now') writes a space where the rest of the app
      -- writes a 'T' (see the v13 normalisation above).
      INSERT OR IGNORE INTO finance_categories (name, updated_at)
        VALUES ('Impuestos de tarjeta', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

      -- The loan payment form never offered a currency, so every repayment was
      -- stamped 'ARS' — including the ones registered against a USD loan, whose
      -- amount finance:getActiveLoanSummary has always subtracted raw. The
      -- label was the only thing lying; align it with the loan so reads and the
      -- outstanding figure finally agree.
      UPDATE finance_loan_payments
      SET currency = (SELECT l.currency FROM finance_loans l WHERE l.id = finance_loan_payments.loan_id),
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE EXISTS (
        SELECT 1 FROM finance_loans l
        WHERE l.id = finance_loan_payments.loan_id
          AND l.currency IS NOT NULL
          AND l.currency <> finance_loan_payments.currency
      );
    `,
  },
  {
    namespace: 'finance',
    version: 15,
    up: `
      -- Monthly spending limits, one row per category. The category name IS the
      -- key: budgets live inside the existing expense wheel (one ring per slice),
      -- never on a screen of their own, so there is nothing else to identify.
      --
      -- Removing a budget is a soft delete like everywhere else in this module,
      -- so the removal travels through last-write-wins sync instead of the row
      -- coming back from the other device on the next pull.
      --
      -- The defaults are written in ISO on purpose (strftime, not datetime('now')):
      -- LWW compares updated_at as a plain string and 'T' > ' ' — see the v13
      -- normalisation above. Every write from the IPC layer passes nowIso().
      CREATE TABLE IF NOT EXISTS finance_budgets (
        category TEXT PRIMARY KEY,
        monthly_limit REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        deleted_at TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_budgets_deleted ON finance_budgets(deleted_at);
    `,
  },
  {
    namespace: 'finance',
    version: 16,
    up: `
      -- Cotización venta del dólar (casa preferida, app_state 'fx_house', default
      -- 'blue') congelada al momento de registrar la transacción. NULL = no había
      -- cotización disponible (offline sin cache); la lectura en USD usa entonces
      -- la cotización actual con indicador de aproximado, y
      -- finance:backfillFxRates puede completarla después.
      ALTER TABLE finance_transactions ADD COLUMN fx_rate REAL DEFAULT NULL;

      -- Día de vencimiento del resumen (el closing_day ya existía). NULL = no
      -- configurado: sin aviso de vencimiento y sin fila en la agenda de 30 días.
      ALTER TABLE finance_credit_cards ADD COLUMN due_day INTEGER DEFAULT NULL;
    `,
  },
];
