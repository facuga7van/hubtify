import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import UpdateNotification from '@hub/UpdateNotification';

// Real i18n + styles so the screenshots match production pixel-for-pixel.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

const SCREENS = 'screens';
const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('UpdateNotification — visual states', () => {
  test('idle — with changelog', async () => {
    render(
      <UpdateNotification version="0.7.4" state="idle" percent={0} error={null} onDownload={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText(/Qué hay de nuevo/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-01-idle.png` });
  });

  test('downloading', async () => {
    render(
      <UpdateNotification version="0.7.4" state="downloading" percent={45} error={null} onDownload={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText('45%')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-02-downloading.png` });
  });

  test('error', async () => {
    render(
      <UpdateNotification version="0.7.4" state="idle" percent={0} error="Update failed: network error" onDownload={noop} onDismiss={noop} />,
    );
    await expect.element(page.getByText(/network error/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/update-03-error.png` });
  });
});
