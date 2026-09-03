import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGaliciaStatement,
  reconcileStatement,
} from '../../../shared-logic/modules/finance-statement';
import { parseGaliciaLine } from '../../../shared-logic/modules/finance-import.ipc';

/**
 * Arnés de regresión del encabezado del resumen.
 *
 * La fixture es SINTÉTICA: misma estructura y mismas etiquetas que un resumen
 * Galicia VISA 2025-2026 real, con comercios y montos inventados. Los resúmenes
 * reales viven fuera del repo (`docsexample/`, gitignoreado) y nunca se
 * commitean.
 *
 * Los números están elegidos para que la identidad de conciliación cierre a
 * mano y se pueda auditar leyendo:
 *
 *   consumos 15.000 + impuestos 3.492 − devolución 300 = 18.192 = TOTAL A PAGAR
 *   con SALDO ANTERIOR 100.000 cancelado por SU PAGO 100.000.
 */
const FIXTURE = readFileSync(
  join(__dirname, '../../fixtures/statements/galicia-visa-synthetic.txt'),
  'utf8',
);

describe('parseGaliciaStatement — encabezado y pie', () => {
  const header = parseGaliciaStatement(FIXTURE);

  it('lee el número de resumen y los últimos 4 de la tarjeta', () => {
    expect(header.statementNumber).toBe('VI00000000012345678');
    expect(header.cardLast4).toBe('1234');
  });

  it('lee las seis fechas en su orden: cierre y vencimiento son la 3ra y la 4ta', () => {
    expect(header.previousClosingDate).toBe('2025-10-30');
    expect(header.previousDueDate).toBe('2025-11-07');
    expect(header.closingDate).toBe('2025-11-27');
    expect(header.dueDate).toBe('2025-12-05');
    expect(header.nextClosingDate).toBe('2025-12-31');
    expect(header.nextDueDate).toBe('2026-01-09');
  });

  it('deriva el período del cierre — el mes deja de preguntarse', () => {
    expect(header.period).toBe('2025-11');
  });

  it('verifica el cierre contra el código de barras del pie', () => {
    expect(header.closingDateAgrees).toBe(true);
  });

  it('avisa cuando el código de barras NO coincide con la fila de fechas', () => {
    // Un layout donde las dos fuentes discrepan: gana la fila de fechas, pero
    // la UI tiene que poder decir que algo no cuadra.
    const tampered = FIXTURE.replace('20251127071234567H', '20251230071234567H');
    const h = parseGaliciaStatement(tampered);
    expect(h.closingDate).toBe('2025-11-27');
    expect(h.closingDateAgrees).toBe(false);
  });

  it('lee el consolidado: saldo anterior, lo pagado y el total a pagar', () => {
    expect(header.previousBalance).toEqual({ ars: 100_000, usd: 10 });
    // Magnitud positiva: la pregunta es «cuánto pagué», no «cuánto restó».
    expect(header.payments).toEqual({ ars: 100_000, usd: 10 });
    expect(header.consumos).toEqual({ ars: 15_000, usd: 10 });
    expect(header.totalDue).toEqual({ ars: 18_192, usd: 10 });
  });

  it('lee el pago mínimo y los dos límites', () => {
    expect(header.minimumPaymentArs).toBe(5_000);
    expect(header.purchaseLimitArs).toBe(900_000);
    expect(header.financingLimitArs).toBe(450_000);
  });

  it('lee las cuotas a vencer que el banco ya proyectó, con su cola', () => {
    expect(header.forecast).toEqual([
      { month: '2025-12', amount: 1_000 },
      { month: '2026-01', amount: 2_000 },
      { month: '2026-02', amount: 3_000 },
      { month: '2026-03', amount: 4_000 },
      { month: '2026-04', amount: 5_000 },
      { month: '2026-05', amount: 6_000 },
    ]);
    expect(header.forecastTail).toEqual({ month: '2026-06', amount: 7_000 });
  });

  it('descarta la proyección si los meses y los importes no se corresponden', () => {
    // Un mes de más significa que el layout cambió: media proyección mal
    // alineada es peor que ninguna.
    const broken = FIXTURE.replace(
      'Diciembre/25 Enero/26 Febrero/26 Marzo/26 Abril/26 Mayo/26',
      'Diciembre/25 Enero/26 Febrero/26 Marzo/26 Abril/26 Mayo/26 Junio/26',
    );
    expect(parseGaliciaStatement(broken).forecast).toEqual([]);
  });

  it('no explota ni inventa nada con un texto que no es un resumen', () => {
    const h = parseGaliciaStatement('hola\nqué tal\n');
    expect(h.closingDate).toBeNull();
    expect(h.period).toBeNull();
    expect(h.totalDue).toEqual({ ars: null, usd: null });
    expect(h.forecast).toEqual([]);
  });

  it('con texto vacío devuelve el encabezado vacío', () => {
    expect(parseGaliciaStatement('').closingDate).toBeNull();
    expect(parseGaliciaStatement(undefined as unknown as string).period).toBeNull();
  });
});

