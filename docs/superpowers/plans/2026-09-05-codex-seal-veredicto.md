# Codex Seal Veredicto Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la página del Cierre del Códice (`CodexSealModal`) como «un solo veredicto»: cuatro zonas, cada dato una sola vez, un único número héroe (el +XP del sello), el ledger a dos columnas como máximo sin desbordar, la X con disco propio, una media query propia bajo 640 px, el cierre de comidas como fila del ledger, la salida en el pie, y sin la bolsa. Según la spec aprobada `docs/superpowers/specs/2026-09-05-codex-seal-veredicto-design.md`.

**Architecture:** Todo vive en el renderer: `src/hub/codex/CodexSealModal.tsx` (React 19), `src/hub/codex/nutritionClose.ts` (devuelve el `xpGained` que pagó el motor), `src/hub/styles/codex-seal.css`, `src/shared/components/codex/codex.css` (sólo `min-width: 0` en `.qb-section`) y los catálogos `src/i18n/{es,en}.json` (claves `rpg.codex*`). Nada de IPC ni de `shared-logic`. El contrato con el backend no cambia: `tests/ipc/rpg-codex-contract.test.ts` lee el fuente del modal con `/rpg\.codexXpToday[\s\S]{0,200}?summary\.(\w+)/` y ese par (clave + `summary.totalXp`) se mantiene a menos de 200 caracteres. La ceremonia GSAP (`src/shared/animations/seal.ts`) sigue encontrando `[data-seal="wax|stamp|halo|result"]`. Los tests visuales corren en Chromium real (`vitest --project browser`) y son la única forma de renderizar el modal.

**Tech Stack:** TypeScript 5.7, React 19, react-i18next, Vitest 4 (`--project unit` en Node, `--project browser` con Playwright/Chromium), CSS plano con tokens de `theme.css`.

---

## Reglas para todo el plan

- **Tests visuales**: `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` (script `test:visual` de `package.json:20` = `vitest run --project browser`). Para un solo test: agregar `-t "<parte del nombre>"`. Los `console.log` del test sólo se ven con `--silent=false`. Duración ~10-20 s por corrida.
- **Tests unitarios**: `npm test -- <archivo>` (script `test` de `package.json:18`, corre vitest dentro de Electron en modo Node; `npx vitest` directo falla por ABI de better-sqlite3).
- **Typecheck**: `npx tsc --noEmit`.
- **No hacer build.** El usuario lo hace.
- **Commits**: `type(codex): descripción` o `type(ui): …`, SIN Co-Authored-By ni atribución a IA.
- **TDD**: primero el test, correrlo y VER que falla por el motivo esperado, recién ahí implementar.
- **Herramientas**: `rg`, `fd`, `bat`, `sd` (no `grep`/`cat`/`find`/`sed`). Si `bat`/`fd` no están instalados en la máquina, usar la herramienta Read del agente.
- **Tokens**: sólo `--fs-*`, `--ff-*`, colores canónicos. Nada nuevo a 28 px fuera de `.codex-sealed__xp`.
- **Contraste**: todo `color: var(--gold-dark)` nuevo lleva `/* contrast-ok: <razón ≥ 8 caracteres> */` en la línea anterior (lo verifica `tests/shared/css-ink-contrast.test.ts`).
- **Vocabulario** (`tests/i18n/vocabulario-unico.test.ts`): ninguna cadena nueva dice «tarea», «meta», «ritual», «salud» ni «HP» suelto; `es.json` y `en.json` tienen la misma cantidad de claves.
- **Líneas**: los números de línea citados son los del archivo ANTES de empezar el plan; después de la Task 1 buscar por contenido.
- Antes de cada commit: `npx tsc --noEmit` en verde + los tests del archivo tocado en verde.

---

## Chunk 1: layout — grilla, X y responsive

### Task 1: El ledger no pasa de dos columnas y la X tiene disco propio

**Files:**
- Modify: `src/shared/components/codex/codex.css:152-155` (`.qb-section`)
- Modify: `src/hub/styles/codex-seal.css:87-102` (`.codex-modal__close`), `:109-111` (`.codex-book`), `:140-144` (`.codex-marginalia`)
- Test: `tests/visual/audit-hub-modals.browser.test.tsx` (fixture + helper cerca de `:55`, test nuevo dentro del `describe('Cierre del Códice (CodexSealModal)')` antes del `});` de `:311`)

- [ ] **Paso 1.1 — Fixture y helper.** En `tests/visual/audit-hub-modals.browser.test.tsx`, después de `const settle = …` (línea 55), agregar:

```tsx
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
```

- [ ] **Paso 1.2 — Test que falla.** Dentro del `describe('Cierre del Códice (CodexSealModal)')`, después del test `'la página ya sellada ofrece su propia salida, al pie del lacre'` (termina en la línea 310) y antes del `});` del describe, agregar:

```tsx
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
```

- [ ] **Paso 1.3 — Verlo fallar.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "ledger de cuatro"`. Esperado: los tres tests fallan en `expect(tracks.length).toBeLessThanOrEqual(maxCols)` — 3 tracks a 900 px (escala 1 y 1.3: la grilla es en px, no en em), 2 a 600 px. Si por algún motivo los tracks pasaran, el siguiente rojo es `borderTopLeftRadius` (`3px` hoy). (Con `--silent=false` se ve el `CODEX LEDGER` con los tracks.) NOTAS: `scrollWidth <= clientWidth` pasa ya hoy — el desborde horizontal NO se reproduce en el arnés; y el assert del título contra la X TAMBIÉN pasa hoy en escritorio (la X arranca en R−43 y el título termina en R−37, pero el borde derecho del título es el del bloque, no del texto: ver Discrepancias 2). Los dos quedan como guardias, no como el rojo de este paso.

- [ ] **Paso 1.4 — `min-width: 0` en `.qb-section`.** En `src/shared/components/codex/codex.css`, reemplazar:

```css
.qb-section {
  position: relative;
  margin-bottom: 10px;
}
```

por:

```css
.qb-section {
  position: relative;
  margin-bottom: 10px;
  /* Como ítem de grilla (el ledger del Códice a dos columnas) el mínimo
     automático es el min-content del contenido: la sección empuja la columna
     en vez de ceder. Con cero, la columna manda y el texto de cada fila cede
     con sus puntos suspensivos. */
  min-width: 0;
}
```

- [ ] **Paso 1.5 — La X como disco y el lugar reservado.** En `src/hub/styles/codex-seal.css`, reemplazar el bloque `.codex-modal__close { … }` (líneas 87-102) por:

```css
.codex-modal__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 20;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--ink-soft);
  /* Un disco con pergamino atrás: la X es absoluta contra el marco y el
     contenido scrollea por debajo; sin fondo se mezclaba con el título. */
  background: var(--parch-1);
  border: 1px solid var(--gold-dark);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(42, 29, 14, 0.25);
  cursor: pointer;
}
```

y reemplazar:

```css
.codex-book {
  padding-top: 20px;
}
```

por:

```css
.codex-book {
  padding-top: 20px;
}

/* El título nunca arranca debajo del disco de la X. Con prefijo a propósito:
   `.qb-header-text` es del sistema y en las páginas normales no hay X. */
.codex-book .qb-header-text {
  padding-right: 48px;
}
```

- [ ] **Paso 1.6 — Dos columnas como máximo.** En `src/hub/styles/codex-seal.css`, reemplazar:

```css
.codex-marginalia {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 4px 20px;
}
```

por:

```css
.codex-marginalia {
  display: grid;
  /* Dos columnas como máximo, sin hardcodear `repeat(2, …)`: la página mide
     816 px como mucho (880 de marco − 2 de borde − 8 de scrollbar − 56 de
     padding), así que entran dos de 320 y nunca tres; y con un solo módulo la
     sección ocupa la página entera. Antes minmax(240px) daba tres columnas de
     ~250 px: una bitácora a tres columnas es una tabla, no un ledger. */
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 4px 20px;
}
```

- [ ] **Paso 1.7 — Verde.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` (el archivo entero: los tres tests viejos del Códice tienen que seguir verdes, en particular «la salida sigue a mano…» que exige X ≥ 32 px y dentro del viewport). `npm test -- tests/shared/css-ink-contrast.test.ts`.

- [ ] **Paso 1.8 — Commit.** `git add src/shared/components/codex/codex.css src/hub/styles/codex-seal.css tests/visual/audit-hub-modals.browser.test.tsx && git commit -m "fix(codex): el ledger no pasa de dos columnas y la X tiene disco propio"`

### Task 2: La página se aprieta bajo 640 px

**Files:**
- Modify: `src/hub/styles/codex-seal.css` (`.codex-sealed__text` en `:320-322`; bloque `@media` nuevo antes de `/* ── Mobile (390 px; Fase 3) ──` en `:1118`)
- Test: `tests/visual/audit-hub-modals.browser.test.tsx` (después del test de la Task 1)

- [ ] **Paso 2.1 — Test que falla.** Agregar después del `for` de la Task 1:

