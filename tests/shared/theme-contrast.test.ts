/**
 * Los tres niveles de tinta del códice tienen que cumplir WCAG AA (4.5:1) sobre
 * las tres superficies de pergamino que reciben texto. Nació de la decisión 1
 * de la auditoría visual: `--ink-faded` prometía «~6:1 on parchment» y sobre
 * `--parch-2` —donde termina el degradé de cada tarjeta— daba 3.80:1.
 *
 * `--parch-3` no es superficie de texto (barra de scroll, pista de gauge):
 * ni `--ink-soft` llega a 4.5 sobre ella. Se exige el umbral de texto grande
 * (3:1) para que tampoco se degrade en silencio.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/hub/styles/theme.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`no encontré --${name} en theme.css`);
  return m[1].toLowerCase();
}

function luminance(hex: string): number {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g)!.map((h) => parseInt(h, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INKS = ['ink', 'ink-soft', 'ink-faded'] as const;
const TEXT_SURFACES = ['parch-0', 'parch-1', 'parch-2'] as const;

describe('tintas del códice sobre pergamino', () => {
  it('la fórmula reproduce el ratio de referencia negro/blanco', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  for (const ink of INKS) {
    for (const surface of TEXT_SURFACES) {
      it(`--${ink} sobre --${surface} cumple AA (>= 4.5:1)`, () => {
        const ratio = contrast(token(ink), token(surface));
        expect(ratio, `--${ink} ${token(ink)} sobre --${surface} ${token(surface)} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`--${ink} sobre --parch-3 (superficie de profundidad) no baja de 3:1`, () => {
      expect(contrast(token(ink), token('parch-3'))).toBeGreaterThanOrEqual(3);
    });
  }

  it('--ink-faded sigue siendo un escalón distinto de --ink-soft', () => {
    // Oscurecer el token compra contraste a costa de jerarquía: si los dos
    // niveles se funden (< 1.15:1 entre sí) el tercer nivel dejó de existir.
    expect(contrast(token('ink-faded'), token('ink-soft'))).toBeGreaterThanOrEqual(1.15);
  });
});
