import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/mobile/install-api', () => ({ getWorkerClient: vi.fn(() => null) }));
vi.mock('../../src/mobile/platform-host', () => ({ createPlatformHost: vi.fn() }));

import { canExportDb, createMobileBackup, type BackupDeps } from '../../src/mobile/backup';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from '../../src/mobile/backup-channels';

function sqliteBytes(): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  return bytes;
}

function deps(overrides: Partial<BackupDeps> = {}): BackupDeps {
  return {
    invoke: vi.fn(async () => sqliteBytes()),
    saveBinaryFile: vi.fn(async () => true),
    pickBinaryFile: vi.fn(async () => null),
    today: () => '2026-09-02',
    ...overrides,
  };
}

describe('exportDb', () => {
  it('pide el .db al worker y lo comparte con nombre fechado', async () => {
    const d = deps();
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: true });
    expect(d.invoke).toHaveBeenCalledWith(EXPORT_DB_CHANNEL);
    expect(d.saveBinaryFile).toHaveBeenCalledWith('hubtify-2026-09-02.db', expect.any(Uint8Array));
  });

  it('share cancelado → canceled', async () => {
    const d = deps({ saveBinaryFile: vi.fn(async () => false) });
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: false, canceled: true });
  });

  it('error del worker → error con el mensaje', async () => {
    const d = deps({ invoke: vi.fn(async () => { throw new Error('NoHandler'); }) });
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: false, error: 'NoHandler' });
  });
});

describe('pickDbFile / importDb', () => {
  it('pickDbFile acepta cualquier archivo (la validación es por cabecera)', async () => {
    const d = deps();
    await createMobileBackup(d).pickDbFile();
    expect(d.pickBinaryFile).toHaveBeenCalledWith([{ name: 'SQLite', extensions: ['*'] }]);
  });

  it('importDb rechaza lo que no es SQLite sin invocar al worker', async () => {
    const d = deps();
    await expect(createMobileBackup(d).importDb(new Uint8Array(500))).resolves.toEqual({ success: false, error: 'not_sqlite' });
    expect(d.invoke).not.toHaveBeenCalled();
  });

  it('importDb válido → invoke con los bytes y tamaño escrito', async () => {
    const d = deps({ invoke: vi.fn(async () => ({ ok: true, bytes: 4096 })) });
    const bytes = sqliteBytes();
    await expect(createMobileBackup(d).importDb(bytes)).resolves.toEqual({ success: true, bytes: 4096 });
    expect(d.invoke).toHaveBeenCalledWith(IMPORT_DB_CHANNEL, bytes);
  });
});

describe('canExportDb', () => {
  it('false sin cliente o con el worker muerto; true si vive', () => {
    expect(canExportDb(null)).toBe(false);
    expect(canExportDb({ isCrashed: () => true } as never)).toBe(false);
    expect(canExportDb({ isCrashed: () => false } as never)).toBe(true);
  });
});
