import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));

import { Browser } from '@capacitor/browser';
import { checkMobileUpdate, findMobileUpdate, LATEST_RELEASE_URL, openReleasePage } from '../../src/mobile/updater';

/** `htmlUrl: null` simula el release SIN `html_url` (el JSON falso de QA). */
const release = (
  tag: string,
  assets: string[],
  htmlUrl: string | null = `https://github.com/facuga7van/hubtify-releases/releases/tag/${tag}`,
) => ({
  tag_name: tag,
  html_url: htmlUrl ?? undefined,
  assets: assets.map((name) => ({ name })),
});

describe('findMobileUpdate', () => {
  it('versión más nueva con su APK → página del release', () => {
    const r = release('v0.9.0', ['Hubtify-0.9.0.apk', 'Hubtify-0.9.0 Setup.exe', 'RELEASES']);
    expect(findMobileUpdate(r, '0.8.2')).toEqual({
      version: '0.9.0',
      releaseUrl: 'https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.0',
    });
  });

  it('sin `html_url` (el JSON falso del override de QA) → la arma con el tag', () => {
    const r = release('v0.9.0', ['Hubtify-0.9.0.apk'], null);
    expect(findMobileUpdate(r, '0.8.2')?.releaseUrl)
      .toBe('https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.0');
  });

  it('más nueva pero sin APK (release solo Windows) → null', () => {
    expect(findMobileUpdate(release('v0.9.0', ['Hubtify-0.9.0 Setup.exe']), '0.8.2')).toBeNull();
  });

  it('igual o más vieja → null', () => {
    expect(findMobileUpdate(release('v0.8.2', ['Hubtify-0.8.2.apk']), '0.8.2')).toBeNull();
    expect(findMobileUpdate(release('v0.8.1', ['Hubtify-0.8.1.apk']), '0.8.2')).toBeNull();
  });

  it('tag que no es X.Y.Z (pre-release) → null', () => {
    expect(findMobileUpdate(release('v1.0.0-beta.1', ['Hubtify-1.0.0-beta.1.apk']), '0.8.2')).toBeNull();
  });
});

describe('checkMobileUpdate', () => {
  it('consulta el último release y devuelve la versión nueva con su página', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(release('v0.9.0', ['Hubtify-0.9.0.apk'])), { status: 200 }));
    await expect(checkMobileUpdate(fetchFn as unknown as typeof fetch, '0.8.2')).resolves.toEqual({
      version: '0.9.0',
      releaseUrl: 'https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.0',
    });
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

describe('openReleasePage', () => {
  it('abre el navegador del sistema con la página del release, no con el APK', async () => {
    await openReleasePage('https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.0');
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://github.com/facuga7van/hubtify-releases/releases/tag/v0.9.0' });
  });
});
