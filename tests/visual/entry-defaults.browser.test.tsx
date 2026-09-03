/**
 * Los formularios de alta arrancan en lo que la persona viene eligiendo.
 *
 * Tres agujeros distintos, todos medidos contra la base real del usuario (copia
 * read-only de `%APPDATA%\hubtify\hubtify.db`, sólo agregados):
 *
 * 1. `QuickAddForm` **calculaba y tiraba la mitad de la inferencia**: el shim
 *    tipaba `finance:getEntryDefaults` como `{ paymentMethod, currency }` y el
 *    `.then` aplicaba sólo el medio de pago. `accountId` y `currency` se
 *    descartaban, y la cuenta salía de `localStorage` con último respaldo
 *    «Efectivo» — la cuenta que el historial dice que NO se usa (`account_id`
 *    en NULL en las 107 filas de la base).
 * 2. `InstallmentAddForm` ni siquiera llamaba al canal: arrancaba en `'debit'`,
 *    constante. En la base hay 4 planes cargados a mano — 3 con tarjeta, 1 por
 *    transferencia, **cero en débito**.
 * 3. La categoría era el literal `'Otros'` en los dos.
 *
 * Y en Questify, `QuickAdd` (Ctrl+K) mandaba `projectId: null` hardcodeado
 * mientras 28 de las 37 misiones vivas tienen proyecto, y sobre las 30 más
 * recientes «sin proyecto» aparece 2 veces contra 14 del proyecto principal.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import ToastProvider from '@shared/components/ToastProvider';
import { QuickAddForm } from '@modules/finance/components/shared/QuickAddForm';
import InstallmentAddForm from '@modules/finance/components/shared/InstallmentAddForm';
import QuickAdd from '@shared/components/QuickAdd';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/finance/styles/coinify.css';

// Las dos cuentas de la base real, con el id sembrado de «Efectivo» — que es
// exactamente el respaldo que la inferencia tiene que ganarle.
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

const PROJECTS = [
  { id: 'p1', name: 'Dardo', color: '#8b7355', order: 0, createdAt: '' },
  { id: 'p2', name: 'Whatsnap', color: '#6b7c5e', order: 1, createdAt: '' },
];

function stub(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, unknown> = {
    financeGetEntryDefaults: () => Promise.resolve(DEFAULTS),
    financeGetAccounts: () => Promise.resolve(ACCOUNTS),
    financeGetCategories: () => Promise.resolve(['Comida', 'Hogar', 'Otros', 'Transporte']),
    financeGetCategoryMappings: () => Promise.resolve([]),
    financeGetTransactions: () => Promise.resolve([]),
    financeGetCreditCards: () => Promise.resolve([]),
    dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
    questsGetProjects: () => Promise.resolve(PROJECTS),
    questsGetEntryDefaults: () => Promise.resolve({ projectId: 'p1', tier: 1, sampleSize: 30 }),
    ...overrides,
  };
  // `has` responde la verdad: los componentes hacen feature-detection con
  // `typeof api.x !== 'function'`, y un Proxy que siempre dice que sí volvería
  // intesteable el camino del binding viejo.
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

const wrap = (node: React.ReactNode) => render(<ToastProvider>{node}</ToastProvider>);

/** Escribe en un input CONTROLADO por React: `.value = x` solo no lo entera. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const paymentSelect = () => el<HTMLSelectElement>('select[aria-label="Medio de pago"]');
const accountSelect = () => el<HTMLSelectElement>('.coin-account-select');
const categoryInput = () => el<HTMLInputElement>('.coin-category-autocomplete__input');

beforeEach(() => {
  document.body.style.margin = '0';
  localStorage.clear();
  stub();
});

describe('Coinify — carga rápida', () => {
  test('aplica medio, moneda, cuenta y categoría, no sólo el medio', async () => {
    wrap(<QuickAddForm onSubmit={() => {}} />);
    await settle();

    expect(paymentSelect().value).toBe('transfer');
    // La cuenta inferida entra ANTES del respaldo genérico a «Efectivo».
    expect(accountSelect().value).toBe('a2');
    expect(categoryInput().value).toBe('Comida');

    // La moneda vive detrás de «Más opciones», pero ya viene aplicada.
    expect(document.querySelector('select[aria-label="ARS / USD"]')).toBeNull();
    el<HTMLButtonElement>('.coin-quick-add-form__toggle').click();
    await settle(100);
    expect(el<HTMLSelectElement>('select[aria-label="ARS / USD"]').value).toBe('USD');
  });

  test('lo recordado en el dispositivo le gana a la inferencia', async () => {
    localStorage.setItem('coinify_last_account_id', CASH);
    wrap(<QuickAddForm onSubmit={() => {}} />);
    await settle();
    expect(accountSelect().value).toBe(CASH);
  });

  test('el auto-sugerido por descripción le gana a la moda de la categoría', async () => {
    // Es más específico: sabe de ESTE gasto, no del promedio de todos.
    stub({ financeGetCategoryMappings: () => Promise.resolve([{ merchantPattern: 'YPF', category: 'Transporte' }]) });
    wrap(<QuickAddForm onSubmit={() => {}} />);
    await settle();
    expect(categoryInput().value).toBe('Comida');

    type(el<HTMLInputElement>('.coin-quick-add-form__row input[type="text"]'), 'Nafta YPF');
    await settle(100);
    expect(categoryInput().value).toBe('Transporte');
  });

  test('sin el canal (binding viejo) se comporta como antes', async () => {
    stub({ financeGetEntryDefaults: undefined });
    wrap(<QuickAddForm onSubmit={() => {}} />);
    await settle();
    // El fallback digital del propio formulario, y la categoría semilla.
    expect(paymentSelect().value).toBe('transfer');
    expect(categoryInput().value).toBe('Otros');
    // Y sin semilla, la cuenta cae en el respaldo de siempre.
    expect(accountSelect().value).toBe(CASH);
  });
});

describe('Coinify — plan en cuotas', () => {
  test('arranca en tarjeta, no en el débito que nunca se usó', async () => {
    wrap(<InstallmentAddForm onCreated={() => {}} />);
    await settle();
    expect(paymentSelect().value).toBe('credit_card');
    expect(categoryInput().value).toBe('Comida');
  });

  test('respeta un historial de planes que no son con tarjeta', async () => {
    stub({ financeGetEntryDefaults: () => Promise.resolve({ ...DEFAULTS, installmentPaymentMethod: 'transfer' }) });
    wrap(<InstallmentAddForm onCreated={() => {}} />);
    await settle();
    expect(paymentSelect().value).toBe('transfer');
    // Y con un plan que no es con tarjeta sí hay bolsillo del que sale la plata.
    expect(accountSelect().value).toBe('a2');
  });

  test('sin el canal (binding viejo) no revienta y usa su propio default', async () => {
    stub({ financeGetEntryDefaults: undefined });
    wrap(<InstallmentAddForm onCreated={() => {}} />);
    await settle();
    expect(paymentSelect().value).toBe('credit_card');
  });
});

describe('Questify — paleta rápida (Ctrl+K)', () => {
  const projectSelect = () => el<HTMLSelectElement>('.rpg-select');

  test('hereda el proyecto del historial en vez de crear misiones huérfanas', async () => {
    wrap(<QuickAdd onClose={() => {}} />);
    await settle();
    expect(projectSelect().value).toBe('p1');
    // Y la línea de confirmación lo dice, no lo aplica a escondidas.
    expect(document.body.textContent).toContain('#Dardo');
  });

  test('la elección del usuario le gana a la inferencia', async () => {
    wrap(<QuickAdd onClose={() => {}} />);
    await settle();
    const select = projectSelect();
    select.value = 'p2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(100);
    expect(projectSelect().value).toBe('p2');
  });

  test('sin el canal (binding viejo) sigue sin proyecto, como antes', async () => {
    stub({ questsGetEntryDefaults: undefined });
    wrap(<QuickAdd onClose={() => {}} />);
    await settle();
    expect(projectSelect().value).toBe('');
  });
});
