/**
 * Un consumo en dólares se guardaba con dólares en un campo de pesos.
 *
 * En una línea USD del resumen Galicia la columna PESOS viene vacía y la última
 * columna es la de DÓLARES; el parser tomaba «el último monto de la línea» como
 * el importe en pesos, así que `amountARS === amountUSD` (medido: 5 de 5 filas
 * USD de los resúmenes reales). `importConfirm` copiaba eso a
 * `billed_amount_ars`, y `computeStatementTotals` lo sumaba al total EN PESOS
 * del resumen: 20 dólares entraban como 20 pesos y ensuciaban totales,
 * presupuestos y el reparto por categoría.
 *
 * La cotización aplicada NO está en el PDF (solo el texto legal que describe
 * cómo se calcula), así que la fila sigue guardando la cotización del día del
 * import marcada como `process` — aproximada y avisada con `~`, no inventada.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { parseGaliciaLine } from '../../../shared-logic/modules/finance-import.ipc';

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

const mappings = new Map<string, string>([['GOOGLE', 'Suscripciones'], ['RAPPI', 'Delivery']]);

describe('parseGaliciaLine — columnas de pesos y dólares', () => {
  it('una línea en dólares no deja un importe en pesos', () => {
    // Formato real (anonimizado): la última columna repite los dólares.
    const row = parseGaliciaLine('02-11-25 K GOOGLE *YouTubeP P1fMHM2Z USD        4,76 530613 4,76', mappings);
    expect(row).not.toBeNull();
    expect(row!.amountUSD).toBeCloseTo(4.76);
    expect(row!.amountARS).toBeUndefined();
    expect(row!.merchant).toBe('GOOGLE *YouTubeP');
  });

  it('una línea en pesos sigue igual', () => {
    const row = parseGaliciaLine('02-11-25 * RAPPIPRO 299493 7.999,00', mappings);
    expect(row!.amountARS).toBeCloseTo(7999);
    expect(row!.amountUSD).toBeUndefined();
  });

  it('si el resumen SÍ imprime la columna de pesos, se conserva', () => {
    // Defensivo: un importe en pesos de un consumo en dólares es siempre mayor
    // que el importe en dólares — nunca igual.
    const row = parseGaliciaLine('02-11-25 K GOOGLE *YouTubeP P1fMHM2Z USD        4,76 530613 6.850,00', mappings);
    expect(row!.amountUSD).toBeCloseTo(4.76);
    expect(row!.amountARS).toBeCloseTo(6850);
  });
});

describe('finance:importConfirm — un consumo en dólares no ensucia los pesos', () => {
  let cardId: string;

  beforeEach(async () => {
    harness.db = setupDb();
    cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: 25 });
  });

  const usdRow = parseGaliciaLine('02-11-25 K GOOGLE *YouTubeP P1fMHM2Z USD        4,76 530613 4,76', mappings)!;
  const arsRow = parseGaliciaLine('02-11-25 * RAPPIPRO 299493 7.999,00', mappings)!;

  it('guarda la fila como USD y sin importe en pesos', async () => {
    await invoke('finance:importConfirm', [usdRow], '2025-11', 'noviembre.pdf', cardId);
    const row = harness.db.prepare(
      `SELECT amount, currency, billed_amount_ars AS billedAmountArs, fx_rate_source AS fxRateSource
       FROM finance_transactions WHERE deleted_at IS NULL`,
    ).get() as { amount: number; currency: string; billedAmountArs: number | null; fxRateSource: string | null };

    expect(row.currency).toBe('USD');
    expect(row.amount).toBeCloseTo(4.76);
    expect(row.billedAmountArs).toBeNull();
  });

  it('el resumen concilia: los dólares van al total en dólares, no al de pesos', async () => {
    await invoke('finance:importConfirm', [usdRow, arsRow], '2025-11', 'noviembre.pdf', cardId);
    const statementId = await invoke<string | null>('finance:generateStatement', cardId, '2025-11');
    expect(statementId).not.toBeNull();

    const detail = await invoke<{ statement: { calculatedAmount: number; calculatedAmountUsd: number } }>(
      'finance:getStatementDetail', statementId!,
    );
    expect(detail.statement.calculatedAmount).toBeCloseTo(7999);
    expect(detail.statement.calculatedAmountUsd).toBeCloseTo(4.76);
  });
});