```tsx
  /* Bajo 640 px de ventana el modal se aprieta. Media query de VENTANA a
     propósito: el modal es fixed y mide min(880px, 96vw), así que acá el
     viewport SÍ es el ancho del modal (a diferencia del shell, donde la barra
     lateral se come parte). */
  test('a 600px la página se aprieta: 16px de margen, sello de 72 y salida a lo ancho', async () => {
    await page.viewport(600, 720);
    resetCapture();
    installApi({
      rpgGetDaySummary: () => Promise.resolve({ ...fourModules(), sealed: true, canSeal: false, sealBlockedReason: 'already_sealed' }),
      rpgGetSeals: () => Promise.resolve([{ date: today, sealedAt: new Date().toISOString(), xpAwarded: 20 }]),
    });
    mountCodex();
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const book = dlg.querySelector('.codex-book') as HTMLElement;
    const disc = dlg.querySelector('.codex-seal-disc') as HTMLElement;
    const exit = dlg.querySelector('.codex-sealed__exit') as HTMLElement;
    expect(disc).not.toBeNull();
    expect(exit).not.toBeNull();

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-codex-03-ledger-600-sellado.png` });
    resetCapture();

    expect(getComputedStyle(book).paddingLeft).toBe('16px');
    expect(getComputedStyle(book).paddingTop).toBe('16px');
    // offsetWidth y no getBoundingClientRect: el sello está rotado -6°.
    expect(disc.offsetWidth).toBe(72);
    // La salida ocupa el ancho de la página (clientWidth incluye el padding).
    const bookInner = book.clientWidth - 32;
    expect(exit.getBoundingClientRect().width).toBeGreaterThanOrEqual(bookInner - 2);
    const box = insideViewport(dlg);
    expect(box.offLeft).toBeLessThanOrEqual(1);
    expect(box.offRight).toBeLessThanOrEqual(1);
  });
```

- [ ] **Paso 2.2 — Verlo fallar.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "a 600px"`. Esperado: falla en `paddingLeft` (`28px`).

- [ ] **Paso 2.3 — `.codex-sealed__text` a ancho completo.** En `codex-seal.css`, reemplazar:

```css
.codex-sealed__text {
  text-align: center;
}
```

por:

```css
.codex-sealed__text {
  /* Hijo de un flex column con `align-items: center`: sin ancho propio se
     encogía a su contenido, y el `width: 100%` del botón de salida era el
     100 % de una caja encogida. */
  width: 100%;
  text-align: center;
}
```

- [ ] **Paso 2.4 — La media query.** En `codex-seal.css`, justo ANTES del comentario `/* ── Mobile (390 px; Fase 3) ──` (línea 1118), insertar:

```css
/* ── Angosto (≤ 640 px de ventana) ───────────────────
   El modal es `position: fixed` y mide min(880px, 96vw): a diferencia del
   shell, acá el ancho de ventana SÍ es el ancho del modal, así que la media
   query es exacta. Cubre el teléfono (390) y la ventana angosta del arnés
   (600). Va ANTES del bloque [data-shell="mobile"]: el teléfono sigue
   ganando donde ya manda (X de 40 px, salida de 44 de alto). */
@media (max-width: 640px) {
  .codex-book { padding: 16px; }
  .codex-marginalia { grid-template-columns: 1fr; }
  .codex-seal-disc { width: 72px; height: 72px; }
  .codex-sealed__exit { width: 100%; }
}
```

- [ ] **Paso 2.5 — Verde.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx`.

- [ ] **Paso 2.6 — Commit.** `git add src/hub/styles/codex-seal.css tests/visual/audit-hub-modals.browser.test.tsx && git commit -m "feat(codex): la página del día se aprieta bajo 640px"`

---

## Chunk 2: el ledger

### Task 3: La línea de cierre del ledger; se van cartuchos y runas

**Files:**
- Modify: `src/hub/codex/CodexSealModal.tsx:6-21` (imports), `:452-532` (cartuchos + runas + divisor + marginalia)
- Modify: `src/hub/styles/codex-seal.css:113-136` (cartuchos, runas), `:1118-1124` (comentario + regla mobile de cartuchos), nuevo `.codex-ledger-total`
- Modify: `src/i18n/es.json` y `src/i18n/en.json` (sección `rpg`, después de `codexHoldToSeal`)
- Test: `tests/visual/audit-hub-modals.browser.test.tsx:220-224`
- Test (debe seguir verde; sólo cambian un comentario y el nombre del helper): `tests/ipc/rpg-codex-contract.test.ts:51-61,77`

- [ ] **Paso 3.1 — Test que falla.** En `tests/visual/audit-hub-modals.browser.test.tsx`, reemplazar las líneas 220-224:

```tsx
      // «XP DEL DÍA» pinta un número, no «+NaN» (el modal leía un campo que
      // el handler no devuelve).
      const xpValue = dlg.querySelector('.codex-cartouches .qb-cartouche-value') as HTMLElement;
      expect(xpValue.textContent).toBe('+148');
      expect(dlg.textContent).not.toMatch(/NaN/);
```

por:

```tsx
      // La línea de cierre del ledger pinta un número, no «+NaN» (el modal
      // leía un campo que el handler no devuelve).
      const xpValue = dlg.querySelector('.codex-ledger-total__xp') as HTMLElement;
      expect(xpValue.textContent).toBe('+148');
      expect(dlg.querySelector('.codex-ledger-total')?.textContent?.replace(/\s+/g, ' ')).toContain('7 hechos');
      // Un número por dato: no quedan cartuchos ni runas de módulo.
      expect(dlg.querySelector('.codex-cartouches, .codex-module-seals, .qb-cartouche')).toBeNull();
      expect(dlg.textContent).not.toMatch(/NaN/);
```

- [ ] **Paso 3.2 — Verlo fallar.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "entra en la ventana"`. Esperado: `TypeError: Cannot read properties of null (reading 'textContent')` en `xpValue`.

- [ ] **Paso 3.3 — Imports.** En `CodexSealModal.tsx`, reemplazar las líneas 6-21:

```tsx
import {
  Cartouche,
  QBDividerSection,
  Rune,
  Section,
} from '../../shared/components/codex/CodexPrimitives';
import {
  Cauldron,
  Dagger,
  FloralHeart,
  Flame,
  Quill,
  Scroll,
  Sparkle,
  Sword,
} from '../../shared/components/icons';
```

por:

```tsx
import { QBDividerSection, Section } from '../../shared/components/codex/CodexPrimitives';
import {
  Cauldron,
  Dagger,
  FloralHeart,
  Scroll,
  Sparkle,
  Sword,
} from '../../shared/components/icons';
```

- [ ] **Paso 3.4 — El ledger cierra con una línea.** En `CodexSealModal.tsx`, reemplazar TODO el tramo desde `{/* ── the day's numbers ────────────────────── */}` (línea 452) hasta el cierre del ternario del marginalia (línea 532, el `)}` después de `</p>` de `codexEmptyDay`) por:

```tsx
        {/* ── zona 2: el ledger, los hechos del día por módulo ── */}
        {grouped.length > 0 ? (
          <>
            <div className="codex-marginalia">
              {grouped.map(({ moduleId, events }) => (
                <Section
                  key={moduleId}
                  title={moduleLabel(moduleId, t).toUpperCase()}
                  icon={<span className="codex-marginalia__icon">{moduleIcon(moduleId)}</span>}
                  rightSlot={<span className="qb-numeral codex-marginalia__count">{events.length}</span>}
                >
                  <ul className="codex-marginalia__list">
                    {events.map((ev, i) => {
                      const label = t(`events.${ev.eventType}`);
                      const text = label !== `events.${ev.eventType}` ? label : ev.eventType;
                      return (
                        <li key={`${moduleId}-${i}`} className="codex-marginalia__row">
                          <span className="qb-hand codex-marginalia__time">{formatTime(ev.time, locale)}</span>
                          <span className="codex-marginalia__text" title={text}>{text}</span>
                          <span className="qb-numeral codex-marginalia__xp">
                            {ev.xpGained >= 0 ? '+' : ''}{Math.round(ev.xpGained)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              ))}
            </div>
            {/* La línea de cierre del ledger: el total del día, UNA vez, en el
                registro de las filas. El `title` del número es el rótulo de la
                cartela de antes («XP DEL DÍA»); el test de contrato del Códice
                (tests/ipc) busca esa clave en este fuente y lee el campo del
                summary que viene a menos de 200 caracteres: no separar el
                `title` del número, y no repetir la clave ni el campo en ningún
                comentario (la regex los matchearía acá). El vigor no está: ya
                vive en la barra lateral. */}
            <p className="qb-small-caps codex-ledger-total">
              <span className="codex-ledger-total__xp" title={t('rpg.codexXpToday', 'XP DEL DÍA')}>
                +{Math.round(summary.totalXp)}
              </span>
              {' '}{t('rpg.codexXpUnit', 'XP')}
              {' · '}
              {t('rpg.codexLedgerDeeds', { count: summary.eventsCount, defaultValue: '{{count}} hechos' })}
              {' · '}
              {t('rpg.codexLedgerCombo', { n: summary.maxCombo, defaultValue: 'combo ×{{n}}' })}
            </p>
          </>
        ) : (
          <p className="codex-note">
            {t('rpg.codexEmptyDay', 'El códice registra días vividos. Volvé cuando haya algo que anotar.')}
          </p>
        )}
```

  (Se van: los cuatro `<Cartouche>`, el `.codex-module-seals` con sus `<Rune>`, y el primer `<QBDividerSection />` — el `.qb-rule` de la cabecera ya separa. El `<QBDividerSection />` que viene DESPUÉS de `.codex-phrase` queda.)

- [ ] **Paso 3.5 — i18n.** En `src/i18n/es.json`, dentro de `"rpg"`, después de la línea `"codexHoldToSeal": "Mantené apretado para sellar el día",` agregar:

```json
    "codexLedgerCombo": "combo ×{{n}}",
    "codexLedgerDeeds_one": "{{count}} hecho",
    "codexLedgerDeeds_other": "{{count}} hechos",
```

  En `src/i18n/en.json`, después de `"codexHoldToSeal": "Press and hold to seal the day",`:

```json
    "codexLedgerCombo": "combo ×{{n}}",
    "codexLedgerDeeds_one": "{{count}} deed",
    "codexLedgerDeeds_other": "{{count}} deeds",
```

