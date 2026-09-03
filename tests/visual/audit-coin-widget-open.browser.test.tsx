/**
 * El widget de Coinify con el formulario ABIERTO.
 *
 * Las tres mediciones anteriores de la rúbrica midieron sólo el estado POR
 * DEFECTO de cada pantalla, y por eso nunca vieron lo que está plegado o detrás
 * de un toque. La carga rápida del widget vive plegada: al abrirla, «Ingreso»
 * —habilitado— daba 3.62:1, porque `.coin-dash-quick__type-btn` le encimaba un
 * `opacity: .5` al `--gold-light` sobre `--leather` de `.rpg-button`.
 *
 * Este arnés abre TODO lo que el formulario esconde —el par Gasto/Ingreso en
 * sus dos estados, la lista de categorías— y mide ahí. Y comprueba que el
 * selector de categorías sobrevive a un puente caído: su `.then()` sin `.catch()`
 * levantaba «TypeError: Cannot read properties of null (reading 'filter')».
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { ModuleCard } from '@shared/components/codex';
import DashboardWidget from '@modules/finance/components/DashboardWidget';
import {
  installApi, SCREENS, WIDE, lowContrastText, smallText, PARCH_WORST, describe as describeEl,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/dashboard-layouts.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/finance/styles/coinify.css';

const CATEGORIES = ['Comida', 'Hogar', 'Transporte', 'Salud', 'Ocio'];

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Promesas rechazadas sin dueño durante el test: el síntoma del `.then()` pelado. */
const unhandled: string[] = [];
const onUnhandled = (e: PromiseRejectionEvent) => {
  e.preventDefault();
  unhandled.push(String((e.reason as Error)?.message ?? e.reason));
};

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  unhandled.length = 0;
  window.addEventListener('unhandledrejection', onUnhandled);
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onUnhandled);
});

function mount(extra: Record<string, unknown> = {}) {
  installApi({ financeGetCategories: () => Promise.resolve([...CATEGORIES]), ...extra });
  return render(
    <MemoryRouter>
      <ToastProvider><ConfirmProvider>
        {/* El mismo envoltorio que le pone el tablero: `ModuleCard` dentro de
            `.widget-wrapper`, que es de donde sale el pergamino que hay debajo
            del texto. Medir contra el fondo de la página daría otro número. */}
        <div className="dashboard-grid" style={{ padding: 24, maxWidth: 520 }}>
          <div className="widget-wrapper widget-span-2">
            <ModuleCard title="Bolsa" tome="Coinify"><DashboardWidget /></ModuleCard>
          </div>
        </div>
      </ConfirmProvider></ToastProvider>
    </MemoryRouter>,
  );
}

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/**
 * Contraste de lo que el usuario PUEDE usar.
 *
 * WCAG exceptúa explícitamente los controles DESHABILITADOS: «Registrar» nace
 * con `disabled` hasta que hay monto, y su 3.09:1 no es un defecto —el que sí
 * lo era es «Ingreso», habilitado—. Se los saca del árbol mientras dura la
 * medición y se los devuelve a su lugar exacto con un comentario-marcador.
 */
function lowContrastEnabled(root: HTMLElement) {
  const parked = [...root.querySelectorAll<HTMLElement>(':disabled')].map((node) => {
    const mark = document.createComment('disabled');
    node.replaceWith(mark);
    return { node, mark };
  });
  try {
    return lowContrastText(root, PARCH_WORST);
  } finally {
    parked.forEach(({ node, mark }) => mark.replaceWith(node));
  }
}

async function openQuickAdd() {
  el<HTMLButtonElement>('.coin-dash-quick__toggle').click();
  await settle(300);
  return el<HTMLElement>('.coin-dash-quick');
}

