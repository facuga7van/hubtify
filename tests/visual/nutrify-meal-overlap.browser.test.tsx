import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import MealScheduleEditor from '@modules/nutrition/components/shared/MealScheduleEditor';
import { DEFAULT_MEAL_SCHEDULE, type MealSchedule } from '../../shared/meal-utils';

// Real i18n so the interpolated overlap message renders like production.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';
const noop = () => {};

function clone(over: Partial<MealSchedule> = {}): MealSchedule {
  return { ...JSON.parse(JSON.stringify(DEFAULT_MEAL_SCHEDULE)), ...over };
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 420, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      {children}
    </div>
  );
}

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('MealScheduleEditor — overlap warning', () => {
  test('sin solapamiento (horario por defecto, sin advertencia)', async () => {
    render(
      <Frame>
        <MealScheduleEditor schedule={clone()} onChange={noop} />
      </Frame>,
    );
    await page.screenshot({ path: `${SCREENS}/meal-overlap-01-clean.png` });
  });

  test('con solapamiento (cena pisa el almuerzo)', async () => {
    // dinner moved to 14:00-22:00 overlaps lunch 11:00-15:00 -> 14:00-15:00.
    const schedule = clone({
      dinner: { enabled: true, startHour: 14, startMinute: 0, endHour: 22, endMinute: 0 },
    });
    render(
      <Frame>
        <MealScheduleEditor schedule={schedule} onChange={noop} />
      </Frame>,
    );
    await page.screenshot({ path: `${SCREENS}/meal-overlap-02-conflict.png` });
  });
});
