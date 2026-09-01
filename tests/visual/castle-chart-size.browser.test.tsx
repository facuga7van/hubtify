import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { CastleBarChart } from '@shared/components/charts';

import '../../src/hub/styles/theme.css';
import '../../src/shared/components/charts/charts.css';

const SCREENS = 'screens';

/**
 * El gráfico tenía `viewBox="0 0 345 220"` con `width: 100%`, así que el alto
 * dibujado era ancho × (220/345): en una ventana maximizada la proyección a 12
 * meses se dibujaba de ~1000 px de alto, con las cifras enormes pisándose.
 * Acá se mide lo único que importa: que el alto pedido sea el alto real.
 */
const PROYECCION = [
  { label: 'sep', value: 950_000 }, { label: 'oct', value: 947_000 },
  { label: 'nov', value: 943_000 }, { label: 'dic', value: 939_000 },
  { label: 'ene', value: 935_000 }, { label: 'feb', value: 932_000 },
  { label: 'mar', value: 928_000 }, { label: 'abr', value: 924_000 },
  { label: 'may', value: 921_000 }, { label: 'jun', value: 917_000 },
  { label: 'jul', value: 913_000 }, { label: 'ago', value: 909_000 },
];

const fmt = (v: number) => (v >= 1_000 ? `${Math.round(v / 1_000)}K` : `${v}`);

beforeAll(() => { document.body.style.margin = '0'; });

/** Alto realmente dibujado del SVG. */
function svgHeight(): number {
  const svg = document.querySelector('.castle-chart-svg');
  if (!svg) throw new Error('no encontré el gráfico');
  return Math.round(svg.getBoundingClientRect().height);
}

/**
 * ¿Se pisa alguna cifra con la siguiente? Es la queja textual —cajas
 * encimadas— y no depende de cuántas se muestren: si entran, que entren todas;
 * si no, el componente rotula selectivamente. Lo que nunca puede pasar es que
 * se superpongan.
 */
function overlappingValueLabels(): number {
  const boxes = [...document.querySelectorAll('.castle-value-label')]
    .map((el) => el.getBoundingClientRect())
    .sort((a, b) => a.left - b.left);
  let hits = 0;
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i].left < boxes[i - 1].right) hits++;
  }
  return hits;
}

describe('El castillo no crece con el ancho', () => {
  test('tarjeta ancha: el alto es el pedido, no el ancho × proporción', async () => {
    await page.viewport(1640, 900);
    render(
      <div style={{ width: '100%', padding: 16 }}>
        <CastleBarChart data={PROYECCION} height={220} valueFormatter={fmt} themed />
      </div>,
    );
    await new Promise((r) => setTimeout(r, 300)); // que mida el contenedor
    await page.screenshot({ path: `${SCREENS}/chart-01-tarjeta-ancha.png` });

    // Antes: 1640 × (220/345) ≈ 1046 px. Ahora: 220, con holgura por bordes.
    expect(svgHeight()).toBeLessThanOrEqual(240);
    // Y ninguna cifra se encima con la de al lado.
    expect(overlappingValueLabels()).toBe(0);
  });

  test('tarjeta angosta: sigue entrando y ahí sí caben todas las cifras', async () => {
    await page.viewport(420, 700);
    render(
      <div style={{ width: '100%', padding: 8 }}>
        <CastleBarChart data={PROYECCION.slice(0, 4)} height={200} valueFormatter={fmt} themed />
      </div>,
    );
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `${SCREENS}/chart-02-tarjeta-angosta.png` });
    expect(svgHeight()).toBeLessThanOrEqual(220);
    expect(overlappingValueLabels()).toBe(0);
  });
});
