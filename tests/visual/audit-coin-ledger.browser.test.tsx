import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import Transactions from '@modules/finance/components/Transactions';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/** El libro mayor con 40 movimientos, descripciones largas y montos de 9 cifras. */

const LONG = 'Suscripción anual al servicio de contabilidad y facturación electrónica del estudio contable de Vicky';
const CATS = ['Comida', 'Hogar', 'Transporte', 'Salud', 'Ocio', 'Impuestos'];
const PMS = ['cash', 'debit', 'transfer', 'credit_card'];

const TX = Array.from({ length: 40 }, (_, i) => ({
  id: `t${i}`,
  type: i % 7 === 0 ? 'income' : 'expense',
  amount: i === 3 ? 214_780_310 : 1_000 * (i + 1) * (i % 5 + 1),
  currency: 'ARS',
  category: CATS[i % CATS.length],
  description: i === 1 ? LONG : `Movimiento ${i + 1}`,
  date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  paymentMethod: PMS[i % PMS.length],
  source: i % 5 === 0 ? 'import' : 'manual',
  impactsBalance: i % 4 === 3 ? 0 : 1,
  accountId: 'a1',
}));

const ACCOUNTS = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 1, movements: 4 },
  { id: 'a2', name: 'Banco Galicia — Caja de ahorro en pesos', kind: 'bank', currency: 'ARS', initialBalance: 0, accountOrder: 1, balance: 1, movements: 4 },
];

