import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@hub/Sidebar';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { lowContrastText, smallText, contrast, LEATHER_WORST, describe as sel } from './audit-hub-harness';
import type { PlayerStats } from '../../shared/types';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/shared/styles/help-bubble.css';

const SCREENS = 'screens';

/**
 * C11 de la rúbrica de user journey — «la metáfora ayuda».
 *
 * El diagnóstico: los HelpBubble del CUERPO de las páginas son buenos y
 * abundantes, pero hay tres huecos donde la metáfora tapa la función y no hay
 * ninguna ayuda. Dos de los tres viven en este archivo:
 *
 *  1. Los ítems del menú son ícono + UNA palabra, y el tooltip del riel
 *     colapsado repetía esa misma palabra. «Caldero» no dice «temporizador de
 *     enfoque».
 *  2. Posada, Vigor e Indultos se explicaban SOLO en `title=`, que en un
 *     teléfono —donde el cajón es la única navegación— no existe.
 *
 * Este test mide las tres cosas que pide la banda 9 de C11: nombre accesible
 * que describe la FUNCIÓN, explicación alcanzable SIN hover, y contraste y piso
 * tipográfico de todo lo agregado, contra la parada más oscura del cuero.
 */
const stats: PlayerStats = {
  userId: 'default', level: 12, xp: 4810, xpToNextLevel: 5200, hp: 84, maxHp: 100,
  title: 'Escudero', streak: 9, dailyCombo: 3, comboDate: null, streakLastDate: null,
  totalTasks: 143, totalMeals: 88, totalExpenses: 61, hpDate: null,
  pardonsMonth: null, pardonsUsed: 1, pardonsRemaining: 2, bestStreak: 21, innSince: null,
} as PlayerStats;

beforeAll(() => {
  document.body.style.margin = '0';
  // Los sellos de ayuda se pueden apagar enteros desde Ajustes; el test mide la
  // app con la configuración por defecto.
  localStorage.removeItem('hubtify_help_bubbles');
  (window as unknown as { api: unknown }).api = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === 'notificationsGetUnreadCount') return () => Promise.resolve(0);
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
});

const mount = (collapsed = false) => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <Sidebar stats={stats} collapsed={collapsed} />
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const rail = () => document.querySelector('.sidebar') as HTMLElement;
const navItems = () => Array.from(document.querySelectorAll<HTMLElement>('.sidebar-nav-item'));

describe('C11 — el menú dice qué hace, no sólo cómo se llama', () => {
  test('cada ítem del nav tiene un nombre accesible que describe la función', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();
    await page.screenshot({ path: `${SCREENS}/c11-01-riel-abierto.png` });

    const items = navItems();
    // 7 del menú principal + Personaje + Ajustes.
    expect(items.length).toBe(9);

    for (const btn of items) {
      const label = (btn.querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim();
      const aria = btn.getAttribute('aria-label') ?? '';
      const title = btn.getAttribute('title') ?? '';

      expect(label, `${sel(btn)} sin rótulo`).not.toBe('');
      // El nombre accesible NO puede ser la palabra temática sola: eso era
      // exactamente el bug (el tooltip repetía el label).
      expect(aria, `${sel(btn)}: aria-label = label`).not.toBe(label);
      expect(aria, `${sel(btn)}: «${aria}»`).toContain(`${label} — `);

      const desc = aria.slice(aria.indexOf(`${label} — `) + label.length + 3);
      // Una descripción de verdad, no una clave i18n cruda ni un sinónimo.
      expect(desc.length, `${sel(btn)}: descripción muy corta`).toBeGreaterThan(12);
      expect(desc).not.toMatch(/^nav\./);
      expect(desc.toLowerCase(), `${sel(btn)}: la descripción repite el rótulo`).not.toBe(label.toLowerCase());
      // El hover de escritorio lleva lo mismo.
      expect(title).toBe(desc);
    }
  });

  test('«Caldero» dice que es un temporizador de enfoque, y el ítem nombra la página a la que lleva', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    const byLabel = (txt: string) => navItems().find(
      (b) => (b.querySelector('.sidebar-nav-item__label')?.textContent ?? '').trim() === txt,
    )!;

    expect(byLabel('Caldero').getAttribute('aria-label')).toMatch(/temporizador de enfoque/i);
    // El puente entre el ítem del menú y el título de la página: el nav decía
    // «Inicio» y la página se llama «Tabla del Aventurero».
    expect(byLabel('Inicio').getAttribute('aria-label')).toMatch(/Tabla del Aventurero/i);
    expect(byLabel('Questify').getAttribute('aria-label')).toMatch(/Libro de Misiones/i);
    expect(byLabel('Nutrify').getAttribute('aria-label')).toMatch(/Diario de Provisiones/i);
    expect(byLabel('Coinify').getAttribute('aria-label')).toMatch(/Libro del Tesorero/i);
  });

  test('en el riel colapsado el tooltip ya no repite el rótulo: trae la función', async () => {
    await page.viewport(1280, 900);
    mount(true);
    await settle();

    const cauldron = navItems().find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Caldero'))!;
    // Por FOCO, no por hover: es el único camino que también existe con
    // teclado, y el que confirma que el tooltip no depende del mouse.
    cauldron.focus();
    await settle(150);

    const tips = Array.from(document.querySelectorAll('[role="tooltip"]')).map((t) => t.textContent ?? '');
    expect(tips.some((t) => /Caldero — .*temporizador de enfoque/i.test(t)), JSON.stringify(tips)).toBe(true);
  });
});

