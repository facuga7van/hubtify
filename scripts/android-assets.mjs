// Genera TODOS los assets del icono de Android a partir del logo real
// (assets/icon.png, PNG con fondo transparente). Correr con:
//
//   node scripts/android-assets.mjs
//
// Este script es la fuente de verdad de `android/app/src/main/res/mipmap-*`:
// escribe las capas del icono adaptativo, los iconos legacy y la capa
// `monochrome` de Android 13+, en las seis densidades. NO hace falta
// @capacitor/assets para el icono (sí sigue generando `resources/` para el
// splash, ver más abajo).
//
// ── Por qué el fondo dejó de ser cuero ──────────────────────────────────────
// El logo es un tomo de CUERO MARRÓN OSCURO. El fondo adaptativo era
// --leather-dark (#2a1d0e), o sea el mismo marrón: el contraste WCAG entre la
// masa del libro (luminancia mediana 0.0296) y ese fondo era de 1.24:1, y el
// 65 % del contorno del libro quedaba por debajo de 3:1. A 48 dp el icono se
// leía como una mancha marrón con un signo de admiración dorado flotando.
// El fondo ahora es --parch-2 (#d4bc82): 7.11:1 contra la masa del libro.
// Se eligió el pergamino MÁS OSCURO que todavía supera 7:1 porque los broches
// y el canto de las hojas son color crema y se pierden contra un pergamino
// más claro (--parch-0/--parch-1); --parch-2 es el mejor equilibrio entre la
// silueta de cuero y esos detalles claros.
//
// ── Reglas del icono adaptativo que respeta este script ─────────────────────
//   · El lienzo de cada capa es de 108 dp; la máscara del launcher sólo deja
//     ver los 72 dp centrales y varía por fabricante (círculo, squircle,
//     redondeado). El contenido va dentro de un círculo de 66 dp.
//   · Por eso las capas se generan a 108 dp × densidad (81/108/162/216/324/432
//     px), no a 48 dp: antes eran bitmaps de 48 dp que el sistema escalaba
//     2,25× y salían borrosos.
//   · El foreground trae su propio margen en el bitmap. NADA de envolverlo en
//     un `<inset>` en el XML: el `<inset>` que había también se le aplicaba al
//     background, que quedaba con un anillo transparente en el borde del
//     lienzo — visible en cuanto el launcher aplica parallax o una máscara más
//     grande que la estándar.
//   · El background es un `<color>` (values/ic_launcher_background.xml), no un
//     PNG: es exacto a cualquier densidad, no tiene banding ni reescalado.
//     Tiene que ser un color PLANO: el launcher ya recorta con su máscara, así
//     que cualquier degradé radial se lee como un segundo disco dentro del
//     recorte nativo (el viejo efecto de "doble círculo").
//
// Los colores son tokens de src/hub/styles/theme.css. Si cambia el token,
// cambiar la constante de acá.
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'assets/icon.png');
const OUT = resolve(ROOT, 'resources');
const RES = resolve(ROOT, 'android/app/src/main/res');

/** --parch-2. Fondo del icono adaptativo y de los iconos legacy. */
const PARCH_2 = '#d4bc82';
/** --leather-dark. Sólo el splash: a pantalla completa un pergamino claro es un fogonazo. */
const LEATHER_DARK = '#2a1d0e';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const ICON = 1024;
const SPLASH = 2732;

/** Lienzo del icono adaptativo, en dp. */
const CANVAS_DP = 108;
/** Círculo que Android garantiza visible con cualquier máscara, en dp. */
const SAFE_DP = 66;
/** Diámetro del contenido dentro del lienzo de 108 dp. Con holgura sobre SAFE_DP. */
const CONTENT_DP = 63;
/** Lado del icono legacy (pre-API 26), en dp. */
const LEGACY_DP = 48;
/** Misma proporción contenido/viewport que en el adaptativo (63/72). */
const LEGACY_CONTENT_FRACTION = CONTENT_DP / 72;

const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/* ── medición del arte ─────────────────────────────────────────────────── */

const srgb = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

/**
 * Recorta `assets/icon.png` a su caja opaca y mide cuánto sobresale el
 * contenido del centro. Devuelve el arte recortado y `radiusFactor`: la razón
 * entre el diámetro real del contenido y el lado de la caja. Sirve para
 * escalar por RADIO (lo que recorta la máscara circular) y no por caja.
 */
