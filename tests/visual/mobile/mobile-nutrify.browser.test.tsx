import { beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

// Mismo seam que audit-nutri-screens: la callable de Firebase no corre en el browser.
vi.mock('../../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, items: [] }),
}));

import Today from '@modules/nutrition/components/Today';
import NutritionCharts from '@modules/nutrition/components/NutritionCharts';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
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

beforeAll(() => {
  installApi(NUTRITION_API);
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Nutrify a 390×844', () => {
  test('Today: comidas, evento y macros (N1, N6)', async () => {
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    await shoot('nutrify-01-today');
    noOverflow('NUTRI TODAY');
    const pageEl = document.querySelector('.nutri-page') as HTMLElement;
    expect(parseFloat(getComputedStyle(pageEl).paddingLeft)).toBeLessThanOrEqual(12);
    for (const row of document.querySelectorAll<HTMLElement>('.nutri-meal-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // N6: el nombre de la comida tiene renglón de verdad.
    const name = document.querySelector('.nutri-meal-row .nutri-meal-name') as HTMLElement;
    expect(name.getBoundingClientRect().width).toBeGreaterThan(150);
  });

  test('Crónica: cabecera con pestañas de rango (N2)', async () => {
    await setMobileViewport();
    mountInShell(<NutritionCharts />, '/nutrition/dashboard');
    await settle(700);
    await shoot('nutrify-02-cronica');
    noOverflow('NUTRI CRONICA');
    const title = document.querySelector('.nutri-page-title') as HTMLElement;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(250);
  });

  test('Configuración: objetivo, macros y horarios (N4, N8, N11)', async () => {
    await setMobileViewport();
    mountInShell(<NutritionSettings />, '/nutrition/settings');
    await settle(700);
    await shoot('nutrify-03-config');
    noOverflow('NUTRI CONFIG');
    for (const row of document.querySelectorAll<HTMLElement>('.nutri-meal-schedule-row, .nutri-goal-toggle')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test('el popup de cerrar el día scrollea en vez de salirse (N9)', async () => {
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    // Today.tsx:2094-2100: «Cerrar el Día» (o «Confirmar Día» si el día está pendiente).
    await page.getByRole('button', { name: /Cerrar el Día|Confirmar Día/i }).click();
    await settle(300);
    const popup = document.querySelector('.nutri-popup') as HTMLElement;
    expect(popup).not.toBeNull();
    const r = popup.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(getComputedStyle(popup).overflowY).toBe('auto');
    await shoot('nutrify-04-cerrar-dia');
  });
});
