/**
 * El libro mayor y la pestaña Cuotas cargan LA MISMA compra en cuotas y hasta
 * ahora escribían filas distintas.
 *
 * 1. `Transactions.tsx` llamaba a `finance:createInstallmentGroup` SIN
 *    `paymentMethod`, así que el handler evaluaba
 *    `isCreditCard = paymentMethod === 'credit_card' && !!creditCardId` en
 *    `false`: el plan quedaba con `credit_card_id = NULL`, `impacts_balance = 1`
 *    y arrancaba el mes de la compra en vez del siguiente. Descontaba del saldo
 *    y no llegaba a ningún resumen.
 * 2. El campo se rotulaba «Monto» pero se interpretaba como el monto DE LA
 *    CUOTA: quien tipeaba el precio de vidriera generaba un plan N veces más
 *    grande, sin aviso.
 *
 * La construcción del payload vive ahora en un solo lugar
 * (`utils/installment-payload.ts`) y se prueba acá contra el handler real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  resolveInstallmentAmounts,
  buildInstallmentGroupPayload,
} from '@modules/finance/utils/installment-payload';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

import { getHandler } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../shared-logic/modules/finance.ipc');
registerFinanceIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

let cardId: string;

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: 25 });
});

describe('resolveInstallmentAmounts', () => {
  it('en modo cuota toma lo tipeado como el precio de cada cuota', () => {
    expect(resolveInstallmentAmounts(75_000, 12, 'installment')).toEqual({
      installmentAmount: 75_000,
      totalAmount: 900_000,
    });
  });

  it('en modo total reparte y la última cuota absorbe el redondeo', () => {
    const r = resolveInstallmentAmounts(100_000, 3, 'total');
    expect(r.installmentAmount).toBeCloseTo(33_333.33);
    expect(r.installmentAmounts).toEqual([33_333.33, 33_333.33, 33_333.34]);
    // La suma tiene que dar EXACTAMENTE el total tipeado.
    expect(r.installmentAmounts!.reduce((a, b) => a + b, 0)).toBeCloseTo(100_000);
    expect(r.totalAmount).toBeCloseTo(100_000);
  });

  it('no manda la lista cuando el reparto es exacto', () => {
    expect(resolveInstallmentAmounts(900_000, 12, 'total').installmentAmounts).toBeUndefined();
  });

  it('devuelve null con datos inválidos en vez de inventar un plan', () => {
    expect(resolveInstallmentAmounts(0, 12, 'total')).toBeNull();
    expect(resolveInstallmentAmounts(100, 0, 'installment')).toBeNull();
    expect(resolveInstallmentAmounts(Number.NaN, 3, 'total')).toBeNull();
  });
});

describe('finance:createInstallmentGroup desde el libro mayor', () => {
  const base = {
    description: 'Heladera',
    category: 'Compras',
    currency: 'ARS' as const,
    date: '2026-03-10',
    paymentMethod: 'credit_card' as const,
    installments: 12,
  };

  it('manda el medio de pago, así el plan queda en la tarjeta y fuera del saldo', async () => {
    const payload = buildInstallmentGroupPayload({ ...base, creditCardId: cardId, amount: 75_000, amountMode: 'installment' });
    expect(payload.paymentMethod).toBe('credit_card');

    const groupId = await invoke<string>('finance:createInstallmentGroup', payload);
    expect(typeof groupId).toBe('string');

    const rows = harness.db.prepare(
      `SELECT date, amount, credit_card_id AS creditCardId, impacts_balance AS impactsBalance,
              payment_method AS paymentMethod, account_id AS accountId
       FROM finance_transactions WHERE installment_group_id = ? ORDER BY installment_number`,
    ).all(groupId) as Array<{
      date: string; amount: number; creditCardId: string | null;
      impactsBalance: number; paymentMethod: string; accountId: string | null;
    }>;

    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.creditCardId).toBe(cardId);
      expect(row.impactsBalance).toBe(0);
      expect(row.paymentMethod).toBe('credit_card');
      expect(row.accountId).toBeNull();
    }
    // Una compra con tarjeta cae en el resumen del mes SIGUIENTE.
    expect(rows[0].date).toBe('2026-04-10');
  });

  it('en modo total no multiplica: 900.000 en 12 son cuotas de 75.000', async () => {
    const payload = buildInstallmentGroupPayload({ ...base, creditCardId: cardId, amount: 900_000, amountMode: 'total' });
    expect(payload.totalAmount).toBeCloseTo(900_000);
    expect(payload.installmentAmount).toBeCloseTo(75_000);

    const groupId = await invoke<string>('finance:createInstallmentGroup', payload);
    const group = harness.db
      .prepare('SELECT total_amount AS totalAmount FROM finance_installment_groups WHERE id = ?')
      .get(groupId) as { totalAmount: number };
    expect(group.totalAmount).toBeCloseTo(900_000);

    const sum = harness.db
      .prepare('SELECT SUM(amount) AS s FROM finance_transactions WHERE installment_group_id = ?')
      .get(groupId) as { s: number };
    expect(sum.s).toBeCloseTo(900_000);
  });

  it('un plan sin tarjeta sigue saliendo de una cuenta y tocando el saldo', async () => {
    const payload = buildInstallmentGroupPayload({
      ...base, paymentMethod: 'debit', amount: 5_000, amountMode: 'installment', installments: 3,
    });
    expect(payload.paymentMethod).toBe('debit');
    expect(payload.creditCardId).toBeUndefined();

    const groupId = await invoke<string>('finance:createInstallmentGroup', payload);
    const rows = harness.db.prepare(
      `SELECT date, credit_card_id AS creditCardId, impacts_balance AS impactsBalance
       FROM finance_transactions WHERE installment_group_id = ? ORDER BY installment_number`,
    ).all(groupId) as Array<{ date: string; creditCardId: string | null; impactsBalance: number }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.creditCardId === null && r.impactsBalance === 1)).toBe(true);
    // Sin tarjeta no hay diferimiento: arranca el mes de la compra.
    expect(rows[0].date).toBe('2026-03-10');
  });
});