async function measureArt() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const side = Math.max(width, height);
  const cx = minX + (width - 1) / 2;
  const cy = minY + (height - 1) / 2;
  let maxR = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 128) {
        const r = Math.hypot(x - cx, y - cy);
        if (r > maxR) maxR = r;
      }
    }
  }
  const cropped = await sharp(SRC)
    .extract({ left: minX, top: minY, width, height })
    .png()
    .toBuffer();
  return { cropped, width, height, side, radiusFactor: (maxR * 2) / side };
}

/** Escala el arte para que su CONTENIDO tenga `diameterPx` de diámetro. */
async function artAtContentDiameter(art, diameterPx) {
  const boxSide = Math.max(1, Math.round(diameterPx / art.radiusFactor));
  return sharp(art.cropped).resize(boxSide, boxSide, { fit: 'inside' }).png().toBuffer();
}

/** Lienzo cuadrado con el arte centrado. */
function canvasWith(sidePx, background, artBuf) {
  return sharp({ create: { width: sidePx, height: sidePx, channels: 4, background } }).composite([
    { input: artBuf, gravity: 'centre' },
  ]);
}

/* ── capas del icono adaptativo ────────────────────────────────────────── */

/**
 * `ic_launcher_foreground.png` de cada mipmap: lienzo de 108 dp transparente con el
 * arte centrado a CONTENT_DP de diámetro. El margen va en el bitmap, no en el XML.
 */
async function writeAdaptiveForegrounds(art) {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const side = Math.round(CANVAS_DP * scale);
    const dir = resolve(RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const logo = await artAtContentDiameter(art, (CONTENT_DP / CANVAS_DP) * side);
    await canvasWith(side, TRANSPARENT, logo).png().toFile(resolve(dir, 'ic_launcher_foreground.png'));
  }
  console.log(`foreground adaptativo: ${CANVAS_DP} dp en ${Object.keys(DENSITIES).length} densidades`);
}

/**
 * `ic_launcher_monochrome.png` de cada mipmap: iconos con tema de Android 13+.
 * El sistema sólo usa el ALPHA y lo tiñe con el color del wallpaper, así que
 * hace falta una silueta: el cuero queda sólido y el signo de admiración, los
 * broches y el canto de las hojas se calan por luminancia.
 */
const MONO_LUMINANCE_THRESHOLD = 0.3;

async function writeMonochrome(art) {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const side = Math.round(CANVAS_DP * scale);
    const logo = await artAtContentDiameter(art, (CONTENT_DP / CANVAS_DP) * side);
    const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * info.channels;
      const on = data[o + 3] > 128 && luminance(data[o], data[o + 1], data[o + 2]) < MONO_LUMINANCE_THRESHOLD;
      out[i * 4 + 3] = on ? 255 : 0; // RGB en negro: el sistema lo reemplaza por el tinte
    }
    const silhouette = await sharp(out, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const dir = resolve(RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    await canvasWith(side, TRANSPARENT, silhouette)
      .png()
      .toFile(resolve(dir, 'ic_launcher_monochrome.png'));
  }
  console.log(`monochrome (Android 13+): ${CANVAS_DP} dp en ${Object.keys(DENSITIES).length} densidades`);
}

