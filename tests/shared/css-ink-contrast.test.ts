/**
 * ¿Por qué existe este test?
 *
 * Porque en UNA SOLA iteración aparecieron CUATRO ocurrencias de la misma clase
 * de defecto: «se arregla donde mira la medición». La regla existe, está
 * escrita, y se viola en la misma hoja que la enuncia.
 *
 * El caso testigo: `src/hub/rewards/rewards.css:69-72` ESCRIBE la regla —
 * «--gold-dark sobre pergamino es 3.84 / 3.26 / 2.55: el oro no es tinta»— y la
 * aplica a `.rwd-purse__label`. TRESCIENTAS TREINTA Y TRES LÍNEAS MÁS ABAJO, EN
 * LA MISMA HOJA, `.shop-item__state` seguía pintando `var(--gold-dark)`.
 * `DESIGN_SYSTEM.md` lo dice en prosa desde hace versiones. No alcanzó.
 *
 * Una regla en un comentario no es una regla. Esto es la regla.
 *
 * Cómo funciona, y por qué así:
 *
 * 1. Los valores salen de `theme.css`, resolviendo alias. NO hay ni una lista
 *    de tokens escrita a mano: una lista a mano se desactualiza en silencio y
 *    ése es exactamente el defecto que estamos cazando.
 * 2. La lista de tokens PROHIBIDOS como tinta se DERIVA: para cada familia de
 *    superficie (pergamino, cuero) un token que no llega a 4.5:1 contra
 *    NINGUNA de sus superficies no puede ser `color:` de texto sobre ella.
 * 3. El barrido recorre TODAS las hojas de `src/` y mide cada `color:` /
 *    `-webkit-text-fill-color:` contra la superficie que le corresponde:
 *    la que declara el propio bloque (cada parada del degradé, que es lo que ve
 *    el ojo), la que declara el ancestro más cercano, o —si no hay ninguna— la
 *    familia del fondo del documento.
 * 4. Escape explícito y AUDITABLE: un comentario `contrast-ok: <razón>` sobre
 *    la declaración (o sobre el selector, para todo el bloque). La razón es
 *    OBLIGATORIA, y un escape que ya no cubre nada por debajo de AA también
 *    falla: los permisos muertos son cómo una lista de excepciones se pudre.
 *
 * El censo, para que quede el número: sobre el código de 2b5f948 este barrido
 * levantaba 70 pares (declaración, superficie) por debajo de 4.5:1. Cincuenta
 * se arreglaron con tokens; los veinte que quedan son ornamento, íconos o
 * contenido no textual y están cubiertos por 19 escapes con su razón escrita.
 * La medición con arnés de navegador había encontrado 7 de esos 70.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AA,
  contrast,
  cssFiles,
  declaresBackground,
  documentSurface,
  lineOf,
  opacityOf,
  rel,
  rulesOf,
  surfacesOf,
  themeTokens,
  withOpacity,
} from './css-contrast';

const tokens = themeTokens();
const hex = (t: string) => tokens.get(t)!;

/** Familias de superficie, derivadas del nombre de los tokens de `theme.css`. */
const FAMILIES = {
  pergamino: [...tokens.keys()].filter((t) => /^parch-\d+$/.test(t)).sort(),
  cuero: [...tokens.keys()].filter((t) => /^leather(-[a-z]+)?$/.test(t)).sort(),
} as const;

/** Mejor ratio que consigue una tinta contra alguna superficie de la familia. */
function bestOn(ink: string, family: readonly string[]): { surface: string; ratio: number } {
  return family
    .map((surface) => ({ surface, ratio: contrast(hex(ink), hex(surface)) }))
    .reduce((a, b) => (b.ratio > a.ratio ? b : a));
}

/** Tokens que NO llegan a AA contra ninguna superficie de la familia. */
function forbiddenOn(family: readonly string[]): string[] {
  return [...tokens.keys()].filter((t) => bestOn(t, family).ratio < AA).sort();
}

