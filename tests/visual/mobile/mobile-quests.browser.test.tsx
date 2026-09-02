import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import TaskList from '@modules/quests/components/TaskList';
import { handleBackButton } from '../../../src/mobile/back-button';
// De dialog-dom y no de native-shell: ese importa @capacitor/app (ver mobile-shell.browser.test).
import { hasOpenDialog, closeTopDialog, hasOpenPopover, closeTopPopover } from '../../../src/mobile/dialog-dom';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { QUESTS_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/quests/styles/quests.css';

beforeAll(() => {
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }
  installApi(QUESTS_API);
});

beforeEach(() => {
  try { localStorage.removeItem('questify_collapsed_projects'); } catch { /* ignore */ }
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

async function goTab(name: RegExp) {
  await page.getByRole('tab', { name }).click();
  await settle(300);
}

describe('Questify a 390×844', () => {
  test('Pendientes: filas, hábitos y barra de pestañas entran', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    await shoot('quests-01-pendientes');
    noOverflow('QUESTS PENDIENTES');
    for (const row of document.querySelectorAll<HTMLElement>('.quest-row, .quest-habit-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // Q1: los badges del hábito bajan a su propio renglón: la fila tiene 3 pistas, no 4.
    const habitRow = document.querySelector('.quest-habit-row') as HTMLElement;
    expect(getComputedStyle(habitRow).gridTemplateColumns.split(' ').length).toBe(3);
    // …y el tilde sigue en el renglón del nombre, no en un tercero. La fila es
    // `align-items: center` y el botón del tilde es más alto que el nombre, así
    // que lo que tiene que coincidir es el centro, no el borde de arriba.
    const name = habitRow.querySelector('.quest-habit-name') as HTMLElement;
    const tick = habitRow.querySelector('.quest-habit-tick') as HTMLElement;
    const midY = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    expect(Math.abs(midY(tick) - midY(name))).toBeLessThanOrEqual(1);
  });

  test('Hoy y Completadas', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Hoy$/i);
    await shoot('quests-02-hoy');
    noOverflow('QUESTS HOY');
    await goTab(/^Completadas$/i);
    noOverflow('QUESTS COMPLETADAS');
  });

  test('QST-02: el nombre del hábito y de la misión van a lo ancho', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    const wide = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const p = el.parentElement!.getBoundingClientRect();
      expect(r.width, `${el.className} mide ${r.width}px`).toBeGreaterThanOrEqual(p.width - 2);
    };
    await page.getByRole('button', { name: /Nuevo hábito/i }).click();
    await settle(300);
    wide(document.querySelector('.quest-habit-form__name') as HTMLElement);

    // El botón va sobre una cinta decorativa que intercepta el click real de
    // playwright; el click de DOM dispara el mismo handler.
    (document.querySelector('.quest-add-toggle') as HTMLElement).click();
    await settle(600);
    const name = document.querySelector('.quest-form-name') as HTMLElement;
    const r = name.getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(300);
    // …y los botones caen al renglón siguiente, no al lado.
    const submit = name.parentElement!.querySelector('button') as HTMLElement;
    expect(submit.getBoundingClientRect().top).toBeGreaterThanOrEqual(r.bottom);
  });

  test('el gestor de proyectos entra en la pantalla (Q3)', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    await page.getByRole('button', { name: /Gestionar proyectos/i }).click();
    await settle(300);
    const modal = document.querySelector('.quest-project-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    const r = modal.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth);
    // …y nada le pinta encima: el modal vive dentro de `.qb-content`, que es un
    // contexto de apilamiento, y el `.qb-header` le ganaba al arrancar arriba.
    const firstRow = modal.querySelector('.quest-project-modal-row') as HTMLElement;
    const rr = firstRow.getBoundingClientRect();
    const top = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
    expect(modal.contains(top)).toBe(true);
    await shoot('quests-03-proyectos');
  });

  /* GEN-01: el menú ⋯ de un hábito no es un `role="dialog"`, así que el botón
     atrás de Android no lo veía y navegaba. Ahora useAnchoredPopup lo anota
     como popover abierto y el primer Atrás lo cierra; el segundo navega. */
  test('el botón atrás cierra el menú de un hábito antes de navegar (GEN-01)', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    await page.getByRole('button', { name: /Acciones del hábito/i }).first().click();
    await settle(300);
    expect(document.querySelector('.quest-row-menu[data-popover-open]')).not.toBeNull();
    expect(hasOpenPopover()).toBe(true);
    expect(hasOpenDialog(document)).toBe(false);

    const back = () => {
      const goBack = vi.fn();
      const outcome = handleBackButton({
        openPopover: hasOpenPopover(),
        closePopover: () => { closeTopPopover(); },
        openDialog: hasOpenDialog(document),
        closeDialog: closeTopDialog,
        canGoBack: true,
        goBack,
        minimize: vi.fn(),
      });
      return { outcome, goBack };
    };

    const first = back();
    await settle(300);
    expect(first.outcome).toBe('popover');
    expect(first.goBack).not.toHaveBeenCalled();
    expect(document.querySelector('.quest-row-menu')).toBeNull();
    expect(hasOpenPopover()).toBe(false);

    const second = back();
    expect(second.outcome).toBe('history');
    expect(second.goBack).toHaveBeenCalledTimes(1);
  });
});
