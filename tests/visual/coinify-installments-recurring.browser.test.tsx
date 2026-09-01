import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import Installments from '@modules/finance/components/Installments';
import Recurring from '@modules/finance/components/Recurring';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/**
 * Las dos pantallas nacieron pensadas para una tarjeta angosta. Maximizada
 * (~1640 px) Cuotas se desarmaba: el nombre del plan contra el borde izquierdo,
 * el importe contra el derecho y medio metro de pergamino en el medio; y los
 * datos en `--ink-faded`, ilegibles sobre la textura.
 *
 * En Recurrentes eran tres botones apilados de anchos distintos ocupando tres
 * renglones, y en la fila de edición un control con flechitas sin rótulo: era
 * el día de cobro, pero medía 55 px con 72 px de padding interno, así que
 * literalmente sólo se veían las flechas.
 */

const INSTALLMENTS = [
  {
    id: 'i1', description: 'Grafica (Cuota 3/6)', amount: 128_400, currency: 'ARS',
    category: 'Hogar', installments: 6, installmentCount: 6, installmentNumber: 3,
    installmentGroupId: 'g1', date: '2026-09-05',
  },
  {
    id: 'i2', description: 'Grafica (Cuota 4/6)', amount: 128_400, currency: 'ARS',
    category: 'Hogar', installments: 6, installmentCount: 6, installmentNumber: 4,
    installmentGroupId: 'g1', date: '2026-10-05',
  },
  {
    id: 'i3', description: 'Etios (Cuota 12/12)', amount: 512_900, currency: 'ARS',
    category: 'Transporte', installments: 12, installmentCount: 12, installmentNumber: 12,
    installmentGroupId: 'g2', date: '2026-09-10',
  },
  {
    id: 'i4', description: 'Notebook del estudio (Cuota 2/18)', amount: 96_750, currency: 'ARS',
    category: 'Trabajo', installments: 18, installmentCount: 18, installmentNumber: 2,
    installmentGroupId: 'g3', forThirdParty: 1, thirdPartyName: 'Vicky', date: '2026-09-12',
  },
];

const PROJECTION = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
  total: 700_000 + i * 21_000,
}));

const RECURRING = [
  {
    id: 'r1', name: 'Alquiler', type: 'expense', amount: 480_000, currency: 'ARS',
    category: 'Hogar', billingDay: 5, frequency: 'monthly', accountId: 'a1', active: 1,
  },
  {
    id: 'r2', name: 'Sueldo', type: 'income', amount: 1_350_000, currency: 'ARS',
    category: 'Trabajo', billingDay: 1, frequency: 'monthly', accountId: 'a1', active: 1,
  },
  {
    id: 'r3', name: 'Seguro del auto', type: 'expense', amount: 74_500, currency: 'ARS',
    category: 'Transporte', billingDay: 22, frequency: 'semiannual', anchorMonth: '2026-03',
    accountId: 'a2', active: 0,
  },
];

const ACCOUNTS = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS' },
  { id: 'a2', name: 'Galicia', kind: 'bank', currency: 'ARS' },
];

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  // Stub permisivo: cualquier canal sin definir devuelve una promesa resuelta,
  // así un handler olvidado no se lleva puesto el render entero.
  const handlers: Record<string, unknown> = {
    financeGetInstallmentsForMonth: () => Promise.resolve(INSTALLMENTS),
    financeGetInstallmentProjection: () => Promise.resolve(PROJECTION),
    financeGetRecurring: () => Promise.resolve(RECURRING),
    financeGetRecurringAmountHistory: () => Promise.resolve([]),
    financeGetCategories: () => Promise.resolve(['Hogar', 'Transporte', 'Trabajo', 'Otros']),
    financeGetAccounts: () => Promise.resolve(ACCOUNTS),
    financeSaveAccount: () => Promise.resolve(null),
  };
  (window as unknown as { api: unknown }).api = new Proxy(handlers, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
});

const wrap = (node: React.ReactNode) => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <div style={{ padding: 24 }}>{node}</div>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function box(sel: string): DOMRect {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no encontré ${sel}`);
  return el.getBoundingClientRect();
}

function rgb(sel: string, prop: string): string {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no encontré ${sel}`);
  return getComputedStyle(el).getPropertyValue(prop);
}

