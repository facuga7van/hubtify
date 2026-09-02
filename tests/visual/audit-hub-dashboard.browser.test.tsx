import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '@hub/Dashboard';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import {
  installApi, SCREENS, WIDE, NARROW, fitCapture, resetCapture,
  overflowingNodes, clippedText, unlabelledButtons, lowContrastText, PARCH_WORST,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/hub/styles/dashboard-layouts.css';
import '../../src/hub/styles/codex-seal.css';
import '../../src/shared/styles/help-bubble.css';

beforeAll(() => {
  document.body.style.margin = '0';
  installApi();
});

/**
 * Monta el dashboard DENTRO del hueco real del shell. Por debajo de 820 px de
 * ventana el Layout colapsa el sidebar solo (AUTO_COLLAPSE_WIDTH), así que la
 * simulación angosta usa el riel de 56 px, no el de 260.
 */
function mount(sidebar = 260) {
  return render(
    <MemoryRouter>
      <ToastProvider><ConfirmProvider>
        <div id="audit-root" className="app-layout" style={{ height: '100vh' }}>
          <div style={{ width: sidebar, flexShrink: 0, background: 'var(--leather)' }} />
          <main className="main-content"><Dashboard /></main>
        </div>
      </ConfirmProvider></ToastProvider>
    </MemoryRouter>,
  );
}

/** Cuánto se sale un nodo de la caja de su padre (izq/der). */
function spillOutOfParent(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const p = el.parentElement!;
  const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
  // Positivo = se SALE de la caja del padre.
  return { left: Math.round(b.left - a.left), right: Math.round(a.right - b.right) };
}

const settle = () => new Promise((r) => setTimeout(r, 400));

describe('Dashboard del hub', () => {
  test('maximizada 1640x900', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount();
    await expect.element(page.getByText(/Tabla del Aventurero/i)).toBeVisible();
    await settle();

    const main = document.querySelector('.main-content')!;
    const report = {
      xpLedgerSvg: (document.querySelector('.main-content svg[viewBox^="0 0 280"]') as SVGElement | null)
        ?.getBoundingClientRect().toJSON(),
      overflow: overflowingNodes(main).slice(0, 12),
      clipped: clippedText(main).slice(0, 12),
      noLabel: unlabelledButtons(main),
      bajoContraste: lowContrastText(main, PARCH_WORST).slice(0, 12),
      codexLinkSpill: spillOutOfParent('.codex-link'),
    };
    // eslint-disable-next-line no-console
    console.log('DASH WIDE REPORT', JSON.stringify(report, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-dash-01-wide.png` });
    (main as HTMLElement).scrollTop = main.scrollHeight;
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-hub-dash-01b-wide-bottom.png` });
    resetCapture();

    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });

  test('angosta 760x640', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(56);
    await expect.element(page.getByText(/Tabla del Aventurero/i)).toBeVisible();
    await settle();

    const main = document.querySelector('.main-content')!;
    // eslint-disable-next-line no-console
    console.log('DASH NARROW REPORT', JSON.stringify({
      overflow: overflowingNodes(main).slice(0, 12),
      clipped: clippedText(main).slice(0, 12),
      codexLinkSpill: spillOutOfParent('.codex-link'),
    }, null, 1));

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-dash-02-narrow.png` });
    (main as HTMLElement).scrollTop = main.scrollHeight;
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-hub-dash-02b-narrow-bottom.png` });
    resetCapture();

    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});
