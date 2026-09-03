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
const components = readFileSync(resolve(__dirname, '../../src/hub/styles/components.css'), 'utf8');
const coinify = readFileSync(resolve(__dirname, '../../src/modules/finance/styles/coinify.css'), 'utf8');

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

/**
 * Decisión abierta nº2 de la auditoría (2026-09-01), cerrada el 2026-09-03.
 *
 * `.rpg-button` es el botón firma de la app: sale en las diez pantallas de
 * escritorio y en las once del teléfono. Declaraba `--gold-light` «6.21:1 on
 * leather», pero su fondo es un DEGRADÉ y la parada peor era `--leather-light`,
 * arriba: 4.36:1, por debajo de AA. El test mide contra CADA parada del
 * degradé, que es lo que ve el ojo, no contra un color promedio.
 */
function gradientStops(rule: string): string[] {
  const block = components.match(new RegExp(`\\.${rule}\\s*\\{[^}]*\\}`));
  if (!block) throw new Error(`no encontré .${rule} en components.css`);
  const bg = block[0].match(/background:\s*linear-gradient\(([^;]*)\)\s*;/);
  if (!bg) throw new Error(`.${rule} no declara un degradé`);
  return [...bg[1].matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
}

describe('el botón de cuero cumple AA en TODA parada de su degradé', () => {
  for (const rule of ['rpg-button', 'rpg-btn-sm']) {
    it(`.${rule}: --gold-light sobre cada parada >= 4.5:1`, () => {
      const stops = gradientStops(rule);
      expect(stops.length, `.${rule} sin paradas`).toBeGreaterThan(0);
      for (const stop of stops) {
        const ratio = contrast(token('gold-light'), token(stop));
        expect(ratio, `.${rule}: --gold-light sobre --${stop} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('--leather-light NO alcanza: es exactamente el caso que fallaba', () => {
    // Deja escrito el número del informe. Si alguien vuelve a arrancar un
    // degradé de botón en --leather-light, el test de arriba lo caza.
    expect(contrast(token('gold-light'), token('leather-light'))).toBeLessThan(4.5);
  });

  it('--gold-light sobre cuero es el único oro que se lee: --gold no llega', () => {
    expect(contrast(token('gold'), token('leather'))).toBeLessThan(4.5);
    expect(contrast(token('gold-light'), token('leather'))).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Tercera medición de la rúbrica (2026-09-03): la CARGA RÁPIDA del widget de
 * Coinify, que vive PLEGADA detrás de un toque.
 *
 * Las dos mediciones anteriores sólo miraron el estado por defecto de cada
 * pantalla y por eso nunca vieron este par. Al abrir el formulario, «Ingreso»
 * —habilitado, no deshabilitado, así que WCAG no lo exceptúa— daba 3.62:1:
 * `.rpg-button` pinta `--gold-light` sobre `--leather` (6.23:1) y encima
 * `.coin-dash-quick__type-btn` llevaba `opacity: .5`, que arrastra el texto Y
 * el fondo hacia el pergamino. La opacidad no es un token del sistema y no
 * distingue estados: sólo apaga.
 *
 * El par vive en `.coin-dash-quick__type-btn`, gemelo del par Gasto/Ingreso del
 * libro mayor. Allá el arreglo se hizo sobre `.rpg-btn-active`
 * (components.css:163) y nunca cruzó al widget, que además de heredar
 * `.rpg-button` le encimaba la opacidad. Los tres estados se miden acá contra
 * la superficie que CADA UNO declara, no contra el fondo de la página.
 */
function declarations(sheet: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const m = sheet.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no encontré ${selector} en la hoja`);
  return m[1];
}

/**
 * Superficies candidatas del bloque: las paradas del degradé si declara uno, el
 * color plano si declara uno, y `null` si no declara fondo (entonces hereda).
 */
function surfacesOf(decls: string): string[] | null {
  const grad = decls.match(/background(?:-image)?:\s*linear-gradient\(([^;]*)\)\s*;/);
  if (grad) return [...grad[1].matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
  const flat = decls.match(/background(?:-color)?:\s*var\(--([a-z0-9-]+)\)\s*;/);
  return flat ? [flat[1]] : null;
}

function inkOf(decls: string, fallback: string): string {
  // `border-color:` contiene «color:», así que se ancla al principio de la
  // declaración para no leer el color del BORDE como si fuera el del texto.
  return decls.match(/(?:^|[;{\s])color:\s*var\(--([a-z0-9-]+)\)/)?.[1] ?? fallback;
}

/**
 * Cómo mide el ojo —y el arnés de navegador— un texto sobre un elemento con
 * `opacity`: el contraste se degrada linealmente hacia 1:1.
 */
function withOpacity(ratio: number, alpha: number): number {
  return 1 + (ratio - 1) * alpha;
}

/** Estados heredados de `.rpg-button` cuando el bloque no declara fondo. */
const INHERITED = { surfaces: ['leather', 'leather-dark'], ink: 'gold-light' };

const STATES = [
  '.coin-dash-quick__type-btn',
  '.coin-dash-quick__type-btn--active-expense',
  '.coin-dash-quick__type-btn--active-income',
] as const;

describe('el par Gasto/Ingreso de la carga rápida del widget', () => {
  for (const selector of STATES) {
    it(`${selector} cumple AA sobre la superficie que declara`, () => {
      const decls = declarations(coinify, selector);
      const alpha = parseFloat(decls.match(/(?:^|[;{\s])opacity:\s*([\d.]+)/)?.[1] ?? '1');
      const surfaces = surfacesOf(decls) ?? INHERITED.surfaces;
      const ink = inkOf(decls, INHERITED.ink);
      for (const surface of surfaces) {
        const eff = withOpacity(contrast(token(ink), token(surface)), alpha);
        expect(eff, `${selector}: --${ink} sobre --${surface} con opacity ${alpha} = ${eff.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('ningún estado se apaga con `opacity`: no es un token y no se puede medir', () => {
    // El botón NO está deshabilitado —su vecino «Registrar» sí, y por eso WCAG
    // lo exceptúa—. Si vuelve la opacidad, el test de arriba mide 3.62:1.
    for (const selector of STATES) {
      expect(declarations(coinify, selector), `${selector} volvió a apagarse con opacity`)
        .not.toMatch(/(?:^|[;{\s])opacity:/);
    }
  });

  it('elegido y apagado no pintan lo mismo: la jerarquía sigue existiendo', () => {
    const off = declarations(coinify, '.coin-dash-quick__type-btn');
    for (const mod of ['--active-expense', '--active-income']) {
      const on = declarations(coinify, `.coin-dash-quick__type-btn${mod}`);
      expect(surfacesOf(on), `${mod} no declara fondo propio`).not.toBeNull();
      expect(inkOf(on, INHERITED.ink), `${mod} usa la misma tinta que el apagado`)
        .not.toBe(inkOf(off, INHERITED.ink));
    }
  });
});
