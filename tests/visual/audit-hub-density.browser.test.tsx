/**
 * C4 — DENSIDAD Y USO DEL ANCHO, y el cromo del códice.
 *
 * La rúbrica (`docs/superpowers/plans/2026-09-03-design-rubric.md`, Tarea 1 C4)
 * mide `inkSpan(contenedor)` a 1640×900: qué fracción del ancho disponible
 * llega a tener tinta, y si hay huecos >250 px DENTRO de una fila. La segunda
 * medición dejó tres pendientes:
 *
 *   · Recompensas al 55 % del ancho.
 *   · El hueco de la crónica (~250 px entre el hecho y su XP).
 *   · Las tarjetas INGRESO/GASTO estiradas a la altura del Cofre.
 *
 * Este archivo pone un número a cada uno para que no vuelvan sin que nadie se
 * entere, y de paso vigila el cromo del códice en Ajustes (ítem 12), la única
 * convención de «elegido» del onboarding (ítem 13) y el `role="dialog"` del
 * diálogo de actualización (ítem 18).
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import SettingsPage from '@hub/SettingsPage';
import Onboarding from '@hub/Onboarding';
import UpdateNotification from '@hub/UpdateNotification';
import Dashboard from '@hub/Dashboard';
import RewardsPage from '@hub/rewards/RewardsPage';
import CoinDashboard from '@modules/finance/components/Dashboard';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { TourProvider } from '@shared/components/tour';
import { installApi, SCREENS, WIDE, fitCapture, resetCapture, unclip } from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/hub/styles/dashboard-layouts.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const baseAuth = {
  user: { uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo' },
  loading: false, switching: false,
  login: async () => ({ success: false }), register: async () => ({ success: false }),
  logout: async () => ({ success: true }), switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }), forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
} as unknown as React.ContextType<typeof AuthContext>;

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

function mount(node: ReactNode, sidebar = 260) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider><TourProvider>
          <div id="audit-root" className="app-layout" style={{ height: '100vh' }}>
            <div data-testid="mouse-park" style={{ width: sidebar, flexShrink: 0, background: 'var(--leather)' }} />
            <main className="main-content">{node}</main>
          </div>
        </TourProvider></ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/* ── la métrica ─────────────────────────────────────────
   `inkSpan` = (borde derecho de la tinta más a la derecha − borde izquierdo de
   la tinta más a la izquierda) / ancho del contenedor. «Tinta» es un nodo HOJA
   con texto o dibujo, o una superficie con marco propio (una tarjeta vacía de
   1300 px es pergamino estirado, no tinta: por eso se miran las hojas). */
function inkBox(container: HTMLElement) {
  let left = Infinity;
  let right = -Infinity;
  for (const node of container.querySelectorAll<HTMLElement>('*')) {
    if (node.children.length > 0) continue;
    const cs = getComputedStyle(node);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity || '1') < 0.05) continue;
    const text = (node.textContent ?? '').trim();
    const drawn = node instanceof SVGElement || node.tagName === 'IMG' || node.tagName === 'CANVAS';
    if (!text && !drawn) continue;
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return { left, right };
}

function inkSpan(container: HTMLElement): number {
  const box = container.getBoundingClientRect();
  const ink = inkBox(container);
  if (!Number.isFinite(ink.left)) return 0;
  return (ink.right - ink.left) / box.width;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
  installApi();
});

/* ══════════════════════════════════════════════════════
   ÍTEM 12 — Ajustes con el cromo del códice
   ══════════════════════════════════════════════════════ */
