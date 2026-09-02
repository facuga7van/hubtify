import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@hub/Sidebar';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import {
  installApi, SCREENS, WIDE, NARROW, stats, fitCapture, resetCapture,
  contrastOf, unlabelledButtons, clippedText,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/hub/styles/codex-seal.css';

const authUser = {
  uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo',
} as unknown as NonNullable<React.ContextType<typeof AuthContext>['user']>;

const baseAuth = {
  user: authUser,
  loading: false,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: true }),
  switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => ([
    { uid: 'u2', email: 'la-cuenta-secundaria-larguisima@ejemplo-muy-largo.com', firebaseAppName: 'a2', lastUsed: '', username: 'Segundo' },
    { uid: 'u3', email: 'tercera@hubtify.app', firebaseAppName: 'a3', lastUsed: '', username: 'Tercero' },
  ]),
} as unknown as React.ContextType<typeof AuthContext>;

beforeAll(() => {
  document.body.style.margin = '0';
  installApi();
});

function mount(collapsed: boolean) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider>
          <div id="audit-root" className="app-layout" style={{ height: '100vh' }}>
            <div className={`sidebar-wrapper ${collapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
              <Sidebar stats={stats} collapsed={collapsed} onBellClick={() => {}} onToggleInn={() => {}} />
            </div>
            <main className="main-content" style={{ background: 'var(--parch-0)' }} />
          </div>
        </ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const settle = () => new Promise((r) => setTimeout(r, 300));

/** Alto que le sobra al menú antes de tener que scrollear. */
function navOverflow(): number {
  const nav = document.querySelector('.sidebar-nav') as HTMLElement;
  return nav.scrollHeight - nav.clientHeight;
}

describe('Shell — sidebar, ficha de jugador y menú de cuenta', () => {
  test('sidebar expandido, ventana maximizada', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(false);
    await expect.element(page.getByText(/Recompensas/i)).toBeVisible();
    await settle();

    const side = document.querySelector('.sidebar') as HTMLElement;
    // eslint-disable-next-line no-console
    console.log('SIDEBAR WIDE', JSON.stringify({
      navOverflow: navOverflow(),
      sidebarVOverflow: side.scrollHeight - side.clientHeight,
      version: contrastOf(document.querySelector('.sidebar-footer__bottom > div')!),
      barsClip: (() => { const b = document.querySelector('.sidebar-bars') as HTMLElement; return b.scrollHeight - b.clientHeight; })(),
      noLabel: unlabelledButtons(side),
      clipped: clippedText(side),
    }, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-shell-01-sidebar-wide.png` });
    resetCapture();

    expect(navOverflow()).toBeLessThanOrEqual(0);
    expect(side.scrollHeight - side.clientHeight).toBeLessThanOrEqual(0);
  });

  test('sidebar expandido, ventana chica 760x640', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(false);
    await expect.element(page.getByText(/Recompensas/i)).toBeVisible();
    await settle();

    const side = document.querySelector('.sidebar') as HTMLElement;
    // eslint-disable-next-line no-console
    console.log('SIDEBAR NARROW', JSON.stringify({
      navOverflow: navOverflow(),
      sidebarVOverflow: side.scrollHeight - side.clientHeight,
      barsClip: (() => { const b = document.querySelector('.sidebar-bars') as HTMLElement; return b.scrollHeight - b.clientHeight; })(),
      clipped: clippedText(side),
    }, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-shell-02-sidebar-narrow.png` });
    resetCapture();

    expect(navOverflow()).toBeLessThanOrEqual(0);
  });

  test('sidebar colapsado: los controles siguen existiendo', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(true);
    await settle();

    const side = document.querySelector('.sidebar') as HTMLElement;
    const accountBtn = document.querySelector('.player-card__account-btn') as HTMLElement;
    // eslint-disable-next-line no-console
    console.log('SIDEBAR COLLAPSED', JSON.stringify({
      accountBtnBox: accountBtn?.getBoundingClientRect().toJSON(),
      sidebarW: side.getBoundingClientRect().width,
      navOverflow: navOverflow(),
    }, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-shell-03-sidebar-collapsed.png` });
    resetCapture();

    // El botón de cuenta y la campana viven fuera de __ident justamente para
    // sobrevivir al colapso: si miden 0 el colapso los borró.
    expect(accountBtn.getBoundingClientRect().width).toBeGreaterThan(10);
  });

  test('menú de cuenta abierto — cae dentro de la pantalla y se cierra', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(false);
    await settle();

    await page.getByRole('button', { name: /Menú de cuenta/i }).click();
    await expect.element(page.getByRole('menu')).toBeVisible();
    await settle();

    const menu = document.querySelector('.account-dropdown') as HTMLElement;
    const r = menu.getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('ACCOUNT MENU', JSON.stringify({
      box: r.toJSON(), vw: window.innerWidth, vh: window.innerHeight,
      offRight: Math.round(r.right - window.innerWidth),
      offBottom: Math.round(r.bottom - window.innerHeight),
      clipped: clippedText(menu),
    }, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-shell-04-account-menu.png` });
    resetCapture();

    expect(Math.round(r.right)).toBeLessThanOrEqual(window.innerWidth);
    expect(Math.round(r.bottom)).toBeLessThanOrEqual(window.innerHeight);

    // Escape tiene que cerrarlo: un menú del que sólo se sale con el mouse es
    // una trampa de teclado.
    await page.getByRole('menu').element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.account-dropdown')).toBeNull();
  });
});
