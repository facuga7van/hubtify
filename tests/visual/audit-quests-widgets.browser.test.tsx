import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import TasksDashboardWidget from '@modules/quests/components/TasksDashboardWidget';
import HabitsDashboardWidget from '@modules/quests/components/HabitsDashboardWidget';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/dashboard-layouts.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/modules/quests/styles/quests.css';

const SCREENS = 'screens';

/**
 * Los dos widgets del tablero viven en una tarjeta angosta de la grilla del
 * hub: una columna de ~300 px en la peor de las disposiciones. Es exactamente
 * el tamaño donde un nombre largo, una racha de tres dígitos y un contador
 * pelean por el mismo renglón.
 */

function iso(off: number, time?: string) {
  const d = new Date();
  d.setDate(d.getDate() + off);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${day}T${time}` : day;
}

type T = Record<string, unknown>;

const NOMBRE_LARGO =
  'Reorganizar el archivo completo de facturas del estudio antes de que cierre el balance';

const TASKS: T[] = [
  { id: 't1', name: 'Pagar el alquiler', tier: 3, status: false, dueDate: iso(-3), description: '', category: '', projectId: null, order: 0, completedAt: null, createdAt: '', updatedAt: '' },
  { id: 't2', name: NOMBRE_LARGO, tier: 2, status: false, dueDate: iso(0), description: '', category: '', projectId: null, order: 1, completedAt: null, createdAt: '', updatedAt: '' },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `f${i}`, name: `Misión de relleno ${i + 1}`, tier: 2, status: false,
    dueDate: iso(i), description: '', category: '', projectId: null, order: 10 + i,
    completedAt: null, createdAt: '', updatedAt: '',
  })),
];

const habit = (over: T): T => ({
  frequency: 'daily', timesPerWeek: 1, createdAt: '', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: true, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true, shieldCount: 0, shieldUsed: false,
  ...over,
});

const HABITS: T[] = [
  habit({ id: 'h1', name: 'Meditar', streak: 128, checkedToday: true, checksThisPeriod: 1 }),
  habit({ id: 'h2', name: 'Leer veinte páginas antes de dormir aunque sea de un libro que ya leí', streak: 7 }),
  ...Array.from({ length: 10 }, (_, i) => habit({ id: `hf${i}`, name: `Ritual ${i + 1}`, streak: i })),
];

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-1)';
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }

  const handlers: Record<string, unknown> = {
    questsGetTasks: () => Promise.resolve(TASKS),
    questsGetPendingCount: () => Promise.resolve(TASKS.length),
    questsGetCompletedTodayCount: () => Promise.resolve(3),
    questsGetHabits: () => Promise.resolve(HABITS),
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

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

/** La tarjeta real del tablero: un ancho fijo, como en la grilla del hub. */
const card = (node: React.ReactNode, width: number) => render(
  <MemoryRouter>
    <ToastProvider><ConfirmProvider>
      <div className="rpg-card" style={{ width, padding: 12 }}>{node}</div>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);

function el(sel: string): HTMLElement {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node as HTMLElement;
}

describe('Widgets del tablero — tarjeta angosta', () => {
  test('misiones: 300px, nombre largo y contador', async () => {
    await page.viewport(900, 700);
    card(<TasksDashboardWidget />, 300);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-w1-tareas-300.png` });

    const flow = el('.widget-list-flow');
    // Sin desborde horizontal: los nombres largos se cortan con puntos suspensivos.
    expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
    /* Vertical: la tarjeta angosta (una sola columna de la grilla auto-fill)
       necesita 260 px y el techo del hub es 155 (`max-height` en
       hub/styles/dashboard-layouts.css, fuera de este módulo). No es un techo
       múltiplo del alto de fila, así que la sexta queda partida al medio.
       Queda anotado con número, no arreglado desde acá. */
    const rowH = (flow.firstElementChild as HTMLElement).getBoundingClientRect().height;
    const cut = flow.clientHeight % rowH;
    console.log('[audit] widget tareas: alto', flow.scrollHeight, 'visible', flow.clientHeight,
      'fila', Math.round(rowH), 'sobra', Math.round(cut));
    expect(flow.scrollHeight).toBeGreaterThan(flow.clientHeight);
  });

  test('misiones: 560px (tarjeta ancha)', async () => {
    await page.viewport(900, 700);
    card(<TasksDashboardWidget />, 560);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-w2-tareas-560.png` });
    const flow = el('.widget-list-flow');
    expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
    // Con dos columnas de auto-fill las ocho misiones entran sin scroll: es la
    // forma normal de la tarjeta en la grilla de dos columnas del tablero.
    console.log('[audit] widget tareas 560: alto', flow.scrollHeight, 'visible', flow.clientHeight);
    expect(flow.scrollHeight).toBeLessThanOrEqual(flow.clientHeight + 1);
  });

  test('hábitos: racha de tres dígitos y nombre largo conviven', async () => {
    await page.viewport(900, 700);
    card(<HabitsDashboardWidget />, 300);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-w3-habitos-300.png` });

    const flow = el('.widget-list-flow');
    expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
    console.log('[audit] widget hábitos: alto', flow.scrollHeight, 'visible', flow.clientHeight);

    // La racha es un número: Fira Code, no un serif del sistema que no cargamos.
    const streak = [...document.querySelectorAll<HTMLElement>('.widget-list-flow span')]
      .find((s) => /^\s*128d\s*$/.test(s.textContent ?? ''));
    expect(streak).toBeTruthy();
    const font = getComputedStyle(streak!).fontFamily;
    console.log('[audit] fuente de la racha del widget:', font);
    expect(font).not.toMatch(/Cinzel/i);
  });
});
