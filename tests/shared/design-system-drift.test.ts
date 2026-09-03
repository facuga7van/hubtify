/**
 * `DESIGN_SYSTEM.md` documentaba `--moss: #556b3c` cuando `theme.css` ya lo
 * tenía en `#40522c` desde que se lo oscureció para cumplir AA. Un sistema de
 * diseño que MIENTE sobre sus propios valores es peor que no tenerlo: el que
 * lo lee calcula ratios con un color que no existe y se va convencido.
 *
 * Es el mismo principio que `css-ink-contrast.test.ts`: la regla no puede vivir
 * sólo en prosa. Acá la prosa y la hoja de estilos no pueden divergir sin que
 * algo se ponga rojo.
 *
 * Lo que se vigila: cada fila de token del documento contra el valor real de
 * `theme.css` —hex, escala tipográfica y escala de z-index—, y al revés, que
 * ningún token de color ni de z-index viva en `theme.css` sin fila propia.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments, THEME } from './css-contrast';

const DOC_PATH = resolve(__dirname, '../../DESIGN_SYSTEM.md');
const doc = readFileSync(DOC_PATH, 'utf8');

/** Valores crudos de `:root`, tal cual están escritos. */
const raw = (() => {
  const css = stripComments(readFileSync(THEME, 'utf8'));
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!root) throw new Error('no encontré el bloque :root de theme.css');
  const out = new Map<string, string>();
  for (const m of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
})();

/** Nombres que el documento cita en cualquier lado, con backticks. */
const mentioned = new Set([...doc.matchAll(/`--([a-z0-9-]+)`/g)].map((m) => m[1]));

const IS_HEX = /^#[0-9a-fA-F]{6}$/;

describe('DESIGN_SYSTEM.md no puede divergir de theme.css', () => {
  it('cada hex documentado es el hex real del token', () => {
    const drift: string[] = [];
    for (const m of doc.matchAll(/\|\s*`--([a-z0-9-]+)`\s*\|\s*`(#[0-9a-fA-F]{6})`/g)) {
      const real = raw.get(m[1]);
      if (real?.toLowerCase() !== m[2].toLowerCase()) {
        drift.push(`--${m[1]}: el doc dice ${m[2]}, theme.css dice ${real ?? '(no existe)'}`);
      }
    }
    expect(drift, 'el documento miente sobre el valor de un token').toEqual([]);
  });

  it('la muestra de color de cada fila usa el mismo hex que la fila', () => {
    // Una fila actualizada a medias (hex nuevo, swatch viejo) sigue mintiendo.
    const drift: string[] = [];
    for (const m of doc.matchAll(
      /\|\s*`--([a-z0-9-]+)`\s*\|\s*`#([0-9a-fA-F]{6})`\s*\|\s*!\[\]\(([^)]*)\)/g,
    )) {
      if (!m[3].toLowerCase().includes(m[2].toLowerCase())) {
        drift.push(`--${m[1]}: la muestra apunta a ${m[3]} y el hex es #${m[2]}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('cada tamaño documentado de la escala tipográfica es el real', () => {
    const drift: string[] = [];
    for (const m of doc.matchAll(/\|\s*`--(fs-[a-z]+)`\s*\|\s*(\d+)px/g)) {
      const want = `calc(${m[2]}px * var(--font-scale))`;
      if (raw.get(m[1]) !== want) {
        drift.push(`--${m[1]}: el doc dice ${m[2]}px, theme.css dice ${raw.get(m[1])}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('cada valor documentado de la escala de z-index es el real', () => {
    const drift: string[] = [];
    for (const m of doc.matchAll(/\|\s*`--(z-[a-z-]+)`\s*\|\s*`(\d+)`/g)) {
      if (raw.get(m[1]) !== m[2]) {
        drift.push(`--${m[1]}: el doc dice ${m[2]}, theme.css dice ${raw.get(m[1]) ?? '(no existe)'}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('ningún token de color vive en theme.css sin fila en el documento', () => {
    // Los alias `--rpg-*` son compatibilidad hacia atrás y el documento los
    // trata como tales: no llevan hex propio.
    const huerfanos = [...raw]
      .filter(([name, value]) => IS_HEX.test(value) && !name.startsWith('rpg-'))
      .map(([name]) => name)
      .filter((name) => !mentioned.has(name));
    expect(huerfanos, 'un token sin documentar es un token que nadie va a usar bien').toEqual([]);
  });

  it('ningún z-index vive en theme.css sin fila en el documento', () => {
    const filas = new Set([...doc.matchAll(/\|\s*`--(z-[a-z-]+)`\s*\|/g)].map((m) => m[1]));
    const huerfanos = [...raw.keys()].filter((n) => n.startsWith('z-') && !filas.has(n));
    expect(huerfanos).toEqual([]);
  });

  it('el barrido encuentra filas de verdad (si el formato cambia, esto avisa)', () => {
    const hexRows = [...doc.matchAll(/\|\s*`--([a-z0-9-]+)`\s*\|\s*`#[0-9a-fA-F]{6}`/g)].length;
    const zRows = [...doc.matchAll(/\|\s*`--(z-[a-z-]+)`\s*\|\s*`\d+`/g)].length;
    expect(hexRows, 'dejó de encontrar filas de color: cambió el formato del documento')
      .toBeGreaterThanOrEqual(17);
    expect(zRows, 'dejó de encontrar filas de z-index').toBeGreaterThanOrEqual(13);
  });
});
