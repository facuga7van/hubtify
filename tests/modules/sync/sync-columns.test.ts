import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

/**
 * Sibling of finance-columns.test.ts for every other synced table that has
 * grown columns lately. Same mechanism: each SQL statement in sync.ipc.ts is
 * checked, on its own, against PRAGMA table_info — a migration that adds a
 * column the export/merge never learns about fails here instead of arriving
 * empty on every other device.
 */

// Normalizado a LF: los marcadores llevan saltos de linea y el working tree
// de Windows puede tener CRLF — un guard no se puede caer por eso.
const SYNC_SRC = fs.readFileSync(
  path.join(__dirname, '../../../shared-logic/modules/sync.ipc.ts'),
  'utf-8',
).replace(new RegExp(String.fromCharCode(13), 'g'), '');

type MigrationSet = Array<{ up: string }>;
const MIGRATIONS: Record<string, MigrationSet> = {
  tasks: questsMigrations,
  subtasks: questsMigrations,
  habits: questsMigrations,
  habit_checks: questsMigrations,
  food_log: nutritionMigrations,
  nutrition_profile: nutritionMigrations,
  cauldron_sessions: cauldronMigrations,
  cauldron_presets: cauldronMigrations,
  finance_credit_cards: financeMigrations,
  finance_recurring: financeMigrations,
  finance_accounts: financeMigrations,
  finance_budgets: financeMigrations,
};

/** Columns that deliberately never travel: purely local bookkeeping. */
const LOCAL_ONLY: Record<string, string[]> = {
  // legacy emoji column, never rendered nor synced
  habits: ['icon'],
  // GENERATED ALWAYS — SQLite computes it for every writer
  food_log: ['description_norm'],
  // the running timer's recovery state, meaningful on this device only
  cauldron_sessions: ['target_end_time'],
  // copied from finance_income_sources by the v3 migration, never read since
  finance_recurring: ['is_variable'],
};

function schemaColumns(table: string): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS[table]) db.exec(m.up);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  db.close();
  return rows.map(r => r.name).filter(n => !(LOCAL_ONLY[table] ?? []).includes(n));
}

/** The text of the first statement starting at `marker` (searched after `after`), up to the closing quote. */
function statementAfter(marker: string, after?: string): string {
  let from = 0;
  if (after) {
    from = SYNC_SRC.indexOf(after);
    expect(from, `no encontré la sección «${after}» en sync.ipc.ts`).toBeGreaterThan(-1);
  }
  const at = SYNC_SRC.indexOf(marker, from);
  expect(at, `no encontré el marcador «${marker}» en sync.ipc.ts`).toBeGreaterThan(-1);
  // Statements are written either as template literals or as single-quoted
  // strings: the quote that opened this one is the first non-blank character
  // before the marker, and the statement ends at its twin. A marker that
  // starts MID-statement (the ON CONFLICT clause) can only live in a template.
  let q = at - 1;
  while (q >= 0 && /\s/.test(SYNC_SRC[q])) q--;
  const quote = SYNC_SRC[q] === "'" ? "'" : '`';
  const end = SYNC_SRC.indexOf(quote, at);
  return SYNC_SRC.slice(at, end === -1 ? at + 2000 : end);
}

interface StatementCase {
  table: string;
  label: string;
  marker: string;
  /** Restrict the search to the text after this marker (disambiguates repeated statements). */
  after?: string;
  /** Columns a statement legitimately omits (an UPDATE never re-sets the key). */
  exempt?: string[];
}

