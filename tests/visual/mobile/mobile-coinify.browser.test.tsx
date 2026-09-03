import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Routes, Route } from 'react-router-dom';
import FinanceLayout from '@modules/finance/components/FinanceLayout';
import FinanceDashboard from '@modules/finance/components/Dashboard';
import Transactions from '@modules/finance/components/Transactions';
import Loans from '@modules/finance/components/Loans';
import Installments from '@modules/finance/components/Installments';
import Commitments from '@modules/finance/components/Commitments';
import Import from '@modules/finance/components/Import';
import Recurring from '@modules/finance/components/Recurring';
import CreditCards from '@modules/finance/components/CreditCards';
import CoinDashboardWidget from '@modules/finance/components/DashboardWidget';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { FINANCE_API, COIN_ACCOUNTS } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/finance/styles/coinify.css';

beforeAll(() => {
  installApi(FINANCE_API);
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

/** El mismo árbol de rutas que App.tsx para /finance, con el layout de pestañas real. */
function Finance() {
  return (
    <Routes>
      <Route path="/finance" element={<FinanceLayout />}>
        <Route index element={<FinanceDashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="commitments" element={<Commitments />}>
          <Route path="installments" element={<Installments />} />
          <Route path="recurring" element={<Recurring />} />
          <Route path="cards" element={<CreditCards />} />
          <Route path="loans" element={<Loans />} />
        </Route>
        <Route path="import" element={<Import />} />
      </Route>
    </Routes>
  );
}

/**
 * Un resumen ya parseado, tal como lo devuelve el importador. Sin PDF real:
 * los resúmenes del usuario viven fuera del repo y no se commitea ni un monto.
 */
const PARSED_STATEMENT = {
  fileName: 'resumen-demo.pdf',
  skippedLines: [],
  rows: [
    { date: '2026-01-05', merchant: 'TIENDA DEMO', amountARS: 1000, isExcluded: false, suggestedCategory: 'Compras' },
    { date: '2026-01-06', merchant: 'OTRA TIENDA', amountARS: 2000, installmentCurrent: 2, installmentTotal: 6, isExcluded: false, suggestedCategory: 'Compras' },
  ],
  header: {
    statementNumber: 'VI0000000001', cardLast4: '1234',
    previousClosingDate: '2025-12-27', previousDueDate: '2026-01-05',
    closingDate: '2026-01-27', dueDate: '2026-02-05',
    nextClosingDate: '2026-02-26', nextDueDate: '2026-03-06',
    period: '2026-01',
    previousBalance: { ars: 5000, usd: null },
    payments: { ars: 5000, usd: null },
    consumos: { ars: 3000, usd: null },
    totalDue: { ars: 3000, usd: null },
    minimumPaymentArs: 900, purchaseLimitArs: 100000, financingLimitArs: 50000,
    forecast: [{ month: '2026-02', amount: 2000 }],
    forecastTail: null,
    closingDateAgrees: true,
  },
};

/** Ninguna palabra cortada: cada rótulo entra entero en su caja. */
function noClippedLabels(selector: string) {
  const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    expect(node.scrollWidth, `«${node.textContent}» está cortado`)
      .toBeLessThanOrEqual(node.clientWidth + 1);
  }
}

describe('Coinify a 390×844', () => {
  test('Panel: la página respira y nada desborda (C1)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance');
    // `.first()` —igual que mobile-hub con «Tabla del Aventurero»—: el título
    // de la página ya no es el único nodo con ese texto, porque el ítem del
    // cajón ahora declara su función («…— el Libro del Tesorero», nav.coinifyDesc)
    // para que el menú y el encabezado dejen de llamarse distinto.
    await expect.element(page.getByText(/Libro del Tesorero/i).first()).toBeVisible();
    await settle(700);
    await shoot('coinify-01-panel');
    noOverflow('COIN PANEL');
    // `.coin-book` va EN el mismo div que `.qb-page` (BookPage.tsx:33): el
    // descendiente `.coin-book .qb-page` de coinify.css no matchea nada.
    const pageEl = document.querySelector('.qb-page.coin-book') as HTMLElement;
    expect(parseFloat(getComputedStyle(pageEl).paddingLeft)).toBeLessThanOrEqual(12);
  });

  test('Libro mayor: cada fila entra entera (C2)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/transactions');
    await settle(700);
    await shoot('coinify-02-movimientos');
    noOverflow('COIN LEDGER');
    const rows = document.querySelectorAll<HTMLElement>('.coin-ledger-row');
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // El concepto ya no queda en 0 px: la columna es legible.
    const desc = document.querySelector('.coin-ledger-row__desc') as HTMLElement;
    expect(desc.getBoundingClientRect().width).toBeGreaterThan(120);
  });

  test('la tira de pestañas ENTRA a 390 px: no hay 696 px de desborde ni rótulos cortados', async () => {
    await setMobileViewport();
    // La auditoría de diseño midió `mainOverflowX = 696 px` en esta pantalla,
    // con el último rótulo cortado a mitad de palabra y sin señal de scroll.
    // Con TRES pestañas en vez de seis la tira entra entera: la condición fuerte
    // (no hace falta scrollear) implica la débil (nada queda cortado).
    mountInShell(<Finance />, '/finance');
    await settle(700);
    const nav = document.querySelector('.coin-tab-nav') as HTMLElement;
    expect(document.querySelectorAll('.coin-tab-link')).toHaveLength(3);
    expect(nav.scrollWidth, 'la tira de pestañas sigue desbordando a 390 px')
      .toBeLessThanOrEqual(nav.clientWidth + 1);
    noClippedLabels('.coin-tab-link');
    noOverflow('COIN TABS 390');
  });

  test('la pestaña activa se ve aunque sea la última (C9)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/commitments/loans');
    await settle(700);
    const active = document.querySelector('.coin-tab-link--active') as HTMLElement;
    const nav = document.querySelector('.coin-tab-nav') as HTMLElement;
    const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
    expect(a.left).toBeGreaterThanOrEqual(n.left - 1);
    expect(a.right).toBeLessThanOrEqual(n.right + 1);
    expect(active.getBoundingClientRect().height).toBeGreaterThanOrEqual(38);
  });

  test('Compromisos: la sub-nav no desborda y sus botones son tocables', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/commitments/installments');
    await settle(700);
    await shoot('coinify-06-compromisos');
    noOverflow('COIN COMMITMENTS');
    noClippedLabels('.coin-subtab');
    // La sección activa a la vista, y ≥44 px de alto de toque.
    const active = document.querySelector('.coin-subtab--active') as HTMLElement;
    expect(active).not.toBeNull();
    for (const tab of document.querySelectorAll<HTMLElement>('.coin-subtab')) {
      expect(tab.getBoundingClientRect().height,
        `«${tab.textContent}» mide menos de 44 px de alto`).toBeGreaterThanOrEqual(44);
    }
  });

  test('COIN-03: Prestado / Tomado prestado van juntos en su propia fila', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/commitments/loans');
    await settle(700);
    await page.getByRole('button', { name: /Agregar préstamo/i }).click();
    await settle(400);
    const group = document.querySelector('.coin-loan-form__direction') as HTMLElement;
    expect(group).not.toBeNull();
    const [lent, borrowed] = [...group.querySelectorAll<HTMLElement>('button')].map((b) => b.getBoundingClientRect());
    const input = (group.parentElement!.querySelector('input') as HTMLElement).getBoundingClientRect();
    expect(Math.abs(lent.top - borrowed.top)).toBeLessThanOrEqual(1);
    expect(lent.top).toBeGreaterThanOrEqual(input.bottom);
    expect(input.width).toBeGreaterThanOrEqual(300);
    noOverflow('COIN LOAN FORM');
  });

  test('COIN-02: «Eliminar grupo» se ve sin hover y con un aspa legible', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/commitments/installments');
    await expect.element(page.getByText(/Heladera/i).first()).toBeVisible();
    await settle(500);
    await shoot('coinify-03-cuotas');
    noOverflow('COIN INSTALLMENTS');
    const btn = document.querySelector('.coin-action-btn--danger') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(parseFloat(getComputedStyle(btn).opacity)).toBe(1);
    const icon = btn.querySelector('svg') as SVGElement;
    const r = icon.getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(16);
    expect(r.width).toBeLessThanOrEqual(18);

    // COIN-04: ningún rótulo del eje X de la proyección se sale del gráfico
    // («CT 26» por «OCT 26» en el primero).
    const svg = document.querySelector('.castle-chart-svg') as SVGSVGElement;
    expect(svg).not.toBeNull();
    const box = svg.getBoundingClientRect();
    const labels = [...svg.querySelectorAll<SVGTextElement>('.castle-label')];
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const label of labels) {
      const lr = label.getBoundingClientRect();
      expect(lr.left, `«${label.textContent}» se sale por la izquierda`).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(lr.right, `«${label.textContent}» se sale por la derecha`).toBeLessThanOrEqual(box.right + 0.5);
    }
  });

  test('Importar: «esto leí de tu resumen» entra a 390 px', async () => {
    await setMobileViewport();
    installApi({
      ...FINANCE_API,
      financeImportSelectAndParsePDF: () => Promise.resolve(PARSED_STATEMENT),
      financeGetCreditCards: () => Promise.resolve([
        { id: 'c1', name: 'Galicia VISA', closingDay: 27, dueDay: 5, last4: '1234', createdAt: '' },
      ]),
      financeGetImportBatches: () => Promise.resolve([]),
      financeGetCategoryMappings: () => Promise.resolve([]),
    });
    mountInShell(<Finance />, '/finance/import');
    await settle(500);
    // El importador arranca en el selector de archivo: se dispara el parseo.
    await page.getByRole('button', { name: /Seleccionar|Select/i }).first().click();
    await expect.element(page.getByText(/Esto leí de tu resumen/i)).toBeVisible();
    await settle(400);
    await shoot('coinify-07-import');
    noOverflow('COIN IMPORT');

    // Lo que antes se tipeaba, ahora leído: período, cierre, vencimiento y total.
    const facts = document.querySelectorAll('.coin-stmt__fact');
    expect(facts.length).toBeGreaterThanOrEqual(5);
    for (const fact of facts) {
      expect((fact as HTMLElement).scrollWidth)
        .toBeLessThanOrEqual((fact as HTMLElement).clientWidth + 1);
    }
    // La conciliación se muestra, y en este resumen cierra (3000 = 3000 − 5000 + 5000).
    expect(document.querySelector('.coin-stmt__recon--ok')).not.toBeNull();
    // El mes dejó de pedirse: el papel lo dijo.
    expect(document.querySelector('#coin-import-month')).toBeNull();
  });

  test('el lápiz de presupuesto existe sin hover (C4)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance');
    await settle(700);
    // El project emula touch: (hover: none) aplica y el lápiz tiene que verse.
    const pencil = document.querySelector('.coin-budget-pencil') as HTMLElement;
    expect(pencil).not.toBeNull();
    expect(parseFloat(getComputedStyle(pencil).opacity)).toBeGreaterThan(0.5);
  });

  /**
   * El atajo del tablero del hub: dos clics y el monto, el camino más corto
   * para cargar un gasto. Acaba de aprender a inferir sus defaults del
   * historial (`finance:getEntryDefaults`), y la fila del monto pasó a tener
   * dos controles: a 390 px es justo donde algo se desborda o queda por debajo
   * del pulgar. Se monta el widget solo —el tablero entero ya lo mide
   * `mobile-hub`— dentro del MobileShell real, que es lo que hace valer las
   * reglas `[data-shell="mobile"]`.
   */
  test('la carga rápida del widget del arca entra a 390 px y bajo el pulgar', async () => {
    await setMobileViewport();
    installApi({
      ...FINANCE_API,
      financeGetEntryDefaults: () => Promise.resolve({
        paymentMethod: 'transfer', currency: 'ARS', accountId: COIN_ACCOUNTS[1]?.id ?? null,
        category: 'Comida', sampleSize: 50,
        installmentPaymentMethod: 'credit_card', installmentSampleSize: 4,
      }),
      financeGetMonthlyTotal: () => Promise.resolve(0),
      financeGetActiveLoansCount: () => Promise.resolve(0),
      financeGetCategoryMappings: () => Promise.resolve([]),
    });
    mountInShell(<div className="rpg-card" style={{ padding: 12 }}><CoinDashboardWidget /></div>, '/');
    await settle(400);

    const toggle = document.querySelector('.coin-dash-quick__toggle') as HTMLButtonElement;
    expect(toggle, 'el widget del arca no montó').not.toBeNull();
    toggle.click();
    await settle(400);

    const form = document.querySelector('.coin-dash-quick') as HTMLElement;
    expect(form, 'la carga rápida no abrió').not.toBeNull();
    noOverflow('COIN WIDGET QUICKADD');
    // Ni el propio formulario se desborda hacia adentro.
    expect(form.scrollWidth - form.clientWidth).toBeLessThanOrEqual(1);

    // WCAG 2.5.5: cada control del formulario, con 44 px de piso.
    const controls = [...form.querySelectorAll('input, select, button')] as HTMLElement[];
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) {
      const h = Math.round(c.getBoundingClientRect().height);
      expect(h, `«${c.getAttribute('aria-label') ?? c.className}» mide ${h}px de alto`).toBeGreaterThanOrEqual(44);
    }

    // Y lo que muestra sale del historial, no de constantes.
    expect((form.querySelector('select[aria-label="Medio de pago"]') as HTMLSelectElement).value).toBe('transfer');
    expect((form.querySelector('.coin-category-autocomplete__input') as HTMLInputElement).value).toBe('Comida');
  });
});
