/**
 * Migración finance v20 (spec 2026-09-05-coinify-integridad):
 *  - `purchase_date`: la fecha de COMPRA que imprime el papel. `date` pasa a
 *    vivir en el mes del resumen (invariante 1).
 *
 * Cada migración se corre sobre una base migrada hasta la anterior con filas
 * sembradas por SQL, que es exactamente lo que va a pasar en cada dispositivo.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import type { Migration } from '../../../shared/types';

const V20 = financeMigrations.find((m) => m.version === 20);
const V21 = financeMigrations.find((m) => m.version === 21);

function dbUpTo(version: number): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) {
    if (m.version > version) break;
    db.exec(m.up);
  }
  return db;
}

const OLD_STAMP = '2026-01-01T00:00:00.000Z';

interface TxSeed { date: string; source?: string; statementPeriod?: string | null; deletedAt?: string | null }

function seedTx(db: Database.Database, id: string, seed: TxSeed): void {
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       impacts_balance, statement_period, created_at, updated_at, deleted_at)
    VALUES (?, 'expense', 100, 'ARS', 'Otros', '', ?, 'credit_card', ?, 0, ?, ?, ?, ?)
  `).run(id, seed.date, seed.source ?? 'import', seed.statementPeriod ?? null, OLD_STAMP, OLD_STAMP, seed.deletedAt ?? null);
}

function readTx(db: Database.Database, id: string) {
  return db.prepare(
    'SELECT date, purchase_date AS purchaseDate, updated_at AS updatedAt, deleted_at AS deletedAt FROM finance_transactions WHERE id = ?',
  ).get(id) as { date: string; purchaseDate: string | null; updatedAt: string; deletedAt: string | null };
}

/** Solo los UPDATE de una migración: el ALTER ya corrió y repetirlo tiraría «duplicate column». */
function rerunBackfill(db: Database.Database, migration: Migration): void {
  for (const chunk of migration.up.split(';')) {
    const stmt = chunk.replace(/--.*$/gm, '').trim();
    if (/^UPDATE/i.test(stmt)) db.exec(stmt);
  }
}

function snapshot(db: Database.Database): unknown[] {
  return db.prepare('SELECT * FROM finance_transactions ORDER BY id').all();
}

