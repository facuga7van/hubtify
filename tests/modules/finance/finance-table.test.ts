/**
 * El importador de tablas delimitadas: la otra mitad del rediseño.
 *
 * El resumen de tarjeta resuelve el setup (140 interacciones) y las cuotas,
 * pero el 67 % de lo que el usuario carga a mano son transferencias y
 * billeteras — 180 de las 330 interacciones, y se pagan TODOS los meses. Nada
 * de eso está en un PDF de tarjeta.
 *
 * Genérico y no un parser por proveedor porque el CSV de Mercado Pago no es un
 * formato sino una familia: delimitador, separador decimal, idioma de los
 * encabezados y alias de columna son configurables por el usuario.
 */
import { describe, it, expect } from 'vitest';
import {
  applyMapping,
  parseDelimitedTable,
  parseTableAmount,
  parseTableDate,
  sniffDecimalSeparator,
  sniffDelimiter,
  splitDelimitedLine,
  suggestMapping,
  type TableColumnMapping,
} from '../../../shared-logic/modules/finance-table';

describe('splitDelimitedLine', () => {
  it('respeta las comillas: una coma dentro de la descripción no corre las columnas', () => {
    // Sin esto, «Kiosco, el de la esquina» empuja el importe una columna a la
    // derecha y el error se descubre tres meses después con el total mal.
    expect(splitDelimitedLine('2026-01-05,"Kiosco, el de la esquina",-1500.00', ','))
      .toEqual(['2026-01-05', 'Kiosco, el de la esquina', '-1500.00']);
  });

  it('entiende el escape `""` de RFC 4180', () => {
    expect(splitDelimitedLine('a,"dijo ""hola""",b', ',')).toEqual(['a', 'dijo "hola"', 'b']);
  });
});

describe('sniffDelimiter', () => {
  it('elige el punto y coma aunque haya más comas (decimales argentinos)', () => {
    const lines = ['Fecha;Detalle;Monto', '05/01/2026;Kiosco;-1.500,00', '06/01/2026;Sube;-2.000,00'];
    expect(sniffDelimiter(lines)).toBe(';');
  });

  it('elige la coma en un CSV normal', () => {
    expect(sniffDelimiter(['date,description,amount', '2026-01-05,Kiosco,-1500.00'])).toBe(',');
  });

  it('elige el tabulador en un TSV', () => {
    expect(sniffDelimiter(['a\tb\tc', '1\t2\t3'])).toBe('\t');
  });
});

describe('sniffDecimalSeparator', () => {
  it('reconoce el formato argentino 1.234,56', () => {
    expect(sniffDecimalSeparator([['-1.500,00'], ['2.750,25']])).toBe(',');
  });

  it('reconoce el formato inglés 1,234.56', () => {
    expect(sniffDecimalSeparator([['-1,500.00'], ['2,750.25']])).toBe('.');
  });

  it('sin números reconocibles no adivina de más: punto', () => {
    expect(sniffDecimalSeparator([['hola'], ['chau']])).toBe('.');
  });
});

describe('parseTableAmount', () => {
  it('lee el formato argentino', () => {
    expect(parseTableAmount('-1.500,50', ',')).toBe(-1500.5);
    expect(parseTableAmount('$ 2.000,00', ',')).toBe(2000);
  });

  it('lee el formato inglés', () => {
    expect(parseTableAmount('-1,500.50', '.')).toBe(-1500.5);
  });

  it('entiende el paréntesis contable como negativo', () => {
    expect(parseTableAmount('(1.234,56)', ',')).toBe(-1234.56);
  });

  it('devuelve null en vez de un número inventado', () => {
    expect(parseTableAmount('', ',')).toBeNull();
    expect(parseTableAmount('n/a', ',')).toBeNull();
    expect(parseTableAmount('12-05-2026', ',')).toBeNull();
  });
});

describe('parseTableDate', () => {
  it('lee ISO y DD/MM/YYYY', () => {
    expect(parseTableDate('2026-01-05')).toBe('2026-01-05');
    expect(parseTableDate('05/01/2026')).toBe('2026-01-05');
    expect(parseTableDate('5-1-26')).toBe('2026-01-05');
  });

  it('descarta lo que no es una fecha en vez de inventar una', () => {
    expect(parseTableDate('Kiosco')).toBeNull();
    expect(parseTableDate('45/13/2026')).toBeNull();
  });
});

