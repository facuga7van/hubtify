/**
 * C3 / C4 — dos líneas con la misma clave de plan en UN resumen.
 *
 * La identidad del plan es (comercio, fecha de compra, moneda, total de cuotas,
 * tarjeta) y NO cambia: el banco ajusta montos entre resúmenes, así que el
 * monto no puede ser identidad. Lo que fijan estos tests:
 *
 * - Invariante 2: un plan absorbe a lo sumo UNA línea por resumen. Dos
 *   artículos distintos de la misma tienda el mismo día (C3) o dos unidades
 *   del mismo artículo (C4) son dos planes.
 * - Invariante 3: entre planes con la misma clave, la línea va al de monto
 *   más cercano. El monto desempata, no identifica.
 * - `findInstallment` nunca materializa sobre una fila de este mismo lote.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { todayDateString } from '../../../shared/date-utils';
import { addMonthsToMonth } from '../../../shared-logic/modules/finance.balance';

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

const LINE = {
  date: '2025-05-20',
  merchant: 'TIENDA MUEBLES',
  installmentCurrent: 1,
  installmentTotal: 3,
  amountARS: 10_000,
  isExcluded: false,
  suggestedCategory: 'Compras',
};

function plans() {
  return harness.db.prepare(
    `SELECT id, total_amount AS totalAmount, category FROM finance_installment_groups
      WHERE deleted_at IS NULL ORDER BY total_amount ASC`,
  ).all() as Array<{ id: string; totalAmount: number; category: string }>;
}

function liveRows(groupId?: string) {
  const where = groupId ? 'AND installment_group_id = ?' : '';
  return harness.db.prepare(
    `SELECT installment_number AS n, date, amount, category, installment_group_id AS groupId,
            import_batch_id AS batchId
       FROM finance_transactions WHERE deleted_at IS NULL ${where}
      ORDER BY installment_group_id, installment_number`,
  ).all(...(groupId ? [groupId] : [])) as Array<{
    n: number | null; date: string; amount: number; category: string; groupId: string | null; batchId: string | null;
  }>;
}

async function monthTotal(month: string): Promise<number> {
  const rows = await invoke<Array<{ amount: number }>>('finance:getInstallmentsForMonth', month);
  return rows.reduce((acc, r) => acc + r.amount, 0);
}

describe('C3 — dos artículos distintos de la misma tienda, mismo día, misma cuota N/M', () => {
  it('son dos planes: un plan absorbe a lo sumo una línea por resumen', async () => {
    const cheap = LINE;
    const dear = { ...LINE, amountARS: 20_000 };
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [cheap, dear], '2025-08', 'agosto.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(res.duplicateCount).toBe(0);

    const found = plans();
    expect(found.map((p) => p.totalAmount)).toEqual([30_000, 60_000]);
    // Total del mes del resumen = las dos cuotas 1/3; proyección total = 90.000.
    expect(await monthTotal('2025-08')).toBe(30_000);
    expect(liveRows().reduce((acc, r) => acc + r.amount, 0)).toBe(90_000);
  });

  it('el resumen siguiente manda cada cuota 2 a SU plan, por cercanía de monto', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE, amountARS: 20_000 }], '2025-08', 'agosto.pdf', cardId);
    const [planA, planB] = plans(); // 30.000 (10.000 × 3) y 60.000 (20.000 × 3)

    // El banco ajustó: 10.100 y 20.200. Y llegan en orden inverso a propósito:
    // el desempate es por monto, no por posición en el PDF.
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm',
      [{ ...LINE, installmentCurrent: 2, amountARS: 20_200 }, { ...LINE, installmentCurrent: 2, amountARS: 10_100 }],
      '2025-09', 'septiembre.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(res.duplicateCount).toBe(0);
    expect(plans()).toHaveLength(2);

    expect(liveRows(planA.id).map((r) => [r.n, r.amount])).toEqual([[1, 10_000], [2, 10_100], [3, 10_000]]);
    expect(liveRows(planB.id).map((r) => [r.n, r.amount])).toEqual([[1, 20_000], [2, 20_200], [3, 20_000]]);
  });

  it('resúmenes desordenados: una cuota que el plan no proyectó desempata por el promedio del plan', async () => {
    // Agosto trae la cuota 3/6 de los dos artículos: cada plan nace con 3..6 y
    // SIN las cuotas 1 y 2 (las pasadas no se inventan). No hay «cuota n
    // proyectada» contra la cual comparar la línea 1/6 → cae al promedio.
    const third = { ...LINE, installmentTotal: 6, installmentCurrent: 3 };
    await invoke('finance:importConfirm', [third, { ...third, amountARS: 20_000 }], '2025-08', 'agosto.pdf', cardId);
    const [planA, planB] = plans(); // 60.000 (10.000 × 6) y 120.000 (20.000 × 6)
    expect(liveRows(planA.id).map((r) => r.n)).toEqual([3, 4, 5, 6]);
    expect(liveRows(planB.id).map((r) => r.n)).toEqual([3, 4, 5, 6]);

    // Después aparece junio con las cuotas 1/6, invertidas a propósito.
    const first = { ...LINE, installmentTotal: 6, installmentCurrent: 1 };
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [{ ...first, amountARS: 20_000 }, first], '2025-06', 'junio.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(res.duplicateCount).toBe(0);
    expect(plans()).toHaveLength(2);

    // Cada cuota 1 cayó en su plan (promedio 10.000 vs 20.000) y proyectó la 2
    // que faltaba, sin volver a escribir la 3..6 que ya existían.
    expect(liveRows(planA.id).map((r) => [r.n, r.amount]))
      .toEqual([[1, 10_000], [2, 10_000], [3, 10_000], [4, 10_000], [5, 10_000], [6, 10_000]]);
    expect(liveRows(planB.id).map((r) => [r.n, r.amount]))
      .toEqual([[1, 20_000], [2, 20_000], [3, 20_000], [4, 20_000], [5, 20_000], [6, 20_000]]);
  });
});

describe('C4 — dos unidades del mismo artículo', () => {
  it('dos líneas idénticas en un PDF son dos planes y dos filas en el mes', async () => {
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(plans()).toHaveLength(2);
    expect(await invoke('finance:getInstallmentsForMonth', '2025-08')).toHaveLength(2);
    // Cada plan tiene sus 3 cuotas: nadie materializó sobre una fila de este mismo lote.
    for (const p of plans()) expect(liveRows(p.id).map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('reimportar el mismo PDF sigue sin duplicar', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId);
    const again = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId,
    );
    expect(again.count).toBe(0);
    expect(again.duplicateCount).toBe(2);
    expect(plans()).toHaveLength(2);
  });

  it('el resumen siguiente materializa la cuota 2 de CADA plan', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId);
    const second = { ...LINE, installmentCurrent: 2 };
    const res = await invoke<{ count: number }>(
      'finance:importConfirm', [second, { ...second }], '2025-09', 'septiembre.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(plans()).toHaveLength(2);
    expect(liveRows()).toHaveLength(6);
    // Las dos cuotas 2 quedaron marcadas con el lote de septiembre, una por plan.
    const sept = liveRows().filter((r) => r.n === 2);
    expect(new Set(sept.map((r) => r.groupId)).size).toBe(2);
    expect(new Set(sept.map((r) => r.batchId)).size).toBe(1);
  });
});

describe('C6 — sin tarjeta, la proyección se ancla en el mes del resumen', () => {
  const CUOTA_3_DE_12 = { ...LINE, installmentCurrent: 3, installmentTotal: 12, amountARS: 25_000 };

  it('con statementMonth, las proyectadas arrancan el mes siguiente al resumen', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', null);
    const rows = liveRows();
    expect(rows.map((r) => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // La importada sin tarjeta impacta en su fecha de compra (decisión explícita de la spec).
    expect(rows[0].date).toBe('2025-05-20');
    expect(rows[1].date).toBe('2025-09-20');
    expect(rows.slice(1).every((r) => r.date >= '2025-09-01')).toBe(true);
  });

  it('sin statementMonth válido, el ancla es el mes actual', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '', 'suelto.pdf', null);
    const rows = liveRows();
    const nextMonth = addMonthsToMonth(todayDateString().slice(0, 7), 1);
    expect(rows[1].date.slice(0, 7)).toBe(nextMonth);
  });
});
