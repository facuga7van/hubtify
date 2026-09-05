import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '@modules/finance/components/Dashboard';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/**
 * El cofre abierto tiene que FLOTAR: antes crecía la celda del grid y toda la
 * columna de abajo se corría al tocarlo. Y una cuenta sembrada por la migración,
 * nunca usada y en cero, no se muestra — era justamente lo que hacía imposible
 * entender para qué sirve el cofre.
 */
const account = (id: string, name: string, kind: string, balance: number, movements: number) =>
  ({ id, name, kind, currency: 'ARS', initialBalance: 0, accountOrder: 0, balance, movements });

function stubApi(accounts: unknown[]) {
  (window as unknown as { api: Record<string, unknown> }).api = {
    financeGetMonthlyBalance: () => Promise.resolve({ ARS: { income: 500000, expenses: 320000, balance: 180000 }, USD: { income: 0, expenses: 0, balance: 0 } }),
    financeGetBalanceForRange: () => Promise.resolve({ ARS: { income: 500000, expenses: 320000, balance: 180000 }, USD: { income: 0, expenses: 0, balance: 0 } }),
    financeGetCategoryBreakdown: () => Promise.resolve([{ category: 'Comida', total: 180000 }, { category: 'Hogar', total: 140000 }]),
    financeGetCategoryBreakdownForRange: () => Promise.resolve([{ category: 'Comida', total: 180000 }, { category: 'Hogar', total: 140000 }]),
    financeGetMonthlyExpenses: () => Promise.resolve([]),
    financeGetProjection: () => Promise.resolve([]),
    financeGetInstallmentGroups: () => Promise.resolve([]),
    financeGetCreditCardStatements: () => Promise.resolve([]),
    financeGetActiveLoanSummary: () => Promise.resolve(null),
    financeGetBudgets: () => Promise.resolve([]),
    // Forma real del handler: antes devolvía `[]` y nadie lo leía porque el
    // feature-detect escondía los presupuestos sin `financeSetBudget` en el stub.
    financeGetBudgetStatus: () => Promise.resolve({ month: '', categories: [], totalLimit: 0, totalSpent: 0 }),
    financeGetAccounts: () => Promise.resolve(accounts),
    financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
    financeGetAccountsOverview: () => Promise.resolve({ accounts, totalArs: 0, totalUsd: 0 }),
    // Antes degradaban a null vía api-ext; ahora el dashboard los llama directo.
    financeGetExpenseBreakdown: () => Promise.resolve(null),
    financeGetExpenseBreakdownForRange: () => Promise.resolve(null),
    financeSetBudget: () => Promise.resolve({ ok: true }),
    financeDeleteAccount: () => Promise.resolve({ ok: true }),
    financeTransferBetweenAccounts: () => Promise.resolve({ ok: true, transferGroupId: 'tg', expenseId: 'e', incomeId: 'i' }),
    // El dashboard dispara estos al montar; sin ellos revienta antes de pintar.
    financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
    financeGetRecurring: () => Promise.resolve([]),
    financeGetTransactions: () => Promise.resolve([]),
    financeGetValuedView: () => Promise.resolve(null),
    financeGetUpcoming: () => Promise.resolve({ items: [], total: 0 }),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    processRpgEvent: () => Promise.resolve({ xpGained: 0, hpChange: 0, leveledUp: false, newTitle: null, comboMultiplier: 1, bonusMultiplier: 1 }),
  };
}

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-1)';
});

const dash = () => render(
  <MemoryRouter><ToastProvider><ConfirmProvider><Dashboard /></ConfirmProvider></ToastProvider></MemoryRouter>,
);

describe('Cofre del tesoro — cuentas', () => {
  test('la cuenta sembrada, nunca usada y en cero, no se muestra', async () => {
    stubApi([account('account-cash-default', 'Efectivo', 'cash', 0, 0)]);
    dash();
    await expect.element(page.getByText(/Cofre del tesoro/i)).toBeVisible();
    // La cuenta sembrada no aparece por ningún lado, ni como fila ni como total.
    await expect.element(page.getByText(/Total en cuentas/i)).not.toBeInTheDocument();
    await page.screenshot({ path: `${SCREENS}/chest-01-cuenta-vacia-oculta.png` });
  });

  test('con cuentas usadas: la lista flota sobre el contenido, no lo empuja', async () => {
    stubApi([
      account('a1', 'Efectivo', 'cash', 42000, 6),
      account('a2', 'Banco', 'bank', 315000, 21),
      account('a3', 'Mercado Pago', 'wallet', 18400, 12),
    ]);
    dash();
    await expect.element(page.getByText(/Total en cuentas/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/chest-02-cerrado.png` });
    await page.getByText(/Total en cuentas/i).click();
    await expect.element(page.getByText(/Mercado Pago/i)).toBeVisible();
    // La lista entra con un fade de 140 ms: sin esperarlo la captura la agarra
    // a media opacidad y parece que deja pasar el contenido de atrás.
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${SCREENS}/chest-03-abierto-flotando.png` });
  });
});
