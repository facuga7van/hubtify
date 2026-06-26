import { beforeAll, afterEach, describe, expect, test } from 'vitest';
import { render, cleanup } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import TaskForm from '@modules/quests/components/TaskForm';

// Real i18n + styles so the screenshots match production.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/quests/styles/quests.css';

const SCREENS = 'screens';

beforeAll(() => {
  document.body.style.margin = '0';
  // Minimal window.api so the form's useEffect (loadCategories) doesn't throw.
  (window as unknown as { api: Record<string, unknown> }).api = {
    questsGetCategories: async () => [],
    questsUpsertProject: async () => 'proj-1',
    questsUpsertTask: async () => 'task-1',
  };
});

afterEach(() => cleanup());

function renderForm() {
  return render(
    <div style={{ padding: 20, background: 'var(--rpg-parchment, #efe2c0)', maxWidth: 720 }}>
      <TaskForm editingTask={null} projects={[]} activeProjectId={null} onSaved={() => {}} />
    </div>,
  );
}

describe('TaskForm — Questify new features', () => {
  test('quick-add recognizes a natural-language date', async () => {
    renderForm();
    await page.getByPlaceholder('Nombre de la quest...').fill('Comprar pan mañana');
    await expect.element(page.getByText(/Se agenda para/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/quest-quickadd.png` });
  });

  test('recurrence selector reveals cadence and anchor', async () => {
    renderForm();
    await page.getByText('Repetir').click();
    await expect.element(page.getByText('Cada')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/quest-recurrence.png` });
  });
});
