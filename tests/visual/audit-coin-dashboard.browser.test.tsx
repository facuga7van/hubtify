import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import Dashboard from '@modules/finance/components/Dashboard';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/**
 * Auditoría visual del panel de Coinify a pantalla completa (1640×900) y al
 * mínimo que permite la app (760×640). Todo lo que llegó hoy —cofre, presupuestos
 * en la rueda, agenda de 30 días, cotización congelada— se mira entero por
 * primera vez.
 */

const LONG = 'Suscripción anual al servicio de contabilidad y facturación electrónica del estudio';

const ACCOUNTS = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 },
  { id: 'a2', name: 'Banco Galicia — Caja de ahorro en pesos', kind: 'bank', currency: 'ARS', initialBalance: 0, accountOrder: 1, balance: 214_780_310, movements: 312 },
  { id: 'a3', name: 'Mercado Pago', kind: 'wallet', currency: 'ARS', initialBalance: 0, accountOrder: 2, balance: -18_400, movements: 41 },
  { id: 'a4', name: 'Cuenta en dólares', kind: 'bank', currency: 'USD', initialBalance: 0, accountOrder: 3, balance: 12_450.75, movements: 9 },
];

const CATEGORIES = [
  { category: 'Comida', ARS: 184_300_000, USD: 0 },
  { category: 'Hogar', ARS: 92_150_000, USD: 0 },
  { category: 'Transporte', ARS: 41_000_000, USD: 0 },
  { category: 'Salud', ARS: 22_400_000, USD: 0 },
  { category: 'Ocio', ARS: 12_900_000, USD: 0 },
  { category: 'Suscripciones y servicios digitales del estudio', ARS: 8_400_000, USD: 0 },
  { category: 'Impuestos', ARS: 4_100_000, USD: 0 },
  { category: 'Regalos', ARS: 900_000, USD: 0 },
  { category: 'Software', ARS: 0, USD: 240 },
];

const BUDGET_STATUS = {
  month: '2026-09',
  totalLimit: 300_000_000,
  totalSpent: 365_150_000,
  categories: [
    { category: 'Comida', limit: 150_000_000, spent: 184_300_000, pct: 122.9 },
    { category: 'Hogar', limit: 100_000_000, spent: 92_150_000, pct: 92.2 },
    { category: 'Transporte', limit: 50_000_000, spent: 41_000_000, pct: 82 },
    // Una categoría con límite y sin gasto: tiene que seguir apareciendo.
    { category: 'Viajes', limit: 30_000_000, spent: 0, pct: 0 },
  ],
};

const UPCOMING = {
  from: '2026-09-01',
  to: '2026-10-01',
  totals: { ARS: 987_654_321, USD: 240 },
  items: [
    { kind: 'recurring', date: '2026-09-02', label: 'Alquiler del departamento de Palermo', amount: 480_000_000, currency: 'ARS', refId: 'r1' },
    { kind: 'installment', date: '2026-09-05', label: LONG, amount: 128_400_000, currency: 'ARS', refId: 'i1', detail: '(3/6)' },
    { kind: 'card_due', date: '2026-09-12', label: 'Visa Galicia', amount: 214_780_310, currency: 'ARS', refId: 'c1' },
    { kind: 'recurring', date: '2026-09-15', label: 'Netflix', amount: 12_000, currency: 'ARS', refId: 'r2' },
    { kind: 'installment', date: '2026-09-18', label: 'Notebook del estudio', amount: 96_750_000, currency: 'ARS', refId: 'i2', detail: '(2/18)' },
    { kind: 'recurring', date: '2026-09-20', label: 'Software', amount: 240, currency: 'USD', refId: 'r3' },
    { kind: 'card_due', date: '2026-09-25', label: 'Amex', amount: 67_712_011, currency: 'ARS', refId: 'c2' },
    { kind: 'recurring', date: '2026-09-28', label: 'Seguro del auto', amount: 74_500_000, currency: 'ARS', refId: 'r4' },
  ],
};

interface StubOpts {
  accounts?: unknown[];
  budgets?: unknown;
  upcoming?: unknown;
  categories?: unknown[];
  empty?: boolean;
}

