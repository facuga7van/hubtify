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
