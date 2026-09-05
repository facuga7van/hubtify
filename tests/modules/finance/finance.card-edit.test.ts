/**
 * C2 — editar una compra con tarjeta no la desengancha.
 *
 * Editar el monto o la descripción de una compra con tarjeta llegaba al handler
 * con `paymentMethod: 'credit_card'` y sin `creditCardId`, y el handler lo leía
 * como «tarjeta = null»: la fila perdía su tarjeta y quedaba con
 * `impacts_balance = 0`, invisible para el resumen y para el saldo. La regla
 * ahora es: sin `creditCardId` explícito, la tarjeta, `impacts_balance` y el
 * período se conservan; cambiar a un medio que no es tarjeta limpia los tres;
 * un `creditCardId` explícito (incluido `null`) se respeta.
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

function cardFields(id: string) {
  return harness.db.prepare(
    'SELECT credit_card_id AS creditCardId, impacts_balance AS impactsBalance, statement_period AS statementPeriod, payment_method AS paymentMethod FROM finance_transactions WHERE id = ?',
  ).get(id) as { creditCardId: string | null; impactsBalance: number; statementPeriod: string | null; paymentMethod: string };
}

/** Una compra con tarjeta con período explícito, como la deja el import. */
async function cardPurchase(): Promise<string> {
  const id = await invoke<string>('finance:addTransaction', {
    type: 'expense', amount: 1000, date: '2025-08-20', paymentMethod: 'credit_card', creditCardId: cardId, category: 'Compras',
  });
  harness.db.prepare("UPDATE finance_transactions SET statement_period = '2025-08' WHERE id = ?").run(id);
  return id;
}

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
});

describe('C2 — editar una compra con tarjeta no la desengancha', () => {
  it('paymentMethod credit_card sin creditCardId conserva tarjeta, impacts_balance y período', async () => {
    const id = await cardPurchase();
    expect(await invoke('finance:updateTransaction', id, { amount: 2000, paymentMethod: 'credit_card' })).toEqual({ ok: true });
    expect(cardFields(id)).toEqual({ creditCardId: cardId, impactsBalance: 0, statementPeriod: '2025-08', paymentMethod: 'credit_card' });
  });

  it('sin paymentMethod ni creditCardId tampoco toca nada de la tarjeta', async () => {
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { description: 'otra' });
    expect(cardFields(id)).toMatchObject({ creditCardId: cardId, impactsBalance: 0, statementPeriod: '2025-08' });
  });

  it('cambiar a cash limpia tarjeta y período y vuelve al saldo', async () => {
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { paymentMethod: 'cash' });
    expect(cardFields(id)).toEqual({ creditCardId: null, impactsBalance: 1, statementPeriod: null, paymentMethod: 'cash' });
  });

  it('un creditCardId explícito se respeta (incluido null)', async () => {
    const other = await invoke<string>('finance:addCreditCard', { name: 'Master', closingDay: 10 });
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { paymentMethod: 'credit_card', creditCardId: other });
    expect(cardFields(id)).toMatchObject({ creditCardId: other, impactsBalance: 0 });
    await invoke('finance:updateTransaction', id, { paymentMethod: 'credit_card', creditCardId: null });
    expect(cardFields(id)).toMatchObject({ creditCardId: null, impactsBalance: 0 });
  });
});
