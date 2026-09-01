import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { RepeatDayPicker, PortionPicker } from '@modules/nutrition/components/Today';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';

// Both pickers take `t` as a prop: fake returns the Spanish fallback.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = ((k: string, d?: string) => (typeof d === 'string' ? d : k)) as any;

const noop = () => {};

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('RepeatDayPicker — repetir día anterior', () => {
  test('con días recientes para elegir', async () => {
    render(
      <RepeatDayPicker
        days={[
          { date: '2026-06-25', meals: 4, calories: 1980 },
          { date: '2026-06-24', meals: 3, calories: 1750 },
          { date: '2026-06-22', meals: 5, calories: 2210 },
        ]}
        onPick={noop}
        onClose={noop}
        locale="es-AR"
        t={t}
      />,
    );
    await page.screenshot({ path: `${SCREENS}/repeat-day-01-list.png` });
  });

  test('sin días recientes', async () => {
    render(<RepeatDayPicker days={[]} onPick={noop} onClose={noop} locale="es-AR" t={t} />);
    await page.screenshot({ path: `${SCREENS}/repeat-day-02-empty.png` });
  });
});

describe('PortionPicker — multiplicador de porción', () => {
  test('x1 (default, un toque sigue siendo un toque)', async () => {
    render(
      <PortionPicker
        name="Milanesa con papas"
        baseCalories={650} baseProteinG={40} baseCarbsG={55} baseFatG={28}
        factor={1} onFactor={noop} onConfirm={noop} onClose={noop} t={t}
      />,
    );
    await page.screenshot({ path: `${SCREENS}/portion-01-x1.png` });
  });

  test('x2 (escala calorías y macros)', async () => {
    render(
      <PortionPicker
        name="Milanesa con papas"
        baseCalories={650} baseProteinG={40} baseCarbsG={55} baseFatG={28}
        factor={2} onFactor={noop} onConfirm={noop} onClose={noop} t={t}
      />,
    );
    await page.screenshot({ path: `${SCREENS}/portion-02-x2.png` });
  });

  test('x0.5 sin macros (comida sin datos de macros)', async () => {
    render(
      <PortionPicker
        name="Café con leche"
        baseCalories={120} baseProteinG={null} baseCarbsG={null} baseFatG={null}
        factor={0.5} onFactor={noop} onConfirm={noop} onClose={noop} t={t}
      />,
    );
    await page.screenshot({ path: `${SCREENS}/portion-03-half-no-macros.png` });
  });
});
