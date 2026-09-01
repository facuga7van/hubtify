import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@hub/Sidebar';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import type { PlayerStats } from '../../shared/types';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';

const SCREENS = 'screens';

/**
 * El sidebar se desbordaba a lo ALTO —siete entradas de menú más las barras,
 * la racha y el pie— pero lo único que lo compactaba era un breakpoint de
 * ANCHO. A tamaño normal aparecía un scroll que cortaba «Recompensas» por la
 * mitad; achicando la ventana de costado se arreglaba de casualidad.
 *
 * Este test mide lo único que importa: que el menú ENTRE sin scrollear, en una
 * ventana ancha (donde el breakpoint de ancho no dispara) pero baja.
 */
const stats: PlayerStats = {
  userId: 'default', level: 6, xp: 1898, xpToNextLevel: 2222, hp: 100, maxHp: 100,
  title: 'Escudero', streak: 1, dailyCombo: 2, comboDate: null, streakLastDate: null,
  totalTasks: 0, totalMeals: 0, totalExpenses: 0, hpDate: null,
  pardonsMonth: null, pardonsUsed: 0, pardonsRemaining: 2, bestStreak: 3, innSince: null,
} as PlayerStats;

beforeAll(() => {
  document.body.style.margin = '0';
  // Stub permisivo: el sidebar toca varios canales (notificaciones, códice,
  // invitación al sello) y cualquiera sin definir tira una promesa sin manejar
  // que se lleva puesto el render entero.
  (window as unknown as { api: unknown }).api = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === 'notificationsGetUnreadCount') return () => Promise.resolve(0);
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
});

const bar = () => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <Sidebar stats={stats} collapsed={false} />
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

/** Alto que le sobra al menú antes de tener que scrollear. */
function navOverflowPx(): number {
  const nav = document.querySelector('.sidebar-nav') as HTMLElement | null;
  if (!nav) throw new Error('no encontré .sidebar-nav');
  return nav.scrollHeight - nav.clientHeight;
}

describe('El sidebar entra sin scroll', () => {
  test('ventana ancha y baja: el menú entra entero, sin cortar entradas', async () => {
    await page.viewport(1200, 720);
    bar();
    await expect.element(page.getByText(/Recompensas/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/sidebar-01-ancha-y-baja.png` });
    // Cero: ni un píxel de scroll. Es lo que hacía que «Recompensas» se
    // cortara al medio y el scroll se viera mal hecho.
    expect(navOverflowPx()).toBeLessThanOrEqual(0);
  });

  test('ventana muy baja: sigue entrando apretando más', async () => {
    await page.viewport(1200, 620);
    bar();
    await expect.element(page.getByText(/Recompensas/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/sidebar-03-muy-baja.png` });
    expect(navOverflowPx()).toBeLessThanOrEqual(0);
  });

  test('ventana angosta: sigue entrando', async () => {
    await page.viewport(880, 720);
    bar();
    await expect.element(page.getByText(/Recompensas/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/sidebar-02-angosta.png` });
    expect(navOverflowPx()).toBeLessThanOrEqual(0);
  });
});