/** Las filas del detalle, como las lee el importador. */
function parseRows(text: string) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const parsed = parseGaliciaLine(raw.trim(), new Map());
    if (parsed) rows.push(parsed);
  }
  return rows;
}

describe('reconcileStatement — el checksum del resumen', () => {
  it('cierra exacto contra el papel en las dos monedas', () => {
    const header = parseGaliciaStatement(FIXTURE);
    const recon = reconcileStatement(parseRows(FIXTURE), header);

    expect(recon.ars.expected).toBe(18_192);
    expect(recon.ars.imported).toBe(18_192);
    expect(recon.ars.difference).toBe(0);
    expect(recon.ars.ok).toBe(true);

    expect(recon.usd.expected).toBe(10);
    expect(recon.usd.imported).toBe(10);
    expect(recon.usd.ok).toBe(true);
  });

  it('detecta una fila que falta en vez de guardarla mal en silencio', () => {
    const header = parseGaliciaStatement(FIXTURE);
    const rows = parseRows(FIXTURE).filter((r) => r.merchant !== 'TIENDA DEMO UNO');
    const recon = reconcileStatement(rows, header);
    expect(recon.ars.ok).toBe(false);
    expect(recon.ars.difference).toBe(-1_000);
  });

  it('sin los totales del papel dice «sin checksum», no «cierra»', () => {
    const noTotals = FIXTURE.replace('TOTAL A PAGAR 18.192,00 10,00', 'TOTAL A PAGAR');
    const header = parseGaliciaStatement(noTotals);
    const recon = reconcileStatement(parseRows(noTotals), header);
    expect(recon.ars.ok).toBeNull();
    expect(recon.ars.expected).toBeNull();
    // Y sigue informando cuánto se está por importar.
    expect(recon.ars.imported).toBeGreaterThan(0);
  });

  it('una línea en dólares aporta a USD y solo a USD', () => {
    const header = parseGaliciaStatement(FIXTURE);
    const recon = reconcileStatement([{ amountUSD: 7 }], header);
    expect(recon.usd.imported).toBe(7);
    expect(recon.ars.imported).toBe(0);
  });
});

describe('parseGaliciaLine — la línea sin marcador', () => {
  it('lee una línea de consumo que no trae `*` ni `K`', () => {
    // Medido en un resumen real: una fila viene sin marcador y se perdía
    // entera, sin llegar siquiera a «líneas salteadas» accionables.
    const row = parseGaliciaLine('21-11-25 TIENDA SIN MARCADOR 100007 5.000,00', new Map());
    expect(row).not.toBeNull();
    expect(row!.merchant).toBe('TIENDA SIN MARCADOR');
    expect(row!.amountARS).toBe(5_000);
  });

  it('NO confunde «SU PAGO» con un consumo', () => {
    expect(parseGaliciaLine('04-11-25 SU PAGO EN PESOS -100.000,00', new Map())).toBeNull();
    expect(parseGaliciaLine('05-11-25 SU PAGO EN USD -10,00', new Map())).toBeNull();
  });

  it('sin marcador y sin columna COMPROBANTE no adivina', () => {
    expect(parseGaliciaLine('21-11-25 ALGO RARO 5.000,00', new Map())).toBeNull();
  });
});
