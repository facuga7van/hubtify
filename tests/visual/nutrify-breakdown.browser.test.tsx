import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { EstimationBreakdown } from '@modules/nutrition/components/Today';
import { sumBreakdown } from '@modules/nutrition/breakdown-utils';
import type { BreakdownItem } from '@modules/nutrition/breakdown-utils';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';

// EstimationBreakdown receives `t` as a prop: fake returning the fallback.
// Supports the interpolation object form ({ name, defaultValue }).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = ((k: string, d?: any) => {
  if (d && typeof d === 'object') return d.defaultValue ?? k;
  return d ?? k;
}) as any;

const item = (name: string, calories: number, p: number | null, c: number | null, f: number | null): BreakdownItem & { calorieInput: string } =>
  ({ name, calories, proteinG: p, carbsG: c, fatG: f, calorieInput: String(calories) });

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 420, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      <div className="nutri-estimation">{children}</div>
    </div>
  );
}

const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('EstimationBreakdown — estados visuales', () => {
  test('varios ingredientes con macros', async () => {
    const items = [
      item('Milanesa de pollo', 400, 30, 20, 18),
      item('Papas fritas', 300, 5, 40, 14),
      item('Ensalada mixta', 80, 2, 8, 5),
    ];
    render(<Frame><EstimationBreakdown items={items} totals={sumBreakdown(items)} onEditCalories={noop} onRemove={noop} t={t} locale="es-AR" /></Frame>);
    await page.screenshot({ path: `${SCREENS}/breakdown-01-multi.png` });
  });

  test('un ingrediente editado (milanesa a la mitad → macros reescalados)', async () => {
    const items = [
      item('Milanesa de pollo', 200, 15, 10, 9), // halved + rescaled macros
      item('Papas fritas', 300, 5, 40, 14),
      item('Ensalada mixta', 80, 2, 8, 5),
    ];
    render(<Frame><EstimationBreakdown items={items} totals={sumBreakdown(items)} onEditCalories={noop} onRemove={noop} t={t} locale="es-AR" /></Frame>);
    await page.screenshot({ path: `${SCREENS}/breakdown-02-edited.png` });
  });

  test('un ingrediente eliminado (papas quitadas → total más bajo)', async () => {
    const items = [
      item('Milanesa de pollo', 400, 30, 20, 18),
      item('Ensalada mixta', 80, 2, 8, 5),
    ];
    render(<Frame><EstimationBreakdown items={items} totals={sumBreakdown(items)} onEditCalories={noop} onRemove={noop} t={t} locale="es-AR" /></Frame>);
    await page.screenshot({ path: `${SCREENS}/breakdown-03-removed.png` });
  });

  test('datos parciales de macros (algunos ingredientes sin macros)', async () => {
    const items = [
      item('Milanesa de pollo', 400, 30, null, 18),
      item('Pan casero', 200, null, null, null),
    ];
    render(<Frame><EstimationBreakdown items={items} totals={sumBreakdown(items)} onEditCalories={noop} onRemove={noop} t={t} locale="es-AR" /></Frame>);
    await page.screenshot({ path: `${SCREENS}/breakdown-04-partial.png` });
  });

  test('todos los ingredientes eliminados (estado vacío)', async () => {
    render(<Frame><EstimationBreakdown items={[]} totals={sumBreakdown([])} onEditCalories={noop} onRemove={noop} t={t} locale="es-AR" /></Frame>);
    await page.screenshot({ path: `${SCREENS}/breakdown-05-empty.png` });
  });
});