const DOC_SURFACE = documentSurface();
/** Todas las superficies que la app usa como fondo de texto. */
const ALL_SURFACES = [...FAMILIES.pergamino, ...FAMILIES.cuero];

// ── índice de superficies: selector → tokens de fondo ────────────────────────

function normalizeSel(sel: string): string {
  return sel
    .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
    .replace(/\s*[>+~]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un paso de «subir» dentro de un compuesto. El orden importa: primero el
 * modificador (`--m`), después el elemento BEM (`__e`), después la clase extra
 * de un compuesto (`.a.b`) y por último un segmento de guion simple
 * (`.sidebar-nav-item` → `.sidebar-nav` → `.sidebar`), que es como esta base
 * nombra la contención antes de que existiera el BEM-lite.
 */
function reduceCompound(c: string): string | null {
  if (/[a-zA-Z0-9]--[a-zA-Z0-9-]+$/.test(c)) return c.replace(/--[a-zA-Z0-9-]+$/, '');
  if (/[a-zA-Z0-9]__[a-zA-Z0-9-]+$/.test(c)) return c.replace(/__[a-zA-Z0-9-]+$/, '');
  const compound = c.match(/^(.+)\.[a-zA-Z0-9_-]+$/);
  if (compound && compound[1]) return compound[1];
  const seg = c.match(/^(\.[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)-[a-zA-Z0-9]+$/);
  return seg ? seg[1] : null;
}

/** Cadena de candidatos a ancestro, del más específico al más general. */
function* ancestors(sel: string): Generator<string> {
  const parts = normalizeSel(sel).split(' ').filter(Boolean);
  while (parts.length) {
    let cur: string | null = parts[parts.length - 1];
    while (cur) {
      yield [...parts.slice(0, -1), cur].join(' ');
      cur = reduceCompound(cur);
    }
    parts.pop();
  }
}

const ALL_RULES = cssFiles().flatMap((f) => rulesOf(f));

const SURFACE_INDEX = new Map<string, { surfaces: string[]; selector: string }>();
for (const rule of ALL_RULES) {
  const surfaces = surfacesOf(rule.body, tokens);
  if (!surfaces) continue;
  for (const part of rule.selector.split(',')) {
    // Sólo se indexa el estado EN REPOSO. Un `:hover` o un `::before` no son la
    // superficie del elemento: el primero es otro estado, el segundo es un hijo
    // que se pinta ENCIMA. Indexarlos daba «heredado de .nutri-pill-portion:hover».
    if (part.includes(':')) continue;
    const key = normalizeSel(part);
    if (key && !SURFACE_INDEX.has(key)) SURFACE_INDEX.set(key, { surfaces, selector: part.trim() });
  }
}

/**
 * Un bloque BEM cuyo CONTENEDOR interno también pinta fondo es ambiguo:
 * `.mobile-fatal` es cuero, pero `.mobile-fatal__title` vive dentro de
 * `.mobile-fatal__card`, que es pergamino. Subir hasta el bloque daría un
 * número que el ojo nunca ve. Cuando pasa eso se prefiere no afirmar nada.
 */
function ambiguousBlock(cand: string): boolean {
  const last = cand.split(' ').pop()!;
  return [...SURFACE_INDEX.keys()].some((k) => k.split(' ').pop()!.startsWith(`${last}__`));
}

function inherited(sel: string): { surfaces: string[]; from: string } | null {
  for (const part of sel.split(',')) {
    const wasElement = /[a-zA-Z0-9]__[a-zA-Z0-9-]+/.test(part);
    for (const cand of ancestors(part)) {
      const hit = SURFACE_INDEX.get(cand);
      if (!hit) continue;
      if (wasElement && ambiguousBlock(cand)) return null;
      return { surfaces: hit.surfaces, from: hit.selector };
    }
  }
  return null;
}

// ── escapes explícitos ───────────────────────────────────────────────────────

const MARKER = /\/\*\s*contrast-ok\s*:([^*]*)\*\//g;

interface Marker {
  line: number;
  reason: string;
  file: string;
  used: boolean;
}

function markersOf(file: string): Map<number, Marker> {
  const raw = readFileSync(file, 'utf8');
  const out = new Map<number, Marker>();
  for (const m of raw.matchAll(MARKER)) {
    // Se indexa por la línea del CIERRE del comentario: un escape puede ocupar
    // varios renglones, y lo que cubre es lo que viene justo después.
    const line = lineOf(raw, m.index! + m[0].length - 1);
    out.set(line, { line, reason: m[1].replace(/\s+/g, ' ').trim(), file, used: false });
  }
  return out;
}

// ── el barrido ───────────────────────────────────────────────────────────────

interface Violation {
  where: string;
  selector: string;
  prop: string;
  ink: string;
  surface: string;
  ratio: number;
  origin: string;
}

const INK_DECL = /(?:^|[;{\s])(-webkit-text-fill-color|color)\s*:\s*var\(\s*--([a-z0-9-]+)\s*\)/g;

const violations: Violation[] = [];
const allMarkers: Marker[] = [];

for (const file of cssFiles()) {
  const markers = markersOf(file);
  allMarkers.push(...markers.values());

  for (const rule of rulesOf(file)) {
    const own = surfacesOf(rule.body, tokens);
    // `opacity: 0` es un estado de partida: otra regla (o una animación) lo
    // revela, y el color casi siempre se declara acá, en el bloque escondido.
    // Medirlo como 0 daría 1.00:1 en todos lados y taparía el color real; se
    // mide el estado REVELADO, que es el que el ojo termina viendo.
    const declared = opacityOf(rule.body);
    const alpha = declared === 0 ? 1 : declared;

    for (const m of rule.body.matchAll(INK_DECL)) {
      const [prop, ink] = [m[1], m[2]];
      if (!tokens.has(ink)) continue;

      const line = lineOf(rule.src, rule.bodyAt + m.index! + m[0].indexOf(prop));
      const escape =
        markers.get(line) ?? markers.get(line - 1) ?? markers.get(rule.line) ?? markers.get(rule.line - 1);

      // Pares (superficie, ratio) que hay que verificar.
      let pairs: { surface: string; ratio: number }[];
      let origin: string;
      // Un bloque que declara fondo TAPA el del ancestro, aunque ese fondo no
      // se pueda medir; en ese caso no se hereda: se cae al caso general.
      const from = declaresBackground(rule.body) ? null : inherited(rule.selector);

      if (own) {
        origin = 'fondo declarado en el bloque';
        pairs = own.map((s) => ({ surface: s, ratio: contrast(hex(ink), hex(s)) }));
      } else if (from) {
        origin = `fondo heredado de \`${from.from}\``;
        pairs = from.surfaces.map((s) => ({ surface: s, ratio: contrast(hex(ink), hex(s)) }));
      } else {
        // No se puede saber sobre qué está. Lo único que SÍ se puede afirmar:
        // si no llega a AA contra NINGUNA superficie de NINGUNA familia, ese
        // token no es tinta en ningún lado y da igual dónde caiga el elemento.
        origin = 'sin fondo resoluble; el token no llega a AA sobre NINGUNA superficie de la app';
        pairs = [bestOn(ink, ALL_SURFACES)];
      }

      for (const { surface, ratio } of pairs) {
        const eff = withOpacity(ratio, alpha);
        if (eff >= AA) continue;
        if (escape) {
          escape.used = true;
          continue;
        }
        violations.push({
          where: `${rel(file)}:${line}`,
          selector: rule.selector,
          prop,
          ink,
          surface,
          ratio: eff,
          origin,
        });
      }
    }
  }
}

function report(list: Violation[]): string {
  return list
    .map(
      (v) =>
        `  ${v.where}  ${v.selector}\n` +
        `      ${v.prop}: var(--${v.ink}) sobre --${v.surface} = ${v.ratio.toFixed(2)}:1  (${v.origin})`,
    )
    .join('\n');
}

// ── los tests ────────────────────────────────────────────────────────────────

describe('la regla derivada: qué token puede ser tinta sobre qué familia', () => {
  it('las familias salen de los nombres de theme.css, no de una lista a mano', () => {
    expect(FAMILIES.pergamino).toEqual(['parch-0', 'parch-1', 'parch-2', 'parch-3']);
    expect(FAMILIES.cuero).toEqual(['leather', 'leather-dark', 'leather-light']);
  });

  it('el oro NO es tinta sobre pergamino: --gold y --gold-dark quedan prohibidos', () => {
    const prohibidos = forbiddenOn(FAMILIES.pergamino);
    for (const oro of ['gold', 'gold-dark']) {
      const best = bestOn(oro, FAMILIES.pergamino);
      expect(
        prohibidos,
        `--${oro} llega a ${best.ratio.toFixed(2)}:1 sobre --${best.surface}: la regla escrita dice que no debería`,
      ).toContain(oro);
    }
    expect(prohibidos, '--ink-soft es la tinta que reemplaza al oro sobre pergamino').not.toContain(
      'ink-soft',
    );
  });

  it('sobre --leather, --gold-light es el único oro legible', () => {
    // La superficie de cuero que más texto lleva es `--leather` (sidebar,
    // botones, cabecera del teléfono), no la familia entera.
    expect(contrast(hex('gold'), hex('leather'))).toBeLessThan(AA);
    expect(contrast(hex('gold-dark'), hex('leather'))).toBeLessThan(AA);
    expect(contrast(hex('gold-light'), hex('leather'))).toBeGreaterThanOrEqual(AA);
    expect(forbiddenOn(FAMILIES.cuero)).toContain('gold-dark');
    expect(forbiddenOn(FAMILIES.cuero)).not.toContain('gold-light');
  });

  it('--gold-dark no es tinta en NINGUNA superficie de la app', () => {
    // Es el token del caso testigo: 3.84:1 en su mejor pergamino y 3.47:1 en su
    // mejor cuero. Por eso el barrido lo caza incluso donde no puede resolver
    // el fondo.
    const best = bestOn('gold-dark', ALL_SURFACES);
    expect(best.ratio, `--gold-dark llega a ${best.ratio.toFixed(2)}:1 sobre --${best.surface}`)
      .toBeLessThan(AA);
  });

  it('el fondo del documento sale de la regla `body` de theme.css', () => {
    expect(FAMILIES.pergamino).toContain(DOC_SURFACE);
  });
});

describe('barrido de TODAS las hojas de src/', () => {
  it('el barrido encuentra hojas, reglas y declaraciones de color', () => {
    expect(cssFiles().length).toBeGreaterThan(15);
    expect(ALL_RULES.length).toBeGreaterThan(1000);
    expect(SURFACE_INDEX.size).toBeGreaterThan(50);
  });

  it('ninguna declaración de color pinta un token ilegible sobre su superficie', () => {
    expect(
      violations.length,
      violations.length
        ? `${violations.length} declaraciones por debajo de ${AA}:1.\n` +
          'Arreglalas con tokens (el oro con texto sobre pergamino va a --ink-soft;\n' +
          'sobre cuero, --gold-light; una superficie dorada con texto arranca en --gold-light),\n' +
          'o marcá el uso deliberado con /* contrast-ok: <razón> */ en la línea anterior.\n' +
          report(violations)
        : '',
    ).toBe(0);
  });
});

describe('los escapes son explícitos, justificados y vivos', () => {
  it('todo /* contrast-ok: … */ trae una razón', () => {
    const mudos = allMarkers.filter((m) => m.reason.length < 8);
    expect(
      mudos.map((m) => `${rel(m.file)}:${m.line}`),
      'un escape sin explicación no es un escape, es un agujero',
    ).toEqual([]);
  });

  it('ningún escape está muerto: todos cubren un caso real por debajo de AA', () => {
    const muertos = allMarkers.filter((m) => !m.used);
    expect(
      muertos.map((m) => `${rel(m.file)}:${m.line} — «${m.reason}»`),
      'ese uso ya cumple AA: sacá el escape antes de que alguien lo copie',
    ).toEqual([]);
  });
});
