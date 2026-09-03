import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { AuthContext } from '@shared/AuthContext';
import SyncStatusChip from '@shared/components/SyncStatusChip';
import {
  resetSyncStatus, markSyncPending, markSyncStarted, markSyncPushed, markSyncError,
} from '@shared/sync-status';
import { baseAuth, installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';

beforeAll(() => { installApi(); });
beforeEach(() => { resetSyncStatus(); });

const chip = () => document.querySelector('.mobile-header .sync-chip') as HTMLElement;

function Page() {
  return <div className="qb-page"><h1 className="qb-title">Página de prueba</h1></div>;
}

describe('SyncStatusChip en la cabecera móvil', () => {
  /* La única señal de sync del teléfono estaba a tres taps, en Ajustes, y el
     sello que mostraba era el del último PULL, no el del push. */
  test('está en la cabecera, mide 44 px de toque y no desborda a 390 px', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();

    const el = chip();
    expect(el).not.toBeNull();
    const r = el.getBoundingClientRect();
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.width).toBeGreaterThanOrEqual(44);
    // La cabecera sigue midiendo 56 px: el chip no la estira.
    const header = document.querySelector('.mobile-header') as HTMLElement;
    expect(Math.round(header.getBoundingClientRect().height)).toBe(56);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    await shoot('shell-03-sync-chip');
  });

  test('el estado se dice en palabras en aria-label y en title', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();

    markSyncPending();
    await settle(60);
    expect(chip().dataset.syncState).toBe('pending');
    expect(chip().getAttribute('aria-label')).toBe('Cambios sin subir');
    expect(chip().getAttribute('title')).toBe('Cambios sin subir');

    markSyncStarted();
    await settle(60);
    expect(chip().getAttribute('aria-label')).toBe('Sincronizando…');

    markSyncPushed('2026-09-03T10:00:00.000Z');
    await settle(60);
    expect(chip().dataset.syncState).toBe('synced');
    expect(chip().getAttribute('aria-label')).toBe('Todo sincronizado');

    markSyncError('offline');
    await settle(60);
    expect(chip().dataset.syncState).toBe('error');
    expect(chip().getAttribute('aria-label')).toBe('No pudimos sincronizar');
  });

  /* El rótulo se recorta en la cabecera (390 px no dan), pero tiene que seguir
     existiendo para el lector de pantalla. */
  test('en la cabecera el rótulo no ocupa ancho, pero el nombre accesible queda', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    const text = chip().querySelector('.sync-chip__text') as HTMLElement;
    expect(text.textContent).not.toBe('');
    expect(text.getBoundingClientRect().width).toBeLessThanOrEqual(2);
  });

  test('sin sesión dice que los datos son solo locales, no «sincronizado»', async () => {
    await setMobileViewport();
    const signedOut = { ...baseAuth, user: null } as React.ContextType<typeof AuthContext>;
    const { container } = await render(
      <AuthContext.Provider value={signedOut}><SyncStatusChip /></AuthContext.Provider>,
    );
    await settle(60);
    const el = container.querySelector('.sync-chip') as HTMLElement;
    expect(el.dataset.syncState).toBe('local');
    expect(el.getAttribute('aria-label')).toBe('Solo en este dispositivo');

    // Y un push ajeno no lo convierte en «sincronizado»: sin sesión no hay nube.
    markSyncPushed('2026-09-03T10:00:00.000Z');
    await settle(60);
    expect(el.dataset.syncState).toBe('local');
  });
});
