import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import TaskList from '@modules/quests/components/TaskList';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/quests/styles/quests.css';

const SCREENS = 'screens';

/**
 * Iteración 2 — los tres ítems de la rúbrica que eran JSX y no CSS:
 *
 *  · Ítem 8  (C3 esc. 7→8): «Hoy» tenía DOS ejes a 1640 —la tira de pestañas
 *    arrancaba en x≈20 y la lista en x≈265— y «Agregar Quest» quedaba centrado
 *    mientras el resto de la página iba a la izquierda.
 *  · Ítem 11 (C8 5→7): el vacío sin filtros era un string pelado flotando en
 *    770×400, con el botón al que apuntaba fuera del hueco.
 *  · Ítem 20 (C7 5→7): dos cuadrados con tilde en la misma fila, en los mismos
 *    colores. Completar y seleccionar-para-lote se leían como duplicados.
 */

type T = Record<string, unknown>;

function iso(offsetDays: number, time?: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${day}T${time}` : day;
}

const baseTask = (over: T): T => ({
  description: '', status: false, category: '', projectId: null, dueDate: null,
  order: 0, completedAt: null, repeatRule: null, repeatOf: null,
  createdAt: '2026-08-01', updatedAt: '2026-08-01', tier: 2, ...over,
});

const TASKS: T[] = [
  baseTask({ id: 't1', name: 'Pagar el alquiler', tier: 3, dueDate: iso(-3), category: 'Hogar', order: 0 }),
  baseTask({ id: 't2', name: 'Llamar al contador', tier: 2, dueDate: iso(0, '16:00'), order: 1 }),
  baseTask({ id: 't3', name: 'Entrenar', tier: 1, dueDate: iso(0, '07:30'), category: 'Salud', order: 2 }),
  baseTask({ id: 't4', name: 'Idea suelta sin fecha', tier: 2, order: 3 }),
  baseTask({ id: 'tc1', name: 'Mandar el presupuesto', tier: 3, status: true, completedAt: iso(0, '11:00'), order: 4 }),
];

const habit = (over: T): T => ({
  frequency: 'daily', timesPerWeek: 1, createdAt: '2026-01-01', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: true, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true, shieldCount: 0, shieldUsed: false,
  ...over,
});

const HABITS: T[] = [
  habit({ id: 'h1', name: 'Meditar', streak: 12, checkedToday: true, checksThisPeriod: 1, pendingToday: false }),
  habit({ id: 'h2', name: 'Escribir el diario', streak: 3 }),
];

let tasksNow: T[] = TASKS;
let habitsNow: T[] = HABITS;

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }

  const handlers: Record<string, unknown> = {
    questsGetTasks: () => Promise.resolve(tasksNow),
    questsGetProjects: () => Promise.resolve([]),
    questsGetAllDrawingCounts: () => Promise.resolve([]),
    questsGetSubtasks: () => Promise.resolve([]),
    questsGetHabits: () => Promise.resolve(habitsNow),
    questsGetCategories: () => Promise.resolve(['Hogar', 'Salud']),
    questsGetHabitHeatmap: () => Promise.resolve({ days: [], totalHabits: 0 }),
    questsGetPendingCount: () => Promise.resolve(4),
    questsGetCompletedTodayCount: () => Promise.resolve(1),
    cauldronGetPresets: () => Promise.resolve([]),
    processRpgEvent: () => Promise.resolve({ xpGained: 15, bonusMultiplier: 1, comboMultiplier: 1, milestoneXp: 0 }),
  };
  (window as unknown as { api: unknown }).api = new Proxy(handlers, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
});

beforeEach(() => {
  tasksNow = TASKS;
  habitsNow = HABITS;
  try { localStorage.removeItem('questify_collapsed_projects'); } catch { /* ignore */ }
});

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const mount = () => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <TaskList />
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

function el(sel: string): HTMLElement {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node as HTMLElement;
}

function all(sel: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(sel)];
}

/** Color real de un token, resuelto con una sonda en el DOM. */
function tokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  probe.style.position = 'absolute';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

async function goTab(name: RegExp) {
  await page.getByRole('tab', { name }).click();
  await settle(250);
}

/* ══ ÍTEM 8 — un solo eje en «Hoy», y el alta en el encabezado ══ */

describe('Questify «Hoy» — un solo eje a 1640', () => {
  test('la tira de pestañas y la lista arrancan en la misma x', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-iter2-01-hoy-1640.png` });

    const tabs = el('.quest-tab-bar').getBoundingClientRect();
    const lista = el('.quest-columns--single').getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('[iter2] eje pestañas:', Math.round(tabs.left), '· eje lista:', Math.round(lista.left),
      '· desvío:', Math.round(Math.abs(tabs.left - lista.left)));
    expect(Math.abs(tabs.left - lista.left)).toBeLessThanOrEqual(1);
    // …y el mismo borde derecho: un eje compartido no es sólo el arranque.
    expect(Math.abs(tabs.right - lista.right)).toBeLessThanOrEqual(1);
  });

  test('la tira de stats comparte el eje de la lista en «Hoy»', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    const strip = el('.quest-stats-strip').getBoundingClientRect();
    const lista = el('.quest-columns--single').getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('[iter2] eje stats:', Math.round(strip.left), '· eje lista:', Math.round(lista.left));
    expect(Math.abs(strip.left - lista.left)).toBeLessThanOrEqual(1);
  });

  test('«Pendientes» sigue usando todo el ancho (dos columnas)', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const cols = el('.quest-columns').getBoundingClientRect();
    const tabs = el('.quest-tab-bar').getBoundingClientRect();
    expect(document.querySelector('.quest-columns--single')).toBeNull();
    expect(Math.abs(tabs.left - cols.left)).toBeLessThanOrEqual(1);
    expect(cols.width).toBeGreaterThan(1100);
  });

  test('«Agregar Quest» vive en el encabezado, a la derecha', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    const btn = el('.quest-add-toggle');
    expect(btn.closest('.qb-header-extra')).not.toBeNull();
    const texto = el('.qb-header-text').getBoundingClientRect();
    const caja = btn.getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('[iter2] botón alta: left', Math.round(caja.left), '· fin del título', Math.round(texto.right));
    expect(caja.left).toBeGreaterThanOrEqual(texto.right - 1);
  });

  test('el botón sigue siendo un toggle: rótulo, ícono y formulario', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    const btn = el('.quest-add-toggle');
    expect(btn.className).not.toMatch(/quest-add-toggle--active/);
    expect(el('.quest-form-wrapper').hasAttribute('inert')).toBe(true);
    // Cerrado: la cruz (dos trazos). Abierto: el guión (uno solo).
    expect(btn.querySelectorAll('svg path').length).toBe(2);

    btn.click();
    await settle(400);
    expect(el('.quest-add-toggle').className).toMatch(/quest-add-toggle--active/);
    expect(el('.quest-form-wrapper').className).toMatch(/quest-form-wrapper--open/);
    expect(el('.quest-form-wrapper').hasAttribute('inert')).toBe(false);
    expect(el('.quest-add-toggle').querySelectorAll('svg path').length).toBe(1);

    el('.quest-add-toggle').click();
    await settle(400);
    expect(el('.quest-form-wrapper').hasAttribute('inert')).toBe(true);
  });

  test('760px: el eje sigue siendo uno y nada se desborda', async () => {
    await page.viewport(760, 640);
    mount();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-iter2-02-hoy-760.png` });
    const tabs = el('.quest-tab-bar').getBoundingClientRect();
    const lista = el('.quest-columns--single').getBoundingClientRect();
    expect(Math.abs(tabs.left - lista.left)).toBeLessThanOrEqual(1);
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});

/* ══ ÍTEM 11 — el hueco explica y ofrece salida ══ */

describe('Questify — el estado vacío', () => {
  test('sin filtros: ícono + frase + botón, los tres DENTRO del hueco', async () => {
    tasksNow = [];
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-iter2-03-vacio.png` });

    const empty = el('.quest-empty');
    const icono = empty.querySelector('svg');
    const cta = empty.querySelector('button');
    expect(icono, 'el vacío no tiene ícono del módulo').not.toBeNull();
    expect(cta, 'el vacío no ofrece salida').not.toBeNull();

    const hueco = empty.getBoundingClientRect();
    const boton = cta!.getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.log('[iter2] vacío:', Math.round(hueco.width), 'x', Math.round(hueco.height),
      '· botón adentro, a', Math.round(boton.top - hueco.top), 'px del borde superior');
    expect(boton.top).toBeGreaterThanOrEqual(hueco.top);
    expect(boton.bottom).toBeLessThanOrEqual(hueco.bottom + 1);
    expect(boton.left).toBeGreaterThanOrEqual(hueco.left);
  });

  test('el botón del vacío abre el formulario de alta (no navega)', async () => {
    tasksNow = [];
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    (el('.quest-empty button') as HTMLButtonElement).click();
    await settle(500);
    expect(el('.quest-form-wrapper').className).toMatch(/quest-form-wrapper--open/);
    expect(el('.quest-form-wrapper').hasAttribute('inert')).toBe(false);
  });

  test('con filtros: sigue siendo «Limpiar filtros», sin robar el foco', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const buscar = el('.quest-search-input') as HTMLInputElement;
    // React lleva su propio rastreador de `value`: escribir la propiedad a mano
    // y disparar `input` no alcanza, hay que pasar por el setter nativo.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(buscar, 'zzzz-no-existe');
    buscar.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(300);
    const limpiar = el('.quest-empty button');
    expect(limpiar.textContent).toMatch(/Limpiar filtros/i);
    limpiar.focus();
    expect(document.activeElement).toBe(limpiar);
  });

  test('los rituales usan el mismo vacío que las misiones', async () => {
    habitsNow = [];
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const vacios = all('.quest-empty');
    const ritual = vacios.find((v) => /ritual|hábito|habito/i.test(v.textContent ?? ''));
    expect(ritual, `vacíos encontrados: ${vacios.map((v) => v.textContent).join(' | ')}`).toBeTruthy();
    expect(ritual!.querySelector('svg')).not.toBeNull();
    expect(ritual!.querySelector('button')).not.toBeNull();
  });
});