describe('Carga rápida del widget de Coinify — estado ABIERTO', () => {
  test('el formulario abierto no esconde ni un texto por debajo de AA', async () => {
    await page.viewport(...WIDE);
    mount();
    await settle();
    const form = await openQuickAdd();
    await page.screenshot({ path: `${SCREENS}/audit-coin-widget-01-abierto.png` });

    const bad = lowContrastEnabled(form);
    expect(bad, `bajo contraste al abrir: ${JSON.stringify(bad)}`).toEqual([]);
  });

  test('«Ingreso» elegido —el otro estado del mismo par— también cumple AA', async () => {
    await page.viewport(...WIDE);
    mount();
    await settle();
    const form = await openQuickAdd();

    const income = [...form.querySelectorAll<HTMLButtonElement>('.coin-dash-quick__type-btn')][1];
    expect(income.textContent).toMatch(/Ingreso/i);
    income.click();
    await settle(300);
    expect(income.className).toContain('--active-income');
    await page.screenshot({ path: `${SCREENS}/audit-coin-widget-02-ingreso.png` });

    const bad = lowContrastEnabled(form);
    expect(bad, `bajo contraste con «Ingreso» elegido: ${JSON.stringify(bad)}`).toEqual([]);
  });

  test('el par no se apaga con opacidad: los dos rótulos se leen enteros', async () => {
    await page.viewport(...WIDE);
    mount();
    await settle();
    const form = await openQuickAdd();

    for (const btn of form.querySelectorAll<HTMLButtonElement>('.coin-dash-quick__type-btn')) {
      expect(parseFloat(getComputedStyle(btn).opacity), `${describeEl(btn)} sigue apagado con opacity`)
        .toBe(1);
    }
  });

  test('la lista de categorías —otro estado plegado— se lee al desplegarse', async () => {
    await page.viewport(...WIDE);
    mount();
    await settle();
    await openQuickAdd();

    el<HTMLInputElement>('.coin-category-autocomplete__input').focus();
    await settle(300);
    const drop = el<HTMLElement>('.coin-category-autocomplete__dropdown');
    expect(drop.querySelectorAll('.coin-category-autocomplete__option').length).toBe(CATEGORIES.length);
    await page.screenshot({ path: `${SCREENS}/audit-coin-widget-03-categorias.png` });

    const bad = lowContrastEnabled(drop);
    expect(bad, `bajo contraste en la lista: ${JSON.stringify(bad)}`).toEqual([]);
  });

  test('ningún texto del formulario abierto baja del piso de 13 px', async () => {
    await page.viewport(...WIDE);
    mount();
    await settle();
    const form = await openQuickAdd();
    const tiny = smallText(form);
    expect(tiny, `texto por debajo de --fs-label: ${JSON.stringify(tiny)}`).toEqual([]);
  });
});

describe('El selector de categorías con el puente caído', () => {
  test('un rechazo no deja una promesa sin dueño ni rompe el formulario', async () => {
    await page.viewport(...WIDE);
    mount({ financeGetCategories: () => Promise.reject(new Error('bridge down')) });
    await settle();
    const form = await openQuickAdd();

    expect(unhandled, `promesas rechazadas sin manejar: ${unhandled.join(' · ')}`).toEqual([]);
    // El campo sigue en pie y se puede escribir a mano: degradar no es desaparecer.
    expect(form.querySelector('.coin-category-autocomplete__input')).toBeTruthy();
    // Y el fallo se DICE, con el aviso que ya usa el resto del módulo.
    expect(document.querySelector('.system-toast-container')?.textContent ?? '')
      .toMatch(/Error al cargar/i);
  });

  test('una respuesta nula (binding viejo) tampoco tira TypeError', async () => {
    await page.viewport(...WIDE);
    // Es el caso REAL que levantó el arnés: el stub permisivo devuelve `null` y
    // `cats.filter` reventaba DENTRO del `.then()`.
    mount({ financeGetCategories: () => Promise.resolve(null) });
    await settle();
    const form = await openQuickAdd();

    expect(unhandled, `promesas rechazadas sin manejar: ${unhandled.join(' · ')}`).toEqual([]);
    el<HTMLInputElement>('.coin-category-autocomplete__input').focus();
    await settle(300);
    // Sin categorías, la lista dice que no hay nada; no se queda a medio dibujar.
    expect(form.querySelectorAll('.coin-category-autocomplete__option').length).toBe(0);
    expect(document.querySelector('.coin-category-autocomplete__empty')).toBeTruthy();
  });
});
