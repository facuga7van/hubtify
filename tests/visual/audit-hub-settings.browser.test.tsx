import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from '@hub/SettingsPage';
import FeedbackDialog from '@hub/FeedbackDialog';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { TourProvider } from '@shared/components/tour';
import {
  installApi, SCREENS, WIDE, NARROW, fitCapture, resetCapture,
  overflowingNodes, clippedText, unlabelledButtons, lowContrastText, PARCH_WORST,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/shared/components/tour/tour.css';

const baseAuth = {
  user: { uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo' },
  loading: false, switching: false,
  login: async () => ({ success: false }), register: async () => ({ success: false }),
  logout: async () => ({ success: true }), switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }), forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
} as unknown as React.ContextType<typeof AuthContext>;

beforeAll(() => {
  document.body.style.margin = '0';
  installApi();
});

function mount(sidebar: number) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider><TourProvider>
          <div id="audit-root" className="app-layout" style={{ height: '100vh' }}>
            <div data-testid="mouse-park" style={{ width: sidebar, flexShrink: 0, background: 'var(--leather)' }} />
            <main className="main-content"><SettingsPage /></main>
          </div>
        </TourProvider></ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function report(tag: string, root: ParentNode = document.querySelector('.main-content')!) {
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({
    overflow: overflowingNodes(root).slice(0, 10),
    clipped: clippedText(root).slice(0, 10),
    noLabel: unlabelledButtons(root),
    bajoContraste: lowContrastText(root, PARCH_WORST).slice(0, 12),
  }, null, 1));
}

/** Todo control de formulario tiene que tener un nombre accesible. */
function unlabelledFields(root: ParentNode) {
  const out: string[] = [];
  root.querySelectorAll('input, select, textarea').forEach((el) => {
    const id = el.getAttribute('id');
    const labelled = (id && root.querySelector(`label[for="${id}"]`))
      || el.getAttribute('aria-label')
      || el.getAttribute('aria-labelledby')
      || el.getAttribute('title')
      || el.closest('label');
    if (!labelled) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('type') ?? ''}] ${el.className}`);
  });
  return out;
}

/** Ancho útil del valor dentro de un input (caja menos su padding). */
function innerWidth(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return Math.round(el.getBoundingClientRect().width
    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
}

describe('Ajustes', () => {
  test('maximizada', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(260);
    await settle(500);
    const main = document.querySelector('.main-content') as HTMLElement;
    report('AJUSTES WIDE');
    // eslint-disable-next-line no-console
    console.log('AJUSTES CAMPOS', JSON.stringify({
      sinEtiqueta: unlabelledFields(main),
      anchosUtiles: [...main.querySelectorAll('input, select')]
        .map((el) => ({ sel: `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`, w: innerWidth(el as HTMLElement) }))
        .filter((x) => x.w < 40),
    }, null, 1));

    await page.getByTestId('mouse-park').hover();
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-01-wide-a.png` });
    main.scrollTop = main.scrollHeight / 2;
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-01-wide-b.png` });
    main.scrollTop = main.scrollHeight;
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-01-wide-c.png` });
    resetCapture();

    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });

  test('angosta', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(56);
    await settle(500);
    const main = document.querySelector('.main-content') as HTMLElement;
    report('AJUSTES NARROW');

    await page.getByTestId('mouse-park').hover();
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-02-narrow-a.png` });
    main.scrollTop = main.scrollHeight;
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-02-narrow-b.png` });
    resetCapture();

    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});

describe('Diálogo de comentarios', () => {
  test('rótulos atados, motivo del botón apagado y cierre con Escape', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    let closed = false;
    render(
      <ToastProvider><ConfirmProvider>
        <FeedbackDialog open onClose={() => { closed = true; }} onSent={() => {}} />
      </ConfirmProvider></ToastProvider>,
    );
    await settle(300);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    report('FEEDBACK', dlg);
    // eslint-disable-next-line no-console
    console.log('FEEDBACK CAMPOS', JSON.stringify(unlabelledFields(dlg), null, 1));

    // Todo control tiene nombre accesible.
    expect(unlabelledFields(dlg)).toEqual([]);

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-feedback-01.png` });
    resetCapture();

    // Con la descripción corta el botón está apagado, pero AHORA dice por qué.
    await page.getByLabelText(/Descripción/i).fill('hola');
    await settle(150);
    const enviar = page.getByRole('button', { name: /^Enviar$/i });
    await expect.element(enviar).toBeDisabled();
    await expect.element(page.getByText(/faltan 6 caracteres/i)).toBeVisible();
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-feedback-02-corto.png` });
    resetCapture();

    await page.getByLabelText(/Descripción/i).fill('El sidebar se corta cuando achico la ventana');
    await settle(150);
    await expect.element(enviar).toBeEnabled();

    // Escape cierra.
    await page.getByRole('dialog').element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(150);
    expect(closed).toBe(true);

    expect(dlg.scrollWidth - dlg.clientWidth).toBeLessThanOrEqual(1);
  });
});
