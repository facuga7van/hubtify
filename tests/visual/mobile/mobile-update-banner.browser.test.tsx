import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { setMobileViewport, settle, shoot } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/shell.css';

/**
 * El aviso ya no baja ni instala el APK (se sacó el instalador in-app por la
 * política de Play sobre REQUEST_INSTALL_PACKAGES): solo avisa y abre la
 * página del release. Queda una sola dependencia externa que mockear —
 * updater.ts, que hace el chequeo y el `Browser.open`—; el resto (el render,
 * el snooze) es el código de producción real.
 */
const checkMobileUpdate = vi.fn();
const openReleasePage = vi.fn(async () => undefined);
vi.mock('../../../src/mobile/updater', () => ({
  checkMobileUpdate: (...args: unknown[]) => checkMobileUpdate(...args),
  openReleasePage: (...args: unknown[]) => openReleasePage(...args),
}));

import AndroidUpdateBanner from '../../../src/mobile/AndroidUpdateBanner';

const RELEASE_URL = 'https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.3';
const UPDATE = { version: '0.9.3', releaseUrl: RELEASE_URL };

beforeAll(() => {
  document.body.style.margin = '0';
});

beforeEach(() => {
  localStorage.removeItem('hubtify_update_mode');
  localStorage.removeItem('hubtify_update_dismissed_version');
  checkMobileUpdate.mockReset().mockResolvedValue(UPDATE);
  openReleasePage.mockReset().mockResolvedValue(undefined);
});

describe('AndroidUpdateBanner — aviso de versión nueva', () => {
  test('disponible: botón «Ver la actualización»', async () => {
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByText(/Nueva versión disponible/i)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Ver la actualización/i })).toBeVisible();
    await settle(150);
    await shoot('android-update-01-disponible');
  });

  test('el botón abre la PÁGINA del release, no el APK', async () => {
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByRole('button', { name: /Ver la actualización/i })).toBeVisible();
    await page.getByRole('button', { name: /Ver la actualización/i }).click();
    await settle(100);
    expect(openReleasePage).toHaveBeenCalledWith(RELEASE_URL);
    // Abrir el navegador no instala nada: el aviso sigue en pantalla.
    await expect.element(page.getByText(/Nueva versión disponible/i)).toBeVisible();
  });

  test('descartar recuerda la versión y no vuelve a mostrarla', async () => {
    await setMobileViewport();
    const { unmount } = await render(<AndroidUpdateBanner />);
    await expect.element(page.getByText(/Nueva versión disponible/i)).toBeVisible();
    await page.getByRole('button', { name: /Descartar el aviso/i }).click();
    await settle(100);
    expect(localStorage.getItem('hubtify_update_dismissed_version')).toBe('0.9.3');
    await unmount();

    render(<AndroidUpdateBanner />);
    await settle(200);
    expect(document.querySelector('.update-chip--android')).toBeNull();
  });
});
