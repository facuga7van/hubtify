import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import AchievementsPage from '@hub/AchievementsPage';
import { ACHIEVEMENTS } from '../../shared/achievements';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

const SCREENS = 'screens';

/**
 * El reclamo real: «no se entiende cuál está hecho y cuál no, es muy
 * transparente todo». Esta pantalla existe para MIRAR el contraste entre una
 * medalla acuñada y un engarce vacío, y para ver el filtro nuevo.
 */
beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-1)';

  // Los primeros dos ganados, el resto pendiente — el mismo caso del reporte.
  const state = ACHIEVEMENTS.map((a, i) => ({
    id: a.id,
    hidden: Boolean((a as { hidden?: boolean }).hidden),
    unlocked: i < 2,
    unlockedAt: i < 2 ? '2026-09-01T12:00:00.000Z' : undefined,
  }));

  (window as unknown as { api: Record<string, unknown> }).api = {
    rpgGetDaySummary: () => Promise.resolve(null),
    rpgGetAchievements: () => Promise.resolve(state),
  };
});

const shelf = () => render(<MemoryRouter><AchievementsPage /></MemoryRouter>);

describe('Estante de logros — obtenidos vs pendientes', () => {
  test('todos: la medalla acuñada se distingue del engarce vacío', async () => {
    shelf();
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/achievements-01-todos.png` });
  });

  test('solo obtenidos', async () => {
    shelf();
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await page.getByRole('button', { name: /Obtenidos/i }).click();
    await page.screenshot({ path: `${SCREENS}/achievements-02-obtenidos.png` });
  });

  test('solo pendientes', async () => {
    shelf();
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await page.getByRole('button', { name: /Pendientes/i }).click();
    await page.screenshot({ path: `${SCREENS}/achievements-03-pendientes.png` });
  });
});

/**
 * Decisión abierta nº4: el «/ N» de cada estante se calculaba sobre la lista YA
 * FILTRADA, así que el denominador cambiaba de significado con el filtro —de
 * «cuántos hay en la sección» a «cuántos pasan el filtro»— y el numerador se
 * iba a cero en Pendientes aunque el estante tuviera medallones ganados.
 *
 * El caso que lo delata: un grupo con UNO ganado y varios pendientes. Medido
 * con este mismo test contra el render viejo, el estante de Questify decía
 * «1/4» en Todos y «0/3» en Pendientes; ahora dice «1/4» en los dos, igual que
 * el contador de la cabecera.
 */
describe('Estante de logros — el contador del estante no depende del filtro', () => {
  const counters = () => Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('.ach-counter__total[data-group]')]
      .map((n) => [n.dataset.group!, (n.textContent ?? '').trim()]),
  );

  test('mismo estante, filtro Todos y filtro Pendientes: mismo «obtenidos / total»', async () => {
    // `first_quest` vive en el estante de Questify: uno ganado, el resto
    // pendiente.
    (window as unknown as { api: Record<string, unknown> }).api = {
      rpgGetDaySummary: () => Promise.resolve(null),
      rpgGetAchievements: () => Promise.resolve(ACHIEVEMENTS.map((a) => ({
        id: a.id,
        hidden: Boolean((a as { hidden?: boolean }).hidden),
        unlocked: a.id === 'first_quest',
        unlockedAt: a.id === 'first_quest' ? '2026-09-01T12:00:00.000Z' : undefined,
      }))),
    };

    render(<MemoryRouter><AchievementsPage /></MemoryRouter>);
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    const todos = counters();
    expect(todos.quests, 'el estante de Questify no se pintó').toMatch(/^1\/\d+$/);

    await page.getByRole('button', { name: /Pendientes/i }).click();
    await expect.element(page.getByRole('button', { name: /Pendientes/i })).toHaveAttribute('aria-pressed', 'true');
    const pendientes = counters();

    expect(Object.keys(pendientes).length, 'no quedó ningún estante bajo el filtro').toBeGreaterThan(0);
    for (const [group, texto] of Object.entries(pendientes)) {
      expect(texto, `el contador del estante «${group}» cambió con el filtro`).toBe(todos[group]);
    }
    // Y el caso puntual, escrito a mano para que se lea en el diff.
    expect(pendientes.quests).toBe(todos.quests);
  });
});
