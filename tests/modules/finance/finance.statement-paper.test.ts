/**
 * Los números DEL PAPEL sobre el resumen, y las dos reglas que los gobiernan:
 *
 * 1. `calculated_amount` (lo que Coinify suma) y `statement_total_ars` (lo que
 *    dice el banco) **conviven y no se pisan**. Que difieran ES el dato.
 * 2. **Nunca inventar.** El «SU PAGO» impreso salda el resumen ANTERIOR solo si
 *    ese resumen ya existe y está pendiente. Si no existe, no se crea: la app
 *    no sabe qué había adentro, y fabricarlo sería adivinar (mismo criterio que
 *    docs/superpowers/plans/2026-09-03-coinify-orphan-installments.md).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

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

/** Una compra con tarjeta que hace que el resumen del período exista. */
async function purchase(date: string, amount: number) {
  await invoke('finance:addTransaction', {
    type: 'expense', amount, currency: 'ARS', category: 'Compras',
    description: 'compra', date, paymentMethod: 'credit_card', creditCardId: cardId,
  });
}

const PAPER = {
  period: '2025-11',
  closingDate: '2025-11-27',
  dueDate: '2025-12-05',
  totalArs: 18_192,
  totalUsd: 10,
  minimumArs: 5_000,
  previousArs: 100_000,
  previousUsd: 10,
  priorPaymentArs: 100_000,
  priorPaymentUsd: 10,
  reconciled: true,
  forecast: [{ month: '2025-12', amount: 1_000 }, { month: '2026-01', amount: 2_000 }],
  last4: '1234',
  issuer: 'galicia_visa',
};

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Galicia VISA', closingDay: 25 });
});

describe('finance:saveStatementPaper', () => {
  it('estampa los 11 campos del papel sin tocar lo calculado', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ ok: boolean }>('finance:saveStatementPaper', cardId, PAPER);
    expect(res.ok).toBe(true);

    const row = harness.db.prepare(`
      SELECT calculated_amount, statement_total_ars, statement_total_usd,
             minimum_payment_ars, previous_balance_ars, prior_payment_ars,
             closing_date, due_date, reconciled, forecast_json
      FROM finance_credit_card_statements WHERE credit_card_id = ? AND period_month = '2025-11'
    `).get(cardId) as Record<string, unknown>;

    // Lo que Coinify calculó con SUS filas queda intacto…
    expect(row.calculated_amount).toBe(15_000);
    // …y al lado, lo que dice el banco. Los dos números, no uno solo.
    expect(row.statement_total_ars).toBe(18_192);
    expect(row.statement_total_usd).toBe(10);
    expect(row.minimum_payment_ars).toBe(5_000);
    expect(row.previous_balance_ars).toBe(100_000);
    expect(row.prior_payment_ars).toBe(100_000);
    expect(row.closing_date).toBe('2025-11-27');
    expect(row.due_date).toBe('2025-12-05');
    expect(row.reconciled).toBe(1);
    expect(JSON.parse(row.forecast_json as string)).toHaveLength(2);
  });

  it('completa el cierre, el vencimiento, los últimos 4 y el emisor de la tarjeta', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, PAPER);

    const card = harness.db.prepare(
      'SELECT closing_day, due_day, last4, issuer FROM finance_credit_cards WHERE id = ?',
    ).get(cardId) as Record<string, unknown>;
    // Se tipeaban a mano, tarjeta por tarjeta. Están impresos.
    expect(card.closing_day).toBe(27);
    expect(card.due_day).toBe(5);
    expect(card.last4).toBe('1234');
    expect(card.issuer).toBe('galicia_visa');
  });

  it('no borra lo que el papel no trae', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', totalArs: 18_192 });

    const card = harness.db.prepare(
      'SELECT closing_day, due_day FROM finance_credit_cards WHERE id = ?',
    ).get(cardId) as Record<string, unknown>;
    expect(card.closing_day).toBe(25); // el que ya tenía
    expect(card.due_day).toBeNull();
  });

  it('salda el resumen ANTERIOR con lo que dice que se pagó', async () => {
    await purchase('2025-10-10', 100_000);
    await invoke('finance:generateStatement', cardId, '2025-10');
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ settledPrevious: boolean }>('finance:saveStatementPaper', cardId, PAPER);
    expect(res.settledPrevious).toBe(true);

    const prev = harness.db.prepare(`
      SELECT status, paid_amount, paid_date FROM finance_credit_card_statements
      WHERE credit_card_id = ? AND period_month = '2025-10'
    `).get(cardId) as Record<string, unknown>;
    expect(prev.status).toBe('paid');
    expect(prev.paid_amount).toBe(100_000);
    expect(prev.paid_date).toBe('2025-11-27');
  });

  it('NO fabrica el resumen anterior si nunca existió', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ settledPrevious: boolean }>('finance:saveStatementPaper', cardId, PAPER);
    expect(res.settledPrevious).toBe(false);

    const count = harness.db.prepare(
      "SELECT COUNT(*) AS c FROM finance_credit_card_statements WHERE period_month = '2025-10'",
    ).get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('no reescribe un resumen anterior ya pagado', async () => {
    await purchase('2025-10-10', 100_000);
    const stmtId = await invoke<string>('finance:generateStatement', cardId, '2025-10');
    await invoke('finance:payStatement', stmtId, 90_000);
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ settledPrevious: boolean }>('finance:saveStatementPaper', cardId, PAPER);
    expect(res.settledPrevious).toBe(false);

    const prev = harness.db.prepare(
      "SELECT paid_amount FROM finance_credit_card_statements WHERE period_month = '2025-10'",
    ).get() as { paid_amount: number };
    expect(prev.paid_amount).toBe(90_000); // lo que el usuario dijo, no lo que trajo el papel
  });

  it('rechaza un período inválido, una tarjeta que no existe y un resumen ausente', async () => {
    expect(await invoke('finance:saveStatementPaper', cardId, { period: 'nunca' }))
      .toMatchObject({ ok: false, reason: 'invalid_period' });
    expect(await invoke('finance:saveStatementPaper', 'no-existe', PAPER))
      .toMatchObject({ ok: false, reason: 'credit_card_not_found' });
    // Sin filas del período no hay resumen, y no se inventa uno.
    expect(await invoke('finance:saveStatementPaper', cardId, PAPER))
      .toMatchObject({ ok: false, reason: 'statement_not_found' });
  });

  it('«sin checksum» se guarda como NULL, distinto de «no cerró»', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    await invoke('finance:saveStatementPaper', cardId, { ...PAPER, reconciled: null });
    const a = harness.db.prepare(
      "SELECT reconciled FROM finance_credit_card_statements WHERE period_month = '2025-11'",
    ).get() as { reconciled: number | null };
    expect(a.reconciled).toBeNull();

    await invoke('finance:saveStatementPaper', cardId, { ...PAPER, reconciled: false });
    const b = harness.db.prepare(
      "SELECT reconciled FROM finance_credit_card_statements WHERE period_month = '2025-11'",
    ).get() as { reconciled: number | null };
    expect(b.reconciled).toBe(0);
  });
});
