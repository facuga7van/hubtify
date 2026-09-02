import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import TaskList from '@modules/quests/components/TaskList';
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
    await shoot('quests-03-proyectos');
  });
});
