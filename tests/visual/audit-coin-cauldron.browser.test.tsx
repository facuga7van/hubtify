import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import CauldronPage from '@modules/cauldron/components/CauldronPage';
import CauldronDashboardWidget from '@modules/cauldron/components/CauldronDashboardWidget';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/shared/components/codex/codex.css';
import '../../src/shared/components/charts/charts.css';
import '../../src/shared/styles/help-bubble.css';
import '../../src/modules/cauldron/styles/cauldron.css';

const SCREENS = 'screens';

/**
 * El Caldero entero: estante de pociones, vínculo con misiones, sesiones
 * retroactivas y el editor de recetas. A pantalla completa y al mínimo.
 */

const PRESETS = [
  { id: 'p1', name: 'Clásico', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLong: 4, autoStartBreak: 1, autoStartWork: 0, isDefault: 1 },
  { id: 'p2', name: 'Maratón de cierre contable de fin de trimestre', workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, cyclesBeforeLong: 3, autoStartBreak: 0, autoStartWork: 0, isDefault: 0 },
  { id: 'p3', name: 'Corto', workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, cyclesBeforeLong: 5, autoStartBreak: 1, autoStartWork: 1, isDefault: 0 },
];

const DAY = 24 * 60 * 60 * 1000;

const SESSIONS = Array.from({ length: 24 }, (_, i) => ({
  id: `s${i}`,
  presetId: 'p1',
  presetName: 'Clásico',
  sessionType: 'work',
  startedAt: new Date(Date.now() - Math.floor(i / 5) * DAY - i * 3600_000).toISOString(),
  completedAt: new Date(Date.now() - Math.floor(i / 5) * DAY - i * 3600_000 + 25 * 60_000).toISOString(),
  durationMinutes: 25,
  completed: 1,
  abandoned: i % 7 === 3,
  retroactive: i % 11 === 5,
  elapsedMinutes: i % 7 === 3 ? 9 : null,
  taskId: i % 3 === 0 ? 't1' : null,
  taskName: i % 3 === 0 ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio' : null,
  projectId: i % 3 === 0 ? 'pr1' : null,
  projectName: i % 3 === 0 ? 'Estudio contable' : null,
  projectColor: i % 3 === 0 ? '#7a1e1e' : null,
}));

const WEEK = [
  { taskId: 't1', taskName: 'Cerrar el balance', projectId: 'pr1', projectName: 'Estudio contable', projectColor: '#7a1e1e', sessions: 9, minutes: 225 },
  { taskId: 't2', taskName: 'Leer', projectId: 'pr2', projectName: 'Facultad', projectColor: '#556b3c', sessions: 3, minutes: 75 },
  { taskId: null, taskName: null, projectId: null, projectName: null, projectColor: null, sessions: 1, minutes: 25 },
];

const TASKS = Array.from({ length: 14 }, (_, i) => ({
  id: `t${i}`,
  name: i === 0
    ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky'
    : `Misión ${i}`,
  status: 0,
  projectId: i % 2 === 0 ? 'pr1' : 'pr2',
}));

const PROJECTS = [
  { id: 'pr1', name: 'Estudio contable', color: '#7a1e1e' },
  { id: 'pr2', name: 'Facultad', color: '#556b3c' },
];

const IDLE_STATE = { status: 'idle', remainingMs: 0, totalMs: 0, sessionType: 'work', presetId: 'p1', round: 1, currentCycle: 1, totalCycles: 4 };

const RUNNING_STATE = {
  status: 'work', remainingMs: 14 * 60_000 + 37_000, totalMs: 25 * 60_000,
  sessionType: 'work', presetId: 'p1', round: 2, currentCycle: 2, totalCycles: 4,
  taskId: 't1',
  taskName: 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky',
  taskProjectId: 'pr1', taskProjectColor: '#7a1e1e',
};

interface StubOpts {
  state?: unknown;
  sessions?: unknown[];
  week?: unknown[];
  interrupted?: unknown;
  wirePhase2?: boolean;
}

function stub(opts: StubOpts = {}) {
  const handlers: Record<string, unknown> = {
    cauldronGetPresets: () => Promise.resolve(PRESETS),
    cauldronGetStats: () => Promise.resolve({ today: 6, week: 23, total: 481, streak: 12, longestStreak: 31, totalMinutes: 12_025 }),
    cauldronGetState: () => Promise.resolve(opts.state ?? IDLE_STATE),
    cauldronGetSessions: (offset: number) => Promise.resolve({
      sessions: (opts.sessions ?? SESSIONS).slice(Number(offset) || 0, (Number(offset) || 0) + 15),
      hasMore: (opts.sessions ?? SESSIONS).length > 15,
    }),
    cauldronGetWeeklyFocusTime: () => Promise.resolve([
      { label: 'Lun', value: 125 }, { label: 'Mar', value: 75 }, { label: 'Mié', value: 200 },
      { label: 'Jue', value: 50 }, { label: 'Vie', value: 175 }, { label: 'Sáb', value: 0 }, { label: 'Dom', value: 25 },
    ]),
    cauldronGetInterruptedSession: () => Promise.resolve(opts.interrupted ?? null),
    cauldronPause: () => Promise.resolve(IDLE_STATE),
    cauldronStop: () => Promise.resolve(IDLE_STATE),
    questsGetTasks: () => Promise.resolve(TASKS),
    questsGetProjects: () => Promise.resolve(PROJECTS),
    onCauldronTick: () => () => undefined,
    onCauldronSessionEnd: () => () => undefined,
  };
  if (opts.wirePhase2 !== false) {
    handlers.cauldronStart = () => Promise.resolve(opts.state ?? IDLE_STATE);
    handlers.cauldronSetSessionTask = () => Promise.resolve(opts.state ?? IDLE_STATE);
    handlers.cauldronGetWeekByProject = () => Promise.resolve(opts.week ?? WEEK);
    handlers.cauldronLogPastSession = () => Promise.resolve({ id: 'x', minutes: 30, startedAt: '', completedAt: '' });
  }
  (window as unknown as { api: unknown }).api = new Proxy(handlers, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      if (prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: (target, prop: string) => prop in target || !prop.startsWith('cauldronSetSessionTask'),
  });
}

