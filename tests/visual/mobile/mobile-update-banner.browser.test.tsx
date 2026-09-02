import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { setMobileViewport, settle, shoot } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/shell.css';

/**
 * AndroidUpdateBanner es autocontenido (chequea el release, baja el APK e
 * instala solo) — para tener los cinco estados en pantalla sin red real ni
 * Capacitor real, se mockean sus tres únicas dependencias externas:
 * updater.ts (chequeo), apk-downloader.ts (descarga) y apk-installer.ts
 * (instalador nativo). El resto (la máquina de estados, el render) es el
 * código de producción real.
 */
const checkMobileUpdate = vi.fn();
const openApkDownload = vi.fn(async () => undefined);
vi.mock('../../../src/mobile/updater', () => ({
  checkMobileUpdate: (...args: unknown[]) => checkMobileUpdate(...args),
  openApkDownload: (...args: unknown[]) => openApkDownload(...args),
}));

const downloadApk = vi.fn();
vi.mock('../../../src/mobile/apk-downloader', () => ({
  downloadApk: (...args: unknown[]) => downloadApk(...args),
}));

const install = vi.fn();
const canInstall = vi.fn(async () => ({ allowed: true }));
vi.mock('../../../src/mobile/apk-installer', () => ({
  default: {
    install: (...args: unknown[]) => install(...args),
    canInstall: (...args: unknown[]) => canInstall(...args),
  },
}));

import AndroidUpdateBanner from '../../../src/mobile/AndroidUpdateBanner';

const UPDATE = { version: '0.9.3', size: 1000, apkUrl: 'https://github.com/facuga7van/hubtify-releases/releases/download/v0.9.3/Hubtify-0.9.3.apk' };

beforeAll(() => {
  document.body.style.margin = '0';
});

beforeEach(() => {
  localStorage.removeItem('hubtify_update_mode');
  localStorage.removeItem('hubtify_update_dismissed_version');
  checkMobileUpdate.mockReset().mockResolvedValue(UPDATE);
  openApkDownload.mockReset().mockResolvedValue(undefined);
  downloadApk.mockReset();
  install.mockReset();
  canInstall.mockReset().mockResolvedValue({ allowed: true });
});

describe('AndroidUpdateBanner — estados visuales', () => {
  test('disponible: botón «Actualizar»', async () => {
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByText(/Nueva versión disponible/i)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Actualizar/i })).toBeVisible();
    await settle(150);
    await shoot('android-update-01-disponible');
  });

  test('descargando: barra de progreso a mitad', async () => {
    let progress: ((bytes: number) => void) | null = null;
    downloadApk.mockImplementation((_url: string, _version: string, _size: number, onProgress: (bytes: number) => void) => {
      progress = onProgress;
      return { result: new Promise(() => {}), cancel: vi.fn() };
    });
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByRole('button', { name: /Actualizar/i })).toBeVisible();
    await page.getByRole('button', { name: /Actualizar/i }).click();
    await settle(100);
    progress?.(450); // 450/1000 = 45%
    await settle(200);
    await expect.element(page.getByText(/45%/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Cancelar/i })).toBeVisible();
    await shoot('android-update-02-descargando');
  });

  test('lista para instalar: botón pasa a «Instalar»', async () => {
    downloadApk.mockImplementation(() => ({
      result: Promise.resolve('file:///cache/updates/Hubtify-0.9.3.apk'),
      cancel: vi.fn(),
    }));
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByRole('button', { name: /Actualizar/i })).toBeVisible();
    await page.getByRole('button', { name: /Actualizar/i }).click();
    await expect.element(page.getByText(/Actualización lista/i)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Instalar/i })).toBeVisible();
    await settle(150);
    await shoot('android-update-03-lista-para-instalar');
  });

  test('falta el permiso de fuentes desconocidas', async () => {
    downloadApk.mockImplementation(() => ({
      result: Promise.resolve('file:///cache/updates/Hubtify-0.9.3.apk'),
      cancel: vi.fn(),
    }));
    install.mockResolvedValue({ needsPermission: true });
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByRole('button', { name: /Actualizar/i })).toBeVisible();
    await page.getByRole('button', { name: /Actualizar/i }).click();
    await expect.element(page.getByRole('button', { name: /Instalar/i })).toBeVisible();
    await page.getByRole('button', { name: /Instalar/i }).click();
    await expect.element(page.getByText(/Permití instalar/i)).toBeVisible();
    await settle(150);
    await shoot('android-update-04-falta-permiso');
  });

  test('error: la descarga no coincide con el tamaño esperado, con «Reintentar»', async () => {
    downloadApk.mockImplementation(() => ({
      result: Promise.reject(new Error('size_mismatch:900:1000')),
      cancel: vi.fn(),
    }));
    await setMobileViewport();
    render(<AndroidUpdateBanner />);
    await expect.element(page.getByRole('button', { name: /Actualizar/i })).toBeVisible();
    await page.getByRole('button', { name: /Actualizar/i }).click();
    await expect.element(page.getByText(/no coincidió con el tamaño esperado/i)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Reintentar/i })).toBeVisible();
    await settle(150);
    await shoot('android-update-05-error');
  });
});