const CASES: StatementCase[] = [
  // ── quests ──
  { table: 'tasks', label: 'export', marker: 'SELECT id, name, description, status, tier, category,' },
  { table: 'tasks', label: 'merge insert', marker: 'INSERT INTO tasks (' },
  { table: 'tasks', label: 'merge update', marker: 'UPDATE tasks SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'subtasks', label: 'export', marker: 'SELECT id, task_id AS taskId, name, description, tier, status,' },
  { table: 'subtasks', label: 'merge insert', marker: 'INSERT INTO subtasks (' },
  { table: 'subtasks', label: 'merge update', marker: 'UPDATE subtasks SET name = ?', exempt: ['id', 'task_id', 'created_at'] },
  { table: 'habits', label: 'export', marker: 'SELECT id, name, frequency, times_per_week AS timesPerWeek,' },
  { table: 'habits', label: 'merge insert', marker: 'INSERT INTO habits (' },
  { table: 'habits', label: 'merge update', marker: 'UPDATE habits SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'habit_checks', label: 'export', marker: 'SELECT id, habit_id AS habitId, date, kind,' },
  { table: 'habit_checks', label: 'merge upsert insert', marker: 'INSERT INTO habit_checks (' },
  { table: 'habit_checks', label: 'merge upsert update', marker: 'ON CONFLICT(habit_id, date) DO UPDATE SET', exempt: ['id', 'habit_id', 'date', 'created_at'] },
  // ── nutrition ──
  { table: 'food_log', label: 'export', marker: 'SELECT f.sync_id, f.date, f.time,' },
  { table: 'food_log', label: 'merge insert', marker: 'INSERT INTO food_log (' },
  { table: 'food_log', label: 'merge update', marker: 'UPDATE food_log SET', exempt: ['id', 'sync_id'] },
  // export is SELECT * — nothing to check there
  { table: 'nutrition_profile', label: 'merge replace', marker: 'INSERT OR REPLACE INTO nutrition_profile' },
  // ── cauldron (export is SELECT *) ──
  { table: 'cauldron_presets', label: 'merge insert', marker: 'INSERT INTO cauldron_presets (', after: 'export function mergeCauldronDataInto' },
  { table: 'cauldron_presets', label: 'merge update', marker: 'UPDATE cauldron_presets SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'cauldron_sessions', label: 'merge insert', marker: 'INSERT OR IGNORE INTO cauldron_sessions' },
  { table: 'cauldron_sessions', label: 'merge update (LWW)', marker: 'UPDATE cauldron_sessions SET completed = ?',
    exempt: ['id', 'preset_id', 'type', 'duration_minutes', 'started_at', 'created_at', 'is_extension'] },
  // ── finance ──
  { table: 'finance_credit_cards', label: 'export', marker: 'SELECT id, name, closing_day AS closingDay,' },
  { table: 'finance_credit_cards', label: 'merge insert', marker: 'INSERT OR IGNORE INTO finance_credit_cards' },
  { table: 'finance_credit_cards', label: 'merge update', marker: 'UPDATE finance_credit_cards SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'finance_accounts', label: 'export', marker: 'SELECT id, name, kind, currency, initial_balance AS initialBalance,' },
  { table: 'finance_accounts', label: 'merge insert', marker: 'INSERT OR IGNORE INTO finance_accounts', after: 'export function mergeFinanceDataInto' },
  { table: 'finance_accounts', label: 'merge update', marker: 'UPDATE finance_accounts SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'finance_recurring', label: 'export', marker: 'SELECT id, name, type, amount, currency, category, active,' },
  { table: 'finance_recurring', label: 'merge insert', marker: 'INSERT OR IGNORE INTO finance_recurring\n' },
  { table: 'finance_recurring', label: 'merge update', marker: 'UPDATE finance_recurring SET name = ?', exempt: ['id', 'created_at'] },
  { table: 'finance_budgets', label: 'export', marker: 'SELECT category, monthly_limit AS monthlyLimit,' },
  { table: 'finance_budgets', label: 'merge insert', marker: 'INSERT INTO finance_budgets' },
  { table: 'finance_budgets', label: 'merge update', marker: 'UPDATE finance_budgets SET monthly_limit = ?', exempt: ['category', 'created_at'] },
];

describe('sync carries every column the schema defines (quests, nutrition, cauldron, finance)', () => {
  for (const c of CASES) {
    it(`${c.table} — ${c.label}`, () => {
      const sql = statementAfter(c.marker, c.after);
      const expected = schemaColumns(c.table).filter(col => !(c.exempt ?? []).includes(col));
      const missing = expected.filter(col => !sql.includes(col));
      expect(missing, `columnas ausentes en ${c.table} / ${c.label}`).toEqual([]);
    });
  }
});
