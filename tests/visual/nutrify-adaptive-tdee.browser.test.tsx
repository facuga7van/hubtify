import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { AdaptiveTdeeInsight } from '@modules/nutrition/components/AdaptiveTdeeInsight';
import type { AdaptiveTdeeEstimate } from '../../shared/adaptive-tdee';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';

// Fake `t` that returns the fallback, interpolating {{x}} placeholders (mirrors i18n).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = ((k: string, d?: any, opts?: any) => {
  let str = typeof d === 'string' ? d : k;
  const vars = typeof d === 'object' && d ? d : opts;
  if (vars) for (const [key, val] of Object.entries(vars)) str = str.replace(`{{${key}}}`, String(val));
  return str;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

function est(p: Partial<AdaptiveTdeeEstimate>): AdaptiveTdeeEstimate {
  return {
    tdee: 2275, confidence: 'high', windowDays: 28, sampleDays: 26,
    weightSamples: 4, intakeAvg: 2000, deltaKg: -1, ...p,
  };
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 420, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      <div className="nutri-card" style={{ position: 'static' }}>{children}</div>
    </div>
  );
}

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('AdaptiveTdeeInsight — estados visuales', () => {
  test('confianza alta, gasto real por encima del estimado', async () => {
    render(<Frame><AdaptiveTdeeInsight result={est({ confidence: 'high', tdee: 2275 })} staticTdee={2050} signedDeficit={500} onApply={() => {}} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/adaptive-tdee-01-high.png` });
  });

  test('confianza media, gasto real por debajo del estimado', async () => {
    render(<Frame><AdaptiveTdeeInsight result={est({ confidence: 'medium', tdee: 1850, sampleDays: 13, weightSamples: 3, deltaKg: 0.4 })} staticTdee={2050} signedDeficit={500} onApply={() => {}} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/adaptive-tdee-02-medium.png` });
  });

  test('confianza baja', async () => {
    render(<Frame><AdaptiveTdeeInsight result={est({ confidence: 'low', tdee: 2120, sampleDays: 7, weightSamples: 2, deltaKg: -0.2 })} staticTdee={2050} signedDeficit={500} onApply={() => {}} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/adaptive-tdee-03-low.png` });
  });

  test('datos insuficientes: faltan días de registro', async () => {
    render(<Frame><AdaptiveTdeeInsight result={est({ confidence: 'insufficient', tdee: null, sampleDays: 2, weightSamples: 2, deltaKg: -0.1 })} staticTdee={2050} signedDeficit={500} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/adaptive-tdee-04-need-days.png` });
  });

  test('datos insuficientes: falta registrar peso', async () => {
    render(<Frame><AdaptiveTdeeInsight result={est({ confidence: 'insufficient', tdee: null, sampleDays: 12, weightSamples: 1, deltaKg: null, intakeAvg: 2000 })} staticTdee={2050} signedDeficit={500} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/adaptive-tdee-05-need-weight.png` });
  });
});
