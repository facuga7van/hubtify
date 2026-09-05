import { beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from '@hub/AuthPage';
import Onboarding from '@hub/Onboarding';
import CodexSealModal from '@hub/codex/CodexSealModal';
import UpdateBanner from '@hub/UpdateBanner';
import UpdateNotification from '@hub/UpdateNotification';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import {
  installApi, SCREENS, WIDE, NARROW, fitCapture, resetCapture,
  overflowingNodes, clippedText, unlabelledButtons, lowContrastText, PARCH_WORST,
} from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';
import '../../src/hub/styles/codex-seal.css';

const baseAuth = {
  user: null, loading: false, switching: false,
  login: async () => ({ success: false }), register: async () => ({ success: false }),
  logout: async () => ({ success: true }), switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }), forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
} as unknown as React.ContextType<typeof AuthContext>;

const today = new Date().toISOString().slice(0, 10);

beforeAll(() => {
  document.body.style.margin = '0';
  installApi({
    rpgGetDaySummary: () => Promise.resolve({
      // Mismos nombres que devuelve el handler real (`rpg:getDaySummary`):
      // el stub no puede inventar campos que el main process no manda.
      date: today, sealed: false, totalXp: 148, eventsCount: 7, maxCombo: 3,
      modules: ['quests', 'nutrition', 'cauldron'], vigor: 84, streak: 9,
      events: [
        { moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 15, time: '09:12' },
        { moduleId: 'nutrition', eventType: 'MEAL_LOGGED', xpGained: 5, time: '13:40' },
        { moduleId: 'cauldron', eventType: 'POMODORO_COMPLETED', xpGained: 25, time: '16:02' },
      ],
    }),
    rpgGetSeals: () => Promise.resolve([
      { date: today, sealedAt: new Date().toISOString(), xpAwarded: 20 },
    ]),
  });
});

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Cuatro módulos con tres hechos cada uno: la página más ancha que el ledger
    puede pedir. Mismos nombres de campo que devuelve `rpg:getDaySummary`. */
const fourModules = () => ({
  date: today, isToday: true, sealed: false, seal: null,
  canSeal: true, sealBlockedReason: null, byModule: [],
  totalXp: 144, eventsCount: 12, maxCombo: 2,
  modules: ['quests', 'nutrition', 'finance', 'cauldron'], vigor: 84, streak: 9,
  events: [
    ...['09:12', '11:40', '18:05'].map((time) => ({ moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 15, time })),
    ...['08:30', '13:40', '21:10'].map((time) => ({ moduleId: 'nutrition', eventType: 'MEAL_LOGGED', xpGained: 5, time })),
    ...['10:02', '15:30', '19:45'].map((time) => ({ moduleId: 'finance', eventType: 'EXPENSE_LOGGED', xpGained: 3, time })),
    ...['09:00', '10:00', '16:02'].map((time) => ({ moduleId: 'cauldron', eventType: 'POMODORO_COMPLETED', xpGained: 25, time })),
  ],
});

function mountCodex(onClose: () => void = () => {}) {
  render(
    <MemoryRouter><ToastProvider><ConfirmProvider>
      <CodexSealModal date={today} onClose={onClose} onSelectDate={() => {}} />
    </ConfirmProvider></ToastProvider></MemoryRouter>,
  );
}

function report(tag: string, root: ParentNode) {
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({
    overflow: overflowingNodes(root).slice(0, 8),
    clipped: clippedText(root).slice(0, 8),
    noLabel: unlabelledButtons(root),
    bajoContraste: lowContrastText(root, PARCH_WORST).slice(0, 8),
  }, null, 1));
}

/** El nodo cabe entero en la ventana. */
function insideViewport(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return {
    offTop: Math.round(-r.top), offLeft: Math.round(-r.left),
    offRight: Math.round(r.right - window.innerWidth),
    offBottom: Math.round(r.bottom - window.innerHeight),
  };
}