describe('Cuotas: se lee de un vistazo a pantalla completa', () => {
  test('maximizada: el importe no se va al borde y la tinta es plena', async () => {
    await page.viewport(1640, 900);
    wrap(<Installments />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-01-cuotas-1640.png` });

    // La lista no se estira con la ventana.
    expect(box('.coin-installment-list').width).toBeLessThanOrEqual(940);

    // Nombre ↔ importe: el hueco entre el contador y la cifra tiene que ser
    // legible de un salto de ojo, no el ancho de la pantalla.
    const rows = [...document.querySelectorAll('.coin-installment-row')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const counter = row.querySelector('.coin-installment-row__counter')!.getBoundingClientRect();
      const right = row.querySelector('.coin-installment-row__right')!.getBoundingClientRect();
      expect(right.left - counter.right).toBeLessThan(500);
    }

    // Contraste: el contador dejó de ser `--ink-faded` (#6b5535) y es tinta
    // plena (#2a1d0e). Lo mismo el título del plan.
    expect(rgb('.coin-installment-row__counter', 'color')).toBe('rgb(42, 29, 14)');
    expect(rgb('.coin-installment-group__title', 'color')).toBe('rgb(42, 29, 14)');

    // Y cada fila tiene fondo propio, no es texto suelto sobre el pergamino.
    const bg = rgb('.coin-installment-row', 'background-color');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('angosta: el importe baja de renglón y nada se desborda', async () => {
    await page.viewport(430, 900);
    wrap(<Installments />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-02-cuotas-430.png` });

    const list = box('.coin-installment-list');
    expect(list.width).toBeLessThanOrEqual(430);
    for (const row of document.querySelectorAll('.coin-installment-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });
});

describe('Recurrentes: acciones y fila de edición', () => {
  test('maximizada: las tres acciones entran en un solo renglón', async () => {
    await page.viewport(1640, 900);
    wrap(<Recurring />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-03-recurrentes-1640.png` });

    const bar = box('.coin-recurring__actions');
    // Un renglón de botones: alto de una fila, no de tres bloques apilados.
    expect(bar.height).toBeLessThan(60);

    const tops = [...document.querySelectorAll('.coin-recurring__action')]
      .map((b) => Math.round(b.getBoundingClientRect().top));
    expect(tops).toHaveLength(3);
    expect(new Set(tops).size).toBe(1);

    // Y con el mismo alto: eran tres bloques de tamaños distintos.
    const heights = [...document.querySelectorAll('.coin-recurring__action')]
      .map((b) => Math.round(b.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
  });

  test('el día de cobro tiene rótulo, aria-label y ancho para su número', async () => {
    await page.viewport(1640, 900);
    wrap(<Recurring />);
    await settle();

    // Abrir la edición del primer recurrente.
    const pencil = [...document.querySelectorAll('button[aria-label="Editar"]')][0] as HTMLButtonElement;
    expect(pencil).toBeTruthy();
    pencil.click();
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-04-recurrente-edicion.png` });

    const input = document.getElementById('coin-recurring-day-r1') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.getAttribute('aria-label')).toBe('Día de cobro, del 1 al 31');

    // Hay un <label> visible apuntando al input.
    const label = document.querySelector('label[for="coin-recurring-day-r1"]');
    expect(label).toBeTruthy();
    expect(label!.textContent!.trim()).toBe('Día de cobro');
    expect(label!.getBoundingClientRect().width).toBeGreaterThan(0);

    // Y el número entra: antes eran 55 px con 72 px de padding interno (las dos
    // flechas), o sea ancho negativo para el valor.
    const style = getComputedStyle(input!);
    const inner = input!.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    expect(inner).toBeGreaterThan(20);

    // Todos los rótulos de la fila de edición se ven.
    const labels = [...document.querySelectorAll('.coin-recurring-edit .coin-field__label')]
      .map((l) => l.textContent!.trim());
    expect(labels).toContain('Día de cobro');
    expect(labels).toContain('Frecuencia');
    expect(labels).toContain('Categoría');
  });

  test('angosta: la barra de acciones envuelve sin desbordar', async () => {
    await page.viewport(430, 900);
    wrap(<Recurring />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/coinify-05-recurrentes-430.png` });

    const bar = document.querySelector('.coin-recurring__actions') as HTMLElement;
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth + 1);
  });
});
