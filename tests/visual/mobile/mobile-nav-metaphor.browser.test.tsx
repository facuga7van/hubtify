import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { contrast, lowContrastText, smallText, LEATHER_WORST } from '../audit-hub-harness';
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
 * Android, invisible. Acá se mide que la función de cada ítem y las reglas de
 * la racha estén PINTADAS, con el piso de 13 px, 4.5:1 contra la parada más
 * oscura del cuero y sin desbordar a 390 px.
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

describe('C11 móvil — el cajón dice qué hace cada cosa', () => {
  test('cada ítem del menú pinta su función como segundo renglón', async () => {
    await openDrawer();
    await shoot('c11-01-cajon');

    const items = navItems();
    expect(items.length).toBe(9);

    for (const btn of items) {
      const desc = btn.querySelector('.sidebar-nav-item__desc') as HTMLElement | null;
      const label = (btn.querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim();
      expect(desc, `«${label}» sin renglón de función`).not.toBeNull();
      const cs = getComputedStyle(desc!);
      expect(cs.display, `«${label}»`).toBe('block');
      expect((desc!.textContent ?? '').trim().length).toBeGreaterThan(12);
      // Piso tipográfico del sistema.
      expect(parseFloat(cs.fontSize), `«${label}»`).toBeGreaterThanOrEqual(13);
      // Contraste contra el cuero más oscuro.
      const ratio = contrast(cs.color, LEATHER_WORST);
      expect(ratio, `«${label}»: ${cs.color} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }

    // eslint-disable-next-line no-console
    console.log('[c11 móvil] función del nav:', getComputedStyle(
      navItems()[4].querySelector('.sidebar-nav-item__desc') as HTMLElement,
    ).color, '=', contrast(getComputedStyle(
      navItems()[4].querySelector('.sidebar-nav-item__desc') as HTMLElement,
    ).color, LEATHER_WORST).toFixed(2), ':1');
  });

  test('el renglón nuevo no le come el blanco de toque a la fila', async () => {
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