describe('suggestMapping', () => {
  it('reconoce encabezados en español y en inglés', () => {
    expect(suggestMapping(['Fecha de operación', 'Descripción', 'Monto', 'Moneda']))
      .toEqual({ 0: 'date', 1: 'description', 2: 'amount', 3: 'currency' });
    expect(suggestMapping(['Date', 'Detail', 'Amount']))
      .toEqual({ 0: 'date', 1: 'description', 2: 'amount' });
  });

  it('no asigna el mismo campo dos veces', () => {
    const mapping = suggestMapping(['Fecha', 'Fecha de acreditación', 'Monto']);
    expect(mapping[0]).toBe('date');
    expect(mapping[1]).toBe('ignore');
  });

  it('lo que no reconoce lo ignora, no lo adivina', () => {
    expect(suggestMapping(['Foo', 'Bar'])).toEqual({ 0: 'ignore', 1: 'ignore' });
  });
});

const AR_CSV = [
  'Fecha;Descripción;Monto;Moneda',
  '05/01/2026;Transferencia a Juan;-15.000,00;ARS',
  '06/01/2026;Sueldo;250.000,00;ARS',
  '07/01/2026;Suscripción;-9,99;USD',
  'sin fecha;Basura;-1,00;ARS',
].join('\n');

describe('parseDelimitedTable + applyMapping', () => {
  it('lee un extracto argentino de punto y coma con decimales de coma', () => {
    const table = parseDelimitedTable(AR_CSV)!;
    expect(table.delimiter).toBe(';');
    expect(table.decimalSeparator).toBe(',');
    expect(table.headers).toHaveLength(4);
    expect(table.rows).toHaveLength(4);

    const { rows, skipped } = applyMapping(table, table.suggested);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      date: '2026-01-05', description: 'Transferencia a Juan', amount: 15_000, currency: 'ARS', raw: -15_000,
    });
    expect(rows[1]).toMatchObject({ amount: 250_000, raw: 250_000 });
    expect(rows[2]).toMatchObject({ currency: 'USD', amount: 9.99 });

    // Lo que no se pudo leer se DEVUELVE con su número de línea: lo que el
    // importador descarta en silencio se descubre tres meses después.
    expect(skipped).toEqual([{ line: 5, reason: 'date' }]);
  });

  it('un mapeo corregido a mano manda sobre el sugerido', () => {
    const table = parseDelimitedTable(
      ['col1;col2;col3', '05/01/2026;Kiosco;-1.500,00'].join('\n'),
    )!;
    expect(applyMapping(table, table.suggested).rows).toHaveLength(0);
    const manual: TableColumnMapping = { 0: 'date', 1: 'description', 2: 'amount' };
    expect(applyMapping(table, manual).rows[0]).toMatchObject({ description: 'Kiosco', amount: 1_500 });
  });

  it('sin columna de moneda usa el default elegido, no una inventada', () => {
    const table = parseDelimitedTable(['Fecha;Detalle;Monto', '05/01/2026;X;-1,00'].join('\n'))!;
    expect(applyMapping(table, table.suggested, { currency: 'USD' }).rows[0].currency).toBe('USD');
    expect(applyMapping(table, table.suggested).rows[0].currency).toBe('ARS');
  });

  it('un archivo que no es una tabla devuelve null en vez de basura', () => {
    expect(parseDelimitedTable('')).toBeNull();
    expect(parseDelimitedTable('una sola linea')).toBeNull();
    expect(parseDelimitedTable('sincolumnas\notralinea')).toBeNull();
  });

  it('completa las filas cortas en vez de descartarlas', () => {
    // Una columna final vacía es normal en estas exportaciones.
    const table = parseDelimitedTable(['Fecha;Detalle;Monto;Moneda', '05/01/2026;X;-1,00'].join('\n'))!;
    expect(table.rows[0]).toHaveLength(4);
    expect(applyMapping(table, table.suggested).rows).toHaveLength(1);
  });
});