function stub(opts: StubOpts = {}) {
  const empty = opts.empty ?? false;
  const bal = empty
    ? { ARS: { income: 0, expenses: 0, balance: 0 }, USD: { income: 0, expenses: 0, balance: 0 } }
    : { ARS: { income: 987_654_321, expenses: 365_150_000, balance: 622_504_321 }, USD: { income: 3_200, expenses: 240, balance: 2_960 } };

  const handlers: Record<string, unknown> = {
    financeGetMonthlyBalance: () => Promise.resolve(bal),
    financeGetBalanceForRange: () => Promise.resolve(bal),
    financeGetCategoryBreakdown: () => Promise.resolve(empty ? [] : (opts.categories ?? CATEGORIES)),
    financeGetCategoryBreakdownForRange: () => Promise.resolve(empty ? [] : (opts.categories ?? CATEGORIES)),
    financeGetExpenseBreakdown: () => Promise.resolve({
      ARS: { total: 365_150_000, direct: 180_000_000, installments: 125_150_000, pendingCard: 60_000_000, cardPayments: 0 },
      USD: { total: 240, direct: 240, installments: 0, pendingCard: 0, cardPayments: 0 },
    }),
    financeGetMonthlyExpenses: () => Promise.resolve(empty ? [] : [280_000_000, 310_000_000, 295_000_000, 340_000_000, 352_000_000, 365_150_000]),
    financeGetProjection: () => Promise.resolve([]),
    financeGetInstallmentGroups: () => Promise.resolve(empty ? [] : [{}, {}, {}]),
    financeGetCreditCardStatements: () => Promise.resolve([]),
    financeGetActiveLoanSummary: () => Promise.resolve(empty ? null : {
      ARS: { lent: 90_000_000, borrowed: 500_000_000, lentPending: 45_120_000, borrowedPending: 312_900_000 },
      USD: { lent: 0, borrowed: 0, lentPending: 1_250, borrowedPending: 0 },
      lent: 90_000_000, borrowed: 500_000_000,
    }),
    financeGetBudgetStatus: () => Promise.resolve(opts.budgets === undefined ? BUDGET_STATUS : opts.budgets),
    financeSetBudget: () => Promise.resolve({ ok: true }),
    financeGetAccounts: () => Promise.resolve(opts.accounts ?? ACCOUNTS),
    financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
    financeDeleteAccount: () => Promise.resolve({ ok: true }),
    financeGetAccountsOverview: () => Promise.resolve({ accounts: opts.accounts ?? ACCOUNTS, totalArs: 0, totalUsd: 0 }),
    financeGetUpcoming: () => Promise.resolve(opts.upcoming === undefined ? (empty ? { ...UPCOMING, items: [], totals: { ARS: 0, USD: 0 } } : UPCOMING) : opts.upcoming),
    financeGetValuedView: () => Promise.resolve(null),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
    financeGetRecurring: () => Promise.resolve([]),
    financeGetTransactions: () => Promise.resolve([]),
    financeExportCsv: () => Promise.resolve({ canceled: true }),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
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
      <div className="qb-page" style={{ padding: 24 }}><Dashboard /></div>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/**
 * Ningún elemento del árbol desborda horizontalmente su propia caja.
 *
 * Salvedad: `.help-bubble` / `.help-bubble-inline` (componente compartido)
 * llevan un `::after` invisible de 32×32 que agranda el área táctil. Es
 * absoluto y no se ve, pero infla `scrollWidth` de la burbuja y de cada
 * ancestro hasta la raíz. Se descuenta: es ruido del harness, no un defecto.
 */
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
    const isBubble = /help-bubble/.test(node.className);
    const hasBubble = isBubble || node.querySelector('.help-bubble, .help-bubble-inline') !== null;
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

describe('Panel de Coinify — pantalla completa', () => {
  test('1640×900: nada se desborda y las cifras de 9 dígitos entran', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-01-1640.png` });

    const bad = overflowing(el('.coin-dashboard'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('760×640 (mínimo de la app): sigue entrando', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-02-760.png` });

    const bad = overflowing(el('.coin-dashboard'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    // La página entera no scrollea de costado.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });

  test('el cofre abierto: cuentas con nombres largos y saldo de 9 cifras', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();

    const peek = el<HTMLButtonElement>('.coin-account-peek');
    peek.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-03-cofre.png` });

    const list = el('.coin-account-list');
    const bad = overflowing(list);
    expect(bad, `desbordes en el cofre: ${bad.join(', ')}`).toEqual([]);

    // Nombre y saldo no se pisan: el saldo empieza después de que termina el nombre.
    for (const row of document.querySelectorAll('.coin-account-row')) {
      const name = row.querySelector('.coin-account-row__name')!.getBoundingClientRect();
      const amount = row.querySelector('.coin-account-row__balance')!.getBoundingClientRect();
      expect(amount.left).toBeGreaterThanOrEqual(name.right - 1);
    }
  });

  test('el cofre cierra con Escape', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    el<HTMLButtonElement>('.coin-account-peek').click();
    await settle(300);
    expect(document.querySelector('.coin-account-list')).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(200);
    expect(document.querySelector('.coin-account-list')).toBeNull();
  });

  test('la rueda de categorías no crece sin techo', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const svg = el<SVGSVGElement>('.coin-middle-grid svg');
    const r = svg.getBoundingClientRect();
    expect(r.height).toBeLessThanOrEqual(200);
    expect(r.width).toBeLessThanOrEqual(200);
  });

  test('la leyenda con presupuestos: importes legibles y lápiz con aria-label', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-04-presupuestos.png` });

    const pencils = [...document.querySelectorAll('.coin-budget-pencil')];
    expect(pencils.length).toBeGreaterThan(0);
    for (const p of pencils) expect(p.getAttribute('aria-label')).toBeTruthy();

    // Los importes son Fira Code (numérico), no display gótica a tamaño etiqueta.
    const amount = el('.coin-category-legend__amount');
    expect(getComputedStyle(amount).fontFamily.toLowerCase()).toContain('fira');
    expect(getComputedStyle(el('.coin-budget-row__figures')).fontFamily.toLowerCase()).toContain('fira');

    // Y la leyenda es un bloque bajo la rueda, no una banda de 1600 px con el
    // nombre en un borde y el importe en el otro.
    expect(el('.coin-category-legend').getBoundingClientRect().width).toBeLessThanOrEqual(640);
    expect(el('.coin-budget-summary').getBoundingClientRect().width).toBeLessThanOrEqual(640);
  });

  test('la tendencia no imprime dos veces el signo de porcentaje', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const info = el('.coin-chest-panel__info').textContent ?? '';
    expect(info).not.toMatch(/%\s*%/);
    expect(info).toMatch(/menos que el mes pasado|más que el mes pasado/);
  });

  test('la agenda corta entre filas, nunca por la mitad de una', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const list = el('.coin-upcoming__list');
    const rows = [...list.querySelectorAll<HTMLElement>('.coin-upcoming__row')];
    expect(rows.length).toBeGreaterThan(7);
    const rowH = rows[0].getBoundingClientRect().height;
    expect(rowH).toBeGreaterThan(0);
    // El alto visible es un múltiplo exacto del alto de fila.
    const visible = list.clientHeight;
    expect(Math.abs(visible / rowH - Math.round(visible / rowH))).toBeLessThan(0.05);
    // Y todas las filas miden lo mismo (si no, «múltiplo» no significa nada).
    const heights = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(heights.size).toBe(1);
  });

  test('el enlace a Préstamos no se corta ni parte el chevron de renglón', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    const link = el<HTMLButtonElement>('.coin-loan-mini__link');
    const r = link.getBoundingClientRect();
    expect(link.scrollHeight, 'el botón recorta contenido en vertical').toBeLessThanOrEqual(link.clientHeight + 1);
    // Texto y chevron en el mismo renglón: el alto es el de una línea.
    expect(r.height).toBeLessThan(40);
  });

  test('el encabezado no gasta tres renglones en 300 px de controles', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    // Un renglón: los tres controles comparten franja vertical.
    const rects = [
      el('.coin-month-nav, .coin-month-nav__label'),
      el('.coin-range-select'),
      el('.coin-export-btn'),
    ].map((n) => n.getBoundingClientRect());
    const top = Math.max(...rects.map((r) => r.top));
    const bottom = Math.min(...rects.map((r) => r.bottom));
    expect(bottom - top, 'los controles no comparten renglón').toBeGreaterThan(8);
    expect(el('.coin-dashboard__header').getBoundingClientRect().height).toBeLessThan(60);
  });

  test('la agenda de 30 días: fecha, rótulo, tipo e importe sin pisarse', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    el('.coin-bottom-grid').scrollIntoView({ block: 'end' });
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-05-agenda.png` });

    const rows = [...document.querySelectorAll('.coin-upcoming__row')];
    expect(rows.length).toBe(UPCOMING.items.length);
    for (const row of rows) {
      const label = row.querySelector('.coin-upcoming__label')!.getBoundingClientRect();
      const amount = row.querySelector('.coin-upcoming__amount')!.getBoundingClientRect();
      expect(amount.left).toBeGreaterThanOrEqual(label.right - 1);
      // La fila no se parte en dos renglones cortando texto.
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test('estados vacíos: nada de valores crudos ni cartas rotas', async () => {
    stub({ empty: true, accounts: [], budgets: null });
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-06-vacio.png` });

    const text = el('.coin-dashboard').textContent ?? '';
    // Una clave i18n sin traducir se ve como «coinify.loQueSea».
    expect(text).not.toMatch(/coinify\.[a-zA-Z]/);
    expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b/);
  });

  test('la comparativa con el mes anterior se abre sin desbordar', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    const btn = el<HTMLButtonElement>('.coin-comparison-toggle__btn');
    btn.click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-dash-07-comparativa.png` });
    const bad = overflowing(el('.coin-comparison-grid'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });
});
