/**
 * Invariantes del icono de launcher de Android.
 *
 * Existe por un bug real (0.9.5): el fondo del icono adaptativo era
 * `--leather-dark` (#2a1d0e), o sea EL MISMO marrón que el tomo de cuero del
 * logo. La masa del libro contrastaba 1.23:1 contra su propio fondo y a 48 dp
 * el icono se leía como una mancha marrón con el "!" dorado flotando.
 * De paso salieron dos bugs latentes: un `<inset 16.7%>` aplicado también al
 * `<background>` (que deja el borde del lienzo de 108 dp transparente) y capas
 * adaptativas dimensionadas como iconos legacy de 48 dp, que el sistema
 * escalaba 2,25×.
 *
 * Los assets los genera `scripts/android-assets.mjs`. Este test verifica el
 * RESULTADO en `android/app/src/main/res`, no el script: si alguien regenera
 * con otra herramienta (por ejemplo @capacitor/assets, que recorta el margen
 * transparente del foreground) o toca un XML a mano, acá se cae.
 *
 * El bloque «XML bien formado» del final existe por el release v0.9.6, que se
 * cayó con estos mismos 2075 tests en verde: el comentario generado en
 * `values/ic_launcher_background.xml` nombraba el token CSS con su prefijo
 * literal de dos guiones, y XML 1.0 §2.5 lo prohíbe dentro de un comentario.
 * Este archivo leía ese XML CON UNA REGEX (`backgroundColor()`), así que el
 * color matcheaba igual y el documento roto pasaba de largo. `build-android`
 * murió en `:app:mergeReleaseResources` y `publish` quedó salteado.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// La fórmula WCAG no se duplica: es la misma que usa la auditoría visual.
import { contrast } from '../visual/audit-hub-harness';

const MAIN = fileURLToPath(new URL('../../android/app/src/main/', import.meta.url));
const RES = `${MAIN}res/`;

/** Escala de cada carpeta de densidad de Android. */
const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;
type Density = keyof typeof DENSITIES;
const EACH = Object.entries(DENSITIES) as Array<[Density, number]>;

/** Lienzo de las capas del icono adaptativo. */
const CANVAS_DP = 108;
/** Lado del icono legacy (pre-API 26). */
const LEGACY_DP = 48;
/** Círculo que Android garantiza visible con cualquier máscara de launcher. */
const SAFE_DP = 66;
/** Mínimo de contraste de la masa del libro contra su fondo. Hoy da ~7.1:1. */
const MIN_CONTRAST = 4.5;

const png = (density: Density, file: string) => `${RES}mipmap-${density}/${file}.png`;

/** Los tamaños que le corresponden a cada archivo en una densidad dada. */
function expectedSides(scale: number): Record<string, number> {
  return {
    ic_launcher_foreground: Math.round(CANVAS_DP * scale),
    ic_launcher_monochrome: Math.round(CANVAS_DP * scale),
    ic_launcher: Math.round(LEGACY_DP * scale),
    ic_launcher_round: Math.round(LEGACY_DP * scale),
  };
}

type Raw = { data: Buffer; width: number; height: number; channels: number };
const decoded = new Map<string, Raw>();

/** Decodifica un PNG a RGBA crudo. Memoizado: cada capa se lee una sola vez. */
async function pixels(path: string): Promise<Raw> {
  const hit = decoded.get(path);
  if (hit) return hit;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { data, width: info.width, height: info.height, channels: info.channels };
  decoded.set(path, raw);
  return raw;
}

