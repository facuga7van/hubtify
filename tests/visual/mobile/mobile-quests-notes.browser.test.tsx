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

});
