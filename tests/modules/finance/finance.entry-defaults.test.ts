/**
 * El default del alta manual deja de ser una constante.
 *
 * Evidencia de la base real (auditoría §5): 41 altas manuales por
 * transferencia, 18 con tarjeta, 2 con débito y **cero en efectivo** — contra un
 * formulario que arrancaba en `cash`. Cada alta empezaba corrigiendo el medio de
 * pago. Las 17 filas `cash` de la base las escribió el generador de recurrentes,
 * que hardcodeaba el valor: aprender de ellas sería aprender del propio bug.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { getEntryDefaults, FALLBACK_PAYMENT_METHOD } from '../../../shared-logic/modules/finance-defaults';
import { RESERVED_CATEGORIES } from '../../../shared-logic/modules/finance.balance';

let db: Database.Database;
let seq = 0;

function setupDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  for (const m of financeMigrations) d.exec(m.up);
  return d;
}

function addTx(fields: {
  paymentMethod: string;
  source?: string;
  type?: string;
  category?: string;
  currency?: string;
  accountId?: string | null;
  date?: string;
}) {
  seq += 1;
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       installments, for_third_party, impacts_balance, account_id, created_at, updated_at)
    VALUES (?, ?, 1000, ?, ?, 'x', ?, ?, ?, 1, 0, 1, ?, ?, ?)
  `).run(
    `tx-${seq}`,
    fields.type ?? 'expense',
    fields.currency ?? 'ARS',
    fields.category ?? 'Compras',
    fields.date ?? `2026-01-${String(seq).padStart(2, '0')}`,
    fields.paymentMethod,
    fields.source ?? 'manual',
    fields.accountId ?? null,
    `2026-01-01T00:00:0${seq % 10}Z`,
    `2026-01-01T00:00:0${seq % 10}Z`,
  );
}

const defaults = () => getEntryDefaults(db, RESERVED_CATEGORIES);

beforeEach(() => { db = setupDb(); seq = 0; });

describe('getEntryDefaults', () => {
  it('con cero historial cae en transferencia, no en efectivo', () => {
    // Decisión de producto explícita: el denominador común argentino es digital.
    expect(FALLBACK_PAYMENT_METHOD).toBe('transfer');
    expect(defaults()).toMatchObject({ paymentMethod: 'transfer', currency: 'ARS', sampleSize: 0 });
  });

  it('devuelve la moda de las altas manuales', () => {
    addTx({ paymentMethod: 'transfer' });
    addTx({ paymentMethod: 'transfer' });
    addTx({ paymentMethod: 'transfer' });
    addTx({ paymentMethod: 'credit_card' });
    expect(defaults().paymentMethod).toBe('transfer');
  });

  it('ignora las filas que escribió la app y no una persona', () => {
    // El generador de recurrentes hardcodeaba 'cash': si contaran, el default
    // fantasma se reaprendería solo, para siempre.
    for (let i = 0; i < 20; i++) addTx({ paymentMethod: 'cash', source: 'recurring' });
    for (let i = 0; i < 20; i++) addTx({ paymentMethod: 'credit_card', source: 'import' });
    addTx({ paymentMethod: 'transfer' });
    expect(defaults()).toMatchObject({ paymentMethod: 'transfer', sampleSize: 1 });
  });

  it('ignora las categorías reservadas', () => {
    for (let i = 0; i < 5; i++) addTx({ paymentMethod: 'debit', category: 'Pago Tarjeta' });
    for (let i = 0; i < 5; i++) addTx({ paymentMethod: 'debit', category: 'Transferencia' });
    addTx({ paymentMethod: 'transfer' });
    expect(defaults().paymentMethod).toBe('transfer');
  });

  it('ignora los ingresos: tienen otra forma y no son lo que se está por cargar', () => {
    for (let i = 0; i < 5; i++) addTx({ paymentMethod: 'transfer', type: 'income' });
    addTx({ paymentMethod: 'cash' });
    expect(defaults().paymentMethod).toBe('cash');
  });

  it('propone la cuenta más usada CON ese medio de pago', () => {
    addTx({ paymentMethod: 'transfer', accountId: 'cuenta-banco' });
    addTx({ paymentMethod: 'transfer', accountId: 'cuenta-banco' });
    addTx({ paymentMethod: 'cash', accountId: 'cuenta-efectivo' });
    expect(defaults()).toMatchObject({ paymentMethod: 'transfer', accountId: 'cuenta-banco' });
  });

  it('no propone cuenta si nunca se eligió ninguna — el caso real de hoy', () => {
    // account_id está en NULL en las 107 filas de la base del usuario.
    addTx({ paymentMethod: 'transfer' });
    expect(defaults().accountId).toBeNull();
  });

  it('descarta un medio de pago que no existe en vez de proponerlo', () => {
    addTx({ paymentMethod: 'cripto-magica' });
    addTx({ paymentMethod: 'cripto-magica' });
    expect(defaults().paymentMethod).toBe('transfer');
  });

  it('con empate gana el más reciente', () => {
    addTx({ paymentMethod: 'cash', date: '2026-01-01' });
    addTx({ paymentMethod: 'transfer', date: '2026-01-02' });
    expect(defaults().paymentMethod).toBe('transfer');
  });

  it('aprende la moneda igual que el medio', () => {
    addTx({ paymentMethod: 'transfer', currency: 'USD' });
    addTx({ paymentMethod: 'transfer', currency: 'USD' });
    addTx({ paymentMethod: 'transfer', currency: 'ARS' });
    expect(defaults().currency).toBe('USD');
  });
});
