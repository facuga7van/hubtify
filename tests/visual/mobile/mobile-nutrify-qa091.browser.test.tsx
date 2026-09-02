/**
 * Bugs de Nutrify del QA exploratorio de la 0.9.0 en Android
 * (docs/superpowers/plans/2026-09-02-mobile-qa-0.9.0.md): NUT-01..04.
 * Cada test monta la página real dentro del MobileShell a 390×844 y afirma
 * sobre la geometría o el estado que el informe vio roto.
 */
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

// Mismo seam que mobile-nutrify: la callable de Firebase no corre en el browser.
vi.mock('../../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, items: [] }),
}));

import Today from '@modules/nutrition/components/Today';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import { installApi, mountInShell, setMobileViewport, settle, shoot } from './mobile-harness';
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

/** Abre la edición de la primera fila y devuelve la fila en edición. */
async function openFirstEdit(): Promise<HTMLElement> {
  (document.querySelector('.nutri-food-action[aria-label^="Editar"]') as HTMLButtonElement).click();
  await settle(200);
  const row = document.querySelector('.nutri-meal-row--edit') as HTMLElement;
  expect(row).not.toBeNull();
  return row;
}

describe('Nutrify — QA 0.9.0 (NUT-01)', () => {
  test('NUT-01: Guardar y Cancelar explícitos, en una fila y del alto de los inputs', async () => {
    installApi(NUTRITION_API);
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    const row = await openFirstEdit();

    const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('.nutri-meal-edit-actions button'));
    const save = buttons.find(b => b.textContent?.trim() === 'Guardar');
    const cancel = buttons.find(b => b.textContent?.trim() === 'Cancelar');
    expect(save, 'botón Guardar').toBeDefined();
    expect(cancel, 'botón Cancelar').toBeDefined();

    // La IA es secundaria: etiquetada, y no se confunde con guardar.
    const ai = row.querySelector('button[aria-label="Re-estimar con IA"]') as HTMLButtonElement;
    expect(ai).not.toBeNull();
    expect(ai.textContent?.trim()).not.toBe('');
    expect(ai.textContent).not.toMatch(/Guardar/);

    // ≥ 40 px de alto, misma fila, y a la altura de los inputs.
    const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input'));
    for (const b of buttons) {
      expect(b.offsetHeight, b.textContent ?? '').toBeGreaterThanOrEqual(40);
      expect(b.offsetTop).toBe(save!.offsetTop);
      expect(Math.abs(b.offsetHeight - inputs[0].offsetHeight)).toBeLessThanOrEqual(2);
    }
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    row.scrollIntoView({ block: 'center' });
    await shoot('nutrify-qa-01-edit-row');
  });

  test('NUT-01: Enter en cualquier input guarda, Escape cancela, blur afuera guarda', async () => {
    const update = vi.fn(async () => null);
    installApi({ ...NUTRITION_API, nutritionUpdateFood: update });
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);

    // Enter en la descripción (antes solo el input de kcal tenía handler).
    let row = await openFirstEdit();
    const desc = row.querySelector<HTMLInputElement>('input:not([type="number"])')!;
    desc.focus();
    await userEvent.keyboard('{Enter}');
    await settle(300);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.nutri-meal-row--edit')).toBeNull();

    // Escape cancela sin guardar.
    row = await openFirstEdit();
    row.querySelector<HTMLInputElement>('input[type="number"]')!.focus();
    await userEvent.keyboard('{Escape}');
    await settle(300);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.nutri-meal-row--edit')).toBeNull();

    // Tocar afuera (el foco se va de la fila) guarda.
    row = await openFirstEdit();
    row.querySelector<HTMLInputElement>('input[type="number"]')!.focus();
    (document.querySelector('.nutri-page') as HTMLElement).click();
    (document.activeElement as HTMLElement | null)?.blur();
    await settle(300);
    expect(update).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.nutri-meal-row--edit')).toBeNull();

    // Cancelar con el botón tampoco guarda, aunque el foco salga del input.
    row = await openFirstEdit();
    row.querySelector<HTMLInputElement>('input[type="number"]')!.focus();
    await page.getByRole('button', { name: /^Cancelar$/ }).click();
    await settle(300);
    expect(update).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.nutri-meal-row--edit')).toBeNull();
  });
});

describe('Nutrify — QA 0.9.0 (NUT-03)', () => {
  test('NUT-03: la barra «Cerrar el Día» se esconde mientras un input tiene el foco', async () => {
    installApi(NUTRITION_API);
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    const footer = () => document.querySelector('.nutri-sticky-footer') as HTMLElement;
    expect(footer()).not.toBeNull();
    expect(getComputedStyle(footer()).display).not.toBe('none');

    // Con el teclado abierto (= un input enfocado) la barra tapaba la fila en edición.
    const row = await openFirstEdit();
    row.querySelector<HTMLInputElement>('input:not([type="number"])')!.focus();
    await settle(100);
    expect(getComputedStyle(footer()).display).toBe('none');

    // El foco se va (la fila guarda y se cierra): la barra vuelve.
    (document.activeElement as HTMLElement).blur();
    await settle(300);
    expect(getComputedStyle(footer()).display).not.toBe('none');
  });
});

describe('Nutrify — QA 0.9.0 (NUT-04)', () => {
  test('NUT-04: confirmación de borrado con el texto arriba y los botones juntos en una fila', async () => {
    installApi(NUTRITION_API);
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    (document.querySelector('.nutri-food-action[aria-label^="Eliminar"]') as HTMLButtonElement).click();
    await settle(200);
    const box = document.querySelector('.nutri-meal-del-confirm') as HTMLElement;
    expect(box).not.toBeNull();
    const text = box.querySelector('.nutri-meal-del-confirm-text') as HTMLElement;
    const [del, cancel] = Array.from(box.querySelectorAll<HTMLButtonElement>('button'));
    expect(del.textContent).toMatch(/Eliminar/);
    expect(cancel.textContent).toMatch(/Cancelar/);
    // Texto arriba; Eliminar y Cancelar en el mismo renglón, ≥ 40 px de alto.
    expect(text.getBoundingClientRect().bottom).toBeLessThanOrEqual(del.getBoundingClientRect().top + 1);
    expect(del.offsetTop).toBe(cancel.offsetTop);
    expect(del.offsetHeight).toBeGreaterThanOrEqual(40);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    box.scrollIntoView({ block: 'center' });
    await shoot('nutrify-qa-04-delete');
  });
});

describe('Nutrify — QA 0.9.0 (NUT-05)', () => {
  test('NUT-05: los inputs de hora del horario de comidas dan lugar a «10:00 AM»', async () => {
    installApi(NUTRITION_API);
    await setMobileViewport();
    mountInShell(<NutritionSettings />, '/nutrition/settings');
    await settle(700);
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.nutri-meal-schedule-time'));
    expect(inputs.length).toBeGreaterThan(0);
    // Sonda: el texto más ancho del formato de 12 h con la misma tipografía
    // del input, más su padding y el reloj del picker nativo (≈ 20 px).
    const probe = document.createElement('span');
    const cs = getComputedStyle(inputs[0]);
    probe.style.font = cs.font;
    probe.style.whiteSpace = 'pre';
    probe.textContent = '10:00 AM';
    document.body.appendChild(probe);
    const textW = probe.getBoundingClientRect().width;
    probe.remove();
    const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 20;
    for (const input of inputs) {
      expect(input.getBoundingClientRect().width).toBeGreaterThanOrEqual(textW + chrome);
    }
    const row = document.querySelector('.nutri-meal-schedule-row') as HTMLElement;
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  });
});

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