/* ══ ÍTEM 20 — una sola caja de completar por fila ══ */

describe('Questify — completar ≠ seleccionar', () => {
  test('el control de lote no es un segundo cuadrado con tilde', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const select = all('.quest-row-select')[0];
    expect(select).toBeTruthy();
    const svg = select.querySelector('svg')!;
    expect(svg.querySelector('rect'), 'sigue siendo un cuadrado').toBeNull();
    expect(svg.querySelector('circle'), 'no tiene la forma redonda de selección').not.toBeNull();

    // …y tampoco comparte el rojo con el que la fila dice «completada».
    const cs = getComputedStyle(svg);
    const rubric = tokenColor('--rubric');
    // eslint-disable-next-line no-console
    console.log('[iter2] lote en reposo — stroke:', cs.stroke, '· fill:', cs.fill, '· rubric:', rubric);
    expect(cs.stroke).not.toBe(rubric);
    expect(cs.fill).toBe('none');
  });

  test('seleccionado: se llena en oro, no se tilda en rojo', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const select = all('.quest-row-select')[0];
    expect(select.getAttribute('role')).toBe('checkbox');
    expect(select.getAttribute('aria-checked')).toBe('false');
    expect(select.getAttribute('aria-label')).toBeTruthy();

    select.click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-iter2-04-lote.png` });

    const marcado = all('.quest-row-select')[0];
    expect(marcado.getAttribute('aria-checked')).toBe('true');
    const cs = getComputedStyle(marcado.querySelector('svg')!);
    // eslint-disable-next-line no-console
    console.log('[iter2] lote marcado — stroke:', cs.stroke, '· fill:', cs.fill);
    expect(cs.fill).not.toBe('none');
    expect(cs.fill).toBe(tokenColor('--gold'));
    expect(cs.fill).not.toBe(tokenColor('--rubric'));

    // La barra de acciones de lote sigue apareciendo.
    const lote = all('.quest-tab-bar .qb-rune').map((b) => b.textContent ?? '');
    expect(lote.join('|')).toMatch(/\(1\)/);
  });

  test('las filas completadas tampoco muestran dos tildes iguales', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Completadas$|^Completed$/i);
    const fila = el('.quest-row--done');
    const select = fila.querySelector('.quest-row-select svg')!;
    expect(select.querySelector('rect')).toBeNull();
    expect(select.querySelector('circle')).not.toBeNull();
  });
});