describe('finance v20 — purchase_date y date en el mes del resumen', () => {
  it('existe y agrega la columna', () => {
    expect(V20).toBeDefined();
    const db = dbUpTo(20);
    const cols = (db.pragma('table_info(finance_transactions)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('purchase_date');
  });

  it('mueve una importada con período al mes del resumen y guarda la fecha de compra', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp', { date: '2025-05-20', statementPeriod: '2025-08' });
    db.exec(V20!.up);
    const row = readTx(db, 'imp');
    expect(row.date).toBe('2025-08-20');
    expect(row.purchaseDate).toBe('2025-05-20');
    // updated_at nuevo: LWW tiene que propagar la corrección a los otros dispositivos.
    expect(row.updatedAt).not.toBe(OLD_STAMP);
  });

  it('clampea el día al último del mes del resumen', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp31', { date: '2025-05-31', statementPeriod: '2025-06' });
    db.exec(V20!.up);
    expect(readTx(db, 'imp31').date).toBe('2025-06-30');
  });

  it('una manual con tarjeta no cambia', () => {
    const db = dbUpTo(19);
    seedTx(db, 'man', { date: '2025-05-20', source: 'manual' });
    db.exec(V20!.up);
    const row = readTx(db, 'man');
    expect(row.date).toBe('2025-05-20');
    expect(row.purchaseDate).toBeNull();
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada sin período conserva su fecha pero gana purchase_date', () => {
    const db = dbUpTo(19);
    seedTx(db, 'cash', { date: '2025-05-20', statementPeriod: null });
    db.exec(V20!.up);
    const row = readTx(db, 'cash');
    expect(row.date).toBe('2025-05-20');
    expect(row.purchaseDate).toBe('2025-05-20');
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada ya en su mes no se mueve', () => {
    const db = dbUpTo(19);
    seedTx(db, 'ok', { date: '2025-08-05', statementPeriod: '2025-08' });
    db.exec(V20!.up);
    const row = readTx(db, 'ok');
    expect(row.date).toBe('2025-08-05');
    expect(row.purchaseDate).toBe('2025-08-05');
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada borrada no se mueve', () => {
    const db = dbUpTo(19);
    seedTx(db, 'del', { date: '2025-05-20', statementPeriod: '2025-08', deletedAt: OLD_STAMP });
    db.exec(V20!.up);
    expect(readTx(db, 'del').date).toBe('2025-05-20');
  });

  it('una importada con statement_period inválido conserva su date y la migración no revienta', () => {
    // Sync no valida el formato: '2025-13' pasa el GLOB pero date() da NULL;
    // '' ni siquiera pasa el GLOB. Sin guards, date = NULL → NOT NULL constraint
    // failed → rollback de TODA la migración y la app no arranca.
    const db = dbUpTo(19);
    seedTx(db, 'bad-month', { date: '2025-05-20', statementPeriod: '2025-13' });
    seedTx(db, 'empty', { date: '2025-05-20', statementPeriod: '' });
    seedTx(db, 'short', { date: '2025-05-20', statementPeriod: '2025-8' });
    seedTx(db, 'imp', { date: '2025-05-20', statementPeriod: '2025-08' });
    expect(() => db.exec(V20!.up)).not.toThrow();
    for (const id of ['bad-month', 'empty', 'short']) {
      const row = readTx(db, id);
      expect(row.date, id).toBe('2025-05-20');
      expect(row.purchaseDate, id).toBe('2025-05-20');
      expect(row.updatedAt, id).toBe(OLD_STAMP);
    }
    // La sana del mismo lote sí se mueve: los guards no frenan la migración entera.
    expect(readTx(db, 'imp').date).toBe('2025-08-20');
  });

  it('una importada con date no ISO no se toca', () => {
    const db = dbUpTo(19);
    seedTx(db, 'dmy', { date: '20/05/2025', statementPeriod: '2025-08' });
    expect(() => db.exec(V20!.up)).not.toThrow();
    const row = readTx(db, 'dmy');
    expect(row.date).toBe('20/05/2025');
    expect(row.purchaseDate).toBe('20/05/2025');
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('es idempotente: la segunda corrida no cambia nada', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp', { date: '2025-05-20', statementPeriod: '2025-08' });
    seedTx(db, 'man', { date: '2025-05-20', source: 'manual' });
    db.exec(V20!.up);
    const before = snapshot(db);
    rerunBackfill(db, V20!);
    expect(snapshot(db)).toEqual(before);
  });
});

describe('finance v21 — un resumen pendiente no tiene Pago Tarjeta', () => {
  function seed(db: Database.Database) {
    db.prepare("INSERT INTO finance_credit_cards (id, name, closing_day, created_at, updated_at) VALUES ('card', 'Visa', 25, ?, ?)").run(OLD_STAMP, OLD_STAMP);
    for (const id of ['tx-pend', 'tx-pend-usd', 'tx-paid']) {
      db.prepare(`
        INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, payment_method, source, impacts_balance, created_at, updated_at)
        VALUES (?, 'expense', 100, 'ARS', 'Pago Tarjeta', '', '2025-11-01', 'debit', 'manual', 1, ?, ?)
      `).run(id, OLD_STAMP, OLD_STAMP);
    }
    db.prepare(`
      INSERT INTO finance_credit_card_statements (id, credit_card_id, period_month, calculated_amount, status, transaction_id, transaction_id_usd, created_at, updated_at)
      VALUES ('s-pend', 'card', '2025-11', 100, 'pending', 'tx-pend', 'tx-pend-usd', ?, ?),
             ('s-paid', 'card', '2025-10', 100, 'paid', 'tx-paid', NULL, ?, ?)
    `).run(OLD_STAMP, OLD_STAMP, OLD_STAMP, OLD_STAMP);
  }

  it('existe, después de la v20', () => {
    expect(V21).toBeDefined();
    expect(financeMigrations.map((m) => m.version).slice(-2)).toEqual([20, 21]);
  });

  it('retira las transacciones del pendiente y conserva la del pagado', () => {
    const db = dbUpTo(20);
    seed(db);
    db.exec(V21!.up);
    expect(readTx(db, 'tx-pend').deletedAt).not.toBeNull();
    expect(readTx(db, 'tx-pend-usd').deletedAt).not.toBeNull();
    expect(readTx(db, 'tx-paid').deletedAt).toBeNull();
    const rows = db.prepare('SELECT id, transaction_id AS t, transaction_id_usd AS u FROM finance_credit_card_statements ORDER BY id').all();
    expect(rows).toEqual([{ id: 's-paid', t: 'tx-paid', u: null }, { id: 's-pend', t: null, u: null }]);
  });

  it('también es idempotente', () => {
    const db = dbUpTo(20);
    seed(db);
    db.exec(V21!.up);
    const before = snapshot(db);
    rerunBackfill(db, V21!);
    expect(snapshot(db)).toEqual(before);
  });
});
