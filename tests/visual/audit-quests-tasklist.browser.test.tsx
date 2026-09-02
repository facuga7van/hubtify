import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import TaskList from '@modules/quests/components/TaskList';
import { smallText, tokenPx } from './audit-hub-harness';

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
 * Auditoría visual de Questify a los dos tamaños que la app permite de verdad:
 * maximizada (1640x900) y el mínimo (760x640, `minWidth:700/minHeight:650` en
 * electron/main.ts). Lo nuevo de hoy —repetición, escudos, saltear, heatmap por
 * hábito, «Enfocar en el Caldero»— no lo miró nadie a pantalla completa.
 */

const TITLE_LARGO =
  'Reorganizar el archivo completo de facturas del estudio, ordenarlas por proveedor y por mes, ' +
  'y despues escanear las que faltan del ejercicio anterior antes de que cierre el balance';

const PROJECTS = [
  { id: 'p1', name: 'Hubtify', color: '#8b7355', order: 0, createdAt: '2026-01-01' },
  {
    id: 'p2',
    name: 'Reforma integral de la cocina y el lavadero del departamento de la calle Rivadavia',
    color: '#6b7c5e', order: 1, createdAt: '2026-01-01',
  },
];

function iso(offsetDays: number, time?: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${day}T${time}` : day;
}

type T = Record<string, unknown>;

const baseTask = (over: T): T => ({
  description: '', status: false, category: '', projectId: null, dueDate: null,
  order: 0, completedAt: null, repeatRule: null, repeatOf: null,
  createdAt: '2026-08-01', updatedAt: '2026-08-01', tier: 2, ...over,
});

const TASKS: T[] = [
  baseTask({ id: 't1', name: 'Pagar el alquiler', tier: 3, dueDate: iso(-3), category: 'Hogar', order: 0 }),
  baseTask({ id: 't2', name: TITLE_LARGO, tier: 2, dueDate: iso(-1), category: 'Trabajo', projectId: 'p2', order: 1 }),
  baseTask({
    id: 't3', name: 'Entrenar', tier: 1, dueDate: iso(0, '07:30'), category: 'Salud',
    repeatRule: '{"freq":"days","days":[1,3,5]}', order: 2,
    description: 'Rutina de fuerza: sentadilla, banco, remo. 45 minutos.',
  }),
  baseTask({ id: 't4', name: 'Llamar al contador', tier: 2, dueDate: iso(0, '16:00'), projectId: 'p1', order: 3 }),
  baseTask({
    id: 't5', name: 'Revisar el backlog de Hubtify', tier: 2, dueDate: iso(2), projectId: 'p1',
    category: 'Trabajo', repeatRule: '{"freq":"weekly"}', order: 4,
  }),
  baseTask({ id: 't6', name: 'Comprar tornillos', tier: 1, dueDate: iso(4), projectId: 'p2', order: 5 }),
  baseTask({ id: 't7', name: 'Leer el capítulo 4', tier: 1, dueDate: iso(20), order: 6 }),
  baseTask({ id: 't8', name: 'Idea suelta sin fecha', tier: 2, order: 7 }),
  baseTask({
    id: 't9', name: 'Backup mensual del servidor', tier: 3, repeatRule: '{"freq":"monthly"}',
    dueDate: iso(9), order: 8, category: 'Trabajo',
  }),
  baseTask({
    id: 'tc1', name: 'Mandar el presupuesto', tier: 3, status: true,
    completedAt: iso(0, '11:00'), projectId: 'p1', order: 9,
  }),
  baseTask({
    id: 'tc2', name: TITLE_LARGO, tier: 1, status: true, completedAt: iso(-1, '19:00'), order: 10,
  }),
];

/** 30 misiones + las de arriba: el caso «lista larga». */
const MANY: T[] = [
  ...TASKS,
  ...Array.from({ length: 30 }, (_, i) => baseTask({
    id: `m${i}`, name: `Misión de relleno número ${i + 1}`, tier: ((i % 3) + 1),
    dueDate: iso((i % 9) - 2), order: 100 + i, category: i % 2 ? 'Trabajo' : '',
    projectId: i % 3 === 0 ? 'p1' : null,
  })),
];

const habit = (over: T): T => ({
  frequency: 'daily', timesPerWeek: 1, createdAt: '2026-01-01', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: true, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true, shieldCount: 0, shieldUsed: false,
  ...over,
});

const HABITS: T[] = [
  habit({ id: 'h1', name: 'Meditar', streak: 128, checkedToday: true, checksThisPeriod: 1, pendingToday: false, shieldCount: 3 }),
  habit({ id: 'h2', name: 'Gimnasio', frequency: 'weekly', timesPerWeek: 3, specificDays: [1, 3, 5], streak: 12, checksThisPeriod: 2, targetThisPeriod: 3, shieldUsed: true }),
  habit({ id: 'h3', name: 'Leer veinte páginas antes de dormir aunque sea de un libro que ya leí', streak: 4, shieldCount: 1 }),
  habit({ id: 'h4', name: 'Escribir el diario', skippedToday: true, streak: 9, pendingToday: false }),
  habit({ id: 'h5', name: 'Estirar', frequency: 'monthly', timesPerWeek: 1, checksThisPeriod: 3, targetThisPeriod: 8, streak: 2, checkedYesterday: false }),
];

const SUBTASKS: T[] = [
  { id: 's1', taskId: 't2', name: 'Separar por proveedor', description: '', tier: 1, status: false, order: 0, completedAt: null },
  { id: 's2', taskId: 't2', name: 'Escanear las de julio', description: '', tier: 2, status: false, order: 1, completedAt: null },
  { id: 's3', taskId: 't2', name: 'Subir al drive', description: '', tier: 1, status: true, order: 2, completedAt: iso(-1) },
];

const HEATMAP_DAYS = Array.from({ length: 30 }, (_, i) => ({
  date: iso(i - 29), count: i % 4, skipCount: i % 7 === 0 ? 1 : 0,
}));

/** El backend devuelve exactamente los dias que le piden: el stub tambien. */
const historyDays = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: iso(i - (n - 1)), checked: i % 3 !== 0,
}));
let historyAsked = 0;

let tasksNow: T[] = TASKS;

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }

  const handlers: Record<string, unknown> = {
    questsGetTasks: () => Promise.resolve(tasksNow),
    questsGetProjects: () => Promise.resolve(PROJECTS),
    questsGetAllDrawingCounts: () => Promise.resolve([{ task_id: 't1', count: 2 }]),
    questsGetDrawings: () => Promise.resolve([
      { id: 'd1', taskId: 't1', data: '', createdAt: iso(-2) },
      { id: 'd2', taskId: 't1', data: '', createdAt: iso(-1) },
    ]),
    questsGetSubtasks: (id: string) => Promise.resolve(SUBTASKS.filter((s) => s.taskId === id)),
    questsGetHabits: () => Promise.resolve(HABITS),
    questsGetCategories: () => Promise.resolve(['Hogar', 'Trabajo', 'Salud']),
    questsGetHabitHeatmap: () => Promise.resolve({ days: HEATMAP_DAYS, totalHabits: 5 }),
    questsGetHabitHistory: (_id: string, days = 91) => {
      historyAsked = days;
      return Promise.resolve({ days: historyDays(days), bestStreak: 41 });
    },
    questsGetPendingCount: () => Promise.resolve(9),
    questsGetCompletedTodayCount: () => Promise.resolve(2),
    cauldronGetPresets: () => Promise.resolve([{ id: 'cp1', name: 'Clásico', focusMin: 25, quickStart: 1 }]),
    // Presente ⇒ isTaskLinkWired() true ⇒ el ítem «Enfocar en el Caldero» se dibuja.
    cauldronSetSessionTask: () => Promise.resolve(true),
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

/** Cada nodo con texto que se sale de su caja a lo ancho. */
function clipped(root: ParentNode = document): string[] {
  const bad: string[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'hidden' && style.textOverflow !== 'ellipsis') {
        bad.push(`${node.className || node.tagName} (${node.scrollWidth} > ${node.clientWidth})`);
      }
    }
  }
  return bad;
}

async function goTab(name: RegExp) {
  await page.getByRole('tab', { name }).click();
  await settle(200);
}

describe('Questify — la lista a pantalla completa', () => {
  test('1640x900: pendientes, agrupadas por vencimiento', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-01-pendientes-1640.png` });

    // Nada se desborda a lo ancho.
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
    for (const row of all('.quest-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test('1640x900: la fila NO se estira dejando un desierto entre título y XP', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    // El título termina y el bloque de XP arranca: el hueco tiene que ser
    // legible de un salto de ojo, no medio metro de pergamino.
    const gaps: number[] = [];
    for (const row of all('.quest-row')) {
      const title = row.querySelector('.quest-row-title');
      const xp = row.querySelector('.quest-row-xp');
      if (!title || !xp) continue;
      gaps.push(xp.getBoundingClientRect().left - title.getBoundingClientRect().right);
    }
    expect(gaps.length).toBeGreaterThan(0);
    const worst = Math.max(...gaps);
    console.log('[audit] hueco máximo título→XP a 1640px:', Math.round(worst));
    expect(worst).toBeLessThan(500);
  });

  test('760x640 (mínimo de la app): una columna, sin desborde', async () => {
    await page.viewport(760, 640);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-02-pendientes-760.png` });

    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
    expect(el('.quest-tab-bar').scrollWidth)
      .toBeLessThanOrEqual(el('.quest-tab-bar').clientWidth + 1);
    expect(clipped(el('.quest-columns'))).toEqual([]);
  });

  test('Hoy: la pantalla de ejecución', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-03-hoy-1640.png` });
    expect(all('.quest-today-row').length).toBeGreaterThan(0);
  });

  test('Hoy angosto', async () => {
    await page.viewport(760, 640);
    mount();
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-quests-04-hoy-760.png` });
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });

  test('Completadas: el tachado sigue siendo legible', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Completadas$|^Completed$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-05-completadas.png` });
    expect(all('.quest-row--done').length).toBeGreaterThan(0);
  });

  test('vacío: el estado sin misiones dice algo', async () => {
    tasksNow = [];
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-06-vacio.png` });
    expect(el('.quest-empty').textContent!.trim().length).toBeGreaterThan(5);
  });

  test('30 misiones: la lista larga no rompe el ancho', async () => {
    tasksNow = MANY;
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    await page.screenshot({ path: `${SCREENS}/audit-quests-07-treinta.png` });
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});

describe('Questify — contraste y tipografía de lo numérico', () => {
  test('el XP de la fila no va en fuente display', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const font = getComputedStyle(el('.quest-row-xp-value')).fontFamily;
    console.log('[audit] fuente del XP de la fila:', font);
    expect(font).not.toMatch(/Unifraktur/i);
  });

  test('ningún texto de la fila de misión baja del piso de 13 px; el título va en cuerpo', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const rows = all('.quest-row');
    expect(rows.length).toBeGreaterThan(0);
    const small = rows.flatMap((r) => smallText(r));
    expect(small, `texto chico: ${small.map((s) => `${s.sel} «${s.text}» ${s.px}px`).join(', ')}`).toEqual([]);
    const body = tokenPx('--fs-body');
    expect(body).toBeGreaterThan(13);
    expect(parseFloat(getComputedStyle(el('.quest-row-title')).fontSize)).toBeGreaterThanOrEqual(body - 0.01);
    for (const meta of all('.quest-row-meta span').slice(0, 6)) {
      expect(getComputedStyle(meta).opacity).toBe('1');
    }
  });

  test('la racha de un hábito es tinta legible, no un fantasma', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    const streak = el('.quest-habit-streak');
    console.log('[audit] racha:', getComputedStyle(streak).color, getComputedStyle(streak).fontFamily);
    expect(getComputedStyle(streak).opacity).toBe('1');
  });
});

describe('Questify — los controles, abiertos', () => {
  test('menú de fila: se abre, tiene los ítems nuevos y entra en pantalla', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const trigger = all('button[aria-label="Acciones de la misión"]')[0];
    expect(trigger).toBeTruthy();
    trigger.click();
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-quests-08-menu-fila.png` });

    const menu = el('.quest-row-menu');
    const r = menu.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);

    const items = all('.quest-row-menu-item').map((b) => b.textContent!.trim());
    expect(items.join('|')).toMatch(/Caldero/);
    expect(items.join('|')).toMatch(/Posponer/);
  });

  test('submenú Posponer: al crecer, el menú sigue entrando en pantalla', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    // La ÚLTIMA fila: su menú se abre pegado al borde inferior, que es donde
    // crecer con el submenú duele.
    const triggers = all('button[aria-label="Acciones de la misión"]');
    const trigger = triggers[triggers.length - 1];
    trigger.scrollIntoView({ block: 'end' });
    await settle(150);
    trigger.click();
    await settle(200);

    const before = el('.quest-row-menu').getBoundingClientRect();
    const postpone = all('.quest-row-menu-item').find((b) => /Posponer/.test(b.textContent!))!;
    postpone.click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-09-submenu-posponer.png` });

    const after = el('.quest-row-menu').getBoundingClientRect();
    console.log('[audit] menú antes:', Math.round(before.bottom), 'después:', Math.round(after.bottom), 'vh:', window.innerHeight);
    expect(all('.quest-row-submenu').length).toBe(1);
    // El menú creció; si nadie lo reposiciona se va abajo de la ventana.
    expect(after.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  test('menú de hábito: historial / editar / saltear / eliminar', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const trigger = all('.quest-habit-actions button[aria-haspopup="menu"]')[0];
    expect(trigger).toBeTruthy();
    trigger.click();
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-quests-10-menu-habito.png` });

    const items = all('.quest-row-menu-item').map((b) => b.textContent!.trim());
    expect(items.join('|')).toMatch(/historial/i);
    expect(items.join('|')).toMatch(/[Ss]altear/);
    const r = el('.quest-row-menu').getBoundingClientRect();
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  });

  test('formulario de misión: el selector Repetir tiene rótulo y el picker de días aparece', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    el('.quest-add-toggle').click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-11-form.png` });

    const select = document.getElementById('quest-repeat-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const label = document.querySelector('label[for="quest-repeat-select"]');
    expect(label).toBeTruthy();
    expect(label!.getBoundingClientRect().width).toBeGreaterThan(0);

    // Elegir «Días específicos» revela las siete teclas.
    select.value = 'days';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-12-form-dias.png` });

    const days = all('.quest-habit-day');
    expect(days.length).toBe(7);
    for (const d of days) {
      const box = d.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(20);
      expect(box.height).toBeGreaterThanOrEqual(20);
    }

    // El formulario abierto no puede desbordar el ancho de la página.
    const form = el('.quest-form-wrapper');
    expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth + 1);
  });

  test('formulario a 760px: no se desborda ni se sale de la caja', async () => {
    await page.viewport(760, 640);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    el('.quest-add-toggle').click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-13-form-760.png` });

    const form = el('.quest-form-wrapper');
    expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth + 1);
    expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });

  test('gestor de proyectos: el nombre largo no rompe la fila', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);
    el('button[aria-label="Gestionar proyectos"]').click();
    await settle(250);
    await page.screenshot({ path: `${SCREENS}/audit-quests-14-proyectos.png` });

    const modal = el('.quest-project-modal');
    expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 1);
    for (const row of all('.quest-project-modal-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test('fila expandida: subtareas y título completo', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    // La fila del título larguísimo.
    const body = all('.quest-row-body').find((b) => /Reorganizar el archivo/.test(b.textContent!))!;
    body.click();
    await settle(350);
    await page.screenshot({ path: `${SCREENS}/audit-quests-15-expandida.png` });

    expect(all('.subtask-item').length).toBeGreaterThan(0);
    const row = body.closest('.quest-row') as HTMLElement;
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);

    // El medidor de subtareas de la cabecera: 48x10 o no está diciendo nada.
    const gauge = row.querySelector('.quest-subtask-gauge')!.getBoundingClientRect();
    console.log('[audit] medidor de subtareas:', Math.round(gauge.width), 'x', Math.round(gauge.height));
    expect(gauge.width).toBeGreaterThan(30);
    expect(gauge.height).toBeGreaterThan(4);
  });

  test('heatmap del hábito: se despliega bajo la fila sin desbordarla', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const trigger = all('.quest-habit-actions button[aria-haspopup="menu"]')[0];
    trigger.click();
    await settle(200);
    const historial = all('.quest-row-menu-item').find((b) => /historial/i.test(b.textContent!))!;
    historial.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-quests-16-heatmap-habito.png` });

    const cal = el('.heatmap-calendar');
    expect(cal.scrollWidth).toBeLessThanOrEqual(cal.clientWidth + 1);

    // El calendario compartido dibuja siempre SIETE columnas, una por dia de la
    // semana: con 91 dias eran catorce renglones, ~400 px de mapa clavados
    // entre dos habitos, que se llevaban puesta el resto de la lista. Seis
    // semanas son la mitad de eso y cuentan la misma historia.
    const block = cal.parentElement!;
    console.log('[audit] alto del historial del habito:', Math.round(block.getBoundingClientRect().height));
    expect(historyAsked).toBeLessThanOrEqual(42);
    expect(block.getBoundingClientRect().height).toBeLessThan(280);
  });

  test('badge de repetición: existe, tiene rótulo y describe la regla', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const badges = all('.quest-repeat-badge');
    expect(badges.length).toBeGreaterThanOrEqual(3);
    const labels = badges.map((b) => b.getAttribute('aria-label'));
    for (const l of labels) expect(l && l.length > 3).toBe(true);
    console.log('[audit] reglas de repetición:', labels.join(' / '));
    expect(labels.join('|')).toMatch(/L, X, V|Se repite/);
  });

  test('tildar una misión no revienta y avisa al resto de la app', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    /* `notifyQuestsChanged` se llamaba a sí misma: recursión infinita. Tildar,
       borrar, posponer o guardar una misión moría con «Maximum call stack size
       exceeded» ANTES de refrescar nada. Este test tilda de verdad y espera el
       evento que el resto de la app escucha. */
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.message);
    let notified = 0;
    const onChanged = () => { notified += 1; };
    window.addEventListener('error', onError);
    window.addEventListener('quests:dataChanged', onChanged);
    try {
      const box = all('.quest-row input[type="checkbox"]')[0] as HTMLInputElement;
      expect(box).toBeTruthy();
      box.click();
      // La animación de tachado + salida corre antes de llamar al backend.
      await settle(2200);
      await page.screenshot({ path: `${SCREENS}/audit-quests-17-completada.png` });
    } finally {
      window.removeEventListener('error', onError);
      window.removeEventListener('quests:dataChanged', onChanged);
    }

    expect(errors).toEqual([]);
    expect(notified).toBeGreaterThan(0);
  });

  test('lienzo de notas: el modal no se estira con la ventana y tiene salida', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    // La misión con notas muestra el atajo directo en la fila.
    const notas = all('button[aria-label="Notas"]')[0];
    expect(notas).toBeTruthy();
    notas.click();
    await settle(500);
    await page.screenshot({ path: `${SCREENS}/audit-quests-18-notas.png` });

    const dialog = el('[role="dialog"][aria-label="Notas"]');
    const box = dialog.getBoundingClientRect();
    console.log('[audit] lienzo de notas:', Math.round(box.width), 'x', Math.round(box.height));
    // Ni se estira a la ventana ni queda más chico que el lienzo que contiene.
    expect(box.width).toBeGreaterThan(500);
    expect(box.width).toBeLessThan(760);
    expect(box.height).toBeLessThanOrEqual(window.innerHeight);
    // Y entra entero en la pantalla: nada de un modal que empieza fuera del borde.
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);

    // Cerrar es alcanzable y tiene nombre.
    const close = el('.quest-modal-close');
    expect(close.getAttribute('aria-label')).toBeTruthy();
  });

  test('todo botón de sólo-icono tiene aria-label', async () => {
    await page.viewport(1640, 900);
    mount();
    await settle();
    await goTab(/^Pendientes$/i);

    const sinNombre: string[] = [];
    for (const b of all('button')) {
      const text = (b.textContent ?? '').trim();
      const label = b.getAttribute('aria-label') ?? b.getAttribute('title');
      if (!text && !label) sinNombre.push(b.className || b.outerHTML.slice(0, 80));
    }
    console.log('[audit] botones sin nombre accesible:', sinNombre);
    expect(sinNombre).toEqual([]);
  });
});