describe('Puerta del Reino (AuthPage)', () => {
  for (const [name, size] of [['wide', WIDE], ['narrow', NARROW]] as const) {
    test(`entrada — ${name}`, async () => {
      await page.viewport(...size);
      resetCapture();
      render(
        <AuthContext.Provider value={baseAuth}>
          <AuthPage onAuth={() => {}} />
        </AuthContext.Provider>,
      );
      await expect.element(page.getByRole('button', { name: 'Entrar al Reino' })).toBeVisible();
      await settle(250);
      report(`AUTH ${name.toUpperCase()}`, document.body);
      fitCapture();
      await page.screenshot({ path: `${SCREENS}/audit-hub-auth-01-${name}.png` });
      resetCapture();
      expect(document.documentElement.scrollWidth - document.documentElement.clientWidth).toBeLessThanOrEqual(1);
    });
  }

  test('registro — el error de contraseña dice qué falta', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    render(
      <AuthContext.Provider value={baseAuth}>
        <AuthPage onAuth={() => {}} />
      </AuthContext.Provider>,
    );
    await page.getByRole('button', { name: '¿No tenés cuenta? Registrate' }).click();
    await page.getByPlaceholder('Nombre de usuario').fill('aventurero');
    await page.getByPlaceholder('Correo electrónico').fill('test@hubtify.app');
    await page.getByPlaceholder('Contraseña').fill('123');
    await page.getByRole('button', { name: 'Crear Cuenta' }).click();
    await expect.element(page.getByText(/al menos 6 caracteres/i)).toBeVisible();
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-auth-02-error.png` });
    resetCapture();
  });
});

describe('Onboarding', () => {
  for (const [name, size] of [['wide', WIDE], ['narrow', NARROW]] as const) {
    test(`primer paso — ${name}`, async () => {
      await page.viewport(...size);
      resetCapture();
      render(
        <MemoryRouter>
          <ToastProvider><ConfirmProvider>
            <Onboarding onComplete={() => {}} />
          </ConfirmProvider></ToastProvider>
        </MemoryRouter>,
      );
      await settle(300);
      report(`ONBOARDING ${name.toUpperCase()}`, document.body);
      const shell = document.querySelector('.onboarding-page, .auth-page') as HTMLElement | null;
      const card = document.querySelector('.onboarding-card, .auth-card') as HTMLElement | null;
      // eslint-disable-next-line no-console
      console.log(`ONBOARDING ${name.toUpperCase()} ALTO`, JSON.stringify({
        shell: shell?.className,
        shellScroll: shell ? shell.scrollHeight - shell.clientHeight : null,
        shellOverflowY: shell ? getComputedStyle(shell).overflowY : null,
        cardBottomOffViewport: card ? Math.round(card.getBoundingClientRect().bottom - window.innerHeight) : null,
        docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }, null, 1));
      fitCapture();
      await page.screenshot({ path: `${SCREENS}/audit-hub-onboarding-01-${name}.png` });
      resetCapture();
      expect(document.documentElement.scrollWidth - document.documentElement.clientWidth).toBeLessThanOrEqual(1);
    });
  }

  test('avanza de paso y el shell no desborda a lo alto', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    render(
      <MemoryRouter>
        <ToastProvider><ConfirmProvider>
          <Onboarding onComplete={() => {}} />
        </ConfirmProvider></ToastProvider>
      </MemoryRouter>,
    );
    await settle(300);
    await page.getByRole('button', { name: /Comenzar Aventura/i }).click();
    await settle(400);
    report('ONBOARDING PASO 2', document.body);
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-onboarding-02-paso2.png` });
    resetCapture();
    expect(document.documentElement.scrollWidth - document.documentElement.clientWidth).toBeLessThanOrEqual(1);
  });
});

