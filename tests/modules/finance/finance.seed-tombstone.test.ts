/**
 * Review sync 08-2026 (medium): the v17 seed of «Efectivo» stamped
 * `updated_at = now` on an empty table, and migrations run BEFORE the first
 * pull. A device that deleted the account on Monday lost against a device that
 * merely migrated on Wednesday: the Wednesday seed won LWW over the Monday
 * tombstone and the account came back everywhere.
 *
 * The seed is now stamped at the epoch, so any real deletion (or edit) is newer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { DEFAULT_CASH_ACCOUNT_ID, listAccounts } from '../../../shared-logic/modules/finance.balance';

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
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
// sync.ipc pulls these two in for the nutrition / habits merges; neither is
// exercised here and both drag Electron-only modules along.
vi.mock('../../../shared-logic/modules/nutrition.ipc', () => ({ recalcSummary: vi.fn() }));
vi.mock('../../../shared-logic/modules/quests.habits', () => ({ weeklyTarget: () => 0 }));

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

// Registration runs a boot-time prune against getDb(); give it a real handle.
harness.db = setupDb();
const { registerSyncIpcHandlers } = await import('../../../electron/modules/sync.ipc');
registerSyncIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const MONDAY = '2026-08-24T10:00:00.000Z';

function seedRow() {
  return harness.db.prepare(
    'SELECT created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM finance_accounts WHERE id = ?',
  ).get(DEFAULT_CASH_ACCOUNT_ID) as { createdAt: string; updatedAt: string; deletedAt: string | null } | undefined;
}

beforeEach(() => {
  harness.db = setupDb();
});

describe('«Efectivo» seed vs a remote tombstone', () => {
  it('the seed is stamped at the epoch, never at migration time', () => {
    expect(seedRow()).toEqual({ createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null });
  });

  it('Monday\'s deletion beats Wednesday\'s fresh seed: the account stays deleted', async () => {
    await invoke('sync:mergeFinanceData', {
      accounts: [{
        id: DEFAULT_CASH_ACCOUNT_ID, name: 'Efectivo', kind: 'cash', currency: 'ARS',
        initialBalance: 0, accountOrder: 0, createdAt: EPOCH, updatedAt: MONDAY, deletedAt: MONDAY,
      }],
    });
    expect(seedRow()?.deletedAt).toBe(MONDAY);
    expect(listAccounts(harness.db).map((a) => a.id)).not.toContain(DEFAULT_CASH_ACCOUNT_ID);
  });

  it('the fresh seed, pushed from the new device, cannot resurrect a tombstoned account elsewhere', async () => {
    // Device A: the account was deleted on Monday.
    const deviceA = harness.db;
    deviceA.prepare('UPDATE finance_accounts SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(MONDAY, MONDAY, DEFAULT_CASH_ACCOUNT_ID);

    // Device B (fresh install, migrated on Wednesday) exports its seed…
    harness.db = setupDb();
    const exported = await invoke<{ accounts: Array<Record<string, unknown>> }>('sync:getAllFinanceData');
    const seed = exported.accounts.find((a) => a.id === DEFAULT_CASH_ACCOUNT_ID);
    expect(seed?.updatedAt).toBe(EPOCH);
    expect(seed?.deletedAt).toBeNull();

    // …and A merges it: nothing changes, the tombstone is newer.
    harness.db = deviceA;
    await invoke('sync:mergeFinanceData', { accounts: [seed] });
    expect(seedRow()?.deletedAt).toBe(MONDAY);
  });

  it('a real edit is still newer than the seed and lands normally', async () => {
    await invoke('sync:mergeFinanceData', {
      accounts: [{
        id: DEFAULT_CASH_ACCOUNT_ID, name: 'Billetera', kind: 'cash', currency: 'ARS',
        initialBalance: 5000, accountOrder: 0, createdAt: EPOCH, updatedAt: MONDAY, deletedAt: null,
      }],
    });
    const acc = listAccounts(harness.db).find((a) => a.id === DEFAULT_CASH_ACCOUNT_ID);
    expect(acc?.name).toBe('Billetera');
    expect(acc?.initialBalance).toBe(5000);
  });
});
