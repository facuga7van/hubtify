/**
 * Migración finance v20 (spec 2026-09-05-coinify-integridad):
 *  - `purchase_date`: la fecha de COMPRA que imprime el papel. `date` pasa a
 *    vivir en el mes del resumen (invariante 1).
 *  - v21: un resumen pendiente no tiene «Pago Tarjeta» (invariante 6): las que
 *    generó la versión anterior se retiran (Task 8).
 *
 * Cada migración se corre sobre una base migrada hasta la anterior con filas
 * sembradas por SQL, que es exactamente lo que va a pasar en cada dispositivo.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import type { Migration } from '../../../shared/types';

const V20 = financeMigrations.find((m) => m.version === 20);

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
