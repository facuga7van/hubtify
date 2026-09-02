import { beforeAll, describe, expect, test } from 'vitest';
import { useState } from 'react';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { MemoryRouter } from 'react-router-dom';
import { isNativeMobile } from '@shared/platform-detect';
import Layout from '@hub/Layout';
import { AuthContext } from '@shared/AuthContext';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
// Las dos consultas al DOM que decide el botón atrás de Android. Se importan de
// dialog-dom y NO de native-shell: ese importa @capacitor/app, y cargarlo define
// globalThis.Capacitor con isNativePlatform() false, que volvería false a
// isNativeMobile() en todo este archivo.
import { hasOpenDialog, closeTopDialog } from '../../../src/mobile/dialog-dom';
import { baseAuth, installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/hub/styles/codex-seal.css';
import '../../../src/shared/styles/notifications.css';

beforeAll(() => {
  installApi();
});

function Page() {
  return <div className="qb-page"><h1 className="qb-title">Página de prueba</h1></div>;
}

/** Más alta que el viewport y con estado propio: para separar «cambio de ruta» de «re-render». */
function TallPage() {
  const [n, setN] = useState(0);
  return (
    <div className="qb-page" style={{ minHeight: 3000 }}>
      <h1 className="qb-title">Página larga</h1>
      <button type="button" onClick={() => setN((v) => v + 1)}>contador {n}</button>
    </div>
  );
}

const drawer = () => document.getElementById('mobile-drawer') as HTMLElement;
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

async function openDrawer() {
  await page.getByRole('button', { name: /Abrir menú/i }).click();
  await settle(400);
}

describe('MobileShell — cabecera y drawer', () => {
  test('el project corre como Android: sin TitleBar, --shell-top 0, cabecera de 56 px', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();

    expect(isNativeMobile()).toBe(true);
    expect(document.documentElement.dataset.shell).toBe('mobile');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--shell-top').trim()).toBe('0px');
    expect(document.querySelector('.title-bar')).toBeNull();
    const header = document.querySelector('.mobile-header') as HTMLElement;
    expect(Math.round(header.getBoundingClientRect().height)).toBe(56);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    // El project emula touch (contextOptions en vitest.config.ts): si esto da
    // false, las reglas @media (hover: none) no se están verificando.
    expect(window.matchMedia('(hover: none)').matches).toBe(true);
    await shoot('shell-00-cerrado');
  });

  test('la hamburguesa abre el drawer con el Sidebar entero; la scrim lo cierra', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    expect(drawer().hasAttribute('inert')).toBe(true);

    await openDrawer();
    const r = drawer().getBoundingClientRect();
    expect(Math.round(r.left)).toBe(0);
    expect(r.width).toBeLessThanOrEqual(300);
    expect(drawer().hasAttribute('inert')).toBe(false);
    // Es el Sidebar real, expandido: las siete entradas están.
    await expect.element(page.getByRole('button', { name: /Recompensas/i })).toBeVisible();
    expect(document.querySelector('.mobile-drawer .sidebar--collapsed')).toBeNull();
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    await shoot('shell-01-drawer-abierto');

    // La scrim cubre todo el viewport pero el drawer (300 px) le tapa el
    // centro: hay que tocarla donde la toca el usuario, a la derecha del menú.
    await page.getByTestId('mobile-scrim').click({ position: { x: 345, y: 400 } });
    await settle(400);
    expect(drawer().getBoundingClientRect().right).toBeLessThanOrEqual(0);
    expect(drawer().hasAttribute('inert')).toBe(true);
  });

  test('Escape cierra el drawer (es lo que manda el botón atrás de Android)', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    escape();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    expect(drawer().getBoundingClientRect().right).toBeLessThanOrEqual(0);
  });

  test('navegar desde el menú cierra el drawer y cambia el título de la cabecera', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await expect.element(page.getByRole('heading', { name: /Tabla del Aventurero/i })).toBeVisible();

    await openDrawer();
    // El nombre accesible es «3 Questify»: el badge de vencidas (Sidebar.tsx:283-285) va antes del rótulo.
    await page.getByRole('button', { name: /Questify$/i }).click();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    await expect.element(page.getByRole('heading', { name: /^Questify$/i })).toBeVisible();
  });

  /* El efecto de `pathname` no alcanza: tocar la sección en la que YA estás no
     cambia la ruta, así que el drawer se quedaba abierto tapando la página. */
  test('tocar la sección actual cierra el drawer aunque la ruta no cambie', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    expect(drawer().hasAttribute('inert')).toBe(false);

    // Estamos en «/»: «Inicio» es la sección actual y no navega a ningún lado.
    await page.getByRole('button', { name: /^Inicio$/i }).click();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    await expect.element(page.getByRole('heading', { name: /Tabla del Aventurero/i })).toBeVisible();
  });

  test('la campana del drawer NO lo cierra: no es un ítem de navegación', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    const bell = drawer().querySelector('.notif-bell') as HTMLElement;
    expect(bell).not.toBeNull();
    bell.click();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(false);
  });

  test('un inset de barra de estado empuja la cabecera, no la tapa', async () => {
    await setMobileViewport();
    // Lo que inyecta el plugin SystemBars de Capacitor en el WebView real.
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    mountInShell(<Page />);
    await settle();
    const header = document.querySelector('.mobile-header') as HTMLElement;
    const btn = page.getByRole('button', { name: /Abrir menú/i }).element() as HTMLElement;
    expect(Math.round(header.getBoundingClientRect().height)).toBe(80);
    expect(btn.getBoundingClientRect().top).toBeGreaterThanOrEqual(24);
    document.documentElement.style.removeProperty('--safe-area-inset-top');
  });

  test('con insets, drawer y capas fijas no quedan debajo de las barras del sistema', async () => {
    await setMobileViewport();
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px');
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    const side = document.querySelector('.mobile-drawer .sidebar') as HTMLElement;
    expect(side.getBoundingClientRect().top).toBeGreaterThanOrEqual(24);
    expect(window.innerHeight - side.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(20);
    const main = document.querySelector('.main-content') as HTMLElement;
    expect(parseFloat(getComputedStyle(main).paddingBottom)).toBe(20);
    document.documentElement.style.removeProperty('--safe-area-inset-top');
    document.documentElement.style.removeProperty('--safe-area-inset-bottom');
  });

  /* DRW-01: el dropdown de cuenta se abría alineado al borde izquierdo del
     ícono y, con 200 px de mínimo, salía del drawer y se cortaba contra el
     borde derecho de la pantalla. */
  test('el menú de cuenta se abre dentro del drawer, alineado a la derecha del ícono', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    const trigger = page.getByRole('button', { name: /Menú de cuenta/i });
    await trigger.click();
    await expect.element(page.getByRole('menu')).toBeVisible();
    await settle(200);

    const menu = document.querySelector('.account-dropdown') as HTMLElement;
    const m = menu.getBoundingClientRect();
    const d = drawer().getBoundingClientRect();
    const tr = (trigger.element() as HTMLElement).getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('ACCOUNT MENU MOBILE', JSON.stringify({ menu: m.toJSON(), drawer: d.toJSON(), trigger: tr.toJSON() }));
    expect(m.width).toBeGreaterThanOrEqual(200);
    expect(Math.round(m.right)).toBeLessThanOrEqual(Math.round(d.right));
    expect(Math.round(m.left)).toBeGreaterThanOrEqual(Math.round(d.left));
    expect(Math.abs(m.right - tr.right)).toBeLessThanOrEqual(1);
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
    await shoot('shell-02-menu-cuenta');
  });

  /* GEN-03: el scroll de `.main-content` se heredaba de una ruta a la otra
     (Caldero abría a mitad de página con el scroll de Coinify). */
  test('cambiar de ruta vuelve el scroll arriba; un re-render de la página no', async () => {
    await setMobileViewport();
    mountInShell(<TallPage />, '/');
    await settle();
    const main = document.querySelector('.main-content') as HTMLElement;
    main.scrollTop = 500;
    expect(main.scrollTop).toBe(500);

    // Cambio de estado: mismo pathname, el scroll se queda donde estaba.
    // Click de DOM y no de Playwright: ese scrollea el botón a la vista y
    // movería el contenedor él mismo.
    (page.getByRole('button', { name: /^contador 0$/ }).element() as HTMLElement).click();
    await settle(200);
    await expect.element(page.getByRole('button', { name: /^contador 1$/ })).toBeInTheDocument();
    expect(main.scrollTop).toBe(500);

    // Cambio de ruta desde el drawer: arranca arriba.
    await openDrawer();
    await page.getByRole('button', { name: /Questify$/i }).click();
    await settle(400);
    await expect.element(page.getByRole('heading', { name: /^Questify$/i })).toBeVisible();
    expect(main.scrollTop).toBe(0);
  });

  /* Lo que ve el botón atrás de Android (native-shell.ts:22-29): el selector
     del diálogo abierto es lo único que separa «hay algo que cerrar» de
     «estamos en la raíz», y el drawer cerrado se distingue por `inert`. */
  test('hasOpenDialog ve el drawer solo cuando está abierto, y closeTopDialog lo cierra', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    expect(hasOpenDialog(document)).toBe(false);

    await openDrawer();
    expect(hasOpenDialog(document)).toBe(true);

    closeTopDialog();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    expect(hasOpenDialog(document)).toBe(false);
  });

  /* La elección de shell vive en Layout (Layout.tsx:235-236) y hasta acá
     ningún test montaba Layout: el arnés monta MobileShell a mano. */
  test('Layout elige el shell mobile: hay cabecera y no hay TitleBar ni riel', async () => {
    await setMobileViewport();
    // Se mide DENTRO del árbol que montó Layout: el arnés monta su propia
    // .mobile-header y un resto del test anterior daría un falso verde.
    const { container } = await render(
      <MemoryRouter initialEntries={['/']}>
        <AuthContext.Provider value={baseAuth}>
          <ConfirmProvider>
            <Layout />
          </ConfirmProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await settle(600);
    expect(container.querySelector('.mobile-header')).not.toBeNull();
    expect(container.querySelector('.title-bar')).toBeNull();
    expect(container.querySelector('.sidebar-wrapper')).toBeNull();
    expect(docOverflowX()).toBeLessThanOrEqual(0);
  });
});