- [ ] **Paso 3.6 — CSS.** En `codex-seal.css`, reemplazar el tramo desde `/* ── the day's numbers ────────────────────────────── */` (línea 113) hasta el cierre de `.codex-module-seal { … }` (línea 136) por:

```css
/* ── the day's numbers ────────────────────────────── */
/* La línea de cierre del ledger: UNA vez el total, en el registro de las
   filas (small caps a --fs-label). Los cuatro cartuchos que había arriba
   decían lo mismo a 28 px y competían con el +XP del sello, también a 28 px
   y también en musgo; las runas de módulo repetían los títulos de sección. */
.codex-ledger-total {
  margin: 10px 0 0;
  text-align: center;
  color: var(--ink-soft);
}

.codex-ledger-total__xp {
  color: var(--moss);
}
```

  Y reemplazar (líneas 1118-1124):

```css
/* ── Mobile (390 px; Fase 3) ────────────────────────
   Va en esta hoja y no en layout.css: el @media de 720 px de arriba tiene la
   misma especificidad y se carga después. */
/* 4 → 2 a 720 px no alcanza: a 366 px cada cartucho tiene 153 px. */
[data-shell="mobile"] .codex-cartouches {
  grid-template-columns: 1fr;
}
```

  por:

```css
/* ── Mobile (390 px; Fase 3) ────────────────────────
   Va en esta hoja y no en layout.css: el @media de 640 px de arriba tiene la
   misma especificidad y se carga después. */
```

- [ ] **Paso 3.7 — El ancla del contrato deja de hablar de la cartela.** En `tests/ipc/rpg-codex-contract.test.ts` (la regex y los asserts NO cambian), reemplazar las líneas 51-56:

```ts
/**
 * El nombre del campo que la cartela «XP DEL DÍA» del modal lee de `summary`,
 * sacado del propio código fuente: si alguien lo renombra en el modal, el test
 * lo sigue; si el handler deja de devolverlo, el test lo denuncia.
 */
function fieldReadByCodexXpCartouche(): string {
```

  por:

```ts
/**
 * El nombre del campo que la línea de cierre del ledger del modal
 * (`.codex-ledger-total__xp`, con `rpg.codexXpToday` como `title`) lee de
 * `summary`, sacado del propio código fuente: si alguien lo renombra en el
 * modal, el test lo sigue; si el handler deja de devolverlo, el test lo denuncia.
 */
function fieldReadByCodexLedgerTotal(): string {
```

  y en la línea 77 `const field = fieldReadByCodexXpCartouche();` → `const field = fieldReadByCodexLedgerTotal();`. Después: `rg -n "rpg\.codexXpToday" src/hub/codex/CodexSealModal.tsx` tiene que dar UNA sola línea (la del `title`); si da dos, un comentario repite la clave y hay que reescribirlo.

- [ ] **Paso 3.8 — Verde.** `npx tsc --noEmit` · `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` · `npm test -- tests/ipc/rpg-codex-contract.test.ts tests/i18n/vocabulario-unico.test.ts`. El de contrato tiene que seguir devolviendo `totalXp` como campo leído (si falla con «no se encontró la cartela», el `title` quedó a más de 200 caracteres de `summary.totalXp`: acercarlos).

- [ ] **Paso 3.9 — Commit.** `git add src/hub/codex/CodexSealModal.tsx src/hub/styles/codex-seal.css src/i18n/es.json src/i18n/en.json tests/visual/audit-hub-modals.browser.test.tsx tests/ipc/rpg-codex-contract.test.ts && git commit -m "refactor(codex): el ledger cierra con una línea; se van cartuchos y runas"`

### Task 4: El cierre de comidas es una fila de la sección de nutrición

**Files:**
- Modify: `src/hub/codex/nutritionClose.ts:16-20` (`NutritionCloseBreakdown`), `:73-93` (`closeNutritionDay`)
- Modify: `src/hub/codex/CodexSealModal.tsx` (después de `MODULE_ORDER` en `:66`; `load` en `:158-165`; estado `nutriAward` en `:199` — se MUEVE arriba de `load`; `setNutriAward` en `:227`; memo `grouped` en `:347-362`; render del ledger de la Task 3; párrafo `.codex-nutri__award`)
- Modify: `src/hub/styles/codex-seal.css` (`.codex-nutri__award`, `:1280-1285`)
- Test: `tests/hub/nutrition-close.test.ts:33,93-106`
- Test: `tests/visual/audit-hub-modals.browser.test.tsx`

  Sin claves i18n nuevas: la fila usa `events.DAY_SUMMARY` («Resumen del día», `es.json:962`), la misma etiqueta con la que el ledger pinta ese evento cuando el summary ya lo trae.

- [ ] **Paso 4.1 — Test unitario que falla: el XP de la fila es el que pagó el motor.** `breakdown.xpTotal` es el XP CRUDO del payload; el motor lo pasa por `calculateXpGain(base, combo, bonus) + milestoneXp` (`rpg-handlers.ts:500,554`; `DAY_SUMMARY` no es flat, `:105`) y `processRpgEvent` devuelve ese `xpGained` (`:658`), que hoy `closeNutritionDay` tira. En `tests/hub/nutrition-close.test.ts`, reemplazar la línea 33:

```ts
    processRpgEvent: (e: unknown) => { calls.rpg.push(e); return Promise.resolve({ xpGained: 42 }); },
```

  por:

```ts
    // El motor paga MÁS que el crudo (combo, bonus, milestone): 57 contra 42.
    processRpgEvent: (e: unknown) => { calls.rpg.push(e); return Promise.resolve({ xpGained: 57 }); },
```

  y en el test `'guarda métricas, cierra y paga el XP UNA vez'` reemplazar `expect(result).toEqual({ xpTotal: 42, hpChange: 10 });` por:

```ts
    // `xpTotal` es el crudo del payload; `xpGained` es lo que el motor pagó de
    // verdad. El Códice pinta el segundo: es el número que va a reaparecer al
    // reabrir la página.
    expect(result).toEqual({ xpTotal: 42, hpChange: 10, xpGained: 57 });
```

  y agregar, después de ese test:

```ts
  it('si el motor no contesta un número, la fila cae al crudo antes que a NaN', async () => {
    installApi({ processRpgEvent: () => Promise.resolve(null) });
    expect(await closeNutritionDay('2026-09-03', '', false)).toEqual({ xpTotal: 42, hpChange: 10, xpGained: 42 });
  });
```

- [ ] **Paso 4.2 — Verlo fallar.** `npm test -- tests/hub/nutrition-close.test.ts`. Esperado: dos rojos, los dos por `xpGained` ausente en el resultado.

- [ ] **Paso 4.3 — `closeNutritionDay` devuelve lo que pagó el motor.** En `src/hub/codex/nutritionClose.ts`, reemplazar:

```ts
/** Lo que el backend devuelve al cerrar; sólo nos importan estos dos números. */
export interface NutritionCloseBreakdown {
  xpTotal: number;
  hpChange: number;
}
```

  por:

```ts
/**
 * Lo que el cierre dejó anotado.
 *
 * `xpTotal` es el XP CRUDO del desglose de Nutrify (lo que va en el payload).
 * `xpGained` es lo que el motor pagó de verdad: el crudo pasado por combo,
 * bonus y milestone (`DAY_SUMMARY` no es un evento flat). Es el número que el
 * ledger va a mostrar al reabrir la página, así que es el que se pinta hoy.
 */
export interface NutritionCloseBreakdown {
  xpTotal: number;
  hpChange: number;
  xpGained: number;
}
```

  y en `closeNutritionDay` reemplazar:

```ts
  // `date` es lo que DAY_REOPENED usa para revertir exactamente este evento.
  await window.api.processRpgEvent({
    type: 'DAY_SUMMARY',
    moduleId: 'nutrition',
    payload: { xp, hp, date },
    timestamp: Date.now(),
  });
  return { xpTotal: xp, hpChange: hp };
```

  por:

```ts
  // `date` es lo que DAY_REOPENED usa para revertir exactamente este evento.
  const paid = await window.api.processRpgEvent({
    type: 'DAY_SUMMARY',
    moduleId: 'nutrition',
    payload: { xp, hp, date },
    timestamp: Date.now(),
  });
  // Un main que no devuelva el resultado (stub, versión vieja) no puede dejar
  // la fila en NaN: se cae al crudo, que es lo que había hasta hoy.
  const xpGained = typeof paid?.xpGained === 'number' && Number.isFinite(paid.xpGained) ? paid.xpGained : xp;
  return { xpTotal: xp, hpChange: hp, xpGained };
```

  `npm test -- tests/hub/nutrition-close.test.ts` en verde.

- [ ] **Paso 4.4 — Tests visuales que fallan.** Después del test `'a 600px la página se aprieta…'`:

