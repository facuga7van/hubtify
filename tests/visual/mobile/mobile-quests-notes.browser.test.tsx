/**
 * QA 0.9.0 — QST-01 / QST-03: el pergamino de notas en el teléfono.
 * Ver docs/superpowers/plans/2026-09-02-mobile-qa-0.9.0.md.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import ScrollNotes from '@modules/quests/components/ScrollNotes';
import { installApi, mountInShell, setMobileViewport, settle } from './mobile-harness';
import { QUESTS_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/quests/styles/quests.css';

/** PNG 1×1 transparente: una nota «vacía» ya guardada. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const ONE_DRAWING = [{ id: 'd1', taskId: 't1', data: BLANK_PNG, order: 0, createdAt: '2026-09-01' }];

beforeAll(() => {
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pointer(type: string, target: Element, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  }));
}

/** Traza una diagonal del 30 % al 50 % del lienzo con eventos pointer. */
function stroke(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const at = (f: number): [number, number] => [r.left + r.width * f, r.top + r.height * f];
  pointer('pointerdown', canvas, ...at(0.3));
  pointer('pointermove', canvas, ...at(0.4));
  pointer('pointermove', canvas, ...at(0.5));
  pointer('pointerup', canvas, ...at(0.5));
}

function inkAt(canvas: HTMLCanvasElement, fx: number, fy: number): number {
  const ctx = canvas.getContext('2d')!;
  const px = ctx.getImageData(Math.round(canvas.width * fx), Math.round(canvas.height * fy), 1, 1).data;
  return (px[0] + px[1] + px[2]) / 3;
}

async function mountNotes(drawings: unknown[], api: Record<string, unknown> = {}) {
  installApi({ ...QUESTS_API, questsGetDrawings: () => Promise.resolve(drawings), ...api });
  await setMobileViewport();
  const onClose = vi.fn();
  mountInShell(<ScrollNotes taskId="t1" onClose={onClose} />, '/quests');
  // El lienzo se pinta recién cuando llegan las notas Y la textura del pergamino.
  await settle(900);
  return onClose;
}

describe('Notas de misión a 390×844', () => {
  test('QST-01: el lienzo retiene el gesto y no se lo lleva el scroll', async () => {
    const capture = vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation(() => {});
    await mountNotes(ONE_DRAWING);
    const canvas = document.querySelector('.quest-notes-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(getComputedStyle(canvas).touchAction).toBe('none');
    const dialog = document.querySelector('.quest-notes-dialog') as HTMLElement;
    expect(getComputedStyle(dialog).overscrollBehaviorY).toBe('contain');

    const before = inkAt(canvas, 0.4, 0.4);
    stroke(canvas);
    expect(capture).toHaveBeenCalledWith(7);
    const after = inkAt(canvas, 0.4, 0.4);
    // Pergamino claro antes, tinta (#3a2a1a) después.
    expect(before).toBeGreaterThan(150);
    expect(after).toBeLessThan(110);
    await expect.element(page.getByText(/Sin guardar/i)).toBeVisible();
  });

  test('QST-03: «Nueva» no persiste nada hasta el primer guardado', async () => {
    const save = vi.fn(() => Promise.resolve('new-id'));
    const onClose = await mountNotes([], { questsSaveDrawing: save });
    // Un solo empty state, no uno en la cabecera y otro en el cuerpo.
    expect(document.querySelectorAll('.quest-notes-dialog').length).toBe(1);
    const dialog = document.querySelector('.quest-notes-dialog') as HTMLElement;
    expect((dialog.textContent!.match(/Sin notas/g) ?? []).length).toBe(1);

    await page.getByRole('button', { name: /Nueva/i }).click();
    await settle(300);
    expect(save).not.toHaveBeenCalled();
    const canvas = document.querySelector('.quest-notes-canvas') as HTMLCanvasElement;
    expect(getComputedStyle(canvas).display).not.toBe('none');

    // Atrás sin dibujar: nada que guardar.
    await page.getByRole('button', { name: /^Cerrar$/i }).click();
    await settle(200);
    expect(save).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('QST-03: el primer trazo guardado crea la nota', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation(() => {});
    const store: unknown[] = [];
    const save = vi.fn((d: { id?: string; taskId: string; data: string }) => {
      const id = d.id ?? `d${store.length + 1}`;
      if (!d.id) store.push({ id, taskId: d.taskId, data: d.data, order: store.length, createdAt: '' });
      return Promise.resolve(id);
    });
    const counted = vi.fn();
    installApi({ ...QUESTS_API, questsGetDrawings: () => Promise.resolve([...store]), questsSaveDrawing: save });
    await setMobileViewport();
    mountInShell(<ScrollNotes taskId="t1" onClose={() => {}} onCountChanged={counted} />, '/quests');
    await settle(900);

    await page.getByRole('button', { name: /Nueva/i }).click();
    await settle(300);
    const canvas = document.querySelector('.quest-notes-canvas') as HTMLCanvasElement;
    stroke(canvas);
    await page.getByRole('button', { name: /^Guardar$/i }).click();
    await settle(400);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].id).toBeUndefined();
    expect(save.mock.calls[0][0].taskId).toBe('t1');
    expect(counted).toHaveBeenCalled();
    await expect.element(page.getByText(/Nota 1 de 1/i)).toBeVisible();
  });
});
