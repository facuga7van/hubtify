/**
 * El parser detectaba «CUOTA N/M» y `importConfirm` tiraba el dato: escribía una
 * fila plana sin `installment_group_id`. Como la pestaña Cuotas y la proyección
 * hacen `JOIN finance_installment_groups`, una compra importada en 12 cuotas no
 * existía para ninguna de las dos, y las cuotas que faltaban no se creaban hasta
 * que llegara el próximo resumen.
 *
 * Ahora el import crea el plan y engancha la fila. Reglas que fijan estos tests:
 *
 * - Se generan las cuotas FUTURAS (N+1..M), nunca las pasadas: una cuota vieja
 *   ya está en un resumen cerrado (o nunca se importó) y escribirla ahora movería
 *   saldos y resúmenes del pasado.
 * - Reimportar el mismo resumen no duplica: la identidad del plan es
 *   (comercio, fecha de compra, moneda, total de cuotas, tarjeta), estable
 *   porque Galicia imprime la fecha ORIGINAL de la compra en cada cuota.
 * - El resumen siguiente MATERIALIZA la cuota proyectada en vez de agregar otra.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

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
const { registerFinanceImportIpcHandlers } = await import('../../../shared-logic/modules/finance-import.ipc');

registerFinanceIpcHandlers();
registerFinanceImportIpcHandlers();

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

/** Una compra en 12 cuotas, hecha en mayo, que aparece como 3/12 en el resumen de agosto. */
const CUOTA_3_DE_12 = {
  date: '2025-05-20',
  merchant: 'TIENDA MUEBLES',
  installmentCurrent: 3,
  installmentTotal: 12,
  amountARS: 25_000,
  isExcluded: false,
  suggestedCategory: 'Compras',
};

const CONTADO = {
  date: '2025-08-04',
  merchant: 'RAPPIPRO',
  amountARS: 8_000,
  isExcluded: false,
  suggestedCategory: 'Delivery',
};

function plans() {
  return harness.db.prepare(
    `SELECT id, description, total_amount AS totalAmount, currency,
            total_installments AS totalInstallments, category, date
     FROM finance_installment_groups WHERE deleted_at IS NULL`,
  ).all() as Array<{
    id: string; description: string; totalAmount: number; currency: string;
    totalInstallments: number; category: string; date: string;
  }>;
}

function planRows(groupId: string) {
  return harness.db.prepare(
    `SELECT installment_number AS n, date, amount, statement_period AS statementPeriod,
            credit_card_id AS creditCardId, impacts_balance AS impactsBalance,
            payment_method AS paymentMethod, source, import_batch_id AS batchId
     FROM finance_transactions WHERE installment_group_id = ? AND deleted_at IS NULL
     ORDER BY installment_number`,
  ).all(groupId) as Array<{
    n: number; date: string; amount: number; statementPeriod: string | null;
    creditCardId: string | null; impactsBalance: number; paymentMethod: string;
    source: string; batchId: string | null;
  }>;
}