```tsx
  /* El cierre de comidas hecho desde acá es un hecho del día: una fila del
     ledger con su hora y el XP que pagó el MOTOR (no el crudo del payload),
     dentro de la sección de nutrición y con la misma etiqueta que va a tener
     al reabrir («Resumen del día»); no un párrafo suelto bajo el formulario. */
  const nutriDay = () => ({
    ...fourModules(), canSeal: false, sealBlockedReason: 'too_old',
    totalXp: 148, eventsCount: 7, maxCombo: 3, modules: ['quests', 'nutrition'],
    events: [{ moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 15, time: '09:12' }],
  });
  const nutriStubs = {
    rpgGetSeals: () => Promise.resolve([]),
    nutritionIsDayClosed: () => Promise.resolve(false),
    nutritionGetDailyMetrics: () => Promise.resolve({ steps: 4200, gym: 0 }),
    nutritionSaveDailyMetrics: () => Promise.resolve(true),
    // El crudo es 12; el motor paga 18. La fila tiene que decir 18.
    nutritionCloseDay: () => Promise.resolve({ success: true, breakdown: { xpTotal: 12, hpChange: 0 } }),
    processRpgEvent: () => Promise.resolve({ xpGained: 18 }),
  };

  test('el cierre de comidas se anota como una fila más de la sección de nutrición', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    // Sin lacre (fuera de ventana) para que exista el botón «Cerrar la
    // jornada»; `modules` trae nutrition pero los hechos no: así se ejercita
    // la rama que CREA la sección.
    installApi({ ...nutriStubs, rpgGetDaySummary: () => Promise.resolve(nutriDay()) });
    mountCodex();
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.querySelector('[data-codex-row="nutrition-close"]')).toBeNull();
    await page.getByRole('button', { name: 'Cerrar la jornada' }).click();
    await settle(500);

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-codex-05-fila-nutricion.png` });
    resetCapture();

    // Ya no hay párrafo suelto…
    expect(dlg.querySelector('.codex-nutri__award')).toBeNull();
    // …hay una fila, dentro de la sección de nutrición, con hora, etiqueta y XP.
    const row = dlg.querySelector('[data-codex-row="nutrition-close"]') as HTMLElement;
    expect(row).not.toBeNull();
    const section = row.closest('.qb-section') as HTMLElement;
    // El rótulo sale de `dashboard.moduleNutrition` («Diario de Provisiones»).
    expect(section.querySelector('.qb-section-title')?.textContent).toContain('PROVISIONES');
    expect(row.querySelector('.codex-marginalia__text')?.textContent).toBe('Resumen del día');
    expect(row.querySelector('.codex-marginalia__xp')?.textContent).toBe('+18');
    expect(row.querySelector('.codex-marginalia__time')?.textContent).toMatch(/\d{1,2}:\d{2}/);
    // El anuncio accesible vive en la lista, no en la fila.
    expect(section.querySelector('.codex-marginalia__list')?.getAttribute('aria-live')).toBe('polite');
    // La sección nueva se ordena como todas: Misiones, después nutrición.
    const titles = [...dlg.querySelectorAll('.codex-marginalia .qb-section-title')]
      .map((el) => el.textContent?.replace(/\d+$/, '').trim());
    expect(titles).toEqual(['LIBRO DE MISIONES', 'DIARIO DE PROVISIONES']);
    // Y la línea de cierre suma lo que el motor acaba de pagar.
    expect(dlg.querySelector('.codex-ledger-total__xp')?.textContent).toBe('+166');
    expect(dlg.querySelector('.codex-ledger-total')?.textContent?.replace(/\s+/g, ' ')).toContain('8 hechos');
  });

  /* `load()` se vuelve a llamar en `account:switched` y cuando el sello
     rebota con `already_sealed`; el summary recargado ya trae el DAY_SUMMARY
     real. La fila sintética tiene que irse con la recarga, o se ve dos veces. */
  test('recargar la página no duplica el cierre de comidas', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    let reads = 0;
    installApi({
      ...nutriStubs,
      rpgGetDaySummary: () => {
        reads += 1;
        const base = nutriDay();
        if (reads === 1) return Promise.resolve(base);
        // Segunda lectura: el handler real ya devuelve el evento del cierre.
        return Promise.resolve({
          ...base, totalXp: 166, eventsCount: 8,
          events: [...base.events, { moduleId: 'nutrition', eventType: 'DAY_SUMMARY', xpGained: 18, time: '17:05' }],
        });
      },
    });
    mountCodex();
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    await page.getByRole('button', { name: 'Cerrar la jornada' }).click();
    await settle(500);
    expect(dlg.querySelector('[data-codex-row="nutrition-close"]')).not.toBeNull();

    window.dispatchEvent(new Event('account:switched'));
    await settle(800);

    // La sintética se fue; queda UNA fila de nutrición, la real.
    expect(dlg.querySelector('[data-codex-row="nutrition-close"]')).toBeNull();
    const nutriSection = [...dlg.querySelectorAll('.codex-marginalia .qb-section')]
      .find((s) => s.querySelector('.qb-section-title')?.textContent?.includes('PROVISIONES')) as HTMLElement;
    const rows = nutriSection.querySelectorAll('.codex-marginalia__row');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.codex-marginalia__text')?.textContent).toBe('Resumen del día');
    expect(rows[0].querySelector('.codex-marginalia__xp')?.textContent).toBe('+18');
    // Y el total no se suma dos veces.
    expect(dlg.querySelector('.codex-ledger-total__xp')?.textContent).toBe('+166');
    expect(dlg.querySelector('.codex-ledger-total')?.textContent?.replace(/\s+/g, ' ')).toContain('8 hechos');
  });
```

- [ ] **Paso 4.5 — Verlos fallar.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "fila más|no duplica"`. Esperado: el primero falla en `expect(dlg.querySelector('.codex-nutri__award')).toBeNull()`; el segundo, en `[data-codex-row="nutrition-close"]` `.not.toBeNull()` tras el click (la fila no existe todavía).

- [ ] **Paso 4.6 — Tipos y orden a nivel de módulo.** En `CodexSealModal.tsx`, después de `const MODULE_ORDER = ['quests', 'nutrition', 'finance', 'cauldron'];` (línea 66) agregar:

```tsx

/** Una fila del ledger, ya formateada para pintar. */
interface LedgerRow {
  key: string;
  time: string;
  text: string;
  xp: number;
  /** Anotada desde acá (el cierre de comidas), no leída del summary. */
  synthetic?: boolean;
}

function byModuleOrder(a: string, b: string): number {
  const ia = MODULE_ORDER.indexOf(a);
  const ib = MODULE_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}
```

- [ ] **Paso 4.7 — El estado guarda hora y XP del motor, y se va con cada `load()`.**
  1. Borrar la línea `const [nutriAward, setNutriAward] = useState<number | null>(null);` (está entre los estados de nutrición, línea 199).
  2. Justo ANTES de `const load = useCallback(() => {` (línea 158) agregar:

```tsx
  /* ── lo que el cierre de comidas dejó anotado en esta sesión ──
     Va ANTES de `load` porque `load` lo resetea: el summary recargado (por
     `account:switched` o por un sello que rebota con `already_sealed`) ya
     trae el DAY_SUMMARY real, y la fila sintética no puede seguir viva al
     lado de la real. `xp` es lo que pagó el MOTOR, no el crudo del payload. */
  const [nutriAward, setNutriAward] = useState<{ xp: number; at: string } | null>(null);
```

  3. En `load`, reemplazar `.then(([s, sl]) => { setSummary(s); setSeals(sl); })` por:

```tsx
      .then(([s, sl]) => { setSummary(s); setSeals(sl); setNutriAward(null); })
```

  4. En `runNutritionClose` reemplazar `if (breakdown) setNutriAward(breakdown.xpTotal);` por:

```tsx
      if (breakdown) setNutriAward({ xp: breakdown.xpGained, at: new Date().toISOString() });
```

  5. El `useEffect` de `[date, dayHasNutrition]` (línea 204) conserva su `setNutriAward(null)`: sigue siendo el reset al cambiar de día.

- [ ] **Paso 4.8 — `grouped` pasa a ser `ledger`.** Reemplazar el `useMemo` de `grouped` completo (desde `const grouped = useMemo(() => {` hasta su `}, [summary]);`) por:

```tsx
  /* ── el ledger ──
     Los hechos del día agrupados por módulo, y —si el cierre de comidas se
     hizo desde acá— una fila más dentro de la sección de nutrición. Antes ese
     cierre era un párrafo suelto debajo del formulario: un hecho del día con
     su hora y su XP es una fila del ledger, no un aviso. La página no se
     recarga después de cerrar (nunca lo hizo), así que la fila se anota acá,
     con la MISMA etiqueta que va a tener cuando el summary la traiga de
     verdad (`events.DAY_SUMMARY`), y muere con el próximo `load()`. */
  const ledger = useMemo(() => {
    if (!summary) return [] as Array<{ moduleId: string; rows: LedgerRow[] }>;
    const map = new Map<string, LedgerRow[]>();
    summary.events.forEach((ev, i) => {
      const label = t(`events.${ev.eventType}`);
      const rows = map.get(ev.moduleId) ?? [];
      rows.push({
        key: `${ev.moduleId}-${i}`,
        time: formatTime(ev.time, locale),
        text: label !== `events.${ev.eventType}` ? label : ev.eventType,
        xp: ev.xpGained,
      });
      map.set(ev.moduleId, rows);
    });
    if (nutriAward) {
      const rows = map.get('nutrition') ?? [];
      rows.push({
        key: 'nutrition-close',
        time: formatTime(nutriAward.at, locale),
        text: t('events.DAY_SUMMARY', 'Resumen del día'),
        xp: nutriAward.xp,
        synthetic: true,
      });
      map.set('nutrition', rows);
    }
    return [...map.entries()]
      .sort((a, b) => byModuleOrder(a[0], b[0]))
      .map(([moduleId, rows]) => ({ moduleId, rows }));
  }, [summary, nutriAward, t, locale]);
```

- [ ] **Paso 4.9 — El render lee `ledger`.** Reemplazar el bloque de la zona 2 escrito en el Paso 3.4 (desde `{/* ── zona 2: el ledger` hasta el `)}` del ternario) por:

