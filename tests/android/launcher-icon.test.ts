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
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// La fórmula WCAG no se duplica: es la misma que usa la auditoría visual.
import { contrast } from '../visual/audit-hub-harness';

const RES = fileURLToPath(new URL('../../android/app/src/main/res/', import.meta.url));

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
