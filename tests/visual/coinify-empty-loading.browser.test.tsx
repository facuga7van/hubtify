import { beforeAll, describe, expect, test } from 'vitest';
import { render, cleanup } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import Transactions from '@modules/finance/components/Transactions';
import Loans from '@modules/finance/components/Loans';
import Installments from '@modules/finance/components/Installments';
import Recurring from '@modules/finance/components/Recurring';
import CreditCards from '@modules/finance/components/CreditCards';
import DashboardWidget from '@modules/finance/components/DashboardWidget';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/**
 * C8 — «estados vacío / carga / error» de Coinify.
 *
 * Los cinco huecos del módulo eran una frase en itálica flotando en el medio de
 * la pantalla, sin ícono y sin ningún control: el peor de todos (Recurrentes) le
 * pedía al usuario «agregá gastos fijos como alquiler» y le escondía el botón.
 * Y tres pantallas mostraban ese vacío DESDE EL PRIMER FRAME, antes de que el
 * backend contestara, así que un mes lleno se anunciaba como vacío por un
 * instante — y si la carga fallaba, el vacío se quedaba mintiendo para siempre.
 */

type Handlers = Record<string, unknown>;

/** Una promesa que no resuelve nunca: congela el componente en «cargando». */
const pending = () => new Promise<never>(() => undefined);

function stub(overrides: Handlers = {}) {
  const base: Handlers = {
    financeGetTransactions: () => Promise.resolve([]),
    financeGetCategories: () => Promise.resolve(['Hogar', 'Otros']),
    financeGetCategoryAverages: () => Promise.resolve({}),
    financeGetLoans: () => Promise.resolve([]),
    financeGetLoanPayments: () => Promise.resolve([]),
    financeGetInstallmentsForMonth: () => Promise.resolve([]),
    financeGetInstallmentProjection: () => Promise.resolve([]),
    financeGetRecurring: () => Promise.resolve([]),
    financeGetRecurringAmountHistory: () => Promise.resolve([]),
    financeGetCreditCards: () => Promise.resolve([]),
    financeGetCreditCardStatements: () => Promise.resolve([]),
    financeGetAccounts: () => Promise.resolve([]),
    financeGetMonthlyTotal: () => Promise.resolve(0),
    financeGetActiveLoansCount: () => Promise.resolve(0),
    financeGetMonthlyBalance: () => Promise.resolve({ ARS: { income: 0, expenses: 0 } }),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve([]);
    },
    has: () => true,
  });
}

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
});

const wrap = (node: React.ReactNode) => {
  cleanup();
  return render(
    <MemoryRouter>
      <ToastProvider><ConfirmProvider>
        <div className="qb-page" style={{ padding: 24 }}>{node}</div>
      </ConfirmProvider></ToastProvider>
    </MemoryRouter>,
  );
};

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/** Un hueco «de 9»: ícono + frase + un control a mano, todo adentro del hueco. */
function assertEmptyWithCta(empty: Element, ctaMatch: RegExp) {
  expect(empty.querySelector('svg'), 'sin ícono').toBeTruthy();
  const title = empty.querySelector('.coin-empty-codex__title');
  expect(title, 'sin título').toBeTruthy();
  expect(title!.textContent!.trim().length).toBeGreaterThan(3);
  const buttons = [...empty.querySelectorAll('button')];
  expect(buttons.length, 'sin CTA adentro del hueco').toBeGreaterThan(0);
  expect(buttons.some((b) => ctaMatch.test(b.textContent ?? '')), `ningún botón matchea ${ctaMatch}`).toBe(true);
  // Y el CTA está DENTRO de la caja del vacío, no a 240 px de distancia.
  const box = empty.getBoundingClientRect();
  const cta = buttons[0].getBoundingClientRect();
  expect(cta.top).toBeGreaterThanOrEqual(box.top - 1);
  expect(cta.bottom).toBeLessThanOrEqual(box.bottom + 1);
  // Sin claves i18n crudas.
  expect(empty.textContent ?? '').not.toMatch(/coinify\.[a-zA-Z]/);
}

