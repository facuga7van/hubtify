/**
 * El PDF ya no se lee en el proceso main: `pdf-parse` (node-only, con canvas
 * nativo) nunca llegó al paquete instalado y el import falló en TODAS las
 * versiones desde marzo. Ahora el main solo elige el archivo y devuelve los
 * bytes; el texto lo saca pdfjs en el renderer (el mismo camino que Android)
 * y vuelve como string a un handler que solo parsea.
 *
 * Con eso el parseo se prueba con texto plano, sin mockear un selector de PDF.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { getHandler } from '../../../shared-logic/registry';
import { setPlatform, type PlatformPort } from '../../../shared-logic/platform';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));
vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceImportIpcHandlers } = await import('../../../shared-logic/modules/finance-import.ipc');
registerFinanceImportIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const STATEMENT_TEXT = [
  'RESUMEN DE CUENTA VISA',
  '02-11-25 * RAPPIPRO 299493 7.999,00',
  '09-10-25 * WWW.FRAVEGA.COM 02/03 001177 29.999,66',
  '14-11-25 LINEA QUE NO SE ENTIENDE',
  '',
].join('\n');

interface ParsedPdf {
  rows: Array<{ merchant: string; amountARS?: number; suggestedCategory: string }>;
  fileName: string;
  skippedLines: string[];
  header: unknown;
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  harness.db = db;
});

describe('finance:importParsePdfText', () => {
  it('parsea el texto que le manda el renderer y devuelve filas, saltadas y encabezado', async () => {
    const r = await invoke<ParsedPdf>('finance:importParsePdfText', 'resumen.pdf', STATEMENT_TEXT);
    expect(r.fileName).toBe('resumen.pdf');
    expect(r.rows.map((x) => x.merchant)).toEqual(['RAPPIPRO', 'WWW.FRAVEGA.COM']);
    expect(r.rows[0].suggestedCategory).toBe('Delivery');
    expect(r.skippedLines).toEqual(['14-11-25 LINEA QUE NO SE ENTIENDE']);
    expect('header' in r).toBe(true);
  });

  it('respeta un mapping de categoría guardado por encima del default', async () => {
    harness.db.prepare('INSERT INTO finance_category_mappings (keyword, category) VALUES (?, ?)').run('RAPPI', 'Comida');
    const r = await invoke<ParsedPdf>('finance:importParsePdfText', 'x.pdf', '02-11-25 * RAPPIPRO 299493 7.999,00');
    expect(r.rows[0].suggestedCategory).toBe('Comida');
  });

  // Por IPC los dos argumentos llegan como `unknown`; la firma tipada es una
  // promesa del renderer, no una garantía.
  it('rechaza un texto que no es string o viene vacío', async () => {
    await expect(invoke('finance:importParsePdfText', 'x.pdf', undefined)).rejects.toThrow('Invalid PDF text');
    await expect(invoke('finance:importParsePdfText', 'x.pdf', 123)).rejects.toThrow('Invalid PDF text');
    await expect(invoke('finance:importParsePdfText', 'x.pdf', '   ')).rejects.toThrow('Invalid PDF text');
  });

  it('rechaza un nombre de archivo que no es string', async () => {
    await expect(invoke('finance:importParsePdfText', null, STATEMENT_TEXT)).rejects.toThrow('Invalid fileName');
  });
});

describe('finance:importPickPdf', () => {
  const port = {
    pickBinaryFile: vi.fn(async () => ({ name: 'resumen.pdf', bytes: new Uint8Array([1, 2, 3]) })),
  } as unknown as PlatformPort;

  it('pide solo PDFs al selector y devuelve nombre + bytes', async () => {
    setPlatform(port);
    const r = await invoke('finance:importPickPdf');
    expect(port.pickBinaryFile).toHaveBeenCalledWith([{ name: 'PDF', extensions: ['pdf'] }]);
    expect(r).toEqual({ name: 'resumen.pdf', bytes: new Uint8Array([1, 2, 3]) });
  });

  it('devuelve null si el usuario cancela', async () => {
    setPlatform({ pickBinaryFile: async () => null } as unknown as PlatformPort);
    expect(await invoke('finance:importPickPdf')).toBeNull();
  });
});

describe('el canal viejo desaparece', () => {
  it('finance:importSelectAndParsePDF ya no se registra (leía el PDF con pdf-parse en el main)', () => {
    expect(getHandler('finance:importSelectAndParsePDF')).toBeUndefined();
  });
});
