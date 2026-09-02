import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import FatalScreen from '../../../src/mobile/FatalScreen';
import { setMobileViewport, settle, shoot, docOverflowX } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';

/**
 * Tarea 17 Step 7 del plan de Fase 5: no hay forma no invasiva de provocar un
 * fatal de migración en el emulador, así que el layout de `.mobile-fatal__*` se
 * mira acá. El botón «Exportar base de datos» NO aparece: `canExportDb()` es
 * false sin worker (esto corre en Chromium, no en el WebView). Lo que se
 * verifica es el layout de la pantalla y que el detalle de la migración —
 * namespace y versión — llegue a la UI.
 */
describe('FatalScreen — layout en 390×844', () => {
  test('fatal de migración: título, detalle y acciones sin desbordar', async () => {
    await setMobileViewport();
    render(<FatalScreen reason="migration" message={'near "FOO": syntax error'} namespace="quests" version={7} />);
    await settle();

    const root = document.querySelector('.mobile-fatal') as HTMLElement;
    expect(root).not.toBeNull();
    const text = root.innerText;
    expect(text).toContain('quests');
    expect(text).toContain('7');
    // Sin worker no hay nada que exportar: el botón no se ofrece.
    expect(root.innerText).not.toContain('Exportar base de datos');
    expect(docOverflowX()).toBeLessThanOrEqual(0);

    const actions = document.querySelector('.mobile-fatal__actions') as HTMLElement;
    expect(actions).not.toBeNull();
    expect(actions.getBoundingClientRect().width).toBeLessThanOrEqual(390);

    await shoot('fatal-00-migracion');
  });
});
