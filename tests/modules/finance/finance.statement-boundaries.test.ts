/**
 * C7 (spec 2026-09-05-coinify-integridad): `closing_day` es configuración del
 * usuario y el papel no la pisa. Para ubicar una compra manual sin
 * `statement_period`, los cierres REALES de los papeles guardados
 * (`finance_credit_card_statements.closing_date`) mandan sobre el día fijo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { loadStatementBoundaries, statementPeriodForWithBoundaries } from '../../../shared-logic/modules/finance.balance';

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

describe('statementPeriodForWithBoundaries (pura)', () => {
  const NOV_DEC = [
    { periodMonth: '2025-11', closingDate: '2025-11-26' },
    { periodMonth: '2025-12', closingDate: '2025-12-28' },
  ];

  it('un statement_period explícito gana siempre', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27', statementPeriod: '2026-02' }, 28, NOV_DEC)).toBe('2026-02');
  });

  it('con papeles consecutivos, una compra entre dos cierres cae en el segundo', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, NOV_DEC)).toBe('2025-12');
    expect(statementPeriodForWithBoundaries({ date: '2025-12-28' }, 28, NOV_DEC)).toBe('2025-12');
  });

  it('una compra EL DÍA del cierre entra en ese resumen, no en el siguiente', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-26' }, 28, NOV_DEC)).toBe('2025-11');
  });

  it('el primer papel absorbe solo un mes hacia atrás', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-25' }, 28, NOV_DEC)).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-10-30' }, 28, NOV_DEC)).toBe('2025-11');
    // Más vieja que un mes antes del primer cierre: vuelve al closing_day.
    expect(statementPeriodForWithBoundaries({ date: '2025-10-20' }, 28, NOV_DEC)).toBe('2025-10');
  });

  it('después del último cierre conocido, manda closing_day', () => {
    expect(statementPeriodForWithBoundaries({ date: '2026-01-05' }, 28, NOV_DEC)).toBe('2026-01');
    expect(statementPeriodForWithBoundaries({ date: '2026-01-29' }, 28, NOV_DEC)).toBe('2026-02');
  });

  it('sin papeles, es getStatementPeriod', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, [])).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-11-29' }, 28, [])).toBe('2025-12');
  });

  it('un hueco entre papeles no arrastra dos meses al segundo', () => {
    const GAP = [
      { periodMonth: '2025-09', closingDate: '2025-09-26' },
      { periodMonth: '2025-12', closingDate: '2025-12-28' },
    ];
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, GAP)).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-12-05' }, 28, GAP)).toBe('2025-12');
  });
});

describe('C7 — el papel completa closing_day, nunca lo pisa; el detalle usa los cierres reales', () => {
  let cardId: string;

  async function purchase(date: string, amount: number): Promise<string> {
    return invoke<string>('finance:addTransaction', {
      type: 'expense', amount, category: 'Compras', description: `compra ${date}`,
      date, paymentMethod: 'credit_card', creditCardId: cardId,
    });
  }

  function cardDays() {
    return harness.db.prepare('SELECT closing_day AS closingDay, due_day AS dueDay FROM finance_credit_cards WHERE id = ?')
      .get(cardId) as { closingDay: number; dueDay: number | null };
  }

  async function detailDates(statementId: string): Promise<string[]> {
    const d = await invoke<{ transactions: Array<{ date: string }> }>('finance:getStatementDetail', statementId);
    return d.transactions.map((t) => t.date).sort();
  }

  beforeEach(async () => {
    harness.db = setupDb();
    cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 28 });
  });

  it('closing_day 28 sigue en 28 tras un papel que cierra el 26', async () => {
    await purchase('2025-11-10', 1000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26', dueDate: '2025-12-05' });
    expect(cardDays()).toEqual({ closingDay: 28, dueDay: 5 }); // due_day estaba vacío: se completa
  });

  it('un closing_day vacío (fila insertada por SQL o sync) sí se completa', async () => {
    await purchase('2025-11-10', 1000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    // Después de generar: con cierre 0 la compra del 10/11 caería a diciembre y
    // el resumen de noviembre no existiría (`statement_not_found`).
    harness.db.prepare('UPDATE finance_credit_cards SET closing_day = 0 WHERE id = ?').run(cardId);
    const res = await invoke<{ ok: boolean }>('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26' });
    expect(res.ok).toBe(true);
    expect(cardDays().closingDay).toBe(26);
  });

  it('con papeles de nov (26) y dic (28), el 27/11 es diciembre y el 25/11 es noviembre', async () => {
    await purchase('2025-11-10', 1000);
    const nov = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26' });
    await purchase('2025-12-10', 1000);
    const dec = await invoke<string>('finance:generateStatement', cardId, '2025-12');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-12', closingDate: '2025-12-28' });

    await purchase('2025-11-27', 500);
    await purchase('2025-11-25', 700);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:generateStatement', cardId, '2025-12');

    expect(await detailDates(nov)).toEqual(['2025-11-10', '2025-11-25']);
    expect(await detailDates(dec)).toEqual(['2025-11-27', '2025-12-10']);
    const decRow = harness.db.prepare('SELECT calculated_amount AS c FROM finance_credit_card_statements WHERE id = ?').get(dec) as { c: number };
    expect(decRow.c).toBe(1500);
  });

  it('un closing_date malformado (OCR, sync) se ignora y la siguiente frontera válida manda', async () => {
    const insert = harness.db.prepare(`
      INSERT INTO finance_credit_card_statements
        (id, credit_card_id, period_month, calculated_amount, status, closing_date, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'pending', ?, 'now', 'now')
    `);
    insert.run('s-nov', cardId, '2025-11', '27/11/2025');
    insert.run('s-dic', cardId, '2025-12', '2025-12-28');
    insert.run('s-ene', cardId, '2026-01', '2026-01-28');

    expect(loadStatementBoundaries(harness.db, cardId)).toEqual([
      { periodMonth: '2025-12', closingDate: '2025-12-28' },
      { periodMonth: '2026-01', closingDate: '2026-01-28' },
    ]);
  });

  it('dos resúmenes con el mismo cierre salen ordenados por período', async () => {
    const insert = harness.db.prepare(`
      INSERT INTO finance_credit_card_statements
        (id, credit_card_id, period_month, calculated_amount, status, closing_date, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'pending', ?, 'now', 'now')
    `);
    insert.run('s-b', cardId, '2025-12', '2025-11-28');
    insert.run('s-a', cardId, '2025-11', '2025-11-28');
    expect(loadStatementBoundaries(harness.db, cardId).map((b) => b.periodMonth)).toEqual(['2025-11', '2025-12']);
  });

  it('sin papeles, la derivación sigue siendo por closing_day', async () => {
    await purchase('2025-11-27', 500);
    await purchase('2025-11-29', 700);
    const nov = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    const dec = await invoke<string>('finance:generateStatement', cardId, '2025-12');
    expect(await detailDates(nov)).toEqual(['2025-11-27']);
    expect(await detailDates(dec)).toEqual(['2025-11-29']);
  });
});
