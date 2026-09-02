import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import CreditCards from '@modules/finance/components/CreditCards';
import Loans from '@modules/finance/components/Loans';
import AccountManager from '@modules/finance/components/shared/AccountManager';
import CategoryManager from '@modules/finance/components/shared/CategoryManager';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/**
 * Tarjetas, resúmenes, préstamos y los tres gestores modales — abiertos, no de
 * lejos. Datos extremos: nueve cifras, nombres larguísimos, listas vacías.
 */

const CARDS = [
  { id: 'c1', name: 'Visa Galicia', closingDay: 20, dueDay: 30, brand: 'visa' },
  { id: 'c2', name: 'American Express Platinum del estudio contable', closingDay: 5, dueDay: 15, brand: 'amex' },
  // Una tarjeta sin resúmenes.
  { id: 'c3', name: 'Naranja X', closingDay: 12, dueDay: 22, brand: 'other' },
];

const STATEMENTS = [
  {
    id: 's1', creditCardId: 'c1', creditCardName: 'Visa Galicia', periodMonth: '2026-09', status: 'pending',
    calculatedAmount: 214_780_310, calculatedAmountUsd: 1_240.5, paidAmount: 0, dueDate: '2026-09-30',
  },
  {
    id: 's2', creditCardId: 'c2', creditCardName: 'American Express Platinum del estudio contable', periodMonth: '2026-09', status: 'paid',
    calculatedAmount: 67_712_011, calculatedAmountUsd: 0, paidAmount: 67_712_011, dueDate: '2026-09-15',
  },
];

const ACCOUNTS = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 },
  { id: 'a2', name: 'Banco Galicia — Caja de ahorro en pesos del estudio', kind: 'bank', currency: 'ARS', initialBalance: 50_000, accountOrder: 1, balance: 214_780_310, movements: 312 },
  { id: 'a3', name: 'Mercado Pago', kind: 'wallet', currency: 'ARS', initialBalance: 0, accountOrder: 2, balance: -18_400, movements: 41 },
];

const CATS = ['Comida', 'Hogar', 'Transporte', 'Suscripciones y servicios digitales del estudio', 'Otros'];

const LOANS = [
  { id: 'l1', personName: 'Victoria Fernández de la Vega', direction: 'lent', type: 'single', amount: 214_780_310, currency: 'ARS', date: '2026-05-12', description: 'Adelanto para la reforma completa del departamento de Palermo', settled: 0 },
  { id: 'l2', personName: 'Victoria Fernández de la Vega', direction: 'lent', type: 'installment', amount: 8_000_000, currency: 'ARS', date: '2026-06-01', description: 'Notebook', settled: 0, installmentGroupId: 'g1' },
  { id: 'l3', personName: 'Victoria Fernández de la Vega', direction: 'lent', type: 'installment', amount: 8_000_000, currency: 'ARS', date: '2026-07-01', description: 'Notebook', settled: 1, installmentGroupId: 'g1' },
  { id: 'l4', personName: 'Juan', direction: 'lent', type: 'single', amount: 1_250, currency: 'USD', date: '2026-08-02', description: '', settled: 0 },
];

function stub(extra: Record<string, unknown> = {}) {
  const handlers: Record<string, unknown> = {
    financeGetCreditCards: () => Promise.resolve(CARDS),
    financeGetCreditCardStatements: () => Promise.resolve(STATEMENTS),
    financeGetStatementDetail: () => Promise.resolve({
      statement: STATEMENTS[0],
      transactions: Array.from({ length: 12 }, (_, i) => ({
        id: `d${i}`,
        type: i === 4 ? 'income' : 'expense',
        amount: 1_000 * (i + 3) * 97,
        currency: 'ARS',
        category: i % 3 === 0 ? 'Impuestos de tarjeta' : 'Comida',
        description: i === 1
          ? 'Suscripción anual al servicio de contabilidad y facturación electrónica del estudio'
          : `Compra ${i + 1}`,
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      })),
    }),
    financeGetAccounts: () => Promise.resolve(ACCOUNTS),
    financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
    financeDeleteAccount: () => Promise.resolve({ ok: true }),
    financeTransferBetweenAccounts: () => Promise.resolve({ ok: true, transferGroupId: 'g' }),
    financeGetCategories: () => Promise.resolve(CATS),
    financeAddCategory: () => Promise.resolve({ ok: true }),
    financeDeleteCategory: () => Promise.resolve({ ok: false, reason: 'category_in_use', count: 37 }),
    financeGetLoans: () => Promise.resolve(LOANS),
    financeGetLoanPayments: () => Promise.resolve([]),
    financeGetTransactions: () => Promise.resolve([]),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    ...extra,
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

const wrap = (node: React.ReactNode) => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <div className="qb-page" style={{ padding: 24 }}>{node}</div>
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
    if (style.textOverflow === 'ellipsis') continue;
    const hasBubble = /help-bubble/.test(node.className)
      || node.querySelector('.help-bubble, .help-bubble-inline') !== null;
    if (hasBubble && excess <= 10) continue;
    bad.push(`${node.className || node.tagName} (${node.scrollWidth}>${node.clientWidth})`);
  }
  return bad;
}

