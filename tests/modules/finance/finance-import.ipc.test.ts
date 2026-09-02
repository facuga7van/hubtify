import { describe, it, expect } from 'vitest';
import { parseGaliciaLine } from '../../../shared-logic/modules/finance-import.ipc';

describe('Galicia VISA PDF parser', () => {
  const defaultMappings = new Map<string, string>([
    ['RAPPI', 'Delivery'],
    ['MERPAGO', 'Compras'],
    ['GOOGLE', 'Suscripciones'],
    ['TWITCH', 'Suscripciones'],
    ['FRAVEGA', 'Compras'],
    ['UBER', 'Transporte'],
    ['TELECENTRO', 'Servicios'],
    ['CRUNCHYROLL', 'Suscripciones'],
    ['OPENAI', 'Suscripciones'],
  ]);

  it('parses a simple ARS expense line', () => {
    const result = parseGaliciaLine(
      '02-11-25 * RAPPIPRO 299493 7.999,00',
      defaultMappings
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2025-11-02');
    expect(result!.merchant).toBe('RAPPIPRO');
    expect(result!.amountARS).toBeCloseTo(7999);
    expect(result!.suggestedCategory).toBe('Delivery');
  });

  it('parses an installment line', () => {
    const result = parseGaliciaLine(
      '09-10-25 * WWW.FRAVEGA.COM 02/03 001177 29.999,66',
      defaultMappings
    );
    expect(result).not.toBeNull();
    expect(result!.installmentCurrent).toBe(2);
    expect(result!.installmentTotal).toBe(3);
    expect(result!.amountARS).toBeCloseTo(29999.66);
    expect(result!.suggestedCategory).toBe('Compras');
  });

  it('parses a USD line', () => {
    const result = parseGaliciaLine(
      '02-11-25 K GOOGLE *YouTubeP P1fMHM2Z USD        4,76 530613 4,76',
      defaultMappings
    );
    expect(result).not.toBeNull();
    expect(result!.amountUSD).toBeCloseTo(4.76);
    expect(result!.suggestedCategory).toBe('Suscripciones');
  });

  /**
   * These lines used to be thrown away (`isExcluded: true`), which is exactly why
   * the imported total never matched the paper the bank sends. They are real
   * charges: they are parsed like any other row, under the reserved category.
   *
   * The amount is always the LAST money-shaped token — every one of these formats
   * prints the taxable base first and the charge last.
   */
  it('parses tax lines as ordinary rows under the reserved category', () => {
    const taxes: Array<[string, number]> = [
      ['27-11-25 IMP DE SELLOS P/INT.FIN.  $ 3,75', 3.75],
      ['27-11-25 INTERESES FINANCIACION    $ 341,67', 341.67],
      ['27-11-25 DB IVA $ 21%                               341,67 71,75', 71.75],
      ['27-11-25 IIBB PERCEP-CABA 2,00%(   14171,62) 283,43', 283.43],
      ['27-11-25 IVA RG 4240 21%(   14171,62) 2.976,04', 2976.04],
      ['27-11-25 DB.RG 5617  30% (    53183,56 ) 15.955,06', 15955.06],
    ];
    for (const [line, expected] of taxes) {
      const result = parseGaliciaLine(line, defaultMappings);
      expect(result, line).not.toBeNull();
      expect(result!.isExcluded).toBe(false);
      expect(result!.isTax).toBe(true);
      expect(result!.suggestedCategory).toBe('Impuestos de tarjeta');
      expect(result!.amountARS).toBeCloseTo(expected);
      expect(result!.merchant.length).toBeGreaterThan(0);
    }
  });

  it('reports a DEV.IMP refund as a negative amount', () => {
    const result = parseGaliciaLine('10-11-25 DEV.IMP DE SELLOS  $ 3,75', defaultMappings);
    expect(result).not.toBeNull();
    expect(result!.isTax).toBe(true);
    expect(result!.amountARS).toBeCloseTo(-3.75);
  });

  /** The old unanchored `/IVA RG/i` would have eaten this merchant whole. */
  it('does not mistake a merchant name for a tax line', () => {
    const result = parseGaliciaLine('02-11-25 * IVA RGB STORE 299493 7.999,00', defaultMappings);
    expect(result).not.toBeNull();
    expect(result!.isTax).toBeUndefined();
    expect(result!.suggestedCategory).not.toBe('Impuestos de tarjeta');
    expect(result!.merchant.startsWith('IVA RGB')).toBe(true);
    expect(result!.amountARS).toBeCloseTo(7999);
  });

  it('parses negative amounts (refunds)', () => {
    const result = parseGaliciaLine(
      '14-11-25 K DLO*RAPPI 008277 -22.590,00',
      defaultMappings
    );
    expect(result).not.toBeNull();
    expect(result!.amountARS).toBeCloseTo(-22590);
  });

  it('defaults unknown merchants to Otros', () => {
    const result = parseGaliciaLine(
      '12-11-25 K ONCITY.COM 01/03 006204 7.143,00',
      new Map()
    );
    expect(result).not.toBeNull();
    expect(result!.suggestedCategory).toBe('Otros');
  });
});
