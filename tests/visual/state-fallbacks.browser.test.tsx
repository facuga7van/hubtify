import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import AchievementsPage from '@hub/AchievementsPage';
import RewardsPage from '@hub/rewards/RewardsPage';
import DashboardWidgetWrapper from '@hub/widgets/DashboardWidgetWrapper';
import HabitsDashboardWidget from '@modules/quests/components/HabitsDashboardWidget';
import CauldronPage from '@modules/cauldron/components/CauldronPage';
import CauldronDashboardWidget from '@modules/cauldron/components/CauldronDashboardWidget';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/dashboard-layouts.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/modules/cauldron/styles/cauldron.css';

const SCREENS = 'screens';

/**
 * C8 — el peor pecado del criterio: el ERROR disfrazado de VACÍO.
 *
 * Tres pantallas hacían exactamente lo mismo: `console.error` (o ni eso) y
 * después pintaban su estado vacío. El usuario leía «Sin rituales configurados»
 * cuando lo que había pasado es que la consulta se cayó, y el botón «Creá tu
 * primer ritual» lo invitaba a resolver un problema que no tenía.
 *
 * Estos tests fallan contra el código anterior: son la prueba del disfraz.
 */

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Instala un `window.api` permisivo; `over` pisa métodos puntuales. */
function api(over: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = new Proxy(over, {
    get: (target, prop: string) => {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: (target, prop: string) => prop in target,
  });
}

const wrap = (node: React.ReactNode) => render(
  <MemoryRouter><ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider></MemoryRouter>,
);

const bodyText = () => document.body.textContent ?? '';

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

/* ── 1. Rituales del tablero ─────────────────────────────────────────────── */

describe('Widget de rituales — el error deja de decir «no tenés hábitos»', () => {
  test('si la consulta se cae, avisa que falló y ofrece reintentar', async () => {
    let calls = 0;
    api({ questsGetHabits: () => { calls += 1; return Promise.reject(new Error('db locked')); } });
    wrap(<div className="rpg-card" style={{ width: 300, padding: 12 }}><HabitsDashboardWidget /></div>);
    await settle();
    await page.screenshot({ path: `${SCREENS}/state-habitos-error.png` });

    // El disfraz: el vacío y su invitación NO pueden aparecer tras un fallo.
    expect(bodyText()).not.toContain('Sin hábitos configurados');
    expect(bodyText()).not.toContain('Creá tu primer hábito');

    const box = document.querySelector('.hub-error');
    expect(box, 'el fallo no se anuncia como fallo').toBeTruthy();
    const retry = box!.querySelector<HTMLButtonElement>('.hub-error__retry');
    expect(retry, 'sin puerta de vuelta').toBeTruthy();

    const before = calls;
    retry!.click();
    await settle(150);
    expect(calls, 'reintentar no vuelve a pedir los datos').toBeGreaterThan(before);
  });

  test('mientras carga muestra esqueleto en vez de desaparecer', async () => {
    api({ questsGetHabits: () => new Promise(() => { /* nunca resuelve */ }) });
    wrap(<div className="rpg-card" style={{ width: 300, padding: 12 }}><HabitsDashboardWidget /></div>);
    await settle(120);
    // Antes: `if (loading) return null` — el widget entero se esfumaba.
    expect(document.querySelectorAll('.hub-skeleton').length).toBeGreaterThan(0);
  });

  test('vacío de verdad: sigue invitando a crear el primero', async () => {
    api({ questsGetHabits: () => Promise.resolve([]) });
    wrap(<div className="rpg-card" style={{ width: 300, padding: 12 }}><HabitsDashboardWidget /></div>);
    await settle();
    expect(document.querySelector('.hub-error')).toBeNull();
    expect(bodyText()).toContain('Sin hábitos configurados');
  });
});

/* ── 2. Estante de logros ────────────────────────────────────────────────── */

describe('Logros — el error deja de decir «el estante está vacío»', () => {
  test('si `rpgGetAchievements` rechaza, no dice que no hay nada', async () => {
    let calls = 0;
    api({
      rpgGetDaySummary: () => Promise.resolve(null),
      rpgGetAchievements: () => { calls += 1; return Promise.reject(new Error('boom')); },
    });
    wrap(<AchievementsPage />);
    await settle(500);
    await page.screenshot({ path: `${SCREENS}/state-logros-error.png` });

    expect(bodyText()).not.toContain('Todavía no hay nada en el estante');
    const box = document.querySelector('.hub-error');
    expect(box, 'el fallo se sigue disfrazando de estante vacío').toBeTruthy();

    const before = calls;
    box!.querySelector<HTMLButtonElement>('.hub-error__retry')!.click();
    await settle(200);
    expect(calls).toBeGreaterThan(before);
  });

  test('el hueco del filtro ofrece limpiar el filtro', async () => {
    api({
      rpgGetDaySummary: () => Promise.resolve(null),
      rpgGetAchievements: () => Promise.resolve([
        { id: 'first_task', hidden: false, unlocked: false, unlockedAt: undefined },
      ]),
    });
    wrap(<AchievementsPage />);
    await settle(500);
    await page.getByRole('button', { name: /Obtenidos/i }).click();
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/state-logros-filtro.png` });

    const hole = document.querySelector('.hub-empty');
    expect(hole, 'el hueco del filtro sigue siendo una frase suelta').toBeTruthy();
    const cta = hole!.querySelector<HTMLButtonElement>('.hub-empty__cta');
    expect(cta, 'no ofrece salir del filtro').toBeTruthy();
    cta!.click();
    await settle(200);
    // Volvió a «Todos»: el medallón pendiente se ve otra vez.
    expect(document.querySelectorAll('.ach-card').length).toBeGreaterThan(0);
  });
});

/* ── 3. Caldero ─────────────────────────────────────────────────────────── */

const CAULDRON_OK = {
  cauldronGetPresets: () => Promise.resolve([
    { id: 'p1', name: 'Classic', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLong: 4, extensionMinutes: 5, isDefault: true },
  ]),
  cauldronGetStats: () => Promise.resolve({ today: 0, week: 0, total: 0, streak: 0 }),
  cauldronGetState: () => Promise.resolve({ status: 'idle', remainingMs: 0, totalMs: 0, sessionType: 'work', currentCycle: 1, totalCycles: 4, presetId: 'p1' }),
  cauldronGetSessions: () => Promise.resolve({ sessions: [], hasMore: false }),
  cauldronGetWeeklyFocusTime: () => Promise.resolve([]),
  cauldronGetInterruptedSession: () => Promise.resolve(null),
  questsGetTasks: () => Promise.resolve([]),
  questsGetProjects: () => Promise.resolve([]),
};

describe('Caldero — deja de mostrar ceros como si fueran dato', () => {
  test('si la carga se cae, dice que falló en vez de pintar un estante vacío', async () => {
    let calls = 0;
    api({
      ...CAULDRON_OK,
      cauldronGetStats: () => { calls += 1; return Promise.reject(new Error('db locked')); },
    });
    wrap(<CauldronPage />);
    await settle(600);
    await page.screenshot({ path: `${SCREENS}/state-caldero-error.png` });

    expect(bodyText()).not.toContain('El estante está vacío');
    const box = document.querySelector('.hub-error');
    expect(box, 'el caldero sigue disfrazando el fallo de vacío').toBeTruthy();

    const before = calls;
    box!.querySelector<HTMLButtonElement>('.hub-error__retry')!.click();
    await settle(300);
    expect(calls).toBeGreaterThan(before);
  });

  test('mientras carga muestra esqueleto, no cero pociones', async () => {
    api({ ...CAULDRON_OK, cauldronGetStats: () => new Promise(() => { /* cuelga */ }) });
    wrap(<CauldronPage />);
    await settle(150);
    await page.screenshot({ path: `${SCREENS}/state-caldero-cargando.png` });
    expect(document.querySelectorAll('.hub-skeleton').length).toBeGreaterThan(0);
    // Los ceros de `useState` no se pueden confundir con el registro real.
    expect(bodyText()).not.toContain('El estante está vacío');
  });

  test('el estante vacío de verdad ofrece encender el caldero', async () => {
    api(CAULDRON_OK);
    wrap(<CauldronPage />);
    await settle(600);
    await page.screenshot({ path: `${SCREENS}/state-caldero-vacio.png` });
    const holes = document.querySelectorAll('.hub-empty');
    expect(holes.length, 'el estante y el gráfico siguen siendo frases sueltas').toBeGreaterThan(0);
    const withCta = [...holes].filter((h) => h.querySelector('.hub-empty__cta'));
    expect(withCta.length, 'ningún hueco del caldero ofrece salida').toBeGreaterThan(0);
  });
});

describe('Widget del caldero', () => {
  test('si la carga se cae, no dice «Caldero en reposo»', async () => {
    api({
      cauldronGetStats: () => Promise.reject(new Error('boom')),
      cauldronGetState: () => Promise.reject(new Error('boom')),
      cauldronGetPresets: () => Promise.reject(new Error('boom')),
    });
    wrap(<div className="rpg-card" style={{ width: 320, padding: 12 }}><CauldronDashboardWidget /></div>);
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/state-caldero-widget-error.png` });
    expect(bodyText()).not.toContain('Caldero en reposo');
    expect(document.querySelector('.hub-error'), 'el widget calla el fallo').toBeTruthy();
  });

  test('mientras carga muestra esqueleto, no un cero inventado', async () => {
    api({
      cauldronGetStats: () => new Promise(() => { /* cuelga */ }),
      cauldronGetState: () => new Promise(() => { /* cuelga */ }),
      cauldronGetPresets: () => new Promise(() => { /* cuelga */ }),
    });
    wrap(<div className="rpg-card" style={{ width: 320, padding: 12 }}><CauldronDashboardWidget /></div>);
    await settle(150);
    expect(document.querySelectorAll('.hub-skeleton').length).toBeGreaterThan(0);
  });

  /* Paridad: en escritorio «ya hay un timer activo» abre la ventana flotante.
     En Android ese canal NO EXISTE (`platforms: 'desktop'`) y el `?.` se tragaba
     la llamada: el usuario tocaba «Quick Brew» y no pasaba absolutamente nada. */
  test('en teléfono, «ya hay una poción al fuego» dice algo en vez de nada', async () => {
    // Objeto PLANO, no el Proxy permisivo: el punto del test es que
    // `cauldronOpenWindow` NO EXISTA, igual que en el binding de Android.
    (window as unknown as { api: unknown }).api = {
      cauldronGetStats: () => Promise.resolve({ today: 0, week: 0, total: 0, streak: 0 }),
      cauldronGetState: () => Promise.resolve(null),
      cauldronGetPresets: () => Promise.resolve([{ id: 'p1', name: 'Classic', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLong: 4, isDefault: true }]),
      cauldronStart: () => Promise.reject(new Error('Timer already active')),
      onCauldronTick: () => () => undefined,
      onCauldronSessionEnd: () => () => undefined,
    };
    wrap(<div className="rpg-card" style={{ width: 320, padding: 12 }}><CauldronDashboardWidget /></div>);
    await settle(400);
    await page.getByRole('button', { name: /Iniciar Poción/i }).click();
    // Un toast, un aviso, algo: la única respuesta inaceptable es el silencio.
    // Con `expect.element` en vez de un `settle` fijo, porque el toast se
    // descarta solo a los 2,5 s y la máquina puede estar cargada.
    await expect.element(page.getByText(/poción al fuego/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/state-caldero-widget-movil.png` });
  });
});

/* ── 4. Un widget roto ya no tumba el tablero ───────────────────────────── */

function Bomb(): React.ReactElement {
  throw new Error('widget roto');
}

const DRAG = {
  onDragStart: () => undefined, onDragOver: () => undefined,
  onDragLeave: () => undefined, onDrop: () => undefined, onDragEnd: () => undefined,
};

describe('ErrorBoundary por widget', () => {
  test('un widget que explota no se lleva puesto al de al lado', async () => {
    api();
    // React escupe el stack del boundary por consola; es ruido esperado.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      wrap(
        <div className="dashboard-grid-4">
          <DashboardWidgetWrapper
            widgetId="bomba" colSpan={2} rowSpan={1} index={0}
            isDragging={false} isDropTarget={false}
            onCycleColSpan={() => undefined} onCycleRowSpan={() => undefined}
            dragHandlers={DRAG} title="Cuadro roto"
          >
            <Bomb />
          </DashboardWidgetWrapper>
          <DashboardWidgetWrapper
            widgetId="sano" colSpan={2} rowSpan={1} index={1}
            isDragging={false} isDropTarget={false}
            onCycleColSpan={() => undefined} onCycleRowSpan={() => undefined}
            dragHandlers={DRAG} title="Cuadro sano"
          >
            <p>contenido vivo</p>
          </DashboardWidgetWrapper>
        </div>,
      );
      await settle(300);
      await page.screenshot({ path: `${SCREENS}/state-widget-roto.png` });

      // El vecino sigue en pie: antes la excepción subía hasta el shell.
      expect(bodyText()).toContain('contenido vivo');
      expect(bodyText()).toContain('Cuadro roto');
      const box = document.querySelector('.hub-error');
      expect(box, 'el widget roto no tiene su propio estado de error').toBeTruthy();
      expect(box!.querySelector('.hub-error__retry'), 'sin reintentar').toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

/* ── 5. Esqueleto en vez de brújula ─────────────────────────────────────── */

describe('Recompensas', () => {
  test('la carga es un esqueleto, no una brújula girando', async () => {
    api({
      rpgGetObolosBalance: () => new Promise(() => { /* cuelga */ }),
      rpgGetRewards: () => new Promise(() => { /* cuelga */ }),
    });
    wrap(<RewardsPage />);
    await settle(150);
    expect(document.querySelectorAll('.hub-skeleton').length).toBeGreaterThan(0);
  });

  test('el hueco del mostrador tiene el botón ADENTRO', async () => {
    api({
      rpgGetObolosBalance: () => Promise.resolve({ balance: 0, earned: 0, spent: 0 }),
      rpgGetRewards: () => Promise.resolve([]),
    });
    wrap(<RewardsPage />);
    await settle(500);
    await page.screenshot({ path: `${SCREENS}/state-recompensas-vacio.png` });
    const hole = document.querySelector('.hub-empty');
    expect(hole, 'el mostrador vacío sigue siendo una frase suelta').toBeTruthy();
    expect(hole!.querySelector('.hub-empty__cta'), 'el botón sigue fuera del hueco').toBeTruthy();
  });
});
