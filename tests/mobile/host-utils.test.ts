import { describe, it, expect } from 'vitest';
import { acceptFor, bytesToBase64, isSqliteFile, notificationIdFor } from '../../src/mobile/host-utils';

describe('bytesToBase64', () => {
  it('codifica como Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('vacío → cadena vacía', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('un buffer más grande que el chunk (32 KiB) se codifica entero', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('acceptFor', () => {
  it('convierte extensiones a la lista de accept del input, sin repetir', () => {
    expect(acceptFor([{ name: 'CSV', extensions: ['csv', '.txt'] }, { name: 'X', extensions: ['CSV'] }]))
      .toBe('text/csv,.csv,text/plain,.txt');
  });

  it('el PDF sale con MIME y con extensión: hay pickers de Android que solo miran el MIME', () => {
    expect(acceptFor([{ name: 'PDF', extensions: ['pdf'] }])).toBe('application/pdf,.pdf');
  });

  it('las tres extensiones del import de tablas traen su MIME', () => {
    expect(acceptFor([{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }]))
      .toBe('text/csv,.csv,text/tab-separated-values,.tsv,text/plain,.txt');
  });

  it('el backup .zip también', () => {
    expect(acceptFor([{ name: 'Zip Files', extensions: ['zip'] }])).toBe('application/zip,.zip');
  });

  it('una extensión sin MIME conocido sale sola', () => {
    expect(acceptFor([{ name: 'DB', extensions: ['db'] }])).toBe('.db');
  });

  it('comodín o sin filtros → cualquier archivo', () => {
    expect(acceptFor([{ name: 'Todos', extensions: ['*'] }])).toBe('');
    expect(acceptFor([])).toBe('');
  });
});

describe('isSqliteFile', () => {
  it('reconoce la cabecera "SQLite format 3\\0"', () => {
    const bytes = new Uint8Array(4096);
    bytes.set(new TextEncoder().encode('SQLite format 3\0'));
    expect(isSqliteFile(bytes)).toBe(true);
  });

  it('rechaza archivos cortos o con otra cabecera', () => {
    expect(isSqliteFile(new Uint8Array(10))).toBe(false);
    const zip = new Uint8Array(4096);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(isSqliteFile(zip)).toBe(false);
  });
});

describe('notificationIdFor', () => {
  it('mismo tag → mismo id (reemplaza la notificación anterior)', () => {
    expect(notificationIdFor('streak')).toBe(notificationIdFor('streak'));
    expect(notificationIdFor('streak')).not.toBe(notificationIdFor('cauldron'));
  });

  it('los ids con tag viven en [2^30, 2^31) — int32 positivo de Android', () => {
    const id = notificationIdFor('cualquier cosa');
    expect(id).toBeGreaterThanOrEqual(0x40000000);
    expect(id).toBeLessThan(0x80000000);
  });

  it('sin tag → ids distintos, crecientes y por debajo de 2^30', () => {
    const a = notificationIdFor();
    const b = notificationIdFor();
    expect(b).toBe(a + 1);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0x40000000);
  });
});
