import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import UpdateSettings from '@hub/UpdateSettings';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

const SCREENS = 'screens';
const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.padding = '20px';
  document.body.style.background = 'var(--parch-2)';
});

describe('UpdateSettings — visual states', () => {
  test('notify (default)', async () => {
    render(<UpdateSettings mode="notify" onChange={noop} />);
    await expect.element(page.getByText(/Modo de actualización/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/settings-update-01-notify.png` });
  });

  test('auto', async () => {
    render(<UpdateSettings mode="auto" onChange={noop} />);
    await expect.element(page.getByText(/segundo plano/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/settings-update-02-auto.png` });
  });

  test('off', async () => {
    render(<UpdateSettings mode="off" onChange={noop} />);
    await expect.element(page.getByText(/No busca actualizaciones/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/settings-update-03-off.png` });
  });
});