describe('finance:importConfirm — cuotas del resumen', () => {
  it('crea el plan de 12 cuotas y deja la fila importada marcada en la 3', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);

    const [plan] = plans();
    expect(plan).toBeDefined();
    expect(plan.totalInstallments).toBe(12);
    expect(plan.description).toBe('TIENDA MUEBLES');
    expect(plan.currency).toBe('ARS');
    expect(plan.category).toBe('Compras');
    // El plan arranca en la fecha ORIGINAL de la compra, que es lo que imprime
    // el banco en cada cuota — la única clave estable entre resúmenes.
    expect(plan.date).toBe('2025-05-20');
    expect(plan.totalAmount).toBeCloseTo(300_000);

    const rows = planRows(plan.id);
    // La cuota 3 (la importada) + las 9 futuras. Las 2 pasadas no se inventan.
    expect(rows.map((r) => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const imported = rows[0];
    expect(imported.date).toBe('2025-05-20');
    expect(imported.statementPeriod).toBe('2025-08');

    // Cada cuota futura cae en el resumen del mes siguiente al anterior.
    expect(rows[1].statementPeriod).toBe('2025-09');
    expect(rows[1].date).toBe('2025-09-20');
    expect(rows[9].statementPeriod).toBe('2026-05');

    for (const row of rows) {
      expect(row.creditCardId).toBe(cardId);
      expect(row.impactsBalance).toBe(0);
      expect(row.paymentMethod).toBe('credit_card');
      expect(row.amount).toBeCloseTo(25_000);
    }
  });

  it('la compra en cuotas ya aparece en la pestaña Cuotas y en la proyección', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);

    const octubre = await invoke<Array<{ installmentNumber: number; installmentCount: number }>>(
      'finance:getInstallmentsForMonth', '2025-10',
    );
    expect(octubre).toHaveLength(1);
    expect(octubre[0].installmentNumber).toBe(5);
    expect(octubre[0].installmentCount).toBe(12);
  });

  it('reimportar el mismo resumen no duplica el plan ni las cuotas', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);
    const first = plans();

    const again = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId,
    );
    expect(again.duplicateCount).toBe(1);
    expect(again.count).toBe(0);

    const after = plans();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id);
    expect(planRows(after[0].id)).toHaveLength(10);
  });

  it('el resumen siguiente materializa la cuota proyectada en vez de agregar otra', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);
    const [plan] = plans();

    const septiembre = { ...CUOTA_3_DE_12, installmentCurrent: 4, amountARS: 25_400 };
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [septiembre], '2025-09', 'septiembre.pdf', cardId,
    );
    expect(res.duplicateCount).toBe(0);
    expect(res.count).toBe(1);

    expect(plans()).toHaveLength(1);
    const rows = planRows(plan.id);
    expect(rows.map((r) => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // La cuota 4 pasó de proyectada a real: monto del papel y fecha de compra.
    const cuatro = rows.find((r) => r.n === 4)!;
    expect(cuatro.amount).toBeCloseTo(25_400);
    expect(cuatro.date).toBe('2025-05-20');
    expect(cuatro.statementPeriod).toBe('2025-09');
  });

  it('una compra sin cuotas sigue siendo una transacción suelta', async () => {
    await invoke('finance:importConfirm', [CONTADO], '2025-08', 'agosto.pdf', cardId);
    expect(plans()).toHaveLength(0);

    const row = harness.db
      .prepare(`SELECT installment_group_id AS g, installments FROM finance_transactions WHERE deleted_at IS NULL`)
      .get() as { g: string | null; installments: number };
    expect(row.g).toBeNull();
    expect(row.installments).toBe(1);
  });

  it('revertir la importación se lleva el plan que creó', async () => {
    const res = await invoke<{ batchId: string }>(
      'finance:importConfirm', [CUOTA_3_DE_12, CONTADO], '2025-08', 'agosto.pdf', cardId,
    );
    expect(plans()).toHaveLength(1);

    await invoke('finance:undoImportBatch', res.batchId);

    expect(plans()).toHaveLength(0);
    const live = harness.db
      .prepare('SELECT COUNT(*) AS c FROM finance_transactions WHERE deleted_at IS NULL')
      .get() as { c: number };
    expect(live.c).toBe(0);
  });

  it('sin tarjeta el plan sigue existiendo, con las cuotas saliendo del saldo', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', null);
    const [plan] = plans();
    expect(plan.totalInstallments).toBe(12);

    const rows = planRows(plan.id);
    expect(rows.map((r) => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const row of rows) {
      expect(row.creditCardId).toBeNull();
      expect(row.impactsBalance).toBe(1);
      expect(row.statementPeriod).toBeNull();
    }
  });

  it('una cuota disparatada no genera un plan: la fila entra suelta', async () => {
    const roto = { ...CUOTA_3_DE_12, installmentCurrent: 13, installmentTotal: 12 };
    await invoke('finance:importConfirm', [roto], '2025-08', 'agosto.pdf', cardId);
    expect(plans()).toHaveLength(0);
    const row = harness.db
      .prepare('SELECT installment_group_id AS g FROM finance_transactions WHERE deleted_at IS NULL')
      .get() as { g: string | null };
    expect(row.g).toBeNull();
  });
});
