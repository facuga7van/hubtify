import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { TreasureLineChart } from '@shared/components/charts';
import type { PointDatum } from '@shared/components/charts';
import { smoothWeightSeries } from '../../shared/weight-trend';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';
import '../../src/shared/components/charts/charts.css';

const SCREENS = 'screens';

// Build raw + smoothed PointDatum series the way NutritionCharts does.
function series(weights: number[]) {
  const points = weights.map((weightKg, i) => ({ date: `2026-05-${String(i * 7 + 1).padStart(2, '0')}`, weightKg }));
  const smoothed = smoothWeightSeries(points);
  const data: PointDatum[] = weights.map((y, x) => ({ x, y, label: `${y} kg` }));
  const trendData: PointDatum[] = smoothed.map((w, x) => ({ x, y: w.trend, label: `${Math.round(w.trend * 10) / 10} kg` }));
  const xLabels = weights.map((_, i) => `${i * 7 + 1}/05`);
  return { data, trendData, xLabels };
}

// Mirrors the real chronicle chart card so the themed styles apply.
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 460, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      <div className="nutri-card medieval nutri-chart-card">
        <h3 className="nutri-card-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('Weight trend — gold smoothed line over faint raw points', () => {
  test('tendencia bajando (déficit) con pesajes ruidosos', async () => {
    // Net downward trend but with the usual water wobble around it.
    const { data, trendData, xLabels } = series([82.4, 83.1, 81.6, 82.0, 80.9, 81.4, 80.1, 80.6, 79.4]);
    render(
      <Frame title="Travesía del Peso">
        <TreasureLineChart data={data} trendData={trendData} themed showArea height={200} xLabels={xLabels} todayIndex={data.length - 1} />
      </Frame>,
    );
    await page.screenshot({ path: `${SCREENS}/weight-trend-01-falling.png` });
  });

  test('serie muy ruidosa: la línea dorada filtra los picos', async () => {
    // A flat true trend buried under big up/down spikes (salt, carbs, etc.).
    const { data, trendData, xLabels } = series([80, 83.5, 78.6, 82.8, 79.0, 82.5, 78.8, 81.9]);
    render(
      <Frame title="Travesía del Peso">
        <TreasureLineChart data={data} trendData={trendData} themed showArea height={200} xLabels={xLabels} todayIndex={data.length - 1} />
      </Frame>,
    );
    await page.screenshot({ path: `${SCREENS}/weight-trend-02-noisy-smoothed.png` });
  });

  test('menos de 2 pesos: empty state informativo (no punitivo)', async () => {
    // Mirrors the NutritionCharts guard for < 2 weight entries.
    render(
      <Frame title="Travesía del Peso">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <p style={{ opacity: 0.65, fontStyle: 'italic', textAlign: 'center', fontFamily: "'IM Fell English', serif", color: 'var(--ink-faded)' }}>
            Registrá al menos 2 pesos para ver la tendencia
          </p>
        </div>
      </Frame>,
    );
    await page.screenshot({ path: `${SCREENS}/weight-trend-03-empty.png` });
  });
});