/** El background adaptativo es un `<color>`: exacto a cualquier densidad. */
async function writeBackgroundColor() {
  const dir = resolve(RES, 'values');
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<!-- Generado por scripts/android-assets.mjs. --parch-2 de src/hub/styles/theme.css. -->\n` +
      `<resources>\n    <color name="ic_launcher_background">${PARCH_2}</color>\n</resources>\n`,
    'utf8'
  );
  // Los PNG de fondo de la versión anterior ya no se usan.
  for (const density of Object.keys(DENSITIES)) {
    await rm(resolve(RES, `mipmap-${density}`, 'ic_launcher_background.png'), { force: true });
  }
  console.log(`background: values/ic_launcher_background.xml = ${PARCH_2} (PNG viejos borrados)`);
}

/** El XML del icono adaptativo, sin `<inset>`. */
async function writeAdaptiveIconXml() {
  const dir = resolve(RES, 'mipmap-anydpi-v26');
  await mkdir(dir, { recursive: true });
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!-- Generado por scripts/android-assets.mjs. -->\n` +
    `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
    `    <background android:drawable="@color/ic_launcher_background" />\n` +
    `    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n` +
    `    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n` +
    `</adaptive-icon>\n`;
  await writeFile(resolve(dir, 'ic_launcher.xml'), xml, 'utf8');
  await writeFile(resolve(dir, 'ic_launcher_round.xml'), xml, 'utf8');
  console.log('mipmap-anydpi-v26/ic_launcher{,_round}.xml reescritos (sin <inset>)');
}

/* ── iconos legacy (API 24-25) ─────────────────────────────────────────── */

/** Máscara de un cuadrado redondeado o de un círculo, del tamaño del icono. */
function shapeMask(sidePx, round) {
  const d = round
    ? `<circle cx="${sidePx / 2}" cy="${sidePx / 2}" r="${sidePx / 2}" fill="#fff"/>`
    : `<rect width="${sidePx}" height="${sidePx}" rx="${sidePx * 0.16}" fill="#fff"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sidePx}" height="${sidePx}">${d}</svg>`);
}

async function writeLegacyIcons(art) {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const side = Math.round(LEGACY_DP * scale);
    const dir = resolve(RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const logo = await artAtContentDiameter(art, side * LEGACY_CONTENT_FRACTION);
    const plate = await canvasWith(side, PARCH_2, logo).png().toBuffer();
    for (const [file, round] of [['ic_launcher.png', false], ['ic_launcher_round.png', true]]) {
      const mask = await sharp(shapeMask(side, round)).ensureAlpha().png().toBuffer();
      // `dest-in` conserva el destino sólo donde la máscara tiene alpha.
      await sharp(plate)
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toFile(resolve(dir, file));
    }
  }
  console.log(`iconos legacy: ${LEGACY_DP} dp en ${Object.keys(DENSITIES).length} densidades`);
}

/* ── fuentes de resources/ para @capacitor/assets (splash) ─────────────── */

async function writeCapacitorResources(art) {
  await mkdir(OUT, { recursive: true });
  const iconLogo = await artAtContentDiameter(art, ICON * LEGACY_CONTENT_FRACTION);

  await canvasWith(ICON, PARCH_2, iconLogo).png().toFile(resolve(OUT, 'icon-only.png'));
  await canvasWith(ICON, TRANSPARENT, await artAtContentDiameter(art, ICON * (CONTENT_DP / CANVAS_DP)))
    .png()
    .toFile(resolve(OUT, 'icon-foreground.png'));
  await sharp({ create: { width: ICON, height: ICON, channels: 4, background: PARCH_2 } })
    .png()
    .toFile(resolve(OUT, 'icon-background.png'));

  // El splash sigue EXACTAMENTE como estaba: cuero oscuro con el logo sin
  // recortar al 25 % del lado (por eso usa SRC y no `art`, que está recortado
  // a su caja). El libro ahí también contrasta poco contra el cuero, pero a
  // pantalla completa un pergamino claro es un fogonazo al arrancar: eso se
  // decide junto con el diseño de la pantalla de arranque, no de a un asset.
  const logo = await sharp(SRC)
    .resize(Math.round(SPLASH * 0.25), Math.round(SPLASH * 0.25), { fit: 'inside' })
    .png()
    .toBuffer();
  const splash = await canvasWith(SPLASH, LEATHER_DARK, logo).png().toBuffer();
  await sharp(splash).toFile(resolve(OUT, 'splash.png'));
  await sharp(splash).toFile(resolve(OUT, 'splash-dark.png'));
  console.log(`resources/ generadas en ${OUT}`);
}

async function main() {
  const art = await measureArt();
  console.log(
    `arte: caja ${art.width}x${art.height}, factor de radio ${art.radiusFactor.toFixed(3)} ` +
      `-> contenido ${CONTENT_DP} dp dentro del círculo seguro de ${SAFE_DP} dp`
  );
  await writeBackgroundColor();
  await writeAdaptiveForegrounds(art);
  await writeMonochrome(art);
  await writeAdaptiveIconXml();
  await writeLegacyIcons(art);
  await writeCapacitorResources(art);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
