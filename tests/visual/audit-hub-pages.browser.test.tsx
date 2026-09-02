import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import AchievementsPage from '@hub/AchievementsPage';
import CharacterPage from '@hub/CharacterPage';
import RewardsPage from '@hub/rewards/RewardsPage';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { ACHIEVEMENTS } from '../../shared/achievements';
import {
  installApi, SCREENS, WIDE, NARROW, fitCapture, resetCapture,
  overflowingNodes, clippedText, unlabelledButtons, lowContrastText, PARCH_WORST,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/hub/styles/character.css';
import '../../src/hub/styles/codex-seal.css';
import '../../src/shared/styles/help-bubble.css';

const baseAuth = {
  user: { uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo' },
  loading: false, switching: false,
  login: async () => ({ success: false }), register: async () => ({ success: false }),
  logout: async () => ({ success: true }), switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }), forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
} as unknown as React.ContextType<typeof AuthContext>;

beforeAll(() => {
  document.body.style.margin = '0';
  installApi({
    rpgGetAchievements: () => Promise.resolve(ACHIEVEMENTS.map((a, i) => ({
      id: a.id,
      hidden: Boolean((a as { hidden?: boolean }).hidden),
      unlocked: i % 3 === 0,
      unlockedAt: i % 3 === 0 ? new Date(Date.now() - i * 86_400_000).toISOString() : undefined,
    }))),
  });
});

function mount(node: ReactNode, sidebar: number) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider>
          <div id="audit-root" className="app-layout" style={{ height: '100vh' }}>
            <div data-testid="mouse-park" style={{ width: sidebar, flexShrink: 0, background: 'var(--leather)' }} />
            <main className="main-content">{node}</main>
          </div>
        </ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function report(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({
    hOverflowMain: main.scrollWidth - main.clientWidth,
    overflow: overflowingNodes(main).slice(0, 10),
    clipped: clippedText(main).slice(0, 10),
    noLabel: unlabelledButtons(main),
    bajoContraste: lowContrastText(main, PARCH_WORST).slice(0, 12),
  }, null, 1));
  return main;
}

/** Captura arriba y abajo de la página, que suele scrollear. */
async function shots(name: string) {
  // El cursor se queda donde lo dejó el test anterior y deja tooltips abiertos
  // en la captura. Lo estacionamos sobre el hueco del sidebar, que no tiene
  // ningún disparador.
  await page.getByTestId('mouse-park').hover();
  const main = document.querySelector('.main-content') as HTMLElement;
  fitCapture();
  await page.screenshot({ path: `${SCREENS}/${name}-a.png` });
  if (main.scrollHeight - main.clientHeight > 40) {
    main.scrollTop = main.scrollHeight;
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/${name}-b.png` });
    main.scrollTop = 0;
  }
  resetCapture();
}

describe('Estante de logros', () => {
  test('maximizada', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<AchievementsPage />, 260);
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await settle();
    const main = report('LOGROS WIDE');
    await shots('audit-hub-logros-01-wide');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });

  test('angosta + filtros', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(<AchievementsPage />, 56);
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await settle();
    const main = report('LOGROS NARROW');
    await shots('audit-hub-logros-02-narrow');

    await page.getByRole('button', { name: /Pendientes/i }).click();
    await settle(250);
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-logros-03-pendientes.png` });
    resetCapture();

    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});

describe('Hoja de personaje', () => {
  test('maximizada', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<CharacterPage />, 260);
    await settle(700);
    const main = report('PERSONAJE WIDE');
    await shots('audit-hub-personaje-01-wide');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });

  test('angosta', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(<CharacterPage />, 56);
    await settle(700);
    const main = report('PERSONAJE NARROW');
    await shots('audit-hub-personaje-02-narrow');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});

describe('Mostrador de recompensas', () => {
  test('maximizada + formulario abierto', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<RewardsPage />, 260);
    await settle(600);
    const main = report('RECOMPENSAS WIDE');
    await shots('audit-hub-recompensas-01-wide');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });

  test('angosta + pestaña tienda', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    mount(<RewardsPage />, 56);
    await settle(600);
    report('RECOMPENSAS NARROW');
    await shots('audit-hub-recompensas-02-narrow');
  });
});
