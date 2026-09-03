import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import FinanceLayout from '@modules/finance/components/FinanceLayout';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const SCREENS = 'screens';

/** Las pestañas del Libro del Tesorero y el chip de cotización, abiertos. */

const RATES = [
  { casa: 'oficial', nombre: 'Oficial', compra: 1_180, venta: 1_240 },
  { casa: 'blue', nombre: 'Blue', compra: 1_425, venta: 1_465 },
  { casa: 'bolsa', nombre: 'Bolsa (MEP)', compra: 1_398, venta: 1_412 },
  { casa: 'cripto', nombre: 'Cripto', compra: 1_440, venta: 1_478 },
  { casa: 'tarjeta', nombre: 'Tarjeta', compra: 0, venta: 1_612 },
  { casa: 'contadoconliqui', nombre: 'Contado con liquidación', compra: 1_402, venta: 1_431 },
  { casa: 'mayorista', nombre: 'Mayorista', compra: 1_175, venta: 1_182 },
];

function stub() {
  const handlers: Record<string, unknown> = {
    dollarGetRates: () => Promise.resolve({ success: true, rates: RATES }),
    dollarGetVisibleTypes: () => Promise.resolve(['oficial', 'blue', 'bolsa', 'cripto']),
    dollarSetVisibleTypes: () => Promise.resolve(true),
    dollarGetFxHouse: () => Promise.resolve('blue'),
    dollarSetFxHouse: () => Promise.resolve(true),
    financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
    cryptoGetRates: () => Promise.resolve({ success: false, rates: [] }),
    cryptoGetVisibleTypes: () => Promise.resolve([]),
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
  <MemoryRouter initialEntries={['/finance']}>
    <ToastProvider><ConfirmProvider>
      <Routes>
        <Route path="/finance" element={<FinanceLayout />}>
          <Route index element={<div style={{ height: 200 }} />} />
        </Route>
      </Routes>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

describe('Libro del Tesorero — pestañas y chip', () => {
  test('1640×900: las tres pestañas entran en un renglón', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-layout-01-1640.png` });

    const tops = [...document.querySelectorAll('.coin-tab-link')]
      .map((n) => Math.round(n.getBoundingClientRect().top));
    // Eran seis, para alguien que usaba dos. Cuotas, Recurrentes, Tarjetas y
    // Préstamos viven ahora dentro de «Compromisos».
    expect(tops).toHaveLength(3);
    expect(new Set(tops).size, 'las pestañas se parten en dos renglones').toBe(1);
    const nav = el('.coin-tab-nav-wrap');
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth + 1);
  });

  test('760×640: la tira de pestañas entra y no desborda la página', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-layout-02-760.png` });
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
    // Con tres pestañas la tira entra sin scrollear ni a 760 px.
    const nav = el('.coin-tab-nav');
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth + 1);
  });

  test('el chip del dólar abre su menú dentro de la ventana', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    el<HTMLButtonElement>('.coin-mode-chip__menu-btn').click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-layout-03-chip.png` });

    const menu = el('.coin-dollar-menu');
    const r = menu.getBoundingClientRect();
    expect(r.right, 'el menú se sale por la derecha').toBeLessThanOrEqual(window.innerWidth + 1);
    expect(r.left).toBeGreaterThanOrEqual(-1);
    expect(menu.textContent).not.toMatch(/coinify\.[a-zA-Z]/);
    // Cada fila muestra nombre y valor sin pisarse.
    for (const row of menu.querySelectorAll('.coin-dollar-menu__row')) {
      const label = row.querySelector('.coin-dollar-menu__rate-label');
      const value = row.querySelector('.coin-dollar-menu__rate-value');
      if (!label || !value) continue;
      expect(value.getBoundingClientRect().left)
        .toBeGreaterThanOrEqual(label.getBoundingClientRect().right - 1);
    }
  });

  test('el selector de casa (rueda dentada) abre y sus controles tienen rótulo', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap();
    await settle();
    el<HTMLButtonElement>('.coin-mode-chip__menu-btn').click();
    await settle(250);
    el<HTMLButtonElement>('.coin-dollar-menu__config-btn').click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-coin-layout-04-casas.png` });

    const picks = [...document.querySelectorAll('.coin-fx-house-pick')];
    expect(picks.length).toBe(RATES.length);
    for (const p of picks) {
      expect(p.getAttribute('aria-label'), 'el rombo de casa no dice qué hace').toBeTruthy();
      expect(p.getAttribute('aria-pressed')).toBeTruthy();
    }
    // La casilla de visibilidad lleva la tinta del códice, no el azul del sistema.
    const box = el<HTMLInputElement>('.coin-dollar-menu input[type="checkbox"]');
    expect(getComputedStyle(box).accentColor.toLowerCase()).not.toBe('auto');

    // La casa elegida se distingue por fondo, no sólo por un rombo casi igual.
    const active = el('.coin-fx-house-pick--active');
    expect(getComputedStyle(active).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    const inactive = document.querySelector('.coin-fx-house-pick:not(.coin-fx-house-pick--active)')!;
    expect(getComputedStyle(inactive).backgroundColor)
      .not.toBe(getComputedStyle(active).backgroundColor);
  });

  test('el chip a 760×640 no empuja el menú fuera de la ventana', async () => {
    stub();
    await page.viewport(760, 640);
    wrap();
    await settle();
    el<HTMLButtonElement>('.coin-mode-chip__menu-btn').click();
    await settle(300);
    await page.screenshot({ path: `${SCREENS}/audit-coin-layout-05-chip-760.png` });
    const r = el('.coin-dollar-menu').getBoundingClientRect();
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(r.left).toBeGreaterThanOrEqual(-1);
  });
});
