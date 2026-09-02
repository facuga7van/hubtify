/**
 * The dashboard renders these panels under a header naming the month the user
 * navigated to, but the handlers behind them took no period at all and always
 * answered "as of today". Each now accepts an optional month; omitting it must
 * still reproduce the old today-anchored answer, so older callers (the dashboard
 * widget, the context bridge before an update) keep working.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn),
  },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../electron/modules/finance.ipc');
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

/** "Today" for every test in this file: 15 August 2026 → current month 2026-08. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
  harness.db = setupDb();
});

afterEach(() => {
  vi.useRealTimers();
});

interface ProjectionRow { month: string; total: number }

describe('finance:getProjection — fromMonth', () => {
  beforeEach(async () => {
    // One installment in 2026-07, one in 2026-09, plus a flat recurring expense.
    await invoke('finance:createInstallmentGroup', {
      description: 'Heladera', totalAmount: 5000, installmentCount: 1, installmentAmount: 5000,
      currency: 'ARS', category: 'Compras', startDate: '2026-07-10', paymentMethod: 'cash',
    });
    await invoke('finance:createInstallmentGroup', {
      description: 'Notebook', totalAmount: 7000, installmentCount: 1, installmentAmount: 7000,
      currency: 'ARS', category: 'Compras', startDate: '2026-09-05', paymentMethod: 'cash',
    });
    await invoke('finance:addRecurring', {
      name: 'Internet', type: 'expense', amount: 1000, currency: 'ARS', category: 'Servicios',
    });
  });

  it('projects from the requested month, not from today', async () => {
    const rows = await invoke<ProjectionRow[]>('finance:getProjection', 3, '2026-06');
    expect(rows.map((r) => r.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(rows.map((r) => r.total)).toEqual([6000, 1000, 8000]);
  });

  it('still anchors on the real current month when no month is given', async () => {
    const rows = await invoke<ProjectionRow[]>('finance:getProjection', 3);
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(rows.map((r) => r.total)).toEqual([8000, 1000, 1000]);
  });

  it('ignores a malformed month rather than producing NaN months', async () => {
    const rows = await invoke<ProjectionRow[]>('finance:getProjection', 1, 'not-a-month');
    expect(rows.map((r) => r.month)).toEqual(['2026-09']);
  });
});

describe('finance:getInstallmentGroups — month', () => {
  beforeEach(async () => {
    await invoke('finance:createInstallmentGroup', {
      description: 'Termina en marzo', totalAmount: 3000, installmentCount: 3, installmentAmount: 1000,
      currency: 'ARS', category: 'Compras', startDate: '2026-01-10', paymentMethod: 'cash',
    });
    await invoke('finance:createInstallmentGroup', {
      description: 'Arranca en julio', totalAmount: 2000, installmentCount: 2, installmentAmount: 1000,
      currency: 'ARS', category: 'Compras', startDate: '2026-07-10', paymentMethod: 'cash',
    });
  });

  it('returns only the plans that actually bill in the requested month', async () => {
    const march = await invoke<Array<{ description: string }>>('finance:getInstallmentGroups', '2026-03');
    expect(march.map((g) => g.description)).toEqual(['Termina en marzo']);

    const july = await invoke<Array<{ description: string }>>('finance:getInstallmentGroups', '2026-07');
    expect(july.map((g) => g.description)).toEqual(['Arranca en julio']);

    // May bills nothing — the count the dashboard shows must be able to reach 0.
    const may = await invoke<unknown[]>('finance:getInstallmentGroups', '2026-05');
    expect(may).toHaveLength(0);
  });

  it('returns every plan when no month is given', async () => {
    const all = await invoke<unknown[]>('finance:getInstallmentGroups');
    expect(all).toHaveLength(2);
  });
});

describe('finance:getMonthlyExpenses — endMonth', () => {
  beforeEach(async () => {
    const seed: Array<[string, number]> = [
      ['2026-01-05', 100], ['2026-02-05', 200], ['2026-03-05', 300],
      ['2026-04-05', 400], ['2026-05-05', 500], ['2026-06-05', 600],
      ['2026-07-05', 700], ['2026-08-05', 800],
    ];
    for (const [date, amount] of seed) {
      await invoke('finance:addTransaction', {
        type: 'expense', amount, currency: 'ARS', category: 'Otros', date, paymentMethod: 'cash',
      });
    }
  });

  it('returns the six months ending on the requested month', async () => {
    const rows = await invoke<number[]>('finance:getMonthlyExpenses', '2026-06');
    expect(rows).toEqual([100, 200, 300, 400, 500, 600]);
  });

  it('ends on the real current month when no month is given', async () => {
    const rows = await invoke<number[]>('finance:getMonthlyExpenses');
    expect(rows).toEqual([300, 400, 500, 600, 700, 800]);
  });
});

interface LoanSummary {
  ARS: { lent: number; borrowed: number; lentPending: number; borrowedPending: number };
}

describe('finance:getActiveLoanSummary — asOfMonth', () => {
  beforeEach(async () => {
    const older = await invoke<string>('finance:addLoan', {
      personName: 'Ana', direction: 'lent', amount: 10000, currency: 'ARS', date: '2026-01-10',
    });
    await invoke('finance:addLoanPayment', older, { amount: 3000, currency: 'ARS', date: '2026-02-15' });
    await invoke('finance:addLoanPayment', older, { amount: 4000, currency: 'ARS', date: '2026-06-20' });

    await invoke('finance:addLoan', {
      personName: 'Beto', direction: 'lent', amount: 5000, currency: 'ARS', date: '2026-05-01',
    });

    const settled = await invoke<string>('finance:addLoan', {
      personName: 'Caro', direction: 'borrowed', amount: 8000, currency: 'ARS', date: '2026-02-01',
    });
    // Settled "today" (2026-08-15), so it was still outstanding back in March.
    await invoke('finance:settleLoan', settled);
  });

  it('rebuilds the outstanding balance at the end of the requested month', async () => {
    const summary = await invoke<LoanSummary>('finance:getActiveLoanSummary', '2026-03');
    // Only the January loan existed, and only the February repayment had happened.
    expect(summary.ARS.lent).toBe(10000);
    expect(summary.ARS.lentPending).toBe(7000);
    // Settled in August — in March it was still owed.
    expect(summary.ARS.borrowedPending).toBe(8000);
  });

  it('answers for the present when no month is given', async () => {
    const summary = await invoke<LoanSummary>('finance:getActiveLoanSummary');
    expect(summary.ARS.lent).toBe(15000);
    expect(summary.ARS.lentPending).toBe(8000);
    expect(summary.ARS.borrowedPending).toBe(0);
  });

  it('matches the present-tense answer for a month that has not closed yet', async () => {
    const future = await invoke<LoanSummary>('finance:getActiveLoanSummary', '2026-12');
    const today = await invoke<LoanSummary>('finance:getActiveLoanSummary');
    expect(future.ARS).toEqual(today.ARS);
  });
});
