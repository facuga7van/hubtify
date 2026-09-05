/**
 * C8/C9 (spec 2026-09-05-coinify-integridad, invariante 6): el «Pago Tarjeta»
 * existe SOLO cuando el resumen está pagado, fechado el día del pago.
 *
 * Antes, generar el resumen insertaba la transacción con `date = {period}-01`
 * e `impacts_balance = 1`: el balance del mes bajaba antes de pagar nada, y
 * pagar en diciembre un resumen de noviembre restaba en noviembre.
 *
 * Drives the real handlers (mocked `electron` + injected DB).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  CARD_PAYMENT_CATEGORY,
  computeAccountsOverview,
  computeMonthlyBalance,
} from '../../../shared-logic/modules/finance.balance';
import { todayDateString } from '../../../shared/date-utils';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

import { getHandler } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
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
  db.prepare(`INSERT OR REPLACE INTO dollar_cache (id, data, updated_at) VALUES ('rates', ?, datetime('now'))`)
    .run(JSON.stringify([{ casa: 'blue', nombre: 'Blue', compra: 990, venta: 1000 }]));
  return db;
}

let cardId: string;

async function purchase(date: string, amount: number, currency = 'ARS'): Promise<void> {
  await invoke('finance:addTransaction', {
    type: 'expense', amount, currency, category: 'Compras', description: 'compra',
    date, paymentMethod: 'credit_card', creditCardId: cardId,
  });
}

function payments() {
  return harness.db.prepare(`
    SELECT id, amount, currency, date, impacts_balance AS impactsBalance, fx_rate AS fxRate,
           fx_rate_source AS fxRateSource, account_id AS accountId
    FROM finance_transactions WHERE category = ? AND deleted_at IS NULL ORDER BY currency
  `).all(CARD_PAYMENT_CATEGORY) as Array<{
    id: string; amount: number; currency: string; date: string; impactsBalance: number;
    fxRate: number | null; fxRateSource: string | null; accountId: string | null;
  }>;
}

function statementRow(id: string) {
  return harness.db.prepare(`
    SELECT status, paid_date AS paidDate, paid_amount AS paidAmount,
           transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
    FROM finance_credit_card_statements WHERE id = ?
  `).get(id) as { status: string; paidDate: string | null; paidAmount: number | null; transactionId: string | null; transactionIdUsd: string | null };
}

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
});

describe('C8/C9 — el Pago Tarjeta existe solo cuando el resumen está pagado', () => {
  it('generar un resumen no crea transacción ni toca el saldo', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    expect(statementRow(id)).toMatchObject({ status: 'pending', transactionId: null, transactionIdUsd: null });
    expect(payments()).toHaveLength(0);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
  });

  it('pagar con fecha: la transacción cae ese día, con cuenta y cotización; diciembre baja, noviembre no', async () => {
    const banco = await invoke<{ id: string }>('finance:saveAccount', { name: 'Banco', kind: 'bank', initialBalance: 100_000 });
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');

    expect(await invoke('finance:payStatement', id, 15_000, 0, banco.id, '2025-12-10')).toEqual({ ok: true });

    const [pago] = payments();
    expect(pago).toMatchObject({ amount: 15_000, currency: 'ARS', date: '2025-12-10', impactsBalance: 1, accountId: banco.id, fxRate: 1000, fxRateSource: 'process' });
    expect(statementRow(id)).toMatchObject({ status: 'paid', paidDate: '2025-12-10', paidAmount: 15_000, transactionId: pago.id });
    expect(computeMonthlyBalance(harness.db, '2025-12').ARS.expenses).toBe(15_000);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
    expect(computeAccountsOverview(harness.db).accounts.find((a) => a.id === banco.id)?.balance).toBe(85_000);
  });

  it('pagar dos veces deja UNA transacción, con el monto y la fecha del último pago', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:payStatement', id, 15_000, 0, undefined, '2025-12-10');
    await invoke('finance:payStatement', id, 14_000, 0, undefined, '2025-12-12');
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ amount: 14_000, date: '2025-12-12' });
  });

  it('una pata por moneda, nunca dos', async () => {
    await purchase('2025-11-10', 50_000);
    await purchase('2025-11-11', 30, 'USD');
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:payStatement', id, 50_000, 30, undefined, '2025-12-10');
    await invoke('finance:payStatement', id, 50_000, 30, undefined, '2025-12-11');
    expect(payments().map((p) => [p.currency, p.amount, p.date])).toEqual([['ARS', 50_000, '2025-12-11'], ['USD', 30, '2025-12-11']]);
  });

  it('sin fecha paga hoy; una fecha inválida se rechaza', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    expect(await invoke('finance:payStatement', id, 15_000, 0, undefined, 'ayer')).toEqual({ ok: false, reason: 'invalid_date' });
    expect(payments()).toHaveLength(0);
    await invoke('finance:payStatement', id, 15_000);
    expect(payments()[0].date).toBe(todayDateString());
  });

  it('saveStatementPaper con SU PAGO fecha el pago en el cierre del papel', async () => {
    await purchase('2025-10-10', 100_000);
    const octId = await invoke<string>('finance:generateStatement', cardId, '2025-10');
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ settledPrevious: boolean }>('finance:saveStatementPaper', cardId, {
      period: '2025-11', closingDate: '2025-11-27', priorPaymentArs: 100_000,
    });
    expect(res.settledPrevious).toBe(true);
    const [pago] = payments();
    expect(pago).toMatchObject({ amount: 100_000, date: '2025-11-27', impactsBalance: 1, accountId: null });
    expect(statementRow(octId)).toMatchObject({ status: 'paid', paidDate: '2025-11-27', transactionId: pago.id });
    expect(computeMonthlyBalance(harness.db, '2025-10').ARS.expenses).toBe(0);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(100_000);
  });

  it('generateStatement sanea un pendiente que trae transacción (sync desde un dispositivo viejo)', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    harness.db.prepare(`
      INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, payment_method, source, impacts_balance, created_at, updated_at)
      VALUES ('stale', 'expense', 15000, 'ARS', ?, 'Pago tarjeta - 2025-11', '2025-11-01', 'debit', 'manual', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run(CARD_PAYMENT_CATEGORY);
    harness.db.prepare("UPDATE finance_credit_card_statements SET transaction_id = 'stale' WHERE id = ?").run(id);

    expect(await invoke('finance:generateStatement', cardId, '2025-11')).toBe(id);
    expect(statementRow(id).transactionId).toBeNull();
    const stale = harness.db.prepare('SELECT deleted_at AS d FROM finance_transactions WHERE id = ?').get('stale') as { d: string | null };
    expect(stale.d).not.toBeNull();
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
  });
});
