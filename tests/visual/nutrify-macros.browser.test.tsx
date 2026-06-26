import { beforeAll, describe, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MacroBars } from '@modules/nutrition/components/Today';

import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/modules/nutrition/styles/nutri.css';

const SCREENS = 'screens';

// MacroBars recibe `t` como prop: fake que devuelve el fallback (español).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = ((k: string, d?: string) => d ?? k) as any;

// Helpers para construir las props sin arrastrar los tipos internos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const summary = (p: number, c: number, f: number) => ({ proteinG: p, carbsG: c, fatG: f } as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const targets = (p: number, c: number, f: number, auto: boolean) => ({ proteinG: p, carbsG: c, fatG: f, auto } as any);

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 380, padding: 20, background: 'var(--rpg-parchment, #efe3c8)' }}>
      {children}
    </div>
  );
}

beforeAll(() => {
  document.body.style.margin = '0';
});

describe('MacroBars — estados visuales', () => {
  test('por debajo del objetivo', async () => {
    render(<Frame><MacroBars summary={summary(80, 120, 30)} targets={targets(150, 220, 60, false)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macros-01-under.png` });
  });

  test('en el objetivo', async () => {
    render(<Frame><MacroBars summary={summary(148, 215, 58)} targets={targets(150, 220, 60, false)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macros-02-on-target.png` });
  });

  test('pasado del objetivo (informativo, no alarma)', async () => {
    render(<Frame><MacroBars summary={summary(190, 280, 85)} targets={targets(150, 220, 60, false)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macros-03-over.png` });
  });

  test('objetivos auto-sugeridos', async () => {
    render(<Frame><MacroBars summary={summary(60, 90, 25)} targets={targets(150, 220, 60, true)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macros-04-auto.png` });
  });

  test('sin macros consumidos (datos viejos pre-Fase 0)', async () => {
    render(<Frame><MacroBars summary={summary(0, 0, 0)} targets={targets(150, 220, 60, true)} t={t} /></Frame>);
    await page.screenshot({ path: `${SCREENS}/macros-05-empty.png` });
  });
});
