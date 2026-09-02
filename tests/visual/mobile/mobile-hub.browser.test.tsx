import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Dashboard from '@hub/Dashboard';
import CharacterPage from '@hub/CharacterPage';
import AchievementsPage from '@hub/AchievementsPage';
import RewardsPage from '@hub/rewards/RewardsPage';
import { ACHIEVEMENTS } from '../../../shared/achievements';
import {
  installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes,
} from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/hub/styles/dashboard-layouts.css';
import '../../../src/hub/styles/character.css';
import '../../../src/hub/styles/codex-seal.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';

beforeAll(() => {
  installApi({
    rpgGetAchievements: () => Promise.resolve(ACHIEVEMENTS.map((a, i) => ({
      id: a.id,
      hidden: Boolean((a as { hidden?: boolean }).hidden),
      unlocked: i % 3 === 0,
      unlockedAt: i % 3 === 0 ? new Date(Date.now() - i * 86_400_000).toISOString() : undefined,
    }))),
  });
});

/** Lo que se le pide a CADA página de esta fase (spec §11): nada desborda a lo ancho. */
function expectNoHorizontalOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 10) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Hub a 390×844', () => {
  test('Tabla del Aventurero', async () => {
    await setMobileViewport();
    mountInShell(<Dashboard />, '/');
    await expect.element(page.getByText(/Tabla del Aventurero/i).first()).toBeVisible();
    await settle();
    await shoot('hub-01-dashboard');
    expectNoHorizontalOverflow('DASH MOBILE');
    // Los controles de los widgets no pueden depender del hover en touch (H6);
    // el project emula touch, así que (hover: none) aplica.
    const controls = document.querySelector('.widget-controls');
    expect(controls).not.toBeNull();
    expect(getComputedStyle(controls!).opacity).toBe('1');
  });

  test('Ficha del Héroe', async () => {
    await setMobileViewport();
    mountInShell(<CharacterPage />, '/character');
    await settle(700);
    await shoot('hub-02-personaje');
    expectNoHorizontalOverflow('PERSONAJE MOBILE');
    // Las cuatro stats y las virtudes ya no van en 4/2 columnas de 65 px (H7, H8).
    const stats = document.querySelector('.hero-stats-grid') as HTMLElement;
    expect(getComputedStyle(stats).gridTemplateColumns.split(' ').length).toBe(2);
    const virtues = document.querySelector('.hero-virtues-grid') as HTMLElement;
    expect(getComputedStyle(virtues).gridTemplateColumns.split(' ').length).toBe(1);
  });

  test('Estante de logros', async () => {
    await setMobileViewport();
    mountInShell(<AchievementsPage />, '/achievements');
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await settle();
    await shoot('hub-03-logros');
    expectNoHorizontalOverflow('LOGROS MOBILE');
    // El contador del header baja a su propio renglón (H2): no le roba ancho al título.
    const title = document.querySelector('.qb-header-text') as HTMLElement;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(300);
  });

  test('Mostrador de recompensas', async () => {
    await setMobileViewport();
    mountInShell(<RewardsPage />, '/rewards');
    await settle(600);
    await shoot('hub-04-recompensas');
    expectNoHorizontalOverflow('RECOMPENSAS MOBILE');
  });
});