describe('Cierre del Códice (CodexSealModal)', () => {
  for (const [name, size] of [['wide', WIDE], ['narrow', NARROW]] as const) {
    test(`la página del día entra en la ventana — ${name}`, async () => {
      await page.viewport(...size);
      resetCapture();
      let closed = false;
      render(
        <MemoryRouter><ToastProvider><ConfirmProvider>
          <CodexSealModal date={today} onClose={() => { closed = true; }} onSelectDate={() => {}} />
        </ConfirmProvider></ToastProvider></MemoryRouter>,
      );
      await settle(1400);

      const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
      report(`CODEX ${name.toUpperCase()}`, dlg);
      // ¿El sello —el único botón que cierra el día— entra en pantalla?
      const seal = dlg.querySelector('.codex-seal-btn, .codex-seal__wax, button[class*="seal"]') as HTMLElement | null;
      const scrollers = [...dlg.querySelectorAll('*')]
        .filter((el) => el.scrollHeight - el.clientHeight > 4)
        .map((el) => ({ sel: (el as HTMLElement).className, over: el.scrollHeight - el.clientHeight }));
      // Lo que se sale por ABAJO de la ventana, sea hijo del diálogo o no.
      const belowFold = [...dlg.querySelectorAll('*')]
        .map((el) => ({ sel: (el as HTMLElement).className || el.tagName, off: Math.round(el.getBoundingClientRect().bottom - window.innerHeight) }))
        .filter((x) => x.off > 2)
        .sort((a, b) => b.off - a.off);
      // Chips de módulo: se ven fantasmales en la captura.
      const chips = [...dlg.querySelectorAll('[class*="chip"], [class*="module"], [class*="rune"]')]
        .slice(0, 6)
        .map((el) => ({ sel: (el as HTMLElement).className, op: getComputedStyle(el).opacity, color: getComputedStyle(el).color }));
      // eslint-disable-next-line no-console
      console.log(`CODEX ${name.toUpperCase()} SELLO`, JSON.stringify({
        seal: seal?.className,
        sealBottomOff: seal ? Math.round(seal.getBoundingClientRect().bottom - window.innerHeight) : null,
        scrollers: scrollers.slice(0, 5),
        vOverflowDialog: dlg.scrollHeight - dlg.clientHeight,
        dialogOverflowY: getComputedStyle(dlg).overflowY,
        // Si offsetWidth == clientWidth no hay barra pintada: el modal scrollea
        // pero nada lo anuncia.
        scrollbarPx: dlg.offsetWidth - dlg.clientWidth,
        scrollbarWidthCss: getComputedStyle(dlg).scrollbarWidth,
        bookOverflowY: (() => { const b = dlg.querySelector('.codex-book') as HTMLElement | null; return b ? { of: getComputedStyle(b).overflowY, scroll: b.scrollHeight - b.clientHeight, h: Math.round(b.getBoundingClientRect().height) } : null; })(),
        belowFold: belowFold.slice(0, 5),
        chips,
      }, null, 1));
      // eslint-disable-next-line no-console
      console.log(`CODEX ${name.toUpperCase()} CAJA`, JSON.stringify(insideViewport(dlg), null, 1));

      fitCapture();
      await page.screenshot({ path: `${SCREENS}/audit-hub-codex-01-${name}.png` });
      resetCapture();

      // «XP DEL DÍA» pinta un número, no «+NaN» (el modal leía un campo que
      // el handler no devuelve).
      const xpValue = dlg.querySelector('.codex-cartouches .qb-cartouche-value') as HTMLElement;
      expect(xpValue.textContent).toBe('+148');
      expect(dlg.textContent).not.toMatch(/NaN/);

      const box = insideViewport(dlg);
      expect(box.offTop).toBeLessThanOrEqual(1);
      expect(box.offBottom).toBeLessThanOrEqual(1);
      expect(box.offLeft).toBeLessThanOrEqual(1);
      expect(box.offRight).toBeLessThanOrEqual(1);

      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(150);
      expect(closed).toBe(true);
    });
  }

  /* La página del día mide ~1000 px: SIEMPRE hay que scrollear para llegar al
     lacre. Con el scroll en `.codex-modal` y la X en `position: absolute`
     contra ese mismo elemento, la cruz se iba con el contenido y quedaba fuera
     de pantalla justo después de sellar. En escritorio zafabas con Escape o el
     backdrop; en touch no hay teclado y el modal ocupa 96vw, así que quedabas
     encerrado. Este test fija las dos mitades del arreglo. */
  test('la salida sigue a mano después de scrollear hasta el lacre', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    render(
      <MemoryRouter><ToastProvider><ConfirmProvider>
        <CodexSealModal date={today} onClose={() => {}} onSelectDate={() => {}} />
      </ConfirmProvider></ToastProvider></MemoryRouter>,
    );
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const scroller = dlg.querySelector('.codex-modal__scroll') as HTMLElement;
    expect(scroller).not.toBeNull();

    // El marco no scrollea; el que scrollea es el wrapper de adentro.
    expect(dlg.scrollHeight - dlg.clientHeight).toBeLessThanOrEqual(1);
    expect(scroller.scrollHeight - scroller.clientHeight).toBeGreaterThan(100);

    scroller.scrollTop = scroller.scrollHeight;
    await settle(120);

    const close = dlg.querySelector('.codex-modal__close') as HTMLElement;
    const box = insideViewport(close);
    // eslint-disable-next-line no-console
    console.log('CODEX SALIDA', JSON.stringify({ ...box, scrollTop: scroller.scrollTop }, null, 1));
    expect(box.offTop).toBeLessThanOrEqual(1);
    expect(box.offBottom).toBeLessThanOrEqual(1);
    expect(box.offRight).toBeLessThanOrEqual(1);
    // …y del tamaño de un dedo.
    const r = close.getBoundingClientRect();
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(32);
  });

  test('la página ya sellada ofrece su propia salida, al pie del lacre', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    let closed = false;
    installApi({
      rpgGetDaySummary: () => Promise.resolve({
        date: today, sealed: true, totalXp: 148, eventsCount: 7, maxCombo: 3,
        modules: ['quests'], vigor: 84, streak: 9,
        events: [{ moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 15, time: '09:12' }],
      }),
      rpgGetSeals: () => Promise.resolve([
        { date: today, sealedAt: new Date().toISOString(), xpAwarded: 20 },
      ]),
    });
    render(
      <MemoryRouter><ToastProvider><ConfirmProvider>
        <CodexSealModal date={today} onClose={() => { closed = true; }} onSelectDate={() => {}} />
      </ConfirmProvider></ToastProvider></MemoryRouter>,
    );
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const exit = dlg.querySelector('.codex-sealed__exit') as HTMLButtonElement;
    expect(exit).not.toBeNull();
    expect(exit.textContent?.trim()).toBeTruthy();

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-codex-02-salida.png` });
    resetCapture();

    exit.click();
    await settle(120);
    expect(closed).toBe(true);
  });

  /* ── el ledger a cuatro módulos ──
     `.codex-marginalia` es `auto-fit`: con minmax(240px) y 816 px de página
     salían TRES columnas de ~250 px, y `.qb-section` sin `min-width: 0` no
     cedía. A 900 px de ventana tienen que ser dos como máximo; a 600, una.
     La tercera corrida sube `--font-scale` a 1.3 (theme.css:13): el usuario
     puede tener la escala configurada y eso es lo que muestra su captura. Y
     la X tiene disco propio: el título termina antes de donde ella empieza. */
  for (const [width, maxCols, scale] of [[900, 2, '1'], [600, 1, '1'], [900, 2, '1.3']] as const) {
    test(`el ledger de cuatro módulos entra a ${width}px (escala ${scale}) y no pasa de ${maxCols} columna(s)`, async () => {
      await page.viewport(width, 720);
      resetCapture();
      document.documentElement.style.setProperty('--font-scale', scale);
      installApi({ rpgGetDaySummary: () => Promise.resolve(fourModules()), rpgGetSeals: () => Promise.resolve([]) });
      mountCodex();
      await settle(1400);

      try {
        const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
        const scroller = dlg.querySelector('.codex-modal__scroll') as HTMLElement;
        const ledger = dlg.querySelector('.codex-marginalia') as HTMLElement;
        expect(ledger).not.toBeNull();
        const tracks = getComputedStyle(ledger).gridTemplateColumns.trim().split(/\s+/);
        // eslint-disable-next-line no-console
        console.log(`CODEX LEDGER ${width} x${scale}`, JSON.stringify({
          tracks, scrollW: scroller.scrollWidth, clientW: scroller.clientWidth,
          overflow: overflowingNodes(dlg).slice(0, 8),
        }, null, 1));

        fitCapture();
        await page.screenshot({ path: `${SCREENS}/audit-hub-codex-03-ledger-${width}-x${scale}.png` });
        resetCapture();

        // Nada se sale a lo ancho del scroller.
        expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
        // Ni una columna de más.
        expect(tracks.length).toBeLessThanOrEqual(maxCols);
        // Cada sección cede y queda dentro del ledger. El `minWidth` es un
        // assert de IMPLEMENTACIÓN a propósito: es la causa raíz que se fija.
        const ledgerRight = ledger.getBoundingClientRect().right;
        for (const section of ledger.querySelectorAll('.qb-section')) {
          expect(getComputedStyle(section).minWidth).toBe('0px');
          expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(ledgerRight + 1);
        }
        // La X es un disco con fondo, y el título le deja el lugar.
        const close = dlg.querySelector('.codex-modal__close') as HTMLElement;
        const title = dlg.querySelector('.qb-title') as HTMLElement;
        expect(getComputedStyle(close).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(close).borderTopLeftRadius).toBe('50%');
        expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(close.getBoundingClientRect().left + 1);
      } finally {
        document.documentElement.style.removeProperty('--font-scale');
      }
    });
  }
});

describe('Avisos de actualización', () => {
  test('la cinta no tapa nada ni se sale, y el detalle abre y cierra', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    render(
      <UpdateBanner
        version="0.9.0" state="idle" percent={0} error={null}
        onViewDetails={() => {}} onRestart={() => {}} onDismiss={() => {}}
      />,
    );
    await settle(250);
    const banner = document.querySelector('.update-chip, .update-banner') as HTMLElement
      ?? (document.body.firstElementChild as HTMLElement);
    report('UPDATE BANNER', document.body);
    // eslint-disable-next-line no-console
    console.log('UPDATE BANNER CAJA', JSON.stringify(insideViewport(banner), null, 1));
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-update-01-banner.png` });
    resetCapture();

    const b = insideViewport(banner);
    expect(b.offRight).toBeLessThanOrEqual(1);
    expect(b.offBottom).toBeLessThanOrEqual(1);
  });

  test('el error de descarga se lee', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    render(
      <UpdateNotification
        version="0.9.0" state="idle" percent={0}
        error="ERR_INTERNET_DISCONNECTED"
        onDownload={() => {}} onRestart={() => {}} onDismiss={() => {}}
      />,
    );
    await settle(250);
    report('UPDATE NOTIF ERROR', document.body);
    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-update-02-error.png` });
    resetCapture();

    // La constante cruda de Chromium no se muestra: se explica y se ofrece
    // una salida. El código sigue estando, en el `title`, para el reporte.
    await expect.element(page.getByText(/Revisá tu conexión/i)).toBeVisible();
    expect(document.body.textContent).not.toContain('ERR_INTERNET_DISCONNECTED');
    expect(document.querySelector('[role="alert"]')?.getAttribute('title'))
      .toBe('ERR_INTERNET_DISCONNECTED');
  });
});