```tsx
        {/* ── zona 2: el ledger, los hechos del día por módulo ── */}
        {ledger.length > 0 ? (
          <>
            <div className="codex-marginalia">
              {ledger.map(({ moduleId, rows }) => (
                <Section
                  key={moduleId}
                  title={moduleLabel(moduleId, t).toUpperCase()}
                  icon={<span className="codex-marginalia__icon">{moduleIcon(moduleId)}</span>}
                  rightSlot={<span className="qb-numeral codex-marginalia__count">{rows.length}</span>}
                >
                  {/* La región viva va en la LISTA de nutrición, que ya existe
                      cuando la fila del cierre entra; un <li> que se monta con
                      su contenido no se anuncia. */}
                  <ul
                    className="codex-marginalia__list"
                    aria-live={moduleId === 'nutrition' ? 'polite' : undefined}
                  >
                    {rows.map((row) => (
                      <li
                        key={row.key}
                        className="codex-marginalia__row"
                        data-codex-row={row.synthetic ? 'nutrition-close' : undefined}
                      >
                        <span className="qb-hand codex-marginalia__time">{row.time}</span>
                        <span className="codex-marginalia__text" title={row.text}>{row.text}</span>
                        <span className="qb-numeral codex-marginalia__xp">
                          {row.xp >= 0 ? '+' : ''}{Math.round(row.xp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ))}
            </div>
            {/* La línea de cierre del ledger: el total del día, UNA vez, en el
                registro de las filas. El `title` del número es el rótulo de la
                cartela de antes («XP DEL DÍA»); el test de contrato del Códice
                (tests/ipc) busca esa clave en este fuente y lee el campo del
                summary que viene a menos de 200 caracteres: no separar el
                `title` del número, y no repetir la clave ni el campo en ningún
                comentario (la regex los matchearía acá). Suma la fila de
                comidas anotada en esta sesión —lo que pagó el motor— para no
                contradecir lo que tiene arriba. El vigor no está: ya vive en
                la barra lateral. */}
            <p className="qb-small-caps codex-ledger-total">
              <span className="codex-ledger-total__xp" title={t('rpg.codexXpToday', 'XP DEL DÍA')}>
                +{Math.round(summary.totalXp + (nutriAward?.xp ?? 0))}
              </span>
              {' '}{t('rpg.codexXpUnit', 'XP')}
              {' · '}
              {t('rpg.codexLedgerDeeds', {
                count: summary.eventsCount + (nutriAward && nutriAward.xp > 0 ? 1 : 0),
                defaultValue: '{{count}} hechos',
              })}
              {' · '}
              {t('rpg.codexLedgerCombo', { n: summary.maxCombo, defaultValue: 'combo ×{{n}}' })}
            </p>
          </>
        ) : (
          <p className="codex-note">
            {t('rpg.codexEmptyDay', 'El códice registra días vividos. Volvé cuando haya algo que anotar.')}
          </p>
        )}
```

- [ ] **Paso 4.10 — Sacar el párrafo suelto.** Borrar del render:

```tsx
        {nutriAward !== null && (
          <p className="codex-nutri__award" role="status">
            {t('rpg.codexNutriClosed', {
              n: Math.round(nutriAward),
              defaultValue: 'Jornada de comidas cerrada · +{{n}} XP',
            })}
          </p>
        )}
```

  (La clave `codexNutriClosed` queda huérfana y se borra en la Task 6 con las demás. No se agrega ninguna: la fila usa `events.DAY_SUMMARY`.)

- [ ] **Paso 4.11 — CSS.** En `codex-seal.css` borrar:

```css
.codex-nutri__award {
  margin-top: 10px;
  text-align: center;
  font-size: var(--fs-body);
  color: var(--moss-dark);
}
```

- [ ] **Paso 4.12 — Verde.** `npx tsc --noEmit` · `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` · `npm test -- tests/hub/nutrition-close.test.ts tests/ipc/rpg-codex-contract.test.ts tests/i18n/vocabulario-unico.test.ts`. `rg -n "rpg\.codexXpToday" src/hub/codex/CodexSealModal.tsx` → una sola línea.

- [ ] **Paso 4.13 — Commit.** `git add src/hub/codex/CodexSealModal.tsx src/hub/codex/nutritionClose.ts src/hub/styles/codex-seal.css tests/hub/nutrition-close.test.ts tests/visual/audit-hub-modals.browser.test.tsx && git commit -m "refactor(codex): el cierre de comidas es una fila del ledger, con el XP que pagó el motor"`

---

## Chunk 3: el sello, el pie y la limpieza

### Task 5: Un solo veredicto bajo el sello y la salida en el pie

**Files:**
- Modify: `src/hub/codex/CodexSealModal.tsx` (estado `award` en `:128`; `setAward` en `:276-281`; derivados después de `nutriStandalone`; tramo desde `{/* ── the wax ─` hasta el `</Section>` de la tira)
- Modify: `src/hub/styles/codex-seal.css:320-450` (sello, óbolos, logros, salida)
- Modify: `src/i18n/es.json`, `src/i18n/en.json` (`codexSealedObolos`)
- Test: `tests/visual/audit-hub-modals.browser.test.tsx` (test `'la página ya sellada…'` + uno nuevo)

- [ ] **Paso 5.1 — Tests que fallan.** (a) En el test `'la página ya sellada ofrece su propia salida, al pie del lacre'`, después de `expect(exit.textContent?.trim()).toBeTruthy();` agregar:

