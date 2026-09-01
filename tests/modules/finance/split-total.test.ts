import { describe, it, expect } from 'vitest';
import {
  splitTotalIntoInstallments,
  installmentAmountsFromTotal,
} from '../../../src/modules/finance/utils/split-total';

/**
 * Lo único que no puede fallar: la suma de las cuotas es el total tipeado.
 * Un plan que suma un centavo de menos hace que el cofre no cuadre con el
 * resumen del banco, que es exactamente la confianza que Coinify tiene que
 * ganarse.
 */
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('repartir un total en cuotas', () => {
  it('división exacta: todas iguales', () => {
    expect(splitTotalIntoInstallments(900_000, 12)).toEqual({ per: 75_000, last: 75_000 });
  });

  it('división con resto: la última absorbe el centavo', () => {
    // 100.000 / 3 = 33.333,333… → tres de 33.333,33 suman 99.999,99.
    expect(splitTotalIntoInstallments(100_000, 3)).toEqual({ per: 33_333.33, last: 33_333.34 });
  });

  it('la suma de las cuotas es SIEMPRE el total, con o sin resto', () => {
    const casos: Array<[number, number]> = [
      [900_000, 12], [100_000, 3], [1, 3], [0.05, 3], [275_000, 7],
      [1_234_567.89, 11], [999_999_999, 120], [50, 4],
    ];
    for (const [total, count] of casos) {
      const amounts = installmentAmountsFromTotal(total, count)!;
      expect(amounts).toHaveLength(count);
      expect(sum(amounts), `${total} en ${count}`).toBe(Math.round(total * 100) / 100);
    }
  });

  it('una sola cuota es el total entero', () => {
    expect(splitTotalIntoInstallments(80_000, 1)).toEqual({ per: 80_000, last: 80_000 });
    expect(installmentAmountsFromTotal(80_000, 1)).toEqual([80_000]);
  });

  it('rechaza lo que no es un plan', () => {
    expect(splitTotalIntoInstallments(0, 3)).toBeNull();
    expect(splitTotalIntoInstallments(-100, 3)).toBeNull();
    expect(splitTotalIntoInstallments(100, 0)).toBeNull();
    expect(splitTotalIntoInstallments(100, 2.5)).toBeNull();
    expect(splitTotalIntoInstallments(NaN, 3)).toBeNull();
    expect(splitTotalIntoInstallments(100, NaN)).toBeNull();
  });
});
