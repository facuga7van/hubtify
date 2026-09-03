/**
 * Dos caminos para el mismo concepto tienen que escribir la MISMA fila.
 *
 * La iteración anterior arregló los defaults inferidos (`finance:getEntryDefaults`)
 * en `QuickAddForm` —el formulario de `/finance`— y dejó afuera el quick-add del
 * widget del tablero del hub, que es justo el camino más corto que mide el
 * journey J2 («cargar gasto: 2 clics + monto»).
 *
 * Resultado medido: el MISMO gasto nacía con `transfer` desde `/finance` y con
 * `cash` desde el hub; con la categoría de la moda en uno y el literal `'Otros'`
 * en el otro; y con la cuenta inferida en uno y el respaldo «Efectivo» en el
 * otro — la cuenta que el historial dice que la persona NO usa.
 *
 * No es «los dos fallan parejo»: es una INCONSISTENCIA entre dos puertas de la
 * misma habitación, que es peor que un default malo, porque el usuario no puede
 * ni aprender la regla.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render, cleanup } from 'vitest-browser-react';
import ToastProvider from '@shared/components/ToastProvider';
import { QuickAddForm } from '@modules/finance/components/shared/QuickAddForm';
import DashboardWidget from '@modules/finance/components/DashboardWidget';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/finance/styles/coinify.css';

/** Las dos cuentas de la base real, con el id sembrado de «Efectivo». */
const CASH = 'account-cash-default';
const ACCOUNTS = [
  { id: CASH, name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 0, movements: 0 },
  { id: 'a2', name: 'Mercadopago', kind: 'bank', currency: 'ARS', initialBalance: 0, accountOrder: 1, balance: 0, movements: 0 },
];

/** Lo que el handler infiere de un historial como el real, pero más variado. */
const DEFAULTS = {
  paymentMethod: 'transfer',
  currency: 'USD',
  accountId: 'a2',
  category: 'Comida',
  sampleSize: 50,
  installmentPaymentMethod: 'credit_card',
  installmentSampleSize: 4,
};

/** Lo último que se le pasó a `finance:addTransaction`. */
let written: Record<string, unknown> | null = null;

function stub(overrides: Record<string, unknown> = {}) {
  written = null;
  const handlers: Record<string, unknown> = {
    financeGetEntryDefaults: () => Promise.resolve(DEFAULTS),
    financeGetAccounts: () => Promise.resolve(ACCOUNTS),
    financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
    financeGetCategories: () => Promise.resolve(['Comida', 'Hogar', 'Otros', 'Transporte']),
    financeGetCategoryMappings: () => Promise.resolve([]),
    financeGetTransactions: () => Promise.resolve([]),
    financeGetCreditCards: () => Promise.resolve([]),
    financeGetMonthlyTotal: () => Promise.resolve(0),
    financeGetActiveLoansCount: () => Promise.resolve(0),
    financeGetMonthlyBalance: () => Promise.resolve({ ARS: { income: 0, expenses: 0 } }),
    financeAddTransaction: (payload: Record<string, unknown>) => {
      written = payload;
      return Promise.resolve('tx-1');
    },
    processRpgEvent: () => Promise.resolve({ xpGained: 5 }),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    ...overrides,
  };
  // `has` responde la verdad: los componentes hacen feature-detection con
  // `typeof api.x !== 'function'`.
  (window as unknown as { api: unknown }).api = new Proxy(handlers, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: (target, prop: string) => prop in target,
  });
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/** `cleanup()` y `render()` son ASÍNCRONOS en este binding: sin `await` el
 *  desmontaje del árbol anterior pisa al siguiente y `querySelector` no
 *  encuentra nada. Este archivo monta dos veces por prueba, así que importa. */
const wrap = async (node: React.ReactNode) => {
  await cleanup();
  return render(<ToastProvider>{node}</ToastProvider>);
};

/** Escribe en un input CONTROLADO por React: `.value = x` solo no lo entera. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** La forma de la fila que los dos caminos tienen que compartir. */
interface Shape {
  category: unknown;
  currency: unknown;
  paymentMethod: unknown;
  accountId: unknown;
}

const shapeOf = (row: Record<string, unknown>): Shape => ({
  category: row.category,
  currency: row.currency,
  paymentMethod: row.paymentMethod,
  accountId: row.accountId,
});