```tsx
    // Un solo veredicto: «Sellado · +20 XP», sin fecha (está en el título),
    // sin desglose de vigor, sin logros (no hubo estampado en esta sesión).
    const line = dlg.querySelector('.codex-sealed__line') as HTMLElement;
    expect(line.textContent?.replace(/\s+/g, '')).toBe('Sellado·+20XP');
    expect(dlg.querySelector('.codex-unlocks, .codex-award, .codex-award__breakdown, .codex-sealed__label, .codex-obolos')).toBeNull();
    // La salida vive en el pie, después de la tira.
    const strip = dlg.querySelector('.codex-strip') as HTMLElement;
    expect(strip.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

  (b) Después del test de la Task 4, agregar:

```tsx
  /* El veredicto completo (óbolos, logros) sólo existe después de estampar:
     hay que apretar el lacre. Se estampa con el teclado (espacio sostenido
     ≥ 1,5 s), igual que lo haría alguien sin mouse; la ceremonia GSAP dura
     ~1,6 s más. */
  test('estampar deja UNA línea de veredicto: XP héroe, óbolos y logros en small caps', async () => {
    await page.viewport(...NARROW);
    resetCapture();
    installApi({
      rpgGetDaySummary: () => Promise.resolve(fourModules()),
      rpgGetSeals: () => Promise.resolve([]),
      rpgSealDay: () => Promise.resolve({
        ok: true, date: today, xpAwarded: 29, vigor: 84, eventsCount: 12,
        modules: ['quests', 'nutrition', 'finance', 'cauldron'],
        achievementIds: ['late_memory'], obolosGranted: 15,
      }),
    });
    mountCodex();
    await settle(1400);

    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const wax = dlg.querySelector('.codex-wax') as HTMLButtonElement;
    expect(wax).not.toBeNull();
    wax.focus();
    wax.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle(1700);
    await settle(2500);

    fitCapture();
    await page.screenshot({ path: `${SCREENS}/audit-hub-codex-04-veredicto.png` });
    resetCapture();

    const line = dlg.querySelector('.codex-sealed__line') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent?.replace(/\s+/g, '')).toBe('Sellado·+29XP·+15óbolos');

    // El +29 es el ÚNICO número héroe del cuerpo de la página.
    const content = dlg.querySelector('.qb-content') as HTMLElement;
    const heroes = [...content.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() !== '')
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) >= 24)
      .map((el) => (typeof el.className === 'string' ? el.className : el.tagName));
    expect(heroes).toEqual(['codex-sealed__xp']);

    expect(dlg.querySelector('.codex-award, .codex-award__breakdown, .codex-obolos, .codex-sealed__label')).toBeNull();

    // Los logros: una línea, sin marco ni fondo.
    const unlocks = dlg.querySelector('.codex-unlocks') as HTMLElement;
    expect(unlocks.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Desbloqueaste · /);
    expect(getComputedStyle(unlocks).borderTopWidth).toBe('0px');
    expect(getComputedStyle(unlocks).backgroundColor).toBe('rgba(0, 0, 0, 0)');

    // La salida, en el pie, después de la tira.
    const exit = dlg.querySelector('.codex-sealed__exit') as HTMLElement;
    const strip = dlg.querySelector('.codex-strip') as HTMLElement;
    expect(exit).not.toBeNull();
    expect(strip.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

- [ ] **Paso 5.2 — Verlos fallar.** `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "sellada|estampar"`. Esperado: (a) `TypeError` en `line.textContent` (no existe `.codex-sealed__line`); (b) lo mismo.

- [ ] **Paso 5.3 — El estado `award` sin `vigor`.** Reemplazar:

```tsx
  const [award, setAward] = useState<{ xpAwarded: number; vigor: number; achievementIds: string[]; obolosGranted: number } | null>(null);
```

  por:

```tsx
  const [award, setAward] = useState<{ xpAwarded: number; achievementIds: string[]; obolosGranted: number } | null>(null);
```

  y en `commitSeal` reemplazar:

```tsx
    setAward({
      xpAwarded: res.xpAwarded,
      vigor: res.vigor,
      achievementIds: res.achievementIds ?? [],
      obolosGranted: typeof res.obolosGranted === 'number' ? res.obolosGranted : 0,
    });
```

  por:

```tsx
    setAward({
      xpAwarded: res.xpAwarded,
      achievementIds: res.achievementIds ?? [],
      obolosGranted: typeof res.obolosGranted === 'number' ? res.obolosGranted : 0,
    });
```

- [ ] **Paso 5.4 — Derivados.** Después de la línea `const nutriStandalone = sealedNow || !!(summary && !summary.canSeal);` agregar:

```tsx
  /** Lo que pagó el sello: recién estampado (`award`) o releído de la tira. */
  const sealXp = award ? award.xpAwarded : thisSeal ? thisSeal.xpAwarded : null;
  const obolos = award?.obolosGranted ?? 0;
```

- [ ] **Paso 5.5a — Zona 3 (el lacre).** Reemplazar el tramo desde `{/* ── the wax ───────────────────────────────── */}` (línea 593) hasta el `</div>` que cierra `.codex-wax-zone` (línea 710, justo antes de `{/* ── la bolsa: el saldo, donde se gana ─────── */}`) por:

```tsx
        {/* ── zona 3: el lacre ─────────────────────── */}
        <div className="codex-wax-zone">
          {sealedNow ? (
            <div className="codex-sealed" ref={stageRef}>
              <div className="codex-seal-halo" data-seal="halo" aria-hidden="true" />
              <div className="qb-seal codex-seal-disc" data-seal="wax">
                <span data-seal="stamp" className="codex-seal-mark">
                  {sealStyleIcon(sealStyle, 34)}
                </span>
              </div>
              {/* UNA línea: «Sellado · +29 XP · +15 óbolos». El +29 es el único
                  número héroe de la página. La fecha ya está en el título y el
                  vigor en la barra lateral: ninguno de los dos vuelve acá. */}
              <div className="codex-sealed__text" data-seal="result">
                {sealXp !== null && (
                  <p className="codex-sealed__line">
                    <span className="qb-small-caps">{t('rpg.codexSealedOn', 'Sellado')}</span>
                    <span className="codex-sealed__dot" aria-hidden="true">·</span>
                    <span className="codex-sealed__xp">+{Math.round(sealXp)}</span>
                    <span className="qb-small-caps">{t('rpg.codexXpUnit', 'XP')}</span>
                    {obolos > 0 && (
                      <>
                        <span className="codex-sealed__dot" aria-hidden="true">·</span>
                        <span className="qb-small-caps codex-sealed__obolos">
                          <Obolus width={13} height={13} aria-hidden="true" />
                          {t('rpg.codexSealedObolos', { n: obolos, defaultValue: '+{{n}} óbolos' })}
                        </span>
                      </>
                    )}
                  </p>
                )}
                {award && award.achievementIds.length > 0 && (
                  <p className="qb-small-caps codex-unlocks">
                    <SealRosette width={13} height={13} aria-hidden="true" />
                    <span>{t('rpg.codexUnlocked', 'Desbloqueaste')}</span>
                    <span className="codex-sealed__dot" aria-hidden="true">·</span>
                    <span>{award.achievementIds.map((id) => t(titleKey(id), humanise(id))).join(' · ')}</span>
                  </p>
                )}
              </div>
            </div>
          ) : emptyDay ? (
            /* El ledger de arriba ya dice «el códice registra días vividos»;
               la regla es sólo que acá NO hay botón. */
            null
          ) : (
            <>
              <button
                type="button"
                className={`codex-wax tap-target${holdPct > 0 ? ' codex-wax--holding' : ''}`}
                style={{ '--codex-hold': `${Math.round(holdPct * 100)}%` } as CSSProperties}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  startHold();
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                    e.preventDefault();
                    startHold();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') cancelHold();
                }}
                aria-label={t('rpg.codexHoldToSeal', 'Mantené apretado para sellar el día')}
              >
                <span className="codex-wax__fill" aria-hidden="true" />
                <span className="codex-wax__face">
                  {sealStyleIcon(sealStyle, 30)}
                </span>
              </button>
              <div className="qb-hand codex-wax__hint">
                {t('rpg.codexHoldHint', 'Mantené apretado para sellar el día')}
              </div>
            </>
          )}

          {problemCopy && (
            <p className="codex-problem" role="status">{problemCopy}</p>
          )}
        </div>
```

  El bloque `{purse && (<div className="codex-purse">…</div>)}` que sigue NO se toca acá: lo saca la Task 6 junto con su estado e imports.

- [ ] **Paso 5.5b — Zona 4 (el pie).** Reemplazar el tramo desde `{/* ── the 14 day strip ──────────────────────── */}` (línea 731) hasta el `</Section>` que cierra la tira (línea 778, lo último antes del `</>` del `return`) por:

```tsx
        {/* ── zona 4: el pie ───────────────────────── */}
        <QBDividerSection />
        <Section
          title={t('rpg.codexStrip', 'ÚLTIMOS XIV DÍAS').toUpperCase()}
          icon={<Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
        >
          <div className="codex-strip">
            {strip.map((cell) => {
              const isOpen = cell.date === date;
              const day = Number(cell.date.slice(8, 10));
              const canOpen = !cell.seal && !isOpen;
              const label = cell.seal
                ? t('rpg.codexStripSealed', {
                    date: formatLongDate(cell.date, locale),
                    xp: Math.round(cell.seal.xpAwarded),
                    defaultValue: '{{date}} — sellado, +{{xp}} XP',
                  })
                : t('rpg.codexStripOpen', {
                    date: formatLongDate(cell.date, locale),
                    defaultValue: '{{date}} — sin sellar',
                  });
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={[
                    'codex-strip__cell',
                    cell.seal ? 'codex-strip__cell--sealed' : 'codex-strip__cell--open',
                    isOpen ? 'codex-strip__cell--current' : '',
                    cell.isToday ? 'codex-strip__cell--today' : '',
                  ].join(' ').trim()}
                  title={label}
                  aria-label={label}
                  aria-current={isOpen ? 'date' : undefined}
                  disabled={!canOpen}
                  onClick={() => { if (canOpen) onSelectDate(cell.date); }}
                >
                  {cell.seal
                    ? <SealRosette width={16} height={16} />
                    : <span className="codex-strip__num">{day}</span>}
                </button>
              );
            })}
          </div>
          <div className="qb-hand codex-strip__legend">
            {t('rpg.codexStripLegend', 'Un día sin sellar no es una falta — es una página que quedó abierta.')}
          </div>
        </Section>

        {/* La única salida escrita de la página, al pie, en los dos estados.
            Durante 'sealing' no: el lacre se está estampando y nada invita a
            irse a mitad de la ceremonia. Sin timer, a propósito: el subtítulo
            promete «podés irte cuando quieras», y un modal que se cierra solo
            decide por vos. */}
        {phase !== 'sealing' && (
          <div className="codex-sealed__foot">
            <button
              type="button"
              className="codex-sealed__exit tap-target"
              onClick={onClose}
            >
              {t('rpg.codexCloseBook', 'Cerrar el libro')}
            </button>
          </div>
        )}
```

- [ ] **Paso 5.6 — i18n.** En `es.json`, ANTES de `"codexSealedOn": "Sellado",` agregar `"codexSealedObolos": "+{{n}} óbolos",`. En `en.json`, ANTES de `"codexSealedOn": "Sealed",` agregar `"codexSealedObolos": "+{{n}} obols",`.

- [ ] **Paso 5.7 — CSS del sello.** En `codex-seal.css`, reemplazar TODO el tramo desde `.codex-sealed__label {` (línea 324) hasta el cierre de `.codex-unlocks__item svg { color: var(--gold-dark); }` (línea 420) — es decir: `.codex-sealed__label`, `.codex-award`, `.codex-award__breakdown`, el bloque `/* ── óbolos minted by the seal ── */` entero con `.codex-obolos*`, `@keyframes codex-obolo-drop`, su `prefers-reduced-motion`, `.codex-unlocks`, `.codex-unlocks__title`, `__list`, `__item`, `__item svg` — por:

```css
/* ── el veredicto: UNA línea ─────────────────────────
   «Sellado · +29 XP · +15 óbolos». Antes eran cuatro cosas apiladas (rótulo
   con la fecha, +XP a 28 px, «día vivo × vigor N», tres monedas animadas) y
   competían con el +XP del cartucho de arriba, también a 28 px y también en
   musgo. El único número héroe de la página es éste. */
.codex-sealed__line {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 0 8px;
  margin: 0;
  color: var(--ink-soft);
}

.codex-sealed__xp {
  font-family: var(--ff-display);
  font-size: var(--fs-hero);
  line-height: 1;
  color: var(--moss);
}

.codex-sealed__dot {
  color: var(--ink-faded);
}

.codex-sealed__obolos {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* contrast-ok: moneda dibujada al lado del número, contenido no textual (3:1); 3.84:1 sobre --parch-0 */
.codex-sealed__obolos svg { color: var(--gold-dark); }

/* Los logros: una línea en small caps, sin marco ni fondo. Con borde dorado y
   fondo parecía un botón, y no lo era. */
.codex-unlocks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0 6px;
  margin: 6px 0 0;
  color: var(--ink);
}

/* contrast-ok: roseta del logro, ícono y no texto; el título va en --ink al lado (3.84:1 sobre pergamino) */
.codex-unlocks svg { color: var(--gold-dark); }
```

- [ ] **Paso 5.8 — CSS de la salida.** Reemplazar el comentario y la regla de `.codex-sealed__exit` (desde `/* ── la salida del ritual ─` hasta el cierre de `.codex-sealed__exit { … }`, sin tocar `:hover` ni `:focus-visible`) por:

```css
/* ── la salida del ritual ─────────────────────────
   Un ritual sin cierre no es un ritual, es un callejón: la ceremonia terminaba
   con el lacre, el XP y los óbolos, y después te dejaba parado ahí con la única
   salida a 1000 px de scroll. Esta es la salida escrita de la página, al pie,
   después de la tira, en los dos estados. Deliberadamente sin timer: el
   subtítulo promete «podés irte cuando quieras», y un modal que se cierra solo
   no cumple esa promesa —decide por vos. */
.codex-sealed__foot {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.codex-sealed__exit {
  padding: 7px 20px;
  font-family: var(--ff-accent);
  font-size: var(--fs-body);
  letter-spacing: 0.06em;
  color: var(--ink);
  background: linear-gradient(180deg, #f7ecd0 0%, #ecdcb4 100%);
  border: 1px solid var(--gold-dark);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease;
}
```

- [ ] **Paso 5.9 — Verde.** `npx tsc --noEmit` · `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` · `npm test -- tests/shared/css-ink-contrast.test.ts tests/i18n/vocabulario-unico.test.ts tests/ipc/rpg-codex-contract.test.ts`. Si el test de estampar no llega a `.codex-sealed__line`, subir el segundo `settle` (la ceremonia dura 0.95 + 0.38 + 0.25 s más el hold de 1.5 s); no bajar `HOLD_MS`.

- [ ] **Paso 5.10 — Commit.** `git add src/hub/codex/CodexSealModal.tsx src/hub/styles/codex-seal.css src/i18n/es.json src/i18n/en.json tests/visual/audit-hub-modals.browser.test.tsx && git commit -m "refactor(codex): un solo veredicto bajo el sello y la salida en el pie"`

### Task 6: Sin bolsa, sin claves huérfanas

**Files:**
- Create: `tests/i18n/codex-keys.test.ts`
- Delete: `src/hub/codex/purse.ts`, `tests/hub/purse.test.ts`
- Modify: `src/hub/codex/CodexSealModal.tsx` (imports `:3`, `:35-46`; estado `purse`/`loadPurse` `:169-184`; listener `:240-244`; `commitSeal` `:283`, `:286`; `purseCopy` `:402-421`; bloque `.codex-purse` `:712-729` si sobrevivió a la Task 5)
- Modify: `src/hub/styles/codex-seal.css` (`/* ══ LA BOLSA ══ */` … `[data-shell="mobile"] .codex-purse__link { … }`, líneas 1164-1231)
- Modify: `src/i18n/es.json`, `src/i18n/en.json` (13 claves)

- [ ] **Paso 6.1 — Test que falla: el guardia de claves huérfanas.** Crear `tests/i18n/codex-keys.test.ts`:

```ts
/**
 * Claves `rpg.codex*` sin dueño.
 *
 * El rediseño «un solo veredicto» (2026-09-05) dejó trece claves huérfanas de
 * golpe: cartuchos, bolsa, desglose de vigor. Una clave que nadie lee es texto
 * que se traduce, se revisa y se mantiene para nadie. Este guardia pide que
 * toda clave `rpg.codex*` de valor string sea leída por algún `.ts`/`.tsx`
 * de `src/` como `'rpg.<clave>'` literal (las `_one`/`_other` se leen por su
 * base, con `count`). `codexPhrases` es un objeto y se lee por template
 * literal en `codexPhrases.ts`: queda fuera por construcción.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SOURCE = walkTs(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');

function codexKeys(file: string): string[] {
  const rpg = JSON.parse(readFileSync(join(SRC, 'i18n', file), 'utf8')).rpg as Record<string, unknown>;
  return Object.entries(rpg)
    .filter(([k, v]) => k.startsWith('codex') && typeof v === 'string')
    .map(([k]) => k);
}

const base = (k: string) => k.replace(/_(one|other)$/, '');

describe('rpg.codex* — ninguna clave sin dueño', () => {
  for (const file of ['es.json', 'en.json']) {
    it(`${file}: toda clave rpg.codex* se lee desde src/`, () => {
      const huerfanas = codexKeys(file).filter((k) => !SOURCE.includes(`'rpg.${base(k)}'`));
      expect(huerfanas).toEqual([]);
    });
  }

  it('los dos catálogos tienen las mismas claves rpg.codex*', () => {
    expect(codexKeys('es.json').sort()).toEqual(codexKeys('en.json').sort());
  });
});
```

- [ ] **Paso 6.2 — Verlo fallar.** `npm test -- tests/i18n/codex-keys.test.ts`. Esperado: las huérfanas listadas son exactamente `codexAwardBreakdown`, `codexComboFoot`, `codexDeeds`, `codexDeedsFoot`, `codexMaxCombo`, `codexNutriClosed`, `codexObolosGranted`, `codexXpFoot` en los dos catálogos (las `codexPurse*` todavía tienen dueño porque el bloque de la bolsa sigue en el TSX). Si aparece alguna otra, PARAR y revisar: o la Task 3/4/5 dejó un uso colgado, o hay una clave preexistente sin dueño que hay que reportar en Discrepancias antes de borrarla.

- [ ] **Paso 6.3 — Verificar que `purseHint` no tiene otro dueño.** `rg -n "purseHint|codex-purse|codexPurse|from './purse'" src tests`. Esperado: sólo `src/hub/codex/purse.ts`, `src/hub/codex/CodexSealModal.tsx` y `tests/hub/purse.test.ts`. Si aparece otro archivo, `purse.ts` se queda y sólo se saca del modal.

- [ ] **Paso 6.4 — Sacar la bolsa del modal.** En `CodexSealModal.tsx`:
  1. Borrar `import { useNavigate } from 'react-router-dom';` (línea 3).
  2. En el import de `./codexApi`, borrar las líneas `getObolosBalance,`, `getRewards,` y `rewardsApiReady,`.
  3. Borrar `import { purseHint } from './purse';`.
  4. Borrar `const navigate = useNavigate();`.
  5. Borrar el bloque completo desde `/* ── la bolsa ─────────────────────────────────────` hasta `useEffect(() => { loadPurse(); }, [loadPurse]);` inclusive (el `useState` de `purse`, `loadPurse` y su efecto).
  6. Reemplazar:

```tsx
  useEffect(() => {
    const handler = () => { load(); loadPurse(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load, loadPurse]);
```

  por:

```tsx
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);
```

  7. En `commitSeal`, borrar la línea `loadPurse();` y cambiar el array de dependencias `[date, load, loadPurse, runNutritionClose]` por `[date, load, runNutritionClose]`.
  8. Borrar el bloque completo de `purseCopy` (desde `/** One line that turns the balance into a reason. Never invents a reward. */` hasta el `})();` que lo cierra).
  9. Borrar el bloque `{/* ── la bolsa: el saldo, donde se gana ─────── */}` con `{purse && ( <div className="codex-purse"> … </div> )}` (queda entre `.codex-wax-zone` y el `<QBDividerSection />` del pie).
  10. `rg -n "purse|navigate|Obolos|getRewards" src/hub/codex/CodexSealModal.tsx` → sólo debe quedar `Obolus` (la moneda de la línea del sello).

- [ ] **Paso 6.5 — Borrar el helper y su test.** `git rm src/hub/codex/purse.ts tests/hub/purse.test.ts`.

- [ ] **Paso 6.6 — CSS de la bolsa.** En `codex-seal.css`, borrar el bloque completo desde `/* ══ LA BOLSA ══════════════════════════════════════` hasta el cierre de `[data-shell="mobile"] .codex-purse__link { … }` (líneas 1164-1231): `.codex-purse`, `__coin`, `__balance`, `__balance .qb-numeral`, `__hint`, `__link`, `__link:hover/:focus-visible`, y las dos reglas mobile.

- [ ] **Paso 6.7 — Borrar las 13 claves huérfanas.** Primero verificar: `rg -n "codexAwardBreakdown|codexComboFoot|codexDeeds|codexMaxCombo|codexNutriClosed\b|codexObolosGranted|codexPurse|codexXpFoot" src --glob '!*.json'` → 0 resultados. Después, en `src/i18n/es.json` borrar las líneas:

```json
    "codexAwardBreakdown": "día vivo × vigor {{vigor}}",
    "codexComboFoot": "en un mismo día",
    "codexDeeds": "HECHOS",
    "codexDeedsFoot": "entradas del día",
    "codexMaxCombo": "COMBO MÁXIMO",
    "codexObolosGranted": "+{{n}} óbolos a la bolsa",
    "codexNutriClosed": "Jornada de comidas cerrada · +{{n}} XP",
    "codexPurseAffordable": "Te alcanza para «{{name}}».",
    "codexPurseClosest": "«{{name}}» te queda a {{missing}} óbolos.",
    "codexPurseNoRewards": "Escribí en el mostrador qué querés comprarte.",
    "codexPurseSpend": "Ir al mostrador",
    "codexPurseUnit": "óbolos en la bolsa",
    "codexXpFoot": "anotados al margen",
```

  y en `src/i18n/en.json`:

```json
    "codexAwardBreakdown": "day lived × vigour {{vigor}}",
    "codexComboFoot": "within one day",
    "codexDeeds": "DEEDS",
    "codexDeedsFoot": "entries for the day",
    "codexMaxCombo": "HIGHEST COMBO",
    "codexObolosGranted": "+{{n}} obols for the purse",
    "codexNutriClosed": "Meals closed · +{{n}} XP",
    "codexPurseAffordable": "Enough for \"{{name}}\".",
    "codexPurseClosest": "\"{{name}}\" is {{missing}} obols away.",
    "codexPurseNoRewards": "Write on the counter what you want to buy yourself.",
    "codexPurseSpend": "Go to the counter",
    "codexPurseUnit": "obols in the purse",
    "codexXpFoot": "noted in the margin",
```

  (Ojo con las comas: `codexNutriCloseNow` queda seguida de `codexNutriHint`; `codexSealedObolos` antes de `codexSealedOn`. Validar el JSON con `node -e "JSON.parse(require('fs').readFileSync('src/i18n/es.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/en.json','utf8'))"`.)

- [ ] **Paso 6.8 — Verde.** `npx tsc --noEmit` · `npm test -- tests/i18n tests/hub tests/ipc/rpg-codex-contract.test.ts tests/shared/css-ink-contrast.test.ts` · `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx`.

- [ ] **Paso 6.9 — Commit.** `git add -A src/hub/codex src/hub/styles/codex-seal.css src/i18n tests/i18n/codex-keys.test.ts tests/hub && git commit -m "refactor(codex): sin bolsa en el sello y sin claves huérfanas"`

### Task 7: Verificación final

**Files:** ninguno nuevo.

- [ ] **Paso 7.1 — Clases y claves muertas.** `rg -n "codex-cartouches|codex-module-seal|codex-award|codex-obolos|codex-unlocks__|codex-sealed__label|codex-nutri__award|codex-purse" src tests` → 0 resultados. `rg -n "Cartouche|Rune\b|Flame|Quill|useNavigate|purseHint" src/hub/codex/CodexSealModal.tsx` → 0 resultados.

- [ ] **Paso 7.2 — Tokens.** `rg -n "28px|'IM Fell|'UnifrakturCook|'Cormorant" src/hub/styles/codex-seal.css` → sólo las reglas preexistentes (marginalia, phrase, note, problem, strip, sidebar, shelf); ninguna de las clases nuevas (`.codex-ledger-total*`, `.codex-sealed__line/__xp/__dot/__obolos/__foot`, `.codex-unlocks`, `.codex-modal__close`) aparece.

- [ ] **Paso 7.3 — Contrato.** `rg -n "rpg\.codexXpToday" src/hub/codex/CodexSealModal.tsx` → una sola línea, y `summary.totalXp` a menos de 200 caracteres después. `npm test -- tests/ipc/rpg-codex-contract.test.ts`.

- [ ] **Paso 7.4 — Suites.** `npx tsc --noEmit` · `npm test -- tests/ipc/rpg-codex-contract.test.ts tests/hub tests/i18n tests/shared/css-ink-contrast.test.ts tests/shared/design-system-drift.test.ts` · `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx` (los 10 tests del Códice verdes: 3 viejos + 3 del ledger + 1 responsive + 2 de nutrición + 1 de estampar) · `npm run test:visual:mobile -- tests/visual/mobile/mobile-hub.browser.test.tsx` (importa `codex-seal.css`; no debe romperse).

- [ ] **Paso 7.5 — Mirar las capturas.** Abrir `tests/visual/screens/audit-hub-codex-0{1,2,3,4,5}-*.png` y confirmar a ojo: un solo número grande en la página sellada, ledger a dos columnas a 900 y una a 600, la X como disco, el botón «Cerrar el libro» debajo de la tira, la fila de nutrición dentro de su sección. Si algo no coincide con la spec, es un bug del plan, no de la spec: corregir y volver al Paso 7.4.

- [ ] **Paso 7.6 — Estado limpio.** `git status` sin cambios pendientes. No hacer build.

---

## Discrepancias

1. **El desborde horizontal del ledger no se reproduce en el arnés.** Se corrió `npm run test:visual -- tests/visual/audit-hub-modals.browser.test.tsx -t "Cierre del Códice" --silent=false` antes de escribir el plan: `overflowingNodes` da `[]` a 1640 y a 760 con tres módulos. Con `.codex-marginalia__text` en `overflow: hidden; min-width: 0` las filas ceden, así que `scrollWidth <= clientWidth` pasa ya hoy. Lo que SÍ se reproduce es el síntoma de diseño: TRES columnas a 900 px (tracks `246px 246px 246px`) y dos a 600. El test de la Task 1 mantiene el assert de `scrollWidth` pedido y agrega el de tracks (≤ 2 / 1), que es el rojo, y el de `min-width: 0px` — assert de IMPLEMENTACIÓN, a sabiendas: fija la causa raíz, no sólo el síntoma. Se agregó una corrida con `--font-scale: 1.3` (el usuario puede tener la escala configurada; `theme.css:13`): la grilla es en px y los tracks no cambian, pero las filas sí crecen y es el escenario más parecido a la captura. Se sigue el diseño.
2. **La X ya tiene fondo.** `.codex-modal__close` (`codex-seal.css:98-99`) ya declara `background: var(--parch-1)` y borde. Lo que falta es la forma de disco (`border-radius: 3px` → `50%`), el tamaño explícito (26 → 32) y la reserva en `.qb-header-text`. En escritorio la geometría actual apenas se toca: la X arranca en R−43 (10 de `right` + 32 de ancho + 1 de borde) y la caja del título termina en R−37 (1 + 8 de scrollbar + 28 de padding), así que se solapan 6 px de CAJA pero el assert `title.right <= close.left + 1` del test… pasa hoy con la X de 26 px (R−37 ≤ R−36). El rojo de la Task 1 son los tracks y el radio, no el título; el assert del título es un guardia para la reserva, que importa en el teléfono (X de 40 px con `.qb-page` a 12 px de padding: 27 px de solape). La reserva va con prefijo `.codex-book` en `codex-seal.css`, no en `codex.css` (`.qb-header-text` es del sistema).
3. **Las claves viven en `rpg.codex*`, no en `codex.*`.** El encargo decía «claves `codex.*`»; en los catálogos son `rpg.codex…` (`es.json:1943-2003`). Alfabético dentro de `rpg`. `codexObolosGranted` estaba fuera de orden en el archivo actual; se va con las huérfanas.
4. **La sección de nutrición no se llama «Vituallas».** `moduleLabel('nutrition')` lee `dashboard.moduleNutrition`, que en `es.json:905` dice «Diario de Provisiones» (y Misiones es «Libro de Misiones»); el fallback del TSX («Vituallas», «Misiones») no se ve. Los tests buscan «PROVISIONES» y `['LIBRO DE MISIONES', 'DIARIO DE PROVISIONES']`.
5. **`vigor` en `award` era código muerto en el diseño nuevo**: se saca del estado (nadie lo lee). `res.vigor` sigue llegando del handler.
6. **`[data-shell="mobile"] .codex-sealed__exit { width: 100% }` no hacía lo que decía**: el botón vivía dentro de `.codex-sealed__text`, hijo de un flex column centrado que se encoge a su contenido. Con el botón en `.codex-sealed__foot` (bloque normal) y `.codex-sealed__text { width: 100% }` la regla vuelve a ser cierta. Se anota porque es un cambio de comportamiento en el teléfono que el encargo no listaba.
7. **La fila de nutrición pinta el XP que pagó el MOTOR, no el crudo del payload.** `nutritionCloseDay` devuelve `breakdown.xpTotal` (el base); el motor lo pasa por `calculateXpGain(base, combo, bonus) + milestoneXp` (`rpg-handlers.ts:500,554`; `DAY_SUMMARY` no está en `FLAT_XP_EVENTS`, `:105`) y `processRpgEvent` devuelve ese `xpGained` (`:658`), que `closeNutritionDay` descartaba (`nutritionClose.ts:86-92`). Con el crudo, la fila decía «+12» hoy y «+18» al reabrir. Fix: `NutritionCloseBreakdown` suma `xpGained` (con fallback al crudo si el motor no contesta un número) y el modal usa ese. El total del ledger es `summary.totalXp + xpGained` y los hechos `eventsCount + (xpGained > 0 ? 1 : 0)`; `summary.totalXp` sigue literal en el fuente (el contrato lo necesita). `tests/hub/nutrition-close.test.ts` fija el campo nuevo.
8. **`rpg.codexXpToday` sobrevive como `title`** del número del total (tooltip «XP DEL DÍA»). Es la forma menos forzada de mantener la clave a menos de 200 caracteres de `summary.totalXp` sin repetir el rótulo en pantalla ni tocar la regex del test de contrato. El comentario JSX que acompaña a la línea NO escribe esos dos literales: la regex matchearía el comentario por accidente y el `rg` del Paso 7.3 daría dos líneas. El comentario y el nombre del helper del test de contrato se actualizan a `.codex-ledger-total__xp` para que el ancla semántica no quede vieja (Paso 3.7).
9. **Test nuevo de claves huérfanas** (`tests/i18n/codex-keys.test.ts`): el encargo pedía «verificar con rg antes» de borrar; se hace, y además queda un guardia para que las trece no vuelvan a acumularse. Es un archivo de test nuevo, no de producto.
10. **Sin doble conteo tras `load()`.** `load()` se vuelve a llamar en `account:switched` (`CodexSealModal.tsx:240-244`) y cuando el sello rebota con `already_sealed` (`:273`); el summary recargado ya trae el `DAY_SUMMARY` real y `nutriAward` sólo se reseteaba en `[date, dayHasNutrition]` (`:204-206`): la fila sintética y la real convivían, y el total sumaba dos veces. Fix: `setNutriAward(null)` en el `.then` de `load()` (la declaración del estado se mueve arriba de `load`), con test visual («recargar la página no duplica el cierre de comidas»).
11. **La fila sintética no tiene clave propia**: usa `t('events.DAY_SUMMARY', 'Resumen del día')`, la misma etiqueta con la que el ledger pinta el evento cuando el summary lo trae. El encargo hablaba de «Jornada de comidas cerrada · +N XP»; la fila de hoy y la de mañana tienen que decir lo mismo, y de paso desaparece el problema de orden alfabético de la clave nueva.
12. **La fecha del evento de cierre de comidas es HOY, no la del día cerrado** (fuera de alcance, sólo se anota). El motor guarda el `DAY_SUMMARY` con `created_at = now` (`rpg-handlers.ts:561,576`), no con `payload.date`: cerrar las comidas de AYER desde la página de ayer anota el evento en HOY. La fila sintética se ve en la página de ayer hasta el próximo `load()`, y al reabrir aparece en la de hoy. Es comportamiento del motor, previo a este rediseño.
13. **`aria-live` va en el `<ul>` de nutrición, no en el `<li>`**: un nodo que se monta ya con contenido no se anuncia; la lista existe antes de que la fila entre. Cuando la sección se CREA con la fila (el caso teórico: `modules` sale de los eventos, `rpg-handlers.ts:1258`), tampoco se anuncia; se acepta.