const wrap = (node: React.ReactNode) => render(
  <MemoryRouter><ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider></MemoryRouter>,
);

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

function el<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

/** ¿Algún hijo EN EL FLUJO se sale por la derecha de su contenedor? */
function flowChildSticksOut(node: Element): boolean {
  const box = node.getBoundingClientRect();
  for (const child of node.children) {
    const pos = getComputedStyle(child).position;
    if (pos === 'absolute' || pos === 'fixed') continue;
    if (child.getBoundingClientRect().right > box.right + 1) return true;
  }
  return false;
}

function overflowing(root: Element): string[] {
  const bad: string[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    if (node.clientWidth <= 0) continue;
    const excess = node.scrollWidth - node.clientWidth;
    if (excess <= 1) continue;
    const style = getComputedStyle(node);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (style.textOverflow === 'ellipsis') continue;
    const hasBubble = /help-bubble/.test(node.className)
      || node.querySelector('.help-bubble, .help-bubble-inline') !== null;
    if (hasBubble && excess <= 10) continue;
    // Decoración absoluta (embers, vapor, sellos) dentro de una caja con
    // `overflow: hidden`: sobresale por diseño y ya está recortada. Sólo
    // interesa lo que se sale ESTANDO en el flujo.
    if (node.children.length > 0 && !flowChildSticksOut(node)) continue;
    bad.push(`${node.className || node.tagName} (${node.scrollWidth}>${node.clientWidth})`);
  }
  return bad;
}

beforeEach(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
  localStorage.clear();
});

