import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { lowContrastText, smallText, LEATHER_WORST } from '../audit-hub-harness';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/hub/styles/codex-seal.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';

/**
 * C11 en el teléfono. El cajón es la ÚNICA navegación de las once pantallas y
 * ahí `title=` NO EXISTE: todo lo que se explicaba sólo por hover era, en
 * Android, invisible. Acá se mide que las reglas de la racha estén PINTADAS,
 * con el piso de 13 px, 4.5:1 contra la parada más oscura del cuero y sin
 * desbordar a 390 px.
 *
 * La función del ítem del menú NO se pinta. Se pintó como segundo renglón
 * (b8bc72f) y se amontonaba: la fila es `min-height: 44px` con
 * `flex-shrink: 1` dentro de un flex column, así que el renglón de más no la
 * agrandaba — le aplastaba el contenido. Medido: cada ítem pedía 52.4 px y
 * recibía 44, y «Coinify» (dos renglones en los 268 px útiles) pedía 69.3 y su
 * segunda línea caía 18.3 px por fuera del botón, encima del rótulo
 * «Caldero» (separación −10.3 px).
 *
 * El test que debía agarrar eso medía `getBoundingClientRect().height >= 44` y
 * pasaba EXACTAMENTE porque el flex aplastaba las filas a los 44 px del
 * mínimo: medía la caja, nunca si el contenido entraba. La guarda de abajo
 * mide las dos cosas — un solo renglón pintado y contenido que entra.
 */
beforeAll(() => {
  installApi();
  localStorage.removeItem('hubtify_help_bubbles');
});

function Page() {
  return <div className="qb-page"><h1 className="qb-title">Página de prueba</h1></div>;
}

const drawer = () => document.getElementById('mobile-drawer') as HTMLElement;
const navItems = () => Array.from(drawer().querySelectorAll<HTMLElement>('.sidebar-nav-item'));

async function openDrawer() {
  await setMobileViewport();
  mountInShell(<Page />);
  await settle();
  await page.getByRole('button', { name: /Abrir menú/i }).click();
  await settle(400);
}

/**
 * Los nodos de texto que pinta la fila, SIN `.sidebar-badge`: el contador de
 * vencidas es `position: absolute` sobre el ícono, una calcomanía y no un
 * renglón del ítem.
 */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node.textContent ?? '').trim()) continue;
    if ((node.parentElement as HTMLElement | null)?.closest('.sidebar-badge')) continue;
    out.push(node as Text);
  }
  return out;
}

/** Lo pintado por la fila, sin la calcomanía del contador. */
function paintedText(root: HTMLElement): string {
  return textNodes(root).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
}

/** Cuántos renglones pinta la fila, contando cajas de línea reales. */
function paintedLines(root: HTMLElement): number {
  const tops = new Set<number>();
  for (const node of textNodes(root)) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects())) {
      if (box.width === 0 && box.height === 0) continue;
      // Redondeo a 2 px: dos hojas del mismo renglón difieren por la línea base.
      tops.add(Math.round(box.top / 2));
    }
  }
  return tops.size;
}

describe('C11 móvil — el cajón dice qué hace cada cosa', () => {
  test('cada ítem del menú pinta SÓLO el nombre del módulo, en un renglón', async () => {
    await openDrawer();
    await shoot('c11-01-cajon');

    const items = navItems();
    expect(items.length).toBe(9);

    for (const btn of items) {
      const label = (btn.querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim();

      // 1. El segundo renglón no vuelve por la puerta de atrás.
      expect(btn.querySelector('.sidebar-nav-item__desc'), `«${label}» volvió a pintar la función`)
        .toBeNull();

      // 2. Lo pintado es el rótulo y nada más (el contador de vencidas no
      //    cuenta: es una calcomanía sobre el ícono, no texto de la fila).
      expect(paintedText(btn), `«${label}»`).toBe(label);

      // 3. UN renglón. Es la queja textual del usuario: «se junta todo el texto».
      expect(paintedLines(btn), `«${label}» pinta más de un renglón`).toBe(1);

      // 4. Y el contenido ENTRA en la caja. Esto es lo que la guarda vieja no
      //    miraba: la fila se aplastaba a los 44 px del mínimo y el texto se
      //    derramaba encima de la fila de abajo, con la altura dando «bien».
      expect(btn.scrollHeight - btn.clientHeight, `«${label}» aplastado`)
        .toBeLessThanOrEqual(0);
    }
  });

  test('ningún ítem se pisa con el de abajo', async () => {
    await openDrawer();
    const items = navItems();
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i].getBoundingClientRect();
      const b = items[i + 1].getBoundingClientRect();
      const name = (items[i].querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim();
      expect(b.top - a.bottom, `«${name}» se superpone con el ítem siguiente`)
        .toBeGreaterThanOrEqual(0);
    }
  });

  test('la función sigue disponible sin pintarse: nombre accesible y title', async () => {
    await openDrawer();
    for (const btn of navItems()) {
      const label = (btn.querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim();
      const aria = btn.getAttribute('aria-label') ?? '';
      // El rótulo está, y detrás del guión la FUNCIÓN.
      expect(aria, `«${label}» sin nombre accesible`).toContain(label);
      const desc = aria.slice(aria.indexOf(`${label} — `) + label.length + 3);
      expect(desc.length, `«${label}»: función muy corta en el aria-label`).toBeGreaterThan(12);
      expect(desc, `«${label}»: clave i18n cruda`).not.toMatch(/^nav\./);
      expect(btn.getAttribute('title'), `«${label}»: title`).toBe(desc);
    }
  });

  test('el ítem conserva el blanco de toque de 44 px', async () => {
    await openDrawer();
    for (const btn of navItems()) {
      expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  test('Posada, Indultos y Vigor se explican sin hover, que en touch no existe', async () => {
    await openDrawer();

    const regla = drawer().querySelector('.sidebar-streak__rule') as HTMLElement;
    expect(regla, 'la regla de la racha no se pinta en el cajón').not.toBeNull();
    expect(getComputedStyle(regla).display).toBe('block');
    expect(regla.textContent).toMatch(/indulto/i);
    expect(regla.textContent).toMatch(/Posada/i);

    expect((drawer().querySelector('.sidebar-streak__pardons') as HTMLElement).textContent)
      .toMatch(/indultos/i);

    // El sello del Vigor se dispara con FOCO: un toque lo enfoca.
    const seal = drawer().querySelector('.sidebar-bar__help') as HTMLElement;
    seal.focus();
    await settle(150);
    expect(document.querySelector('.help-bubble__tip')?.textContent)
      .toMatch(/se recupera solo cada mañana/i);
  });

  test('nada de esto desborda a 390 px ni baja del piso de 13 px', async () => {
    await openDrawer();
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    expect(drawer().scrollWidth - drawer().clientWidth).toBeLessThanOrEqual(0);
    expect(smallText(drawer(), 13)).toEqual([]);
    const flojos = lowContrastText(drawer(), LEATHER_WORST);
    // eslint-disable-next-line no-console
    console.log('[c11 móvil] textos flojos en el cajón:', JSON.stringify(flojos));
    expect(flojos).toEqual([]);
  });
});
