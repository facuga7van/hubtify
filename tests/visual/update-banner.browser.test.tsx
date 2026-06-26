import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import UpdateBanner from '@hub/UpdateBanner';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

const SCREENS = 'screens';
const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('UpdateBanner — visual states', () => {
  test('idle', async () => {
    render(<UpdateBanner version="0.7.4" state="idle" percent={0} error={null} onViewDetails={noop} onDismiss={noop} />);
    await expect.element(page.getByText(/Ver novedades/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/banner-01-idle.png` });
  });

  test('downloading', async () => {
    render(<UpdateBanner version="0.7.4" state="downloading" percent={45} error={null} onViewDetails={noop} onDismiss={noop} />);
    await expect.element(page.getByText(/45%/)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/banner-02-downloading.png` });
  });

  test('error', async () => {
    render(<UpdateBanner version="0.7.4" state="idle" percent={0} error="boom" onViewDetails={noop} onDismiss={noop} />);
    await expect.element(page.getByText(/Error al actualizar/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/banner-03-error.png` });
  });
});
