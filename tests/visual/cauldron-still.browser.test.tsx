import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import CauldronSVG from '@modules/cauldron/components/CauldronSVG';

import '../../src/hub/styles/theme.css';
import '../../src/modules/cauldron/styles/cauldron.css';

/**
 * El caldero dibuja 20 `<animate>` SMIL en bucle infinito y un `feGaussianBlur`
 * sobre las llamas, y los dejaba corriendo los 25 minutos de la sesión pase lo
 * que pase. Ni el CSS ni GSAP pueden apagar SMIL, así que
 * `prefers-reduced-motion` —que el resto de la app sí respeta— no llegaba hasta
 * acá: quien pidió que la pantalla se quedara quieta seguía viendo las llamas
 * temblar. Es también lo que tumba al emulador (CAU-03), ver
 * `docs/superpowers/plans/2026-09-03-cauldron-start-crash.md`.
 *
 * Se mide el DOM, no un screenshot: lo que importa es que los nodos que animan
 * NO EXISTAN, no que se vean parecido.
 */
async function mount(animated: boolean) {
  render(
    <CauldronSVG progress={0.4} sessionType="work" paused={false} clipId="t" animated={animated} />,
  );
  // React 19 pinta fuera del tick: sin esto el contenedor todavía está vacío.
  await new Promise((r) => setTimeout(r, 200));
}

const svg = () => document.querySelector('.cauldron-svg') as SVGSVGElement;

describe('CauldronSVG · quieto', () => {
  test('animado: hay SMIL y las llamas llevan el resplandor', async () => {
    await mount(true);
    const el = svg();
    expect(el.querySelectorAll('animate').length).toBeGreaterThan(10);
    // el <g> de la llama principal y el borde del líquido usan el filtro
    const filtered = [...el.querySelectorAll('[filter]')];
    expect(filtered.some((n) => n.querySelector('animate'))).toBe(true);
  });

  test('quieto: ni un solo <animate>, y ningún nodo animado bajo el filtro', async () => {
    await mount(false);
    const el = svg();
    expect(el.querySelectorAll('animate').length).toBe(0);
    // La sombra del piso conserva su filtro (es estática y no cuesta nada);
    // lo que no puede quedar es un filtro envolviendo algo que se mueve.
    const filtered = [...el.querySelectorAll('[filter]')];
    expect(filtered.every((n) => n.querySelector('animate') === null)).toBe(true);
  });

  test('quieto sigue dibujando el caldero: no se vacía la escena', async () => {
    await mount(false);
    const el = svg();
    // mismo relleno de líquido y mismas patas que en la variante animada
    expect(el.querySelectorAll('path').length).toBeGreaterThan(10);
    expect(el.querySelector(`#t-liquidGrad`)).not.toBeNull();
  });
});
