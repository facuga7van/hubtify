/**
 * Guarda de la cabecera del Tomo IV y del buscador del libro mayor.
 *
 * Nace de una captura del usuario (ventana angosta, barra lateral plegada):
 * «el título sale todo empujado a la izquierda por culpa de los botones y el
 * input de Buscar transacciones está pegado a la card de arriba».
 *
 * Lo que se medió ANTES de tocar nada, montando Tomo + Movimientos juntos y
 * leyendo `getBoundingClientRect()` (`.qb-header-extra` = «Importar resumen»
 * + chip del dólar + chip de cripto = 474 px que no encogen nunca):
 *
 *   ventana   .qb-header-text   renglones del título   hueco vertical
 *    1640          1094 px               1                 57 px
 *    1280           734 px               1                 57 px
 *     900           354 px               1 (bajada en 2)   81 px
 *     860           314 px               1 (bajada en 2)   81 px
 *     800           254 px               1 (bajada en 2)   81 px
 *     760           214 px               2 (epígrafe en 2) 152 px
 *
 * El «hueco vertical» es lo que sobra del bloque de título por debajo de unos
 * controles de 38 px de alto: no faltaba ancho, estaba mal repartido.
 *
 * Y el buscador: 0 px entre el borde inferior de la tarjeta de «Carga rápida»
 * y el borde superior del campo, a las seis anchuras.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import FinanceLayout from '@modules/finance/components/FinanceLayout';
import Transactions from '@modules/finance/components/Transactions';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

const CATS = ['Comida', 'Hogar', 'Transporte'];

const TX = Array.from({ length: 8 }, (_, i) => ({
  id: `t${i}`,
  type: 'expense',
  amount: 1_000 * (i + 1),
  currency: 'ARS',
  category: CATS[i % CATS.length],
  description: `Movimiento ${i + 1}`,
  date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  paymentMethod: 'cash',
  source: 'manual',
  impactsBalance: 1,
  accountId: 'a1',
}));

const RATES = [
  { casa: 'oficial', nombre: 'Oficial', compra: 1_180, venta: 1_240 },
  { casa: 'blue', nombre: 'Blue', compra: 1_425, venta: 1_545 },
];

const CRYPTO = [{
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin',
  current_price: 80_913, price_change_percentage_24h: 1.2, image: '',
}];

/** Los tres controles de la cabecera CARGADOS: vacíos no ocupan y no hay bug. */
function stub() {
  const handlers: Record<string, unknown> = {
    financeGetTransactions: () => Promise.resolve(TX),
    financeGetCategories: () => Promise.resolve(CATS),
    financeGetAccounts: () => Promise.resolve([{ id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 1, movements: 4 }]),
    financeGetCreditCards: () => Promise.resolve([]),
    financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
    financeGetMonthlyBalance: () => Promise.resolve({ ARS: { income: 0, expenses: 0, balance: 0 } }),
    financeGetCategoryAverages: () => Promise.resolve([]),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    financeGetImportBatches: () => Promise.resolve([]),
    dollarGetRates: () => Promise.resolve({ success: true, rates: RATES }),
    dollarGetVisibleTypes: () => Promise.resolve(['oficial', 'blue']),
    dollarGetFxHouse: () => Promise.resolve('blue'),
    cryptoGetRates: () => Promise.resolve({ success: true, rates: CRYPTO }),
    cryptoGetVisibleTypes: () => Promise.resolve(['bitcoin']),
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
  <MemoryRouter initialEntries={['/finance/transactions']}>
    <ToastProvider><ConfirmProvider>
      <Routes>
        <Route path="/finance" element={<FinanceLayout />}>
          <Route path="transactions" element={<Transactions />} />
        </Route>
      </Routes>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/** Renglones que ocupa un nodo de texto: alto / interlineado. */
function lines(node: Element): number {
  const cs = getComputedStyle(node);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  return Math.round(node.getBoundingClientRect().height / lh);
}

/** Ancho NATURAL del nodo, con una copia fuera de flujo a `max-content`. */
function maxContent(node: Element): number {
  const probe = node.cloneNode(true) as HTMLElement;
  probe.style.position = 'absolute';
  probe.style.left = '-9999px';
  probe.style.width = 'max-content';
  probe.style.maxWidth = 'none';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

/* Las anchuras donde el usuario lo vio (ventana angosta con la barra lateral
   plegada) más las dos de referencia del arnés. 700 es el `minWidth` que
   `electron/main.ts` le pone a la ventana: por debajo no se puede llegar. */
const ANCHOS: Array<[number, number]> = [
  [1640, 900], [1280, 900], [900, 760], [860, 760], [800, 760], [760, 640], [700, 650],
];

describe('Cabecera del Tomo IV: los controles ceden, el título no', () => {
  for (const [w, h] of ANCHOS) {
    test(`${w}×${h}: el título no lo aplasta la botonera`, async () => {
      stub();
      await page.viewport(w, h);
      wrap();
      await settle();

      const text = el('.qb-header-text');
      const extra = el('.qb-header-extra');
      const title = el('.qb-title');
      const eyebrow = el('.qb-eyebrow');

      // 1. El título de página y el epígrafe son rótulos, no prosa: cada uno
      //    entra en UN renglón. A 760 px el título salía en dos y el epígrafe
      //    también, con 214 px de columna.
      expect(lines(title), `«${title.textContent}» partido en renglones`).toBe(1);
      expect(lines(eyebrow), 'el epígrafe se parte').toBe(1);

      // 2. El bloque de título nunca recibe menos que su ancho natural: si no
      //    entra, quien se va a otro renglón es la botonera. Es la invariante
      //    de verdad, y no depende ni del idioma ni de cuántos chips haya.
      const natural = Math.max(maxContent(title), maxContent(eyebrow));
      expect(Math.round(text.getBoundingClientRect().width),
        `el bloque de título quedó por debajo de su ancho natural (${Math.round(natural)} px)`)
        .toBeGreaterThanOrEqual(Math.round(natural));

      // 3. Y el reparto no deja pergamino muerto: si el bloque de título es
      //    mucho más alto que unos controles de 38 px, es que los controles
      //    tendrían que haber bajado a su propio renglón en vez de comerle el
      //    ancho. Antes del arreglo esto medía 81 px a 900/860/800 y 152 a 760.
      const hueco = text.getBoundingClientRect().height - extra.getBoundingClientRect().height;
      const mismaFila = Math.abs(text.getBoundingClientRect().top - extra.getBoundingClientRect().top) < 4;
      if (mismaFila) {
        expect(Math.round(hueco),
          'los controles comparten renglón con el título y dejan un hueco vertical grande al lado')
          .toBeLessThanOrEqual(70);
      }

      // 4. Nada se sale de la página por la derecha.
      const headerBox = el('.qb-header').getBoundingClientRect();
      expect(extra.getBoundingClientRect().right).toBeLessThanOrEqual(headerBox.right + 1);
    });
  }

  test('860×900: captura de la cabecera repartida', async () => {
    stub();
    await page.viewport(860, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-book-header-860.png` });
    // A este ancho la botonera YA tiene que estar en su propio renglón.
    const text = el('.qb-header-text').getBoundingClientRect();
    const extra = el('.qb-header-extra').getBoundingClientRect();
    expect(extra.top, 'la botonera sigue robándole el renglón al título')
      .toBeGreaterThanOrEqual(text.bottom - 1);
  });
});

describe('Buscador del libro mayor: aire contra la tarjeta de arriba', () => {
  for (const [w, h] of ANCHOS) {
    test(`${w}×${h}: el campo no queda pegado a «Carga rápida»`, async () => {
      stub();
      await page.viewport(w, h);
      wrap();
      await settle();

      const form = el('.coin-quick-add-form');
      expect(form.className, 'este test necesita la tarjeta desplegada')
        .toContain('coin-quick-add-form--open');

      // Se busca por el CAMPO y se sube al contenedor, no por la clase: así la
      // guarda mide el hueco de verdad en vez de romperse por «no encontré
      // .coin-tx-search» si alguien renombra o saca la clase.
      const input = el<HTMLInputElement>('input[type="search"]');
      const search = input.closest('div')!;
      const gap = search.getBoundingClientRect().top - form.getBoundingClientRect().bottom;
      // Medía 0 px: el campo parecía un renglón más del formulario y no el
      // filtro del libro. El piso es el escalón de 12 px del sistema.
      expect(Math.round(gap), 'el buscador está pegado a la tarjeta de arriba')
        .toBeGreaterThanOrEqual(12);

      // El aire de abajo sigue existiendo (contra el encabezado de columnas).
      const header = el('.coin-ledger-header');
      expect(Math.round(header.getBoundingClientRect().top - search.getBoundingClientRect().bottom))
        .toBeGreaterThanOrEqual(6);

      // Y sigue ocupando el ancho del libro: el `width: 100%` que estaba
      // inline ahora lo pone `.coin-tx-search .rpg-input`.
      expect(Math.round(input.getBoundingClientRect().width))
        .toBe(Math.round(search.getBoundingClientRect().width));
    });
  }
});