describe('Caldero — la página entera', () => {
  test('1640×900 en reposo: nada se desborda', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-01-1640.png` });
    const bad = overflowing(el('.cauldron-book'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(document.body.textContent).not.toMatch(/cauldron\.[a-zA-Z]/);
  });

  test('760×640 en reposo: sigue entrando', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-02-760.png` });
    const bad = overflowing(el('.cauldron-book'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });

  test('760×640: «Iniciar Poción» se ve sin scrollear', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-14-boton.png` });
    const start = [...document.querySelectorAll<HTMLButtonElement>('.cauldron-btn--primary')]
      .find((b) => /poción|potion/i.test(b.textContent ?? ''));
    expect(start, 'no encontré el botón de encender').toBeTruthy();
    const r = start!.getBoundingClientRect();
    expect(r.bottom, 'la acción principal queda abajo del pliegue')
      .toBeLessThanOrEqual(window.innerHeight);
  });

  test('corriendo con misión: el nombre largo no rompe el panel', async () => {
    stub({ state: RUNNING_STATE });
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-03-corriendo.png` });
    const bad = overflowing(el('.cauldron-book'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('corriendo a 760×640: los controles siguen alcanzables', async () => {
    stub({ state: RUNNING_STATE });
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-04-corriendo-760.png` });
    const bad = overflowing(el('.cauldron-book'));
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    for (const btn of document.querySelectorAll('.cauldron-controls .cauldron-btn')) {
      const r = btn.getBoundingClientRect();
      expect(r.width, 'botón sin ancho').toBeGreaterThan(0);
      expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
    }
  });

  test('el estante de pociones no crece sin techo ni deja frascos a medias', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    const shelf = document.querySelector('.cauldron-shelf, .cauldron-potion-shelf');
    expect(shelf, 'no encontré el estante').toBeTruthy();
    shelf!.scrollIntoView({ block: 'center' });
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-05-estante.png` });

    const bad = overflowing(shelf!);
    expect(bad, `desbordes en el estante: ${bad.join(', ')}`).toEqual([]);
    // Los frascos entran en su repisa: ninguno se sale por el borde derecho.
    const shelfRect = shelf!.getBoundingClientRect();
    for (const jar of shelf!.querySelectorAll('svg')) {
      const r = jar.getBoundingClientRect();
      expect(r.right).toBeLessThanOrEqual(shelfRect.right + 1);
      expect(r.height, 'un frasco creció sin techo').toBeLessThan(120);
    }
  });

  test('el estante a 760 px tampoco se desarma', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    const shelf = el('.cauldron-shelf, .cauldron-potion-shelf');
    shelf.scrollIntoView({ block: 'center' });
    await settle(200);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-06-estante-760.png` });
    const bad = overflowing(shelf);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });

  test('el picker de misión abre, se ve entero y cierra con Escape', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    const trigger = el<HTMLButtonElement>('.cauldron-mission-trigger:not(.cauldron-retro-link)');
    trigger.scrollIntoView({ block: 'center' });
    await settle(150);
    trigger.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-07-misiones.png` });

    const popup = document.querySelector('.cauldron-mission-popover');
    expect(popup, 'no encontré el desplegable de misiones').toBeTruthy();
    const r = popup!.getBoundingClientRect();
    expect(r.top, 'el desplegable arranca fuera de la ventana').toBeGreaterThanOrEqual(-1);
    expect(r.bottom, 'el desplegable se pasa por abajo').toBeLessThanOrEqual(window.innerHeight + 1);
    expect(r.left).toBeGreaterThanOrEqual(-1);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(300);
    expect(document.querySelector('.cauldron-mission-popover')).toBeNull();
  });

  test('el picker de misión a 760×640 no se sale de la ventana', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    const trigger = el<HTMLButtonElement>('.cauldron-mission-trigger:not(.cauldron-retro-link)');
    trigger.scrollIntoView({ block: 'center' });
    await settle(150);
    trigger.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-08-misiones-760.png` });
    const popup = el('.cauldron-mission-popover');
    const r = popup.getBoundingClientRect();
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1);
  });

  test('el formulario de sesión retroactiva abre y su campo tiene rótulo', async () => {
    stub();
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    const link = el<HTMLButtonElement>('.cauldron-retro-link');
    link.click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-09-retro.png` });

    const form = el('.cauldron-retro-form');
    const bad = overflowing(form);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    const input = el<HTMLInputElement>('.cauldron-retro-input');
    // Rótulo visible o aria-label: un campo con flechitas sin nombre no se entiende.
    const labelled = input.getAttribute('aria-label')
      || input.closest('label')?.textContent?.trim()
      || (input.id && document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim());
    expect(labelled, 'el campo de minutos no tiene rótulo').toBeTruthy();

    // Y el número entra detrás de sus flechas.
    const style = getComputedStyle(input);
    const inner = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    expect(inner, 'el campo no tiene lugar para su valor').toBeGreaterThan(24);
  });

  test('el editor de recetas abre, entra y cierra con Escape', async () => {
    stub();
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    el<HTMLButtonElement>('.cauldron-preset-pill.add').click();
    await settle(400);
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-10-receta.png` });

    const modal = el('.cauldron-modal');
    const r = modal.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(-1);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    const bad = overflowing(modal);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);

    // Cada campo del editor tiene lugar para su número.
    for (const input of modal.querySelectorAll<HTMLInputElement>('input[type="number"], .cauldron-input')) {
      const style = getComputedStyle(input);
      const inner = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      expect(inner, `campo sin lugar: ${input.className}`).toBeGreaterThan(24);
    }

    // Las casillas nativas llevan la tinta del códice, no el azul del sistema.
    for (const box of modal.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      expect(getComputedStyle(box).accentColor.toLowerCase(), 'casilla con acento del sistema')
        .not.toBe('auto');
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(300);
    expect(document.querySelector('.cauldron-modal')).toBeNull();
  });

  test('sesión interrumpida: el aviso entra y ofrece las dos salidas', async () => {
    stub({
      interrupted: {
        id: 'i1', presetId: 'p1', sessionType: 'work',
        remainingMs: 8 * 60_000 + 12_000, startedAt: new Date(Date.now() - 900_000).toISOString(),
      },
    });
    await page.viewport(760, 640);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-11-interrumpida.png` });
    const banner = el('.cauldron-resume-banner');
    const bad = overflowing(banner);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
    expect(banner.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
    expect(banner.textContent).not.toMatch(/cauldron\.[a-zA-Z]/);
  });

  test('estante vacío: dice algo en vez de quedar en blanco', async () => {
    stub({ sessions: [], week: [] });
    await page.viewport(1640, 900);
    wrap(<CauldronPage />);
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-12-vacio.png` });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/cauldron\.[a-zA-Z]/);
    expect(text).not.toMatch(/\bNaN\b|\bundefined\b/);
  });
});

describe('Widget del caldero en el panel', () => {
  test('entra en una celda de widget sin desbordar', async () => {
    stub({ state: RUNNING_STATE });
    await page.viewport(1640, 900);
    render(
      <MemoryRouter><ToastProvider><ConfirmProvider>
        <div style={{ width: 320, padding: 12 }}><CauldronDashboardWidget /></div>
      </ConfirmProvider></ToastProvider></MemoryRouter>,
    );
    await settle();
    await page.screenshot({ path: `${SCREENS}/audit-coin-cauldron-13-widget.png` });
    const bad = overflowing(document.body);
    expect(bad, `desbordes: ${bad.join(', ')}`).toEqual([]);
  });
});
