// Genera las fuentes de `resources/` para `@capacitor/assets` a partir del logo
// real (assets/icon.png, PNG con fondo transparente). Correr con:
//
//   node scripts/android-assets.mjs
//   npx @capacitor/assets generate --android \
//     --iconBackgroundColor '#2a1d0e' --iconBackgroundColorDark '#2a1d0e' \
//     --splashBackgroundColor '#2a1d0e' --splashBackgroundColorDark '#2a1d0e'
//
// Los colores son los tokens de src/hub/styles/theme.css: --leather-dark
// (#2a1d0e) como fondo y --leather (#3a2513) como centro del degradé radial
// del fondo adaptativo. Si cambian los tokens, cambiar LEATHER/LEATHER_DARK.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'assets/icon.png');
const OUT = resolve(ROOT, 'resources');

const LEATHER = '#3a2513';
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

/** Fondo sólido leather-dark con un degradé radial sutil hacia --leather en el centro. */
function radialLeatherBackground(side) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="70%">
      <stop offset="0" stop-color="${LEATHER}"/>
      <stop offset="1" stop-color="${LEATHER_DARK}"/>
    </radialGradient>
  </defs>
  <rect width="${side}" height="${side}" fill="url(#g)"/>
</svg>`;
  return sharp(Buffer.from(svg));
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

  // icon-background: cuero con degradé radial sutil, sin textura.
  await radialLeatherBackground(ICON).png().toFile(resolve(OUT, 'icon-background.png'));

  // splash y splash-dark: cuero sólido, logo centrado al ~25% del lado.
  const splash = await (await logoCentered(SPLASH, Math.round(SPLASH * 0.25), LEATHER_DARK))
    .png()
    .toBuffer();
  await sharp(splash).toFile(resolve(OUT, 'splash.png'));
  await sharp(splash).toFile(resolve(OUT, 'splash-dark.png'));

  console.log(`resources/ generadas en ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
