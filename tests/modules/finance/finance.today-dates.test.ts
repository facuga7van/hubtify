/**
 * A las 23:30 hora local, `nowIso().slice(0, 10)` (UTC) ya es MAÑANA en
 * cualquier huso al oeste de Greenwich (ART = UTC-3). La fecha de un hecho del
 * usuario (saldar un préstamo, cambiar el monto de un recurrente) es la del
 * reloj de pared, no la del meridiano de Greenwich.
 *
 * El huso se fija con `process.env.TZ` (Node lo honra para `Date` nuevos) ANTES
 * de construir el instante, así el test discrimina también en un CI en UTC.
 * Precedente: `tests/shared/local-day-roundtrip.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

const harness = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
}));

import { getHandler } from '../../../shared-logic/registry';

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

const originalTz = process.env.TZ;

/** "Hoy" para todo el archivo: 4 de septiembre de 2026, 23:30 en Buenos Aires (02:30 del 5 en UTC). */
beforeEach(() => {
  process.env.TZ = 'America/Argentina/Buenos_Aires';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 4, 23, 30, 0));
  harness.db = setupDb();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('C12 — fechas del día local, no del UTC', () => {
  it('settleLoan fecha hoy, no mañana', async () => {
    const id = await invoke<string>('finance:addLoan', {
      personName: 'Ana',
      direction: 'lent',
      amount: 100,
      date: '2026-09-01',
    });
    await invoke('finance:settleLoan', id);
    const row = harness.db
      .prepare('SELECT settled_date AS d FROM finance_loans WHERE id = ?')
      .get(id) as { d: string };
    expect(row.d).toBe('2026-09-04');
  });

  it('updateRecurringAmount registra el cambio con fecha de hoy', async () => {
    const id = await invoke<string>('finance:addRecurring', { name: 'Luz', type: 'expense', amount: 1000 });
    expect(await invoke('finance:updateRecurringAmount', id, 1500)).toEqual({ ok: true });
    const row = harness.db
      .prepare('SELECT effective_date AS d FROM finance_recurring_amount_history WHERE recurring_id = ?')
      .get(id) as { d: string };
    expect(row.d).toBe('2026-09-04');
  });
});