/** El color del fondo adaptativo, leído del recurso que usa el XML. */
function backgroundColor(): { css: string; hex: string } {
  const path = `${RES}values/ic_launcher_background.xml`;
  const xml = readFileSync(path, 'utf8');
  const found = xml.match(/<color name="ic_launcher_background">\s*(#[0-9a-fA-F]{6})\s*<\/color>/);
  if (!found) throw new Error(`${path}: no define <color name="ic_launcher_background">#rrggbb</color>`);
  const hex = found[1];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { css: `rgb(${r}, ${g}, ${b})`, hex };
}

describe('icono de launcher de Android', () => {
  describe('las capas están al tamaño exacto de su densidad', () => {
    it.each(EACH)('mipmap-%s', async (density, scale) => {
      for (const [file, side] of Object.entries(expectedSides(scale))) {
        const path = png(density, file);
        expect(existsSync(path), `falta ${path}`).toBe(true);
        const { width, height } = await sharp(path).metadata();
        expect(
          `${width}x${height}`,
          `${path} mide mal: una capa adaptativa va a ${CANVAS_DP} dp y un icono legacy a ${LEGACY_DP} dp ` +
            `(regenerar con \`node scripts/android-assets.mjs\`)`
        ).toBe(`${side}x${side}`);
      }
    });
  });

  describe('el arte del foreground entra en el círculo seguro', () => {
    it.each(EACH)('mipmap-%s', async (density) => {
      const path = png(density, 'ic_launcher_foreground');
      const { data, width, height, channels } = await pixels(path);
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      let maxRadius = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * channels + 3] <= 128) continue;
          const r = Math.hypot(x - cx, y - cy);
          if (r > maxRadius) maxRadius = r;
        }
      }
      const diameterDp = ((maxRadius * 2) / width) * CANVAS_DP;
      expect(
        diameterDp,
        `${path}: el arte llega a Ø ${diameterDp.toFixed(1)} dp dentro del lienzo de ${CANVAS_DP} dp, ` +
          `y la máscara del launcher recorta todo lo que pase de Ø ${SAFE_DP} dp`
      ).toBeLessThanOrEqual(SAFE_DP);
    });
  });

  describe('la masa del libro contrasta contra el fondo', () => {
    it.each(EACH)('mipmap-%s', async (density) => {
      const { css, hex } = backgroundColor();
      const path = png(density, 'ic_launcher_foreground');
      const { data, width, height, channels } = await pixels(path);

      // Se pesa por color y no por pixel: el arte tiene unos pocos miles de
      // colores únicos y así `contrast()` se llama una vez por color.
      const counts = new Map<number, number>();
      for (let i = 0; i < width * height; i++) {
        const o = i * channels;
        if (data[o + 3] <= 250) continue; // sólo la masa opaca, no el antialias del borde
        const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      expect(counts.size, `${path}: no tiene pixeles opacos, ¿se generó vacío?`).toBeGreaterThan(0);

      const ranked = [...counts]
        .map(([key, n]) => ({
          n,
          ratio: contrast(`rgb(${(key >> 16) & 255}, ${(key >> 8) & 255}, ${key & 255})`, css),
        }))
        .sort((a, b) => a.ratio - b.ratio);

      const total = ranked.reduce((sum, e) => sum + e.n, 0);
      let seen = 0;
      let median = ranked[ranked.length - 1].ratio;
      for (const e of ranked) {
        seen += e.n;
        if (seen >= total / 2) {
          median = e.ratio;
          break;
        }
      }

      expect(
        median,
        `${path}: la mitad del libro contrasta ${median.toFixed(2)}:1 o menos contra el fondo ${hex} ` +
          `de values/ic_launcher_background.xml. Con un fondo del mismo marrón que el cuero el libro ` +
          `desaparece a 48 dp (era 1.23:1 antes del fix)`
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  });

  describe('el XML adaptativo tiene un background full-bleed', () => {
    it.each(['ic_launcher', 'ic_launcher_round'])('mipmap-anydpi-v26/%s.xml', (name) => {
      const path = `${RES}mipmap-anydpi-v26/${name}.xml`;
      const xml = readFileSync(path, 'utf8');
      // Primero la forma auto-cerrada (`[^>]*` no cruza un `>`), si no la forma con cierre.
      const background = xml.match(/<background\b[^>]*\/>|<background\b[\s\S]*?<\/background>/)?.[0];
      expect(background, `${path}: no encuentro el elemento <background>`).toBeTruthy();
      expect(
        background!.includes('<inset'),
        `${path}: el <background> tiene un <inset> y eso deja transparente el borde del lienzo de ` +
          `${CANVAS_DP} dp; se ve en cuanto el launcher aplica parallax o una máscara más grande que ` +
          `la estándar de 72 dp. El background va de borde a borde:\n${background}`
      ).toBe(false);
      expect(
        xml,
        `${path}: el <background> tiene que apuntar a @color/ic_launcher_background (un color plano es ` +
          `exacto a cualquier densidad; un PNG se reescala y hace banding)`
      ).toMatch(/<background\s+android:drawable="@color\/ic_launcher_background"\s*\/>/);
    });
  });

  describe('no quedan PNG de fondo sueltos', () => {
    it.each(EACH)('mipmap-%s', (density) => {
      const path = png(density, 'ic_launcher_background');
      expect(
        existsSync(path),
        `${path} volvió a aparecer. El fondo adaptativo es @color/ic_launcher_background: un PNG ` +
          `duplica la fuente de verdad del color y encima se reescala`
      ).toBe(false);
    });
  });

});

/* ── XML bien formado ─────────────────────────────────────────────────────
 *
 * QUÉ VALIDA ESTE BLOQUE Y QUÉ NO.
 *
 * Valida (dos pasadas, sobre TODOS los .xml de `android/app/src/main`, que es
 * lo que Gradle fusiona: `res/`, `res/xml/` y el AndroidManifest):
 *
 *   1. `commentDefect()` — la producción `Comment` de XML 1.0 §2.5, a mano:
 *      el cuerpo de un comentario no puede contener dos guiones seguidos ni
 *      terminar en guion, y todo `<!--` tiene que cerrar. Está separada de la
 *      pasada 2 sólo para dar el mensaje EXACTO de la regla que rompió v0.9.6;
 *      `sax` también la caza, pero la reporta como «Malformed comment» a secas.
 *   2. `parseDefect()` — una pasada completa de `sax` en modo estricto, que es
 *      un parser XML de verdad (el mismo que usa `xml2js`, y por lo tanto el
 *      grueso del tooling de Cordova/Capacitor). Caza tags mal cerrados o sin
 *      cerrar, atributos sin comillas, `<` sin escapar, texto fuera de la raíz,
 *      entidades inválidas y el resto de las reglas de buena formación.
 *      Más un chequeo propio de «exactamente un elemento raíz», que `sax` no
 *      hace (verificado: `<a/><b/>` le pasa limpio).
 *
 * NO valida: nada de lo que va MÁS ALLÁ de la buena formación XML. No hay
 * DTD ni XSD ni resolución de entidades externas; no chequea namespaces, ni
 * atributos duplicados, ni el rango legal de caracteres XML, ni que la
 * declaración `encoding=` coincida con los bytes del archivo. Tampoco es un
 * validador de recursos de Android: que un `@color/…` exista, que un `<style>`
 * herede de un parent real o que el manifest declare permisos coherentes se lo
 * sigue diciendo aapt2 en el build, no este test.
 *
 * `sax` llega hoy como dependencia transitiva de @capacitor/cli
 * (`xml2js` -> `sax`) y de `native-run` (`elementtree` -> `sax`). Se usa tal
 * cual, sin instalar nada nuevo. Si algún día desaparece del árbol, el
 * `require` de abajo tira un error explícito y ESTE ARCHIVO ENTERO no colecta:
 * el guard falla ruidoso, nunca se apaga en silencio.
 */

type SaxParser = {
  line: number;
  column: number;
  error: Error | null;
  onerror: ((err: Error) => void) | null;
  onopentag: ((tag: { name: string }) => void) | null;
  onclosetag: ((tagName: string) => void) | null;
  write(chunk: string | null): SaxParser;
  close(): SaxParser;
  resume(): SaxParser;
};

const nodeRequire = createRequire(import.meta.url);
let sax: { parser(strict: boolean, opt?: Record<string, unknown>): SaxParser };
try {
  sax = nodeRequire('sax');
} catch (cause) {
  throw new Error(
    'No se pudo cargar `sax`, el parser con el que este archivo valida los XML de Android. ' +
      'Hoy llega como dependencia transitiva de @capacitor/cli (xml2js -> sax); si ese árbol ' +
      'cambió, agregá `sax` a devDependencies y listo. NO borres la validación: sin ella un XML ' +
      'mal formado recién se descubre en `:app:mergeReleaseResources`, o sea en CI y con el tag ' +
      'de la versión ya puesto. Pasó en v0.9.6.',
    { cause }
  );
}

/** Todos los `.xml` de `android/app/src/main`, recursivo. */
function androidXmlFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) androidXmlFiles(path, out);
    else if (entry.name.endsWith('.xml')) out.push(path);
  }
  return out.sort();
}

