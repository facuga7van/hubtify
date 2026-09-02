import { beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import CauldronPage from '@modules/cauldron/components/CauldronPage';
import CauldronFloatingTimer from '@modules/cauldron/components/CauldronFloatingTimer';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { cauldronApi, CAULDRON_RUNNING } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/cauldron/styles/cauldron.css';

beforeEach(() => {
  localStorage.clear();
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Caldero a 390×844', () => {
  test('en reposo: el botón de inicio queda a la vista sin scrollear (K1)', async () => {
    await setMobileViewport();
    installApi(cauldronApi());
    mountInShell(<CauldronPage />, '/cauldron');
    await settle(800);
    await shoot('cauldron-01-reposo');
    noOverflow('CAULDRON IDLE');
    const svg = document.querySelector('.cauldron-svg') as HTMLElement;
    expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(200);
    const start = document.querySelector('.cauldron-stage-actions button') as HTMLElement;
    expect(start.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    // K4: una cartela por renglón.
    const stats = document.querySelector('.cauldron-stats-grid') as HTMLElement;
    expect(getComputedStyle(stats).gridTemplateColumns.split(' ').length).toBe(1);
  });

  /* CAU-01: el chip flotante se mostraba sobre la propia página del Caldero,
     tapando las stat cards. En mobile solo aparece FUERA de /cauldron. */
  test('corriendo con misión: la página entra y el chip flotante no se le pone encima (K2, CAU-01)', async () => {
    await setMobileViewport();
    installApi(cauldronApi(CAULDRON_RUNNING));
    mountInShell(<><CauldronPage /><CauldronFloatingTimer /></>, '/cauldron');
    await settle(800);
    await shoot('cauldron-02-corriendo');
    noOverflow('CAULDRON RUNNING');
    expect(document.querySelector('.cauldron-floating-timer')).toBeNull();
    // CAU-02: la ventana flotante es de Electron; el checkbox no va en Android.
    expect(document.querySelector('.cauldron-popout-toggle')).toBeNull();
  });

  test('fuera del Caldero el chip flotante entra en el ancho y no ofrece «abrir en ventana» (CAU-01)', async () => {
    await setMobileViewport();
    installApi(cauldronApi(CAULDRON_RUNNING));
    mountInShell(<CauldronFloatingTimer />, '/quests');
    await settle(800);
    const ft = document.querySelector('.cauldron-floating-timer') as HTMLElement | null;
    expect(ft).not.toBeNull();
    const r = ft!.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth);
    expect(ft!.scrollWidth).toBeLessThanOrEqual(ft!.clientWidth + 1);
    expect(ft!.querySelector('.cauldron-ft-btn--popout')).toBeNull();
    await shoot('cauldron-03-chip-fuera');
  });

  test('el editor de recetas es de una columna (K5)', async () => {
    await setMobileViewport();
    installApi(cauldronApi());
    mountInShell(<CauldronPage />, '/cauldron');
    await settle(800);
    // CauldronPage.tsx:786-788: «+ Crear Receta» abre el editor vacío (.cauldron-modal con .cauldron-form-grid).
    await page.getByRole('button', { name: /Crear Receta/i }).click();
    await settle(300);
    const grid = document.querySelector('.cauldron-form-grid') as HTMLElement | null;
    expect(grid).not.toBeNull();
    expect(getComputedStyle(grid!).gridTemplateColumns.split(' ').length).toBe(1);
    const modal = document.querySelector('.cauldron-modal') as HTMLElement;
    expect(modal.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });
});