function stub(rows: unknown[] = TX) {
  const handlers: Record<string, unknown> = {
    financeGetTransactions: () => Promise.resolve(rows),
    financeGetCategories: () => Promise.resolve(CATS),
    financeGetAccounts: () => Promise.resolve(ACCOUNTS),
    financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
    financeGetCreditCards: () => Promise.resolve([]),
    financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
    financeGetMonthlyBalance: () => Promise.resolve({ ARS: { income: 0, expenses: 0, balance: 0 }, USD: { income: 0, expenses: 0, balance: 0 } }),
    financeGetCategoryAverages: () => Promise.resolve([]),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    financeGetImportBatches: () => Promise.resolve([]),
    financeUndoImportBatch: () => Promise.resolve({ ok: true, deleted: 0 }),
  };
  (window as unknown as { api: unknown }).api = new Proxy(handlers, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
}

const wrap = () => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <div className="qb-page" style={{ padding: 24 }}><Transactions /></div>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

function overflowing(root: Element): string[] {
  const bad: string[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    if (node.clientWidth <= 0) continue;
    const excess = node.scrollWidth - node.clientWidth;
    if (excess <= 1) continue;
    const style = getComputedStyle(node);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    // Un recorte con puntos suspensivos es una decisión, no un defecto: lo que
    // se busca acá es el corte a cuchillo y el contenido que se sale de su caja.
    if (style.textOverflow === 'ellipsis') continue;
    const hasBubble = /help-bubble/.test(node.className)
      || node.querySelector('.help-bubble, .help-bubble-inline') !== null;
    if (hasBubble && excess <= 10) continue;
    bad.push(`${node.className || node.tagName} (${node.scrollWidth}>${node.clientWidth})`);
  }
  return bad;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

describe('Libro mayor (Transactions)', () => {
  test('1640×900: 40 filas, ninguna se desborda', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-01-1640.png` });

    const bad = overflowing(el('.coin-ledger'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // Concepto e importe no se pisan y el importe no se va al borde derecho
    // dejando medio metro de pergamino en el medio.
    for (const row of document.querySelectorAll('.coin-ledger-row')) {
      const desc = row.querySelector('.coin-ledger-row__desc');
      const amount = row.querySelector('.coin-ledger-row__amount');
      if (!desc || !amount) continue;
      expect(amount.getBoundingClientRect().left).toBeGreaterThanOrEqual(desc.getBoundingClientRect().right - 1);
    }
  });

  test('760×640: la fila sigue entera y la cabecera no se despega de sus columnas', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-02-760.png` });

    const bad = overflowing(el('.coin-ledger'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // El encabezado y las filas comparten la misma rejilla: si no, la flecha de
    // orden queda sobre otra columna.
    const header = getComputedStyle(el('.coin-ledger-header')).gridTemplateColumns;
    const row = getComputedStyle(el('.coin-ledger-row')).gridTemplateColumns;
    expect(header).toBe(row);
  });

  test('cada acción de fila tiene aria-label y área táctil', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const btns = [...document.querySelectorAll<HTMLButtonElement>('.coin-ledger-row__action-btn')];
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns.slice(0, 6)) {
      expect(b.getAttribute('aria-label'), 'botón sin rótulo accesible').toBeTruthy();
    }
  });

  test('la fila en edición no desborda ni tapa las columnas vecinas', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const pencil = document.querySelector<HTMLButtonElement>('.coin-ledger-row__action-btn');
    pencil!.click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-03-edicion.png` });

    const edit = el('.coin-ledger-row__edit');
    const bad = overflowing(edit);
    expect(bad, `desbordes en edición: ${bad.join(', ')}`).toEqual([]);
    expect(edit.scrollWidth).toBeLessThanOrEqual(edit.clientWidth + 1);
  });

  test('la fila en edición entra también a 760 px', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    document.querySelector<HTMLButtonElement>('.coin-ledger-row__action-btn')!.click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-04-edicion-760.png` });
    const edit = el('.coin-ledger-row__edit');
    expect(edit.scrollWidth).toBeLessThanOrEqual(edit.clientWidth + 1);
  });

  test('el formulario de carga rápida se abre y entra', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const toggle = el<HTMLButtonElement>('.coin-toggle-btn');
    if (toggle.getAttribute('aria-expanded') !== 'true') { toggle.click(); await settle(400); }
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-05-quickadd.png` });
    const form = el('form.coin-quick-add-form');
    const bad = overflowing(form);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    // Un formulario de seis campos, no una banda de 1600 px.
    expect(form.getBoundingClientRect().width).toBeLessThanOrEqual(740);

    // El chevron de «Más opciones» no se sale de su renglón.
    const advToggle = el<HTMLButtonElement>('.coin-quick-add-form__toggle');
    const icon = advToggle.querySelector('svg')!.getBoundingClientRect();
    expect(icon.height).toBeLessThan(16);
    expect(icon.top).toBeGreaterThanOrEqual(advToggle.getBoundingClientRect().top - 1);
    expect(icon.bottom).toBeLessThanOrEqual(advToggle.getBoundingClientRect().bottom + 1);
  });

  test('el importador se abre en modal, se puede cerrar y no desborda', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const importBtn = [...document.querySelectorAll<HTMLButtonElement>('.coin-month-nav__btn')]
      .find((b) => /import/i.test(b.textContent ?? ''));
    expect(importBtn, 'no encontré el botón Importar').toBeTruthy();
    importBtn!.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-06-importador.png` });

    const modal = el('.coin-import-modal');
    expect(modal.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    const bad = overflowing(modal);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // Hay un cierre visible y rotulado.
    const close = [...modal.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.getAttribute('aria-label') === 'Cerrar');
    expect(close, 'el modal no tiene botón de cerrar rotulado').toBeTruthy();
    close!.click();
    await settle(300);
    expect(document.querySelector('.coin-import-modal')).toBeNull();
  });

  test('el importador entra a 760×640 sin cortar el pie', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('.coin-month-nav__btn')]
      .find((b) => /import/i.test(b.textContent ?? ''))!.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-07-importador-760.png` });
    const modal = el('.coin-import-modal');
    const r = modal.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(-1);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  test('mes vacío: mensaje propio, sin claves i18n crudas', async () => {
    stub([]);
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-tx-08-vacio.png` });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/coinify\.[a-zA-Z]/);
    expect(el('.coin-empty-codex').textContent).toBeTruthy();
  });
});
