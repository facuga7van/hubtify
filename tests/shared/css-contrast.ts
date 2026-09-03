/**
 * Utilidades compartidas por los tests de contraste (`theme-contrast.test.ts` y
 * `css-ink-contrast.test.ts`). NO es un test: vitest sólo recoge `*.test.ts`.
 *
 * Todo lo de acá se DERIVA de las hojas de estilo reales. No hay ni una lista
 * de tokens escrita a mano: una lista a mano se desactualiza en silencio, que
 * es justo la clase de defecto que estos tests cazan.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SRC = resolve(__dirname, '../../src');
export const THEME = join(SRC, 'hub', 'styles', 'theme.css');

/** Umbral WCAG AA para texto normal. */
export const AA = 4.5;

export function luminance(hex: string): number {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g)!.map((h) => parseInt(h, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Borra los comentarios CSS conservando offsets Y renglones: cada carácter que
 * no es salto de línea se cambia por un espacio. Así el número de línea que
 * reporta un fallo es el número de línea del archivo de verdad.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

export function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** Todas las hojas `.css` bajo `src/`, en orden estable. */
export function cssFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Ruta relativa a la raíz del repo, con barras normales, para los mensajes. */
export function rel(file: string): string {
  return `src/${file.slice(SRC.length + 1).replace(/\\/g, '/')}`;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(hex: string): string {
  const h = hex.slice(1).toLowerCase();
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

/**
 * Resuelve el valor REAL de cada token de color de `:root`, siguiendo los alias
 * (`--rpg-gold: var(--gold)`). Devuelve sólo los que terminan en un hex.
 */
export function themeTokens(): Map<string, string> {
  const css = stripComments(readFileSync(THEME, 'utf8'));
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!root) throw new Error('no encontré el bloque :root de theme.css');

  const raw = new Map<string, string>();
  for (const m of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) raw.set(m[1], m[2].trim());

  const resolveToken = (name: string, depth = 0): string | null => {
    const v = raw.get(name);
    if (v === undefined || depth > 8) return null;
    if (HEX.test(v)) return normalizeHex(v);
    const ref = v.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
    return ref ? resolveToken(ref[1], depth + 1) : null;
  };

  const out = new Map<string, string>();
  for (const name of raw.keys()) {
    const hex = resolveToken(name);
    if (hex) out.set(name, hex);
  }
  return out;
}

/** El color de fondo del documento, leído de la regla `body` de theme.css. */
export function documentSurface(): string {
  const css = stripComments(readFileSync(THEME, 'utf8'));
  const body = css.match(/(?:^|\})\s*body\s*\{([^}]*)\}/m);
  const tok = body?.[1].match(/background(?:-color)?\s*:\s*var\(\s*--([a-z0-9-]+)\s*\)/);
  if (!tok) throw new Error('la regla `body` de theme.css ya no declara un fondo con token');
  return tok[1];
}

export interface CssRule {
  file: string;
  /** Fuente con los comentarios blanqueados (offsets y líneas intactos). */
  src: string;
  selector: string;
  body: string;
  /** Offset del primer carácter del cuerpo dentro de `src`. */
  bodyAt: number;
  line: number;
}

/**
 * Bloques `selector { … }` de una hoja. La expresión toma el bloque MÁS INTERNO
 * (`[^{}]` no cruza llaves), así que las reglas dentro de un `@media` salen
 * solas y el `@media` no aparece como selector.
 */
export function rulesOf(file: string): CssRule[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const out: CssRule[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    // Pasos de keyframe (`from`, `to`, `40%`) no son elementos.
    if (/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(selector)) continue;
    const bodyAt = m.index! + m[1].length + 1;
    // La línea de la regla es la del PRIMER carácter del selector, no la del
    // hueco que quedó después de la llave anterior.
    const at = m.index! + (m[1].length - m[1].trimStart().length);
    out.push({ file, src, selector, body: m[2], bodyAt, line: lineOf(src, at) });
  }
  return out;
}

/**
 * Tokens de fondo que declara el bloque: las paradas del degradé o el color
 * plano. `null` = el bloque no declara fondo resoluble (hereda), que NO es lo
 * mismo que declarar `transparent`… salvo para el ojo, que en los dos casos ve
 * lo que hay debajo.
 */
export function surfacesOf(body: string, tokens: Map<string, string>): string[] | null {
  const found: string[] = [];
  for (const m of body.matchAll(/(?:^|[;{\s])background(?:-color|-image)?\s*:\s*([^;}]+)/g)) {
    for (const v of m[1].matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)) {
      if (tokens.has(v[1]) && !found.includes(v[1])) found.push(v[1]);
    }
  }
  return found.length ? found : null;
}

/**
 * ¿El bloque declara ALGÚN fondo, aunque no se pueda medir (`transparent`,
 * `rgba(…)`, una imagen)? Si lo declara, TAPA el del ancestro: mirar hacia
 * arriba daría un número que el ojo nunca ve. `.rpg-button.…--ghost` con
 * `background: transparent` no está sobre cuero, está sobre el pergamino de la
 * tarjeta.
 */
export function declaresBackground(body: string): boolean {
  return /(?:^|[;{\s])background(?:-color|-image)?\s*:/.test(body);
}

/** `opacity` declarada en el bloque (1 si no hay). Degrada el contraste linealmente. */
export function opacityOf(body: string): number {
  const m = body.match(/(?:^|[;{\s])opacity\s*:\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : 1;
}

export function withOpacity(ratio: number, alpha: number): number {
  return 1 + (ratio - 1) * alpha;
}