/**
 * Un input con flechas reserva 26 px de relleno a cada lado. Si el ancho no
 * descuenta eso, el valor —o el placeholder que hace de rótulo— no entra: es
 * el mal del «día de cobro» de 55 px con 72 px de relleno interno.
 */
function crampedInputs(root: Element): string[] {
  const bad: string[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  for (const input of root.querySelectorAll<HTMLInputElement>('input')) {
    const style = getComputedStyle(input);
    const inner = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const label = input.placeholder || input.value || '';
    if (inner < 40) { bad.push(`${label || input.type}: ${Math.round(inner)}px útiles`); continue; }
    if (!label) continue;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const needed = ctx.measureText(label).width;
    if (needed > inner + 1) bad.push(`«${label}» necesita ${Math.round(needed)}px y tiene ${Math.round(inner)}px`);
  }
  return bad;
}

/** Relación de contraste WCAG entre dos colores `rgb(...)` computados. */
function contrast(fg: string, bg: string): number {
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(parse(fg)), l2 = lum(parse(bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Un modal tiene que caber en la ventana y poder cerrarse. */
function assertModalFits(sel: string) {
  const modal = el(sel);
  const r = modal.getBoundingClientRect();
  expect(r.top, `${sel} arranca fuera de la ventana`).toBeGreaterThanOrEqual(-1);
  expect(r.bottom, `${sel} se pasa del alto de la ventana`).toBeLessThanOrEqual(window.innerHeight + 1);
  expect(r.left).toBeGreaterThanOrEqual(-1);
  expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

describe('Tarjetas y resúmenes', () => {
  test('1640×900: la tarjeta sin resúmenes también dice algo', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CreditCards />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-01-1640.png` });
    const bad = overflowing(el('.qb-page'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(document.querySelectorAll('.coin-cc-card').length).toBe(CARDS.length);
  });

  test('760×640: la fila de la tarjeta no se parte', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CreditCards />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-02-760.png` });
    const bad = overflowing(el('.qb-page'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('el detalle del resumen abre, entra y cierra', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CreditCards />);
    await settle();
    const detail = [...document.querySelectorAll<HTMLButtonElement>('.coin-cc-card button')]
      .find((b) => /detalle/i.test(b.textContent ?? ''));
    expect(detail, 'no encontré el botón de detalle').toBeTruthy();
    detail!.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-03-detalle.png` });

    const modal = el('[role="dialog"]');
    assertModalFits('[role="dialog"]');
    const bad = overflowing(modal);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(modal.textContent).not.toMatch(/coinify\.[a-zA-Z]/);
    // El título nombra la tarjeta: sin ella quedaba «Resumen de  — 2026-09».
    expect(el('[role="dialog"] .rpg-card-title').textContent).toContain('Visa Galicia');
    // Rótulo y desplegable de «Pagar desde» comparten renglón.
    const field = document.querySelector('.coin-statement-pay__field');
    if (field) {
      const label = field.querySelector('span')!.getBoundingClientRect();
      const select = field.querySelector('select')!.getBoundingClientRect();
      expect(Math.abs(label.top - select.top)).toBeLessThan(20);
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(300);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('el detalle del resumen entra a 760×640', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CreditCards />);
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('.coin-cc-card button')]
      .find((b) => /detalle/i.test(b.textContent ?? ''))!.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-04-detalle-760.png` });
    assertModalFits('[role="dialog"]');
  });

  test('sin tarjetas: el vacío explica y ofrece salida', async () => {
    stub({ financeGetCreditCards: () => Promise.resolve([]), financeGetCreditCardStatements: () => Promise.resolve([]) });
    await page.viewport(1640, 900);
    wrap(<CreditCards />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-05-vacio.png` });
    const empty = el('.coin-empty-codex');
    expect(empty.textContent).not.toMatch(/coinify\.[a-zA-Z]/);
    expect(empty.querySelector('button')).toBeTruthy();
  });

  test('el gestor de tarjetas abre y entra', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CreditCards />);
    await settle();
    el<HTMLButtonElement>('.coin-dashboard__header .rpg-button').click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cc-06-gestor.png` });
    assertModalFits('[role="dialog"]');
    const bad = overflowing(el('[role="dialog"]'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('Préstamos', () => {
  test('1640×900: nombre largo, monto de 9 cifras, USD y cuotas', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<Loans />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-loans-01-1640.png` });
    const bad = overflowing(el('.qb-page'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // Descripción e importe no se pisan.
    for (const row of document.querySelectorAll('.coin-loan-card__row')) {
      const desc = row.querySelector('.coin-loan-card__desc');
      const amount = row.querySelector('.coin-loan-card__amount');
      if (!desc || !amount) continue;
      expect(amount.getBoundingClientRect().left).toBeGreaterThanOrEqual(desc.getBoundingClientRect().right - 1);
    }
  });

  test('760×640: las filas de préstamo siguen entrando', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<Loans />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-loans-02-760.png` });
    const bad = overflowing(el('.qb-page'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('un préstamo sin descripción no imprime la fecha dos veces', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<Loans />);
    await settle();
    const rows = [...document.querySelectorAll('.coin-loan-card__desc')]
      .map((n) => n.textContent ?? '');
    for (const text of rows) {
      expect(text, `fecha repetida en «${text}»`).not.toMatch(/(\d{4}-\d{2}-\d{2})\s*\1/);
    }
  });

  test('sin préstamos: estado vacío limpio', async () => {
    stub({ financeGetLoans: () => Promise.resolve([]) });
    await page.viewport(1640, 900);
    wrap(<Loans />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-loans-03-vacio.png` });
    expect(el('.coin-empty-codex').textContent).not.toMatch(/coinify\.[a-zA-Z]/);
  });
});

describe('Gestor de cuentas', () => {
  test('abre, muestra saldos y no desborda a 1640', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<AccountManager onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-acc-01-1640.png` });
    assertModalFits('[role="dialog"]');
    const bad = overflowing(el('[role="dialog"]'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(el('[role="dialog"]').textContent).not.toMatch(/coinify\.[a-zA-Z]/);
  });

  test('entra a 760×640 sin cortar el formulario', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<AccountManager onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-acc-02-760.png` });
    assertModalFits('[role="dialog"]');
  });

  test('el formulario de transferencia abre dentro del modal', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<AccountManager onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    const transfer = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => /transferir/i.test(b.textContent ?? ''));
    expect(transfer, 'no encontré el botón Transferir').toBeTruthy();
    transfer!.click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-acc-03-transferencia.png` });
    assertModalFits('[role="dialog"]');
    const bad = overflowing(el('[role="dialog"]'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // Ni «Saldo inicial» ni «Monto» pueden quedar sin lugar detrás de sus flechas.
    const cramped = crampedInputs(el('[role="dialog"]'));
    expect(cramped, `campos sin lugar: ${cramped.join(' | ')}`).toEqual([]);
  });

  test('el botón «Eliminar» se lee: no es rojo oscuro sobre cuero oscuro', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<AccountManager onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    const del = el('.coin-manager__delete');
    const style = getComputedStyle(del);
    expect(contrast(style.color, style.backgroundColor), 'contraste insuficiente').toBeGreaterThan(4.5);
  });

  test('cada acción de fila tiene rótulo accesible', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<AccountManager onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    const iconButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .filter((b) => !b.textContent?.trim());
    for (const b of iconButtons) {
      expect(b.getAttribute('aria-label') || b.getAttribute('title'), 'botón sólo-icono sin rótulo').toBeTruthy();
    }
  });
});

describe('Gestor de categorías', () => {
  test('abre, entra y las categorías largas no rompen la lista', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CategoryManager categories={CATS} onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cat-01-1640.png` });
    assertModalFits('[role="dialog"]');
    const bad = overflowing(el('[role="dialog"]'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('entra a 760×640', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CategoryManager categories={CATS} onClose={() => undefined} onSaved={() => undefined} />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cat-02-760.png` });
    assertModalFits('[role="dialog"]');
  });
});