describe('Ajustes — cromo del códice', () => {
  test('la página es un BookPage: ceja, regla y escuadras como toda otra', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<SettingsPage />);
    await settle();

    const pageEl = el('.qb-page.settings-page');
    // Ceja con su TOMO, regla ornamental y las cuatro escuadras de hierro.
    expect(pageEl.querySelector('.qb-eyebrow')?.textContent).toMatch(/TOMO VI/);
    expect(pageEl.querySelector('.qb-title')?.textContent).toBeTruthy();
    expect(pageEl.querySelector('.qb-subtitle')?.textContent).toBeTruthy();
    expect(pageEl.querySelector('.qb-rule')).toBeTruthy();
    expect(pageEl.querySelectorAll('.qb-corner')).toHaveLength(4);

    // Y el encabezado viejo desapareció de la app entera.
    expect(document.querySelector('.page-header')).toBeNull();

    // El padding no se duplica: el de `.qb-page` y punto.
    const cs = getComputedStyle(pageEl);
    expect(parseFloat(cs.paddingLeft)).toBeLessThanOrEqual(28);
    expect(parseFloat(cs.paddingTop)).toBeLessThanOrEqual(24);

    unclip();
    fitCapture({ full: true });
    await page.screenshot({ path: `${SCREENS}/audit-hub-ajustes-04-codice.png` });
    resetCapture();

    const main = el('.main-content');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════
   ÍTEM 13 — una sola convención de «elegido» en el onboarding
   ══════════════════════════════════════════════════════ */
describe('Onboarding — decisión abierta nº5', () => {
  test('idioma y tamaño de fuente marcan lo elegido con el MISMO cuero', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    render(<Onboarding onComplete={() => {}} />);
    await settle();

    const langBtns = [...document.querySelectorAll<HTMLElement>('.onboarding__lang-row button')];
    const fontBtns = [...document.querySelectorAll<HTMLElement>('.onboarding__font-btn')];
    expect(langBtns).toHaveLength(2);
    expect(fontBtns).toHaveLength(4);

    // Los dos grupos son `.rpg-button`, y «no elegido» se dice con la MISMA
    // clase de pergamino en los dos.
    for (const b of [...langBtns, ...fontBtns]) expect(b.classList.contains('rpg-button')).toBe(true);

    const chosenLang = langBtns.find((b) => !b.classList.contains('onboarding__btn-dim'))!;
    const chosenFont = fontBtns.find((b) => !b.classList.contains('onboarding__btn-dim'))!;
    expect(chosenLang, 'ningún idioma marcado').toBeTruthy();
    expect(chosenFont, 'ningún tamaño marcado').toBeTruthy();
    expect(getComputedStyle(chosenFont).backgroundImage)
      .toBe(getComputedStyle(chosenLang).backgroundImage);
    expect(getComputedStyle(chosenFont).color).toBe(getComputedStyle(chosenLang).color);

    // Piso tipográfico y la tarjeta de 560 px: los cuatro entran sin desbordar.
    const card = el('.onboarding-card');
    for (const b of fontBtns) {
      expect(parseFloat(getComputedStyle(b).fontSize)).toBeGreaterThanOrEqual(12.99);
      expect(b.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
      expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth + 1);
    }

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-onboarding-03-elegido.png` });
    resetCapture();
  });

  test('a 390 px los cuatro tamaños siguen entrando y llegan a 44 px de toque', async () => {
    await page.viewport(390, 844);
    document.documentElement.setAttribute('data-shell', 'mobile');
    try {
      render(<Onboarding onComplete={() => {}} />);
      await settle();
      const card = el('.onboarding-card');
      for (const b of document.querySelectorAll<HTMLElement>('.onboarding__font-btn')) {
        const r = b.getBoundingClientRect();
        expect(r.height, 'área de toque').toBeGreaterThanOrEqual(43.5);
        expect(r.right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
      }
      expect(document.documentElement.scrollWidth)
        .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
    } finally {
      document.documentElement.removeAttribute('data-shell');
    }
  });
});

/* ══════════════════════════════════════════════════════
   ÍTEM 18 — el diálogo de actualización es un diálogo
   ══════════════════════════════════════════════════════ */
describe('UpdateNotification — modal de verdad', () => {
  test('role/aria-modal, nombre accesible y Escape', async () => {
    await page.viewport(...WIDE);
    let dismissed = 0;
    render(
      <UpdateNotification
        version="0.9.5" state="idle" percent={0} error={null}
        onDownload={() => {}} onRestart={() => {}} onDismiss={() => { dismissed += 1; }}
      />,
    );
    await settle(200);

    const dlg = el('[role="dialog"]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    // Nombre accesible: el título de la ventana.
    const labelledBy = dlg.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBeTruthy();
    // Bloquea la app: overlay a pantalla completa.
    expect(getComputedStyle(el('.update-dialog-overlay')).position).toBe('fixed');
    // Y ya no se pinta con estilos en línea.
    expect(dlg.getAttribute('style')).toBeFalsy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(120);
    expect(dismissed, 'Escape no cierra').toBe(1);
  });
});

/* ══════════════════════════════════════════════════════
   C4 — Recompensas
   ══════════════════════════════════════════════════════ */
describe('Recompensas — uso del ancho', () => {
  test('el mostrador usa el ancho en vez de dejar 45 % de pergamino', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<RewardsPage />);
    await settle(600);

    const content = el('.qb-content');
    const span = inkSpan(content);
    // eslint-disable-next-line no-console
    console.log('RECOMPENSAS inkSpan', JSON.stringify({
      contenedor: Math.round(content.getBoundingClientRect().width),
      span: Math.round(span * 1000) / 10,
    }));

    unclip();
    fitCapture({ full: true });
    await page.screenshot({ path: `${SCREENS}/audit-hub-recompensas-03-ancho.png` });
    resetCapture();

    expect(span, 'la tinta no llega al 75 % del ancho').toBeGreaterThanOrEqual(0.75);

    // Y llega ahí por la razón correcta: el mostrador se dobla en dos columnas,
    // no porque un rótulo suelto toque el borde.
    const tracks = getComputedStyle(el('.rwd-list')).gridTemplateColumns.split(/\s+/).filter(Boolean);
    expect(tracks.length, 'el mostrador sigue en una sola columna').toBeGreaterThanOrEqual(2);
    // La bolsa es una tarjeta, no una banda de 1300 px.
    expect(el('.rwd-purse').getBoundingClientRect().width).toBeLessThan(700);

    // Y la fila no se parte en dos extremos: entre el nombre y su precio no
    // puede quedar medio metro de pergamino.
    for (const row of document.querySelectorAll('.rwd-item')) {
      const name = row.querySelector('.rwd-item__name')!.getBoundingClientRect();
      const cost = row.querySelector('.rwd-item__cost')!.getBoundingClientRect();
      expect(cost.left - name.right, 'hueco dentro de la fila').toBeLessThan(250);
    }

    const main = el('.main-content');
    expect(main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════
   C4 — el hueco de la crónica (decisión abierta nº6)
   ══════════════════════════════════════════════════════ */
describe('Crónica del hub — decisión abierta nº6', () => {
  test('el puntillado guía cose el hecho con su XP', async () => {
    await page.viewport(...WIDE);
    resetCapture();
    mount(<Dashboard />);
    await settle(700);

    const rows = [...document.querySelectorAll('.dash-chronicle__row')];
    expect(rows.length, 'la crónica no se pintó').toBeGreaterThan(0);

    const huecos = rows.map((row) => {
      const text = row.querySelector('.dash-chronicle__text')!.getBoundingClientRect();
      const xp = row.querySelector('.dash-chronicle__xp')!.getBoundingClientRect();
      const leader = row.querySelector('.dash-chronicle__leader')!.getBoundingClientRect();
      return { crudo: Math.round(xp.left - text.right), sinGuia: Math.round(xp.left - leader.right) };
    });
    // eslint-disable-next-line no-console
    console.log('CRÓNICA huecos', JSON.stringify(huecos));

    unclip();
    fitCapture({ full: true });
    await page.screenshot({ path: `${SCREENS}/audit-hub-cronica-01-puntillado.png` });
    resetCapture();

    for (const h of huecos) {
      // El puntillado ocupa el sobrante: lo que queda sin cubrir es el gap de
      // la grilla, no un hueco de lectura.
      expect(h.sinGuia, 'el puntillado no llega hasta la cifra').toBeLessThanOrEqual(16);
    }
  });
});

/* ══════════════════════════════════════════════════════
   C4 — las tarjetas INGRESO / GASTO de Coinify
   ══════════════════════════════════════════════════════ */
describe('Coinify — las tarjetas del panel dejan de estirarse', () => {
  test('INGRESO/GASTO miden su contenido, no la altura del Cofre', async () => {
    await page.viewport(...WIDE);
    (window as unknown as { api: Record<string, unknown> }).api = new Proxy({
      financeGetMonthlyBalance: () => Promise.resolve({
        ARS: { income: 987_654_321, expenses: 365_150_000, balance: 622_504_321 },
        USD: { income: 3_200, expenses: 240, balance: 2_960 },
      }),
      financeGetBalanceForRange: () => Promise.resolve({
        ARS: { income: 987_654_321, expenses: 365_150_000, balance: 622_504_321 },
        USD: { income: 3_200, expenses: 240, balance: 2_960 },
      }),
      financeGetCategoryBreakdown: () => Promise.resolve([{ category: 'Comida', ARS: 184_300_000, USD: 0 }]),
      financeGetCategoryBreakdownForRange: () => Promise.resolve([{ category: 'Comida', ARS: 184_300_000, USD: 0 }]),
      financeGetMonthlyExpenses: () => Promise.resolve([280_000_000, 310_000_000, 295_000_000, 340_000_000, 352_000_000, 365_150_000]),
      financeGetAccounts: () => Promise.resolve([
        { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 },
      ]),
      financeGetAccountsOverview: () => Promise.resolve({
        accounts: [{ id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 }],
        totalArs: 128_450, totalUsd: 0,
      }),
      financeGetUpcoming: () => Promise.resolve({ from: '2026-09-01', to: '2026-10-01', totals: { ARS: 0, USD: 0 }, items: [] }),
      financeGetExpenseBreakdown: () => Promise.resolve({
        ARS: { total: 365_150_000, direct: 180_000_000, installments: 125_150_000, pendingCard: 60_000_000, cardPayments: 0 },
        USD: { total: 240, direct: 240, installments: 0, pendingCard: 0, cardPayments: 0 },
      }),
      financeGetProjection: () => Promise.resolve([]),
      financeGetInstallmentGroups: () => Promise.resolve([]),
      financeGetCreditCardStatements: () => Promise.resolve([]),
      financeGetActiveLoanSummary: () => Promise.resolve(null),
      financeGetBudgetStatus: () => Promise.resolve(null),
      financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
      financeGetRecurring: () => Promise.resolve([]),
      financeGetTransactions: () => Promise.resolve([]),
      financeGetValuedView: () => Promise.resolve(null),
      financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
      dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    } as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : (p.startsWith('on') ? () => () => undefined : () => Promise.resolve(null))),
      has: () => true,
    });

    render(
      <MemoryRouter>
        <ToastProvider><ConfirmProvider>
          <div className="qb-page" style={{ padding: 24 }}><CoinDashboard /></div>
        </ConfirmProvider></ToastProvider>
      </MemoryRouter>,
    );
    await settle(700);

    const chest = el('.coin-chest-panel').getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('.coin-summary-card')];
    expect(cards).toHaveLength(2);
    // eslint-disable-next-line no-console
    console.log('COINIFY tarjetas', JSON.stringify({
      cofre: Math.round(chest.height),
      tarjetas: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
    }));

    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-08-tarjetas.png` });

    for (const c of cards) {
      const r = c.getBoundingClientRect();
      expect(r.height, 'la tarjeta se sigue estirando a la altura del Cofre')
        .toBeLessThan(chest.height - 40);
    }
    // Y las dos barras siguen a la misma altura: el placeholder de la tarjeta
    // de ingresos existe justamente para eso.
    const [g1, g2] = cards.map((c) => c.querySelector('.qb-gauge')!.getBoundingClientRect());
    expect(Math.abs(g1.top - g2.top), 'las barras se desalinearon').toBeLessThanOrEqual(1);
  });
});