describe('Los cinco vacíos de Coinify ofrecen una salida', () => {
  test('libro mayor: mes sin movimientos → ícono, frase y carga rápida', async () => {
    stub();
    await page.viewport(1200, 900);
    wrap(<Transactions />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-01-ledger-vacio.png` });

    const empties = [...document.querySelectorAll('.coin-empty-codex')];
    expect(empties.length).toBe(2); // movimientos + recurrentes
    assertEmptyWithCta(empties[0], /carga r|movimiento/i);

    // El CTA abre el formulario: cerrado antes, abierto después.
    el<HTMLButtonElement>('.coin-toggle-btn').click();
    await settle(80);
    expect(document.querySelector('.coin-quick-add-form--open')).toBeNull();
    const cta = [...document.querySelectorAll('.coin-empty-codex')][0].querySelector('button')!;
    (cta as HTMLButtonElement).click();
    await settle(120);
    expect(document.querySelector('.coin-quick-add-form--open')).toBeTruthy();
  });

  test('libro mayor: la sección Recurrentes vacía lleva al taller de recurrentes', async () => {
    stub();
    await page.viewport(1200, 900);
    wrap(<Transactions />);
    await settle();
    const empties = [...document.querySelectorAll('.coin-empty-codex')];
    assertEmptyWithCta(empties[1], /recurrente/i);
  });

  test('préstamos: el vacío abre el alta de préstamo', async () => {
    stub();
    await page.viewport(1200, 900);
    wrap(<Loans />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-02-prestamos-vacio.png` });

    const empty = el('.coin-empty-codex');
    assertEmptyWithCta(empty, /préstamo/i);
    expect(document.querySelector('.coin-codex-form')).toBeNull();
    empty.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(120);
    expect(document.querySelector('.coin-codex-form')).toBeTruthy();
  });

  test('cuotas: el vacío abre el alta de cuotas', async () => {
    stub();
    await page.viewport(1200, 900);
    wrap(<Installments />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-03-cuotas-vacio.png` });

    const empty = el('.coin-empty-codex');
    assertEmptyWithCta(empty, /cuota/i);
    empty.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(150);
    expect(document.querySelector('.coin-installment-add')
      ?? document.querySelector('form')
      ?? document.querySelector('.coin-codex-form')).toBeTruthy();
  });

  test('recurrentes: el peor de los cinco ya no esconde el botón que pide', async () => {
    stub();
    await page.viewport(1200, 900);
    wrap(<Recurring />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-04-recurrentes-vacio.png` });

    const empty = el('.coin-empty-codex');
    assertEmptyWithCta(empty, /recurrente/i);
    expect(document.querySelector('.coin-codex-form')).toBeNull();
    empty.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(120);
    expect(document.querySelector('.coin-codex-form')).toBeTruthy();
  });
});

describe('A 390 px los huecos siguen entrando', () => {
  test('ni el vacío del libro mayor ni el de recurrentes desbordan', async () => {
    stub();
    await page.viewport(390, 844);
    wrap(<Transactions />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-08-vacio-390.png` });

    for (const empty of document.querySelectorAll('.coin-empty-codex')) {
      expect(empty.scrollWidth, empty.className).toBeLessThanOrEqual(empty.clientWidth + 1);
      // Y el CTA no se sale de la caja.
      const btn = empty.querySelector('button')!.getBoundingClientRect();
      const box = empty.getBoundingClientRect();
      expect(btn.left).toBeGreaterThanOrEqual(box.left - 1);
      expect(btn.right).toBeLessThanOrEqual(box.right + 1);
    }
  });
});

describe('Mientras carga no se miente: esqueleto, no vacío', () => {
  test('tarjetas: esqueleto antes de la respuesta, vacío después', async () => {
    stub({ financeGetCreditCards: pending });
    await page.viewport(1200, 900);
    wrap(<CreditCards />);
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/coinify-c8-05-tarjetas-cargando.png` });
    expect(document.querySelector('.coin-skeleton')).toBeTruthy();
    expect(document.querySelector('.coin-empty-codex')).toBeNull();
  });

  test('recurrentes: esqueleto antes de la respuesta', async () => {
    stub({ financeGetRecurring: pending });
    await page.viewport(1200, 900);
    wrap(<Recurring />);
    await settle(200);
    expect(document.querySelector('.coin-skeleton')).toBeTruthy();
    expect(document.querySelector('.coin-empty-codex')).toBeNull();
  });

  test('préstamos: esqueleto antes de la respuesta', async () => {
    stub({ financeGetLoans: pending });
    await page.viewport(1200, 900);
    wrap(<Loans />);
    await settle(200);
    expect(document.querySelector('.coin-skeleton')).toBeTruthy();
    expect(document.querySelector('.coin-empty-codex')).toBeNull();
  });

  test('el widget del tablero: esqueleto en vez de tres guiones', async () => {
    stub({ financeGetMonthlyBalance: pending });
    await page.viewport(420, 400);
    wrap(<DashboardWidget />);
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/coinify-c8-06-widget-cargando.png` });
    expect(document.querySelector('.coin-skeleton')).toBeTruthy();
    expect(document.body.textContent).not.toContain('---');
  });
});

describe('Un error se ve: nada se queda en guiones para siempre', () => {
  test('el widget del tablero avisa y ofrece reintentar', async () => {
    stub({
      financeGetMonthlyBalance: () => Promise.reject(new Error('sin puente')),
      financeGetActiveLoansCount: () => Promise.reject(new Error('sin puente')),
    });
    await page.viewport(420, 400);
    wrap(<DashboardWidget />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-c8-07-widget-error.png` });

    const notice = el('.coin-widget-error');
    expect(notice.textContent!.trim().length).toBeGreaterThan(3);
    expect(notice.textContent ?? '').not.toMatch(/coinify\.[a-zA-Z]/);
    expect(notice.querySelector('button'), 'sin reintentar').toBeTruthy();
    // Y NO se queda mostrando los tres guiones como si fuera un cero.
    expect(document.body.textContent).not.toContain('---');
  });

  test('tarjetas: si la carga falla se dice, no se muestra «no cargaste ninguna»', async () => {
    stub({ financeGetCreditCards: () => Promise.reject(new Error('sin puente')) });
    await page.viewport(1200, 900);
    wrap(<CreditCards />);
    await settle();
    expect(document.querySelector('.coin-load-error')).toBeTruthy();
    expect(document.querySelector('.coin-empty-codex')).toBeNull();
  });
});
