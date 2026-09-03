/**
 * `getTextContent()` de pdfjs no devuelve renglones: devuelve fragmentos con su
 * matriz de transformación. El parser del resumen es **line-based**
 * (`/^DD-MM-YY /`), así que si los renglones se arman mal el importador de
 * Android no lee nada — y sería un fallo silencioso, no un error.
 *
 * Esta es la única parte del PDF en Android que se puede probar sin un device:
 * es pura, y es la que puede romper el parser.
 */
import { describe, it, expect } from 'vitest';
import { joinTextItems } from '../../src/shared/pdf-text';

/** Un fragmento como lo entrega pdfjs: `transform[4]` es X y `transform[5]` es Y. */
const item = (str: string, x: number, y: number, hasEOL = false) => ({
  str, transform: [1, 0, 0, 1, x, y], hasEOL,
});

describe('joinTextItems', () => {
  it('junta en un renglón los fragmentos que comparten la línea base', () => {
    expect(joinTextItems([
      item('22-06-25', 40, 700),
      item('* TIENDA DEMO', 90, 700),
      item('1.000,00', 400, 700),
    ])).toBe('22-06-25 * TIENDA DEMO 1.000,00');
  });

  it('separa renglones distintos', () => {
    expect(joinTextItems([
      item('primera', 40, 700),
      item('segunda', 40, 680),
    ])).toBe('primera\nsegunda');
  });

  it('tolera el corrimiento de línea base dentro del mismo renglón', () => {
    // Un superíndice o un cambio de fuente mueve la Y uno o dos puntos; partir
    // ahí rompería la línea del resumen en dos y el parser no la reconocería.
    expect(joinTextItems([
      item('27-11-25', 40, 500),
      item('IVA RG 4240', 90, 501.5),
      item('2.976,04', 400, 500),
    ])).toBe('27-11-25 IVA RG 4240 2.976,04');
  });

  it('ordena por X aunque los fragmentos vengan desordenados', () => {
    expect(joinTextItems([
      item('1.000,00', 400, 700),
      item('22-06-25', 40, 700),
    ])).toBe('22-06-25 1.000,00');
  });

  it('respeta hasEOL como fin de renglón explícito', () => {
    expect(joinTextItems([
      item('primera', 40, 700),
      item('', 0, 0, true),
      item('segunda', 40, 700),
    ])).toBe('primera\nsegunda');
  });

  it('descarta fragmentos sin matriz en vez de romperse', () => {
    expect(joinTextItems([
      { str: 'sin transform' },
      item('con transform', 40, 700),
    ])).toBe('con transform');
  });

  it('colapsa espacios múltiples y descarta renglones vacíos', () => {
    expect(joinTextItems([
      item('a', 10, 700), item('   ', 20, 700), item('b', 30, 700),
      item('   ', 10, 680),
    ])).toBe('a b');
  });

  it('sin fragmentos devuelve cadena vacía, no una excepción', () => {
    expect(joinTextItems([])).toBe('');
  });
});