const XML_FILES = androidXmlFiles(MAIN);
const name = (path: string) => relative(MAIN, path).split(sep).join('/');
const XML_NAMES = XML_FILES.map(name);

type Defect = { line: number; column: number; rule: string };

/** Línea (1-indexada) y columna (1-indexada) de un offset del documento. */
function locate(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: offset - lastBreak };
}

/** Archivo, línea, columna, la línea ofensora con un cursor debajo, y la regla. */
function report(path: string, text: string, defect: Defect): string {
  const source = text.split('\n')[defect.line - 1] ?? '';
  const gutter = ' '.repeat(String(defect.line).length);
  return (
    `\n${path}:${defect.line}:${defect.column}\n` +
    `  XML mal formado: ${defect.rule}\n\n` +
    `  ${defect.line} | ${source}\n` +
    `  ${gutter} | ${' '.repeat(Math.max(0, defect.column - 1))}^\n`
  );
}

/**
 * Producción `Comment` de XML 1.0 §2.5. Separada del parser sólo para nombrar
 * la regla con precisión: es la que voló el release v0.9.6.
 */
function commentDefect(text: string): Defect | null {
  const OPEN = '<!--';
  const CLOSE = '-->';
  const CDATA = '<![CDATA[';
  let i = 0;
  for (;;) {
    const open = text.indexOf(OPEN, i);
    if (open === -1) return null;
    // Dentro de un CDATA, `<!--` es texto literal y no abre nada.
    const cdata = text.indexOf(CDATA, i);
    if (cdata !== -1 && cdata < open) {
      const end = text.indexOf(']]>', cdata + CDATA.length);
      if (end === -1) {
        return { ...locate(text, cdata), rule: 'sección CDATA sin cerrar: falta el `]]>`' };
      }
      i = end + 3;
      continue;
    }
    const close = text.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      return { ...locate(text, open), rule: 'comentario sin cerrar: falta el `-->`' };
    }
    const body = text.slice(open + OPEN.length, close);
    const dashes = body.indexOf('--');
    if (dashes !== -1) {
      return {
        ...locate(text, open + OPEN.length + dashes),
        rule:
          'un comentario XML no puede contener dos guiones seguidos (XML 1.0 §2.5, producción ' +
          '`Comment`). aapt2 aborta `:app:mergeReleaseResources` con «The string "--" is not ' +
          'permitted within comments» y se cae el build de Android. Si querés nombrar un token ' +
          'de tema, escribilo SIN el prefijo de custom property: `parch-2`, no el nombre literal',
      };
    }
    if (body.endsWith('-')) {
      return {
        ...locate(text, close - 1),
        rule: 'el cuerpo de un comentario XML no puede terminar en guion (queda `--->`)',
      };
    }
    i = close + CLOSE.length;
  }
}

