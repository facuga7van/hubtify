import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MacroHistory } from '@modules/nutrition/components/MacroHistory';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';

// MacroHistory recibe `t` como prop: fake que devuelve el fallback (español),
// soportando interpolación {{count}} como i18next.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = ((k: string, d?: string, opts?: Record<string, unknown>) => {
  let out = d ?? k;
  if (opts) for (const [key, val] of Object.entries(opts)) out = out.replace(`{{${key}}}`, String(val));
  return out;
}) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const day = (date: string, p: number, c: number, f: number) =>
  ({ date, totalCaloriesIn: p * 4 + c * 4 + f * 9, bmr: 1500, tdee: 2200, balance: 0, proteinG: p, carbsG: c, fatG: f } as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const targets = (p: number, c: number, f: number, auto: boolean) => ({ proteinG: p, carbsG: c, fatG: f, auto } as any);

// Card wrapper that mirrors the real chronicle chart card so styles apply.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 460, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      <div className="nutri-card medieval nutri-chart-card">
        <h3 className="nutri-card-title">Balance de Nutrientes</h3>
        {children}
      </div>
    </div>
  );
}

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('MacroHistory — estados visuales', () => {
  test('rango corto con datos (promedio cerca del objetivo)', async () => {
    const summaries = [
      day('2026-06-20', 140, 200, 55),
      day('2026-06-21', 150, 210, 62),
      day('2026-06-22', 160, 230, 58),
      day('2026-06-23', 145, 205, 60),
      day('2026-06-24', 155, 225, 64),
    ];
    render(<Frame><MacroHistory summaries={summaries} targets={targets(150, 220, 60, false)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macro-history-01-with-data.png` });
  });

  test('rango largo, objetivos auto, alguno por encima', async () => {
    const summaries = Array.from({ length: 40 }, (_, i) => {
      const d = String(i + 1).padStart(2, '0');
      // alterna por debajo y por encima para promediar alto en grasa
      return day(`2026-05-${d > '31' ? '31' : d}`, 120 + (i % 5) * 12, 180 + (i % 7) * 14, 65 + (i % 4) * 6);
    });
    render(<Frame><MacroHistory summaries={summaries} targets={targets(150, 220, 60, true)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macro-history-02-long-auto.png` });
  });

  test('sin datos de macros (días viejos pre-Fase 0)', async () => {
    const summaries = [
      day('2026-06-20', 0, 0, 0),
      day('2026-06-21', 0, 0, 0),
    ];
    render(<Frame><MacroHistory summaries={summaries} targets={targets(150, 220, 60, true)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macro-history-03-empty.png` });
  });
});
