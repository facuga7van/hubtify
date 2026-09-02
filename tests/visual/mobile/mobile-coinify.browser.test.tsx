import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Routes, Route } from 'react-router-dom';
import FinanceLayout from '@modules/finance/components/FinanceLayout';
import FinanceDashboard from '@modules/finance/components/Dashboard';
import Transactions from '@modules/finance/components/Transactions';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { FINANCE_API } from './fixtures';

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
      </Route>
    </Routes>
  );
}

describe('Coinify a 390×844', () => {
  test('Panel: la página respira y nada desborda (C1)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance');
    await expect.element(page.getByText(/Libro del Tesorero/i)).toBeVisible();
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

  test('la pestaña activa se ve aunque sea la última (C9)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/transactions');
    await settle(700);
    const active = document.querySelector('.coin-tab-link--active') as HTMLElement;
    const nav = document.querySelector('.coin-tab-nav') as HTMLElement;
    const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
    expect(a.left).toBeGreaterThanOrEqual(n.left - 1);
    expect(a.right).toBeLessThanOrEqual(n.right + 1);
    expect(active.getBoundingClientRect().height).toBeGreaterThanOrEqual(38);
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
});