/** Pasada de `sax` en estricto: buena formación general. Devuelve el PRIMER defecto. */
function parseDefect(text: string): Defect | null {
  const parser = sax.parser(true, { xmlns: false });
  let first: Defect | null = null;
  let depth = 0;
  let roots = 0;

  const record = (err: unknown) => {
    if (first) return;
    // `sax` cuenta líneas desde 0 y columnas desde 1.
    first = {
      line: parser.line + 1,
      column: Math.max(1, parser.column),
      rule: String((err as Error)?.message ?? err).split('\n')[0],
    };
  };

  parser.onerror = (err) => {
    record(err);
    // Seguir parseando: si no, `close()` vuelve a tirar el ÚLTIMO error y se
    // pierde la posición del primero, que es el que importa.
    parser.resume();
  };
  parser.onopentag = () => {
    if (depth === 0) roots++;
    depth++;
  };
  parser.onclosetag = () => {
    depth--;
  };

  try {
    parser.write(text).close();
  } catch (err) {
    record(err);
  }

  if (!first && roots !== 1) {
    return {
      line: 1,
      column: 1,
      rule: `el documento tiene ${roots} elementos raíz y XML exige exactamente 1`,
    };
  }
  return first;
}

describe('los XML de Android están bien formados', () => {
  it('el barrido encuentra los recursos que Gradle fusiona', () => {
    // Sin esto el guard se puede volver VACÍO en silencio: si el walk se rompe
    // o alguien mueve la carpeta, `it.each([])` no prueba nada y todo pasa.
    // 8 es el piso: los 8 XML versionados. `res/xml/config.xml` lo agrega
    // `cap sync`, así que en un checkout limpio de CI todavía no está.
    expect(XML_FILES.length, `no encontré XML bajo ${MAIN}`).toBeGreaterThanOrEqual(8);
    for (const expected of [
      'AndroidManifest.xml',
      'res/values/ic_launcher_background.xml',
      'res/values/strings.xml',
      'res/values/styles.xml',
      'res/layout/activity_main.xml',
      'res/xml/file_paths.xml',
      'res/mipmap-anydpi-v26/ic_launcher.xml',
      'res/mipmap-anydpi-v26/ic_launcher_round.xml',
    ]) {
      expect(XML_NAMES, `${expected} se cayó del barrido`).toContain(expected);
    }
  });

  it.each(XML_FILES.map((path) => [name(path), path]))('%s', (_name, path) => {
    const text = readFileSync(path, 'utf8');
    const defect = commentDefect(text) ?? parseDefect(text);
    expect(defect === null, defect ? report(path, text, defect) : '').toBe(true);
  });
});
