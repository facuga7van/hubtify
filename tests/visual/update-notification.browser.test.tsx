import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import UpdateNotification from '@hub/UpdateNotification';

// Real i18n + styles so the screenshots match production pixel-for-pixel.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

const SCREENS = 'screens';
const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('UpdateNotification — visual states', () => {
  test('idle — with changelog', async () => {
    render(
      <UpdateNotification version="0.7.4" state="idle" percent={0} error={null} onDownload={noop} onRestart={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText(/Qué hay de nuevo/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-01-idle.png` });
  });

  test('downloading', async () => {
    render(
      <UpdateNotification version="0.7.4" state="downloading" percent={45} error={null} onDownload={noop} onRestart={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText('45%')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-02-downloading.png` });
  });

  /* El fallo del updater llega como una constante de Chromium
     («ERR_INTERNET_DISCONNECTED») o como un mensaje en inglés de
     electron-updater. Este test afirmaba que ESO se mostraba tal cual; ahora
     afirma lo contrario: la pantalla explica el problema en el idioma de la
     app y el texto crudo queda en el `title`, para el reporte de bug. */
  test('error — se explica, y el texto crudo queda en el title', async () => {
    render(
      <UpdateNotification version="0.7.4" state="idle" percent={0} error="Update failed: network error" onDownload={noop} onRestart={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText(/Revisá tu conexión/i)).toBeVisible();
    expect(document.body.textContent).not.toContain('Update failed: network error');
    expect(document.querySelector('[role="alert"]')?.getAttribute('title'))
      .toBe('Update failed: network error');
    await page.screenshot({ path: `${SCREENS}/update-03-error.png` });
  });

  test('ready — restart prompt', async () => {
    render(
      <UpdateNotification version="0.7.4" state="ready" percent={100} error={null} onDownload={noop} onRestart={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText(/Reiniciar ahora/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-04-ready.png` });
  });
});