/** El camino largo: `/finance` → carga rápida del libro mayor. */
async function ledgerPath(): Promise<Shape> {
  let payload: Record<string, unknown> | null = null;
  await wrap(<QuickAddForm onSubmit={(d) => { payload = d as unknown as Record<string, unknown>; }} />);
  await settle();
  type(el<HTMLInputElement>('#coin-quick-add-amount'), '1000');
  el<HTMLButtonElement>('button[type="submit"]').click();
  await settle();
  if (!payload) throw new Error('el formulario del libro mayor no envió nada');
  return shapeOf(payload);
}

/** El camino corto: el quick-add del widget del tablero del hub. */
async function hubPath(): Promise<Shape> {
  await wrap(<DashboardWidget />);
  await settle();
  el<HTMLButtonElement>('.coin-dash-quick__toggle').click();
  await settle(100);
  type(el<HTMLInputElement>('.coin-dash-quick input[type="number"]'), '1000');
  await settle(100);
  el<HTMLButtonElement>('.coin-dash-quick > button.rpg-button:last-child').click();
  await settle();
  if (!written) throw new Error('el widget no escribió ninguna transacción');
  return shapeOf(written);
}

beforeEach(() => {
  document.body.style.margin = '0';
  localStorage.clear();
  stub();
});

describe('Coinify — el mismo gasto por las dos puertas', () => {
  test('el widget del hub escribe la misma fila que el libro mayor', async () => {
    // Cada camino arranca de cero: es un usuario que carga su primer gasto por
    // ahí, no uno que ya pasó por el otro y dejó rastro en `localStorage`.
    const hub = await hubPath();
    localStorage.clear();
    stub();
    const ledger = await ledgerPath();

    expect(hub).toEqual(ledger);
    // Y lo que comparten es lo que dice el historial, no una constante:
    expect(hub).toEqual({
      category: 'Comida',
      currency: 'USD',
      paymentMethod: 'transfer',
      accountId: 'a2',
    });
  });

  test('lo que el usuario elige a mano no lo pisa la inferencia', async () => {
    // La inferencia llega tarde (otro viaje de IPC). Si pisa la elección, el
    // usuario ve cambiar un select que acaba de tocar.
    stub({ financeGetEntryDefaults: () => new Promise((r) => setTimeout(() => r(DEFAULTS), 400)) });
    await wrap(<DashboardWidget />);
    await settle(100);
    el<HTMLButtonElement>('.coin-dash-quick__toggle').click();
    await settle(50);
    pick(el<HTMLSelectElement>('.coin-dash-quick select[aria-label="Medio de pago"]'), 'cash');
    await settle(600);
    expect(el<HTMLSelectElement>('.coin-dash-quick select[aria-label="Medio de pago"]').value).toBe('cash');
  });

  test('re-infiere al cambiar de cuenta', async () => {
    await wrap(<DashboardWidget />);
    await settle();
    el<HTMLButtonElement>('.coin-dash-quick__toggle').click();
    await settle(100);
    pick(el<HTMLSelectElement>('.coin-dash-quick select[aria-label="Medio de pago"]'), 'cash');
    await settle(50);

    // Otro historial: lo que el usuario tocó acá ya no aplica.
    stub({ financeGetEntryDefaults: () => Promise.resolve({ ...DEFAULTS, paymentMethod: 'debit' }) });
    window.dispatchEvent(new Event('account:switched'));
    await settle();
    expect(el<HTMLSelectElement>('.coin-dash-quick select[aria-label="Medio de pago"]').value).toBe('debit');
  });

  test('sin el canal (binding viejo) el widget no revienta y usa el mismo respaldo', async () => {
    stub({ financeGetEntryDefaults: undefined });
    const hub = await hubPath();
    localStorage.clear();
    stub({ financeGetEntryDefaults: undefined });
    const ledger = await ledgerPath();
    expect(hub).toEqual(ledger);
    // El respaldo digital compartido, no el efectivo que nadie eligió nunca.
    expect(hub.paymentMethod).toBe('transfer');
    expect(hub.category).toBe('Otros');
  });

  test('la categoría inferida se ve en el select del widget', async () => {
    await wrap(<DashboardWidget />);
    await settle();
    el<HTMLButtonElement>('.coin-dash-quick__toggle').click();
    await settle(150);
    // No es sólo el payload: el usuario VE con qué se va a guardar antes de
    // apretar «Registrar».
    expect(el<HTMLInputElement>('.coin-category-autocomplete__input').value).toBe('Comida');
    expect(el<HTMLSelectElement>('.coin-dash-quick select[aria-label="Medio de pago"]').value).toBe('transfer');
    expect(el<HTMLSelectElement>('.coin-dash-quick .coin-account-select').value).toBe('a2');
  });
});
