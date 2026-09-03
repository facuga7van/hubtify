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
  installments?: number;
  installmentGroupId?: string;
}) {
  seq += 1;
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       installments, installment_group_id, for_third_party, impacts_balance, account_id, created_at, updated_at)
    VALUES (?, ?, 1000, ?, ?, 'x', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
  `).run(
    `tx-${seq}`,
    fields.type ?? 'expense',
    fields.currency ?? 'ARS',
    fields.category ?? 'Compras',
    fields.date ?? `2026-01-${String(seq).padStart(2, '0')}`,
    fields.paymentMethod,
    fields.source ?? 'manual',
    fields.installments ?? 1,
    fields.installmentGroupId ?? null,
    fields.accountId ?? null,
    `2026-01-01T00:00:0${seq % 10}Z`,
    `2026-01-01T00:00:0${seq % 10}Z`,
  );
}

/** Un plan en cuotas: N filas que comparten `installment_group_id`. */
function addPlan(groupId: string, paymentMethod: string, count = 6, date = '2026-01-03') {
  for (let i = 0; i < count; i++) {
    addTx({ paymentMethod, installments: count, installmentGroupId: groupId, date });
  }
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

/**
 * La categoría también sale del historial.
 *
 * En la base real es un caso degenerado y vale decirlo: **58 de las 60 altas
 * manuales de gasto están en «Otros»** (las 2 restantes son «Pago Tarjeta», que
 * escribe la app). O sea que el `'Otros'` hardcodeado acierta hoy por accidente.
 * Lo que cambia es que deja de ser una constante: el día que la persona empiece
 * a separar «Comida» de «Transporte», el formulario la sigue en vez de obligarla
 * a corregir el mismo select para siempre.
 */
describe('getEntryDefaults — categoría', () => {
  it('sin historial cae en «Otros»', () => {
    expect(defaults().category).toBe('Otros');
  });

  it('devuelve la categoría más usada de las altas manuales', () => {
    for (let i = 0; i < 3; i++) addTx({ paymentMethod: 'transfer', category: 'Comida' });
    addTx({ paymentMethod: 'transfer', category: 'Transporte' });
    expect(defaults().category).toBe('Comida');
  });

  it('nunca propone una categoría reservada, aunque sea la más frecuente', () => {
    // «Pago Tarjeta» y «Transferencia» las escribe la app: cargarles un gasto a
    // mano corrompe un número que se lee en otro lado.
    for (let i = 0; i < 10; i++) addTx({ paymentMethod: 'debit', category: 'Pago Tarjeta' });
    addTx({ paymentMethod: 'transfer', category: 'Comida' });
    expect(defaults().category).toBe('Comida');
  });
});

/**
 * El medio de pago de un PLAN EN CUOTAS es otra pregunta que la de un gasto suelto.
 *
 * En la base real hay 4 planes cargados a mano: **3 con tarjeta y 1 por
 * transferencia. Cero en débito** — que es exactamente con lo que arrancaba
 * `InstallmentAddForm` (`paymentMethod: 'debit'`, constante). La moda general de
 * los gastos sueltos tampoco sirve acá: da `transfer` (40 de 60), que es el
 * plan minoritario.
 */
describe('getEntryDefaults — plan en cuotas', () => {
  it('sin historial de planes cae en tarjeta, no en débito', () => {
    expect(defaults()).toMatchObject({ installmentPaymentMethod: 'credit_card', installmentSampleSize: 0 });
  });

  it('cuenta PLANES, no filas: un plan de 36 cuotas no le gana a tres de 6', () => {
    addPlan('g1', 'transfer', 36, '2026-02-01');
    addPlan('g2', 'credit_card', 6, '2026-01-03');
    addPlan('g3', 'credit_card', 6, '2026-03-03');
    addPlan('g4', 'credit_card', 6, '2026-07-08');
    expect(defaults()).toMatchObject({ installmentPaymentMethod: 'credit_card', installmentSampleSize: 4 });
  });

  it('respeta un historial de planes que no son con tarjeta', () => {
    addPlan('g1', 'transfer', 3);
    addPlan('g2', 'transfer', 3);
    addPlan('g3', 'credit_card', 3);
    expect(defaults().installmentPaymentMethod).toBe('transfer');
  });

  it('no confunde el plan con el gasto suelto', () => {
    // 20 transferencias sueltas no dicen nada sobre cómo se financia una compra.
    for (let i = 0; i < 20; i++) addTx({ paymentMethod: 'transfer' });
    addPlan('g1', 'credit_card', 6);
    const d = defaults();
    expect(d.paymentMethod).toBe('transfer');
    expect(d.installmentPaymentMethod).toBe('credit_card');
  });

  it('ignora los planes importados del resumen: no los eligió nadie', () => {
    addPlan('g1', 'credit_card', 6);
    for (let i = 0; i < 12; i++) {
      addTx({ paymentMethod: 'debit', source: 'import', installments: 12, installmentGroupId: 'g-import' });
    }
    expect(defaults()).toMatchObject({ installmentPaymentMethod: 'credit_card', installmentSampleSize: 1 });
  });
});
