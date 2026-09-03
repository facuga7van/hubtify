import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../../src/shared/app-lifecycle-events';

/** Mock del plugin nativo: guarda el callback de cada evento y anota los remove(). */
const listeners = new Map<string, (ev: unknown) => void>();
const removed: string[] = [];

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (ev: unknown) => void) => {
      listeners.set(name, cb);
      return { remove: async () => { removed.push(name); } };
    }),
    minimizeApp: vi.fn(async () => {}),
  },
}));

import { bindNativeShell } from '../../src/mobile/native-shell';

beforeEach(() => {
  listeners.clear();
  removed.length = 0;
  (globalThis as { window?: unknown }).window = new EventTarget();
});

describe('bindNativeShell', () => {
  it('engancha el botón atrás Y el ciclo de vida de la app', async () => {
    await bindNativeShell();
    expect([...listeners.keys()].sort()).toEqual(['appStateChange', 'backButton']);
  });

  /* La causa raíz de C8: en el WebView de Android, mandar la app a background no
     dispara `blur` (ni visibilitychange), así que el push quedaba colgando de un
     setTimeout de 30 s que muere con el proceso. appStateChange sí llega. */
  it('irse a background emite hubtify:appBackground en window', async () => {
    await bindNativeShell();
    const seen: string[] = [];
    (globalThis.window as EventTarget).addEventListener(APP_BACKGROUND_EVENT, () => seen.push('bg'));
    listeners.get('appStateChange')!({ isActive: false });
    expect(seen).toEqual(['bg']);
  });

  it('volver al frente emite hubtify:appForeground en window', async () => {
    await bindNativeShell();
    const seen: string[] = [];
    (globalThis.window as EventTarget).addEventListener(APP_FOREGROUND_EVENT, () => seen.push('fg'));
    listeners.get('appStateChange')!({ isActive: true });
    expect(seen).toEqual(['fg']);
  });

  it('un estado no emite el otro evento', async () => {
    await bindNativeShell();
    const seen: string[] = [];
    (globalThis.window as EventTarget).addEventListener(APP_FOREGROUND_EVENT, () => seen.push('fg'));
    (globalThis.window as EventTarget).addEventListener(APP_BACKGROUND_EVENT, () => seen.push('bg'));
    listeners.get('appStateChange')!({ isActive: false });
    listeners.get('appStateChange')!({ isActive: true });
    expect(seen).toEqual(['bg', 'fg']);
  });

  it('el disposer suelta los DOS listeners nativos', async () => {
    const dispose = await bindNativeShell();
    dispose();
    // remove() es async: se resuelven en la microcola.
    await Promise.resolve();
    await Promise.resolve();
    expect(removed.sort()).toEqual(['appStateChange', 'backButton']);
  });
});