describe('C11 — Posada, Vigor e Indultos se alcanzan sin hover', () => {
  test('la regla de la racha es texto PINTADO, no un title=', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    const regla = document.querySelector('.sidebar-streak__rule') as HTMLElement;
    expect(regla, 'no encontré la regla visible de la racha').not.toBeNull();
    expect(getComputedStyle(regla).display).not.toBe('none');
    // Explica los DOS controles del bloque, sin que haya que apuntar a nada.
    expect(regla.textContent).toMatch(/indulto/i);
    expect(regla.textContent).toMatch(/Posada/i);
  });

  test('los indultos dejaron de ser un escudito con un número: tienen rótulo', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    const pardons = document.querySelector('.sidebar-streak__pardons') as HTMLElement;
    expect(pardons.textContent?.trim()).toMatch(/^2\s+indultos$/);
  });

  test('la Posada lleva la regla en su nombre accesible, no sólo en el title', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    const inn = document.querySelector('.sidebar-streak__inn') as HTMLElement;
    const aria = inn.getAttribute('aria-label') ?? '';
    expect(aria.startsWith('Posada — ')).toBe(true);
    expect(aria).toMatch(/racha/i);
  });

  test('el Vigor se explica con FOCO (que es lo que hay en touch), no con hover', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    const seal = document.querySelector('.sidebar-bar__help') as HTMLElement;
    expect(seal, 'el Vigor no tiene sello de ayuda').not.toBeNull();
    expect(seal.tabIndex).toBe(0);

    seal.focus();
    await settle(150);
    const tip = document.querySelector('.help-bubble__tip');
    expect(tip?.textContent).toMatch(/se recupera solo cada mañana/i);

    // Y el rótulo visible se sigue bastando solo si alguien apaga los sellos.
    const txt = document.querySelector('.sidebar-bar__label-txt') as HTMLElement;
    expect(txt.textContent?.trim()).toBe('Vigor');
  });
});

describe('C11 — contraste y piso tipográfico de lo agregado', () => {
  test('todo lo nuevo pasa 4.5:1 contra la parada más oscura del cuero', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();

    // El token con el que se pintan la regla de la racha y la descripción del
    // nav. Se mide el color COMPUTADO, no el nombre de la variable.
    const regla = document.querySelector('.sidebar-streak__rule') as HTMLElement;
    const color = getComputedStyle(regla).color;
    const ratio = contrast(color, LEATHER_WORST);
    // eslint-disable-next-line no-console
    console.log('[c11] regla de la racha:', color, 'sobre', LEATHER_WORST, '=', ratio.toFixed(2), ':1');
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // Y el barrido completo del riel, por si algo se coló.
    const flojos = lowContrastText(rail(), LEATHER_WORST);
    // eslint-disable-next-line no-console
    console.log('[c11] textos flojos en el riel:', JSON.stringify(flojos));
    expect(flojos).toEqual([]);
  });

  test('ni un nodo por debajo del piso de 13 px', async () => {
    await page.viewport(1280, 900);
    mount();
    await settle();
    expect(smallText(rail(), 13)).toEqual([]);
  });

  test('el riel sigue entrando sin scroll con el rótulo y la regla nuevos', async () => {
    for (const [w, h] of [[1200, 720], [1200, 620], [880, 720]] as const) {
      await page.viewport(w, h);
      mount();
      await settle();
      const nav = document.querySelector('.sidebar-nav') as HTMLElement;
      const over = nav.scrollHeight - nav.clientHeight;
      // eslint-disable-next-line no-console
      console.log(`[c11] ${w}x${h} · scroll del menú: ${over}px`);
      expect(over, `${w}x${h}`).toBeLessThanOrEqual(0);
    }
  });

  test('el bloque de barras no se recorta contra su propio max-height', async () => {
    await page.viewport(1200, 900);
    mount();
    await settle();
    const bars = document.querySelector('.sidebar-bars') as HTMLElement;
    // `overflow: hidden` + `max-height` no avisa: recorta en silencio. Era el
    // riesgo real de sumarle un renglón al bloque de la racha.
    expect(bars.scrollHeight - bars.clientHeight).toBeLessThanOrEqual(0);
  });
});
