import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../shared-logic/db', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
  suspendDb: vi.fn(),
}));
vi.mock('../../shared-logic/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared-logic/registry')>();
  return { ...actual, runSuspend: vi.fn(), runResume: vi.fn() };
});

import { closeDb, getDb, suspendDb } from '../../shared-logic/db';
import { clearHandlers, getHandler, runResume, runSuspend } from '../../shared-logic/registry';
import { registerMobileDbHandlers, type DbPool } from '../../src/mobile/db-backup-handlers';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from '../../src/mobile/backup-channels';

function sqliteBytes(): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  return bytes;
}

function setup(booted = true) {
  const order: string[] = [];
  const track = (name: string, fn: ReturnType<typeof vi.fn>) => fn.mockImplementation(() => { order.push(name); });
  track('runSuspend', vi.mocked(runSuspend));
  track('runResume', vi.mocked(runResume));
  track('closeDb', vi.mocked(closeDb));
  track('getDb', vi.mocked(getDb));
  track('suspendDb', vi.mocked(suspendDb));
  const exported = sqliteBytes();
  const pool: DbPool = {
    exportFile: vi.fn(() => { order.push('exportFile'); return exported; }),
    importDb: vi.fn((_name: string, bytes: Uint8Array | ArrayBuffer) => { order.push('importDb'); return (bytes as Uint8Array).byteLength; }),
  };
  registerMobileDbHandlers({ pool, dbFile: '/hubtify.db', isBooted: () => booted });
  return { order, pool, exported };
}

beforeEach(() => {
  clearHandlers();
  vi.clearAllMocks();
});

describe('registerMobileDbHandlers', () => {
  it('registra los dos canales', () => {
    setup();
    expect(getHandler(EXPORT_DB_CHANNEL)).toBeDefined();
    expect(getHandler(IMPORT_DB_CHANNEL)).toBeDefined();
  });

  it('exportDb con el worker ready: suspende, cierra, lee, reabre y reanuda — en ese orden', () => {
    const { order, pool, exported } = setup(true);
    const bytes = getHandler(EXPORT_DB_CHANNEL)!({}) as Uint8Array;
    expect(order).toEqual(['runSuspend', 'closeDb', 'exportFile', 'getDb', 'runResume']);
    expect(pool.exportFile).toHaveBeenCalledWith('/hubtify.db');
    expect(Array.from(bytes)).toEqual(Array.from(exported));
    expect(bytes.buffer).not.toBe(exported.buffer); // copia propia: el buffer se transfiere
  });

  it('exportDb antes de ready (fatal de migración): solo cierra y lee', () => {
    const { order } = setup(false);
    getHandler(EXPORT_DB_CHANNEL)!({});
    expect(order).toEqual(['closeDb', 'exportFile']);
  });

  it('importDb rechaza lo que no es SQLite sin tocar la DB', () => {
    const { order, pool } = setup();
    expect(() => getHandler(IMPORT_DB_CHANNEL)!({}, new Uint8Array(200))).toThrow('not_sqlite');
    expect(() => getHandler(IMPORT_DB_CHANNEL)!({}, 'texto')).toThrow('not_sqlite');
    expect(order).toEqual([]);
    expect(pool.importDb).not.toHaveBeenCalled();
  });

  it('importDb válido: suspende lifecycles y DB, importa y devuelve el tamaño', () => {
    const { order, pool } = setup();
    const bytes = sqliteBytes();
    const r = getHandler(IMPORT_DB_CHANNEL)!({}, bytes);
    expect(order).toEqual(['runSuspend', 'suspendDb', 'importDb']);
    expect(pool.importDb).toHaveBeenCalledWith('/hubtify.db', bytes);
    expect(r).toEqual({ ok: true, bytes: 4096 });
  });
});
