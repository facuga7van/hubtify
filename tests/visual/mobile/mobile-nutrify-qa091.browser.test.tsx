/**
 * Bugs de Nutrify del QA exploratorio de la 0.9.0 en Android
 * (docs/superpowers/plans/2026-09-02-mobile-qa-0.9.0.md): NUT-01..04.
 * Cada test monta la página real dentro del MobileShell a 390×844 y afirma
 * sobre la geometría o el estado que el informe vio roto.
 */
import { describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

// Mismo seam que mobile-nutrify: la callable de Firebase no corre en el browser.
vi.mock('../../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, items: [] }),
}));

import Today from '@modules/nutrition/components/Today';
import { installApi, mountInShell, setMobileViewport, settle } from './mobile-harness';
import { NUTRITION_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/nutrition/styles/nutri.css';

const BREAKDOWN = {
  xpPrecision: 20, xpSteps: 0, xpGym: 0, xpWeight: 0, xpBonus: 5, xpTotal: 25,
  hpChange: 5, consumed: 3740, target: 2000,
};

describe('Nutrify — QA 0.9.0 (NUT-02)', () => {
  test('NUT-02: cerrar el día deja la página en solo lectura sin recargar', async () => {
    installApi({
      ...NUTRITION_API,
      nutritionCloseDay: async () => ({ success: true, breakdown: BREAKDOWN }),
    });
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);

    // Antes de cerrar: acciones de fila (editar / borrar / favorito) y barra sticky.
    expect(document.querySelectorAll('.nutri-food-action').length).toBeGreaterThan(0);
    expect(document.querySelector('.nutri-sticky-footer')).not.toBeNull();

    await page.getByRole('button', { name: /Cerrar el Día|Confirmar Día/i }).click();
    await settle(300);
    const confirmBtn = document.querySelector('.nutri-popup .nutri-btn-primary') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await settle(700);

    // Después: sin barra sticky, sin acciones de fila, con «Reabrir» a la vista.
    expect(document.querySelector('.nutri-sticky-footer')).toBeNull();
    expect(document.querySelectorAll('.nutri-food-action').length).toBe(0);
    // Banner + tarjeta de cierre: dos «Reabrir día», como tras un reload.
    await expect.element(page.getByRole('button', { name: /Reabrir/i }).first()).toBeVisible();
    expect(document.querySelectorAll('.nutri-day-success').length).toBe(1);
  });
});
