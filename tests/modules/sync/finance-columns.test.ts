import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

/**
 * Guard against the regression class where a migration adds a finance column and
 * the sync export/merge never learns about it.
 *
 * This already happened: `installment_number`, `billed_amount_ars`,
 * `calculated_amount_usd`, `paid_amount_usd` and `transaction_id_usd` shipped in
 * finance v11 while `sync:getAllFinanceData` and `sync:mergeFinanceData` kept the
 * old column list. Everything looked right on the machine that created the data
 * and arrived empty on every other device — silently undoing the multi-currency
 * work those columns exist for.
 *
 * The check is per-SQL-statement on purpose. An earlier version of this test only
 * asked whether the column name appeared *somewhere* in the file, which passed
 * even with the column deleted from the SELECT, because the INSERT still
 * mentioned it. A guard that cannot fail is worse than no guard.
 */

const SYNC_SRC = fs.readFileSync(
  path.join(__dirname, '../../../electron/modules/sync.ipc.ts'),
  'utf-8',
);

/** Columns that deliberately never travel: purely local bookkeeping. */
const LOCAL_ONLY: Record<string, string[]> = {
  finance_transactions: [],
  finance_credit_card_statements: [],
};

function schemaColumns(table: string): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  db.close();
  return rows.map(r => r.name).filter(n => !(LOCAL_ONLY[table] ?? []).includes(n));
}

/** The text of the first statement starting at `startMarker`, up to the closing backtick. */
function statementAfter(startMarker: string): string {
  const at = SYNC_SRC.indexOf(startMarker);
  expect(at, `no encontré el marcador «${startMarker}» en sync.ipc.ts`).toBeGreaterThan(-1);
  const end = SYNC_SRC.indexOf('`', at);
  return SYNC_SRC.slice(at, end === -1 ? at + 2000 : end);
}

interface StatementCase {
  table: string;
  label: string;
  marker: string;
  /** Columns a statement legitimately omits (an UPDATE never re-sets the key). */
  exempt?: string[];
}

const CASES: StatementCase[] = [
  {
    table: 'finance_transactions',
    label: 'export (sync:getAllFinanceData)',
    marker: 'SELECT id, type, amount, currency, category, description, date,',
  },
  {
    table: 'finance_transactions',
    label: 'merge insert',
    marker: 'INSERT OR IGNORE INTO finance_transactions',
  },
  {
    table: 'finance_transactions',
    label: 'merge update',
    marker: 'UPDATE finance_transactions SET type = ?',
    exempt: ['id', 'created_at'],
  },
  {
    table: 'finance_credit_card_statements',
    label: 'export (sync:getAllFinanceData)',
    marker: 'SELECT id, credit_card_id AS creditCardId, period_month AS periodMonth,',
  },
  {
    table: 'finance_credit_card_statements',
    label: 'merge insert',
    marker: 'INSERT OR IGNORE INTO finance_credit_card_statements',
  },
  {
    table: 'finance_credit_card_statements',
    label: 'merge update',
    marker: 'UPDATE finance_credit_card_statements SET calculated_amount = ?',
    exempt: ['id', 'credit_card_id', 'period_month', 'created_at'],
  },
];

describe('finance sync carries every column the schema defines', () => {
  for (const c of CASES) {
    it(`${c.table} — ${c.label}`, () => {
      const sql = statementAfter(c.marker);
      const expected = schemaColumns(c.table).filter(col => !(c.exempt ?? []).includes(col));
      const missing = expected.filter(col => !sql.includes(col));
      expect(missing, `columnas ausentes en ${c.table} / ${c.label}`).toEqual([]);
    });
  }
});
