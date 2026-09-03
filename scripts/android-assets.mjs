// Genera las fuentes de `resources/` para `@capacitor/assets` a partir del logo
// real (assets/icon.png, PNG con fondo transparente). Correr con:
//
//   node scripts/android-assets.mjs
//   npx @capacitor/assets generate --android \
//     --iconBackgroundColor '#2a1d0e' --iconBackgroundColorDark '#2a1d0e' \
//     --splashBackgroundColor '#2a1d0e' --splashBackgroundColorDark '#2a1d0e'
//
// OJO con ese segundo comando: @capacitor/assets 3.0.5 recorta el margen
// transparente de `icon-foreground.png` y lo reescala hasta llenar la capa
// (bbox 80% -> 100% del lado), con lo que el libro se sale de la máscara del
// launcher y queda cortado; además deja los iconos legacy sin su placa de
// cuero. Los `android/app/src/main/res/mipmap-*` versionados están generados
// con una versión anterior que sí respetaba el margen: NO los regeneres con
// 3.0.5. Por eso este script escribe él mismo la capa de fondo adaptativa
// (ver `writeAdaptiveBackgrounds`), que al ser un color plano es exacta a
// cualquier densidad.
//
// Los colores son los tokens de src/hub/styles/theme.css: --leather-dark
// (#2a1d0e) como fondo. Si cambia el token, cambiar LEATHER_DARK.
//
// El fondo del icono adaptativo tiene que ser un color PLANO de borde a borde:
// el launcher ya recorta la capa con su propia máscara (círculo, squircle…), así
// que cualquier degradé radial se lee como un segundo disco dentro del recorte
// nativo — el efecto de "doble círculo". Además el rango del degradé era de sólo
// ~15 niveles RGB, lo que producía bandas concéntricas visibles (banding de 8
// bits) que reforzaban ese borde fantasma.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'assets/icon.png');
const OUT = resolve(ROOT, 'resources');

const LEATHER_DARK = '#2a1d0e';

const ICON = 1024;
const SPLASH = 2732;

/** Escala el logo para que su lado mayor sea `side` px y lo centra en un lienzo. */
async function logoCentered(canvasSide, logoSide, background) {
  const logo = await sharp(SRC)
    .resize(logoSide, logoSide, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: { width: canvasSide, height: canvasSide, channels: 4, background },
  }).composite([{ input: logo, gravity: 'centre' }]);
}

/** Fondo plano leather-dark, de borde a borde (sin degradé: ver el comentario de arriba). */
function flatLeatherBackground(side) {
  return sharp({
    create: { width: side, height: side, channels: 4, background: LEATHER_DARK },
  });
}

/** Lado en px de `mipmap-<densidad>/` para el icono de launcher. */
const MIPMAP_SIDES = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

/**
 * Escribe la capa de fondo del icono adaptativo en cada densidad. Es un color
 * plano, así que no hay reescalado que degradar y no hace falta @capacitor/assets.
 */
async function writeAdaptiveBackgrounds() {
  const res = resolve(ROOT, 'android/app/src/main/res');
  for (const [density, side] of Object.entries(MIPMAP_SIDES)) {
    const dir = resolve(res, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    await flatLeatherBackground(side).png().toFile(resolve(dir, 'ic_launcher_background.png'));
  }
  console.log(`fondo adaptativo plano escrito en ${Object.keys(MIPMAP_SIDES).length} densidades`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  // icon-only: logo con ~10% de margen sobre cuero sólido (iconos legacy, no adaptativos).
  await (await logoCentered(ICON, Math.round(ICON * 0.8), LEATHER_DARK))
    .png()
    .toFile(resolve(OUT, 'icon-only.png'));

  // icon-foreground: capa transparente. @capacitor/assets envuelve esta capa en
  // un <inset 16.7%> al armar el adaptive icon, así que un logo al 80% del lado
  // queda al ~53% del lienzo de 108 dp: dentro del círculo seguro de 66 dp
  // (~61%) que Android no recorta, con margen para las esquinas del libro.
  await (await logoCentered(ICON, Math.round(ICON * 0.8), transparent))
    .png()
    .toFile(resolve(OUT, 'icon-foreground.png'));

  // icon-background: cuero plano de borde a borde. El recorte lo hace el launcher.
  await flatLeatherBackground(ICON).png().toFile(resolve(OUT, 'icon-background.png'));

  // splash y splash-dark: cuero sólido, logo centrado al ~25% del lado.
  const splash = await (await logoCentered(SPLASH, Math.round(SPLASH * 0.25), LEATHER_DARK))
    .png()
    .toBuffer();
  await sharp(splash).toFile(resolve(OUT, 'splash.png'));
  await sharp(splash).toFile(resolve(OUT, 'splash-dark.png'));

  console.log(`resources/ generadas en ${OUT}`);
  await writeAdaptiveBackgrounds();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
