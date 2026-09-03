import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Dashboard from '@hub/Dashboard';
import CharacterPage from '@hub/CharacterPage';
import AchievementsPage from '@hub/AchievementsPage';
import RewardsPage from '@hub/rewards/RewardsPage';
import SettingsPage from '@hub/SettingsPage';
import { TourProvider } from '@shared/components/tour';
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

/**
 * Cuántos renglones ocupa el TEXTO de un botón.
 *
 * Estas dos comprobaciones (QA 0.9.0) medían `height <= 40` como atajo de «no
 * se parte en dos renglones». El atajo se venció el 2026-09-03, cuando los
 * botones del teléfono pasaron a tener 44 px de piso de toque (WCAG 2.5.5):
 * un botón de un solo renglón mide 44 y el atajo lo daba por partido. Esto
 * mide lo que la prueba siempre quiso medir: las cajas de línea del texto.
 */
function lineCount(el: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getClientRects().length;
}

describe('Hub a 390×844', () => {
  test('Tabla del Aventurero', async () => {
    await setMobileViewport();
    mountInShell(<Dashboard />, '/');
    await expect.element(page.getByText(/Tabla del Aventurero/i).first()).toBeVisible();
    await settle();
    await shoot('hub-01-dashboard');
    expectNoHorizontalOverflow('DASH MOBILE');
    // HUB-02: los cuatro controles de escritorio (arrastrar, ancho, alto) no
    // sirven en el teléfono y robaban la cabecera de cada widget. La regla
    // (hover: none) que los mostraba queda para escritorio táctil; bajo el
    // shell mobile van ocultos.
    const controls = document.querySelector('.widget-controls');
    expect(controls).not.toBeNull();
    expect(getComputedStyle(controls!).display).toBe('none');
    // Las cuatro cartelas (Nivel / XP hoy / Racha / Salud) van 2×2, no en
    // cuatro columnas de ~95 px donde «XP HOY» partía en tres renglones.
    const cartouches = [...document.querySelectorAll('.qb-cartouche')] as HTMLElement[];
    expect(cartouches.length).toBe(4);
    const widths = cartouches.map((c) => Math.round(c.getBoundingClientRect().width));
    // eslint-disable-next-line no-console
    console.log('DASH MOBILE CARTELAS', JSON.stringify(widths));
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(150);
    // HUB-01 / HUB-03: la fila HOY (parte + sello) y Crónica + Bitácora van
    // en una columna; eran grillas inline `1fr 220px` / `1.2fr 1fr`.
    for (const sel of ['.dash-row-brief', '.dash-row-chronicle']) {
      const row = document.querySelector(sel) as HTMLElement;
      expect(row, sel).not.toBeNull();
      expect(getComputedStyle(row).gridTemplateColumns.split(' ').length, sel).toBe(1);
    }
    for (const c of cartouches) {
      const label = c.querySelector('.qb-cartouche-label') as HTMLElement;
      const cs = getComputedStyle(label);
      // `line-height: normal` no se puede parsear: se mide un renglón real.
      let lineHeight = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lineHeight)) {
        const probe = document.createElement('span');
        probe.textContent = 'X';
        label.appendChild(probe);
        lineHeight = probe.getBoundingClientRect().height;
        probe.remove();
      }
      expect(label.scrollHeight, `«${label.textContent}» en más de 2 renglones`)
        .toBeLessThanOrEqual(lineHeight * 2 + 1);
    }
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
    // QA 0.9.0: «Descartar cambios» no se parte en dos renglones.
    await page.getByRole('button', { name: /Personalizar/i }).click();
    await settle(400);
    for (const btn of document.querySelectorAll<HTMLElement>('.hero-customize-actions .rpg-button')) {
      expect(lineCount(btn), `«${btn.textContent}» en dos renglones`).toBe(1);
      // Y sigue siendo alcanzable con el pulgar.
      expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
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
    // QA 0.9.0: «Nueva recompensa» no se parte en dos renglones.
    const add = document.querySelector('.rwd-add') as HTMLElement;
    expect(add).not.toBeNull();
    expect(lineCount(add), '«Nueva recompensa» en dos renglones').toBe(1);
    expect(add.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  /* SET-01: sin teclado físico no hay atajos; la tarjeta «Atajos de teclado» sobra en Android. */
  test('Ajustes no lista los atajos de teclado', async () => {
    await setMobileViewport();
    mountInShell(<TourProvider><SettingsPage /></TourProvider>, '/settings');
    await settle(600);
    // La página se montó entera: la tarjeta vecina del mismo grupo está.
    await expect.element(page.getByText(/Reiniciar Tour/i).first()).toBeInTheDocument();
    expect(document.querySelector('.settings-shortcuts')).toBeNull();
  });
});
