import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));

import { Browser } from '@capacitor/browser';
import { checkMobileUpdate, findApkUpdate, LATEST_RELEASE_URL, openApkDownload } from '../../src/mobile/updater';

const release = (tag: string, assets: string[], size = 12_345_678) => ({
  tag_name: tag,
  assets: assets.map((name) => ({
    name, size,
    browser_download_url: `https://github.com/facuga7van/hubtify-releases/releases/download/${tag}/${name}`,
  })),
});

describe('findApkUpdate', () => {
  it('versión más nueva con su APK → url de descarga + tamaño del asset', () => {
    const r = release('v0.9.0', ['Hubtify-0.9.0.apk', 'Hubtify-0.9.0 Setup.exe', 'RELEASES']);
    expect(findApkUpdate(r, '0.8.2')).toEqual({
      version: '0.9.0',
      apkUrl: 'https://github.com/facuga7van/hubtify-releases/releases/download/v0.9.0/Hubtify-0.9.0.apk',
      size: 12_345_678,
    });
  });

  it('más nueva pero sin APK (release solo Windows) → null', () => {
    expect(findApkUpdate(release('v0.9.0', ['Hubtify-0.9.0 Setup.exe']), '0.8.2')).toBeNull();
  });

  it('igual o más vieja → null', () => {
    expect(findApkUpdate(release('v0.8.2', ['Hubtify-0.8.2.apk']), '0.8.2')).toBeNull();
    expect(findApkUpdate(release('v0.8.1', ['Hubtify-0.8.1.apk']), '0.8.2')).toBeNull();
  });

  it('tag que no es X.Y.Z (pre-release) → null', () => {
    expect(findApkUpdate(release('v1.0.0-beta.1', ['Hubtify-1.0.0-beta.1.apk']), '0.8.2')).toBeNull();
  });
});

describe('checkMobileUpdate', () => {
  it('consulta el último release y devuelve el APK más nuevo (con tamaño)', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(release('v0.9.0', ['Hubtify-0.9.0.apk'])), { status: 200 }));
    await expect(checkMobileUpdate(fetchFn as unknown as typeof fetch, '0.8.2')).resolves.toMatchObject({ version: '0.9.0', size: 12_345_678 });
    expect(fetchFn).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('respuesta no-2xx (rate limit) o red caída → null, sin lanzar', async () => {
    await expect(checkMobileUpdate((async () => new Response('', { status: 403 })) as unknown as typeof fetch, '0.8.2')).resolves.toBeNull();
    await expect(checkMobileUpdate((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, '0.8.2')).resolves.toBeNull();
  });

  it('respeta el override de QA `localStorage.hubtify_update_api`', async () => {
    // Entorno node de este archivo: sin `localStorage` global (Node no lo
    // expone sin flag). Se stubea lo mínimo que `releaseApiUrl()` usa.
    const store = new Map<string, string>([['hubtify_update_api', 'http://127.0.0.1:8123/fake-release.json']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
    };
    try {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify(release('v0.9.0', ['Hubtify-0.9.0.apk'])), { status: 200 }));
      await checkMobileUpdate(fetchFn as unknown as typeof fetch, '0.8.2');
      expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8123/fake-release.json', expect.objectContaining({ headers: expect.any(Object) }));
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('openApkDownload', () => {
  it('abre el navegador del sistema con la url del APK', async () => {
    await openApkDownload('https://x/y.apk');
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://x/y.apk' });
  });
});
