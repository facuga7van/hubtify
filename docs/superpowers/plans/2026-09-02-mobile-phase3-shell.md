# Hubtify Mobile — Fase 3: Shell mobile — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Hubtify en Android se vea y se use como una app de teléfono: cabecera de 56 px con hamburguesa, el `<Sidebar>` real dentro de un drawer, sin barra de título, barra de estado del sistema con iconos claros sobre cuero, safe areas respetadas, botón atrás que cierra lo abierto y después navega, y ninguna de las páginas principales desbordando a lo ancho en 390×844 — con un arnés `browser-mobile` que lo verifica en cada corrida.

**Architecture:** `Layout.tsx` deja de renderizar la cáscara inline: `useShellKind()` elige `DesktopShell` (TitleBar + riel fijo + botón de colapso, tal cual estaba) o `MobileShell` (cabecera + drawer + scrim). El drawer monta `<Sidebar collapsed={false}>` sin tocarlo: `mobile-shell.css` solo le quita el `position: fixed; top: var(--shell-top)` del riel. La geometría del shell pasa a tokens (`--shell-top`, `--safe-*`) en `theme.css`; el shell mobile los fija vía `<html data-shell="mobile">`. El cableado con Capacitor (`@capacitor/app` `backButton`) vive en `src/mobile/native-shell.ts` y se importa dinámicamente solo con el bridge nativo presente, así el bundle desktop y el arnés de vitest no lo cargan. El pase responsive por módulo es CSS al final de cada hoja de módulo: reglas con prefijo `[data-shell="mobile"]` (el atributo que `MobileShell` pone en `<html>`; Electron nunca lo tiene, así que ninguna regla mobile puede pisar el escritorio) y `@media (hover: none)` para lo que solo se revelaba con el puntero, con cuatro retoques JSX puntuales donde el CSS no llega.

**Tech Stack:** React 19, react-router 7 (`HashRouter`), GSAP 3 + `@gsap/react`, Capacitor 8.5 (`@capacitor/app` 8.1.1, plugin core `SystemBars`), Vitest 4 browser mode + Playwright (Chromium), TypeScript 5.7.

**Spec (fuente de verdad):** `docs/superpowers/specs/2026-09-01-mobile-android-design.md` §5, §7, §10, §11 fila «3. Shell mobile».

**Rama:** `feature/mobile`. Cada tarea termina en un commit `type(scope): descripción` sin líneas de atribución de IA.

**Revisión del plan:** dos rondas con revisor independiente contra la spec y el código. Ronda 1: 6 bloqueantes + 9 menores, todos aplicados (el mayor: ninguna regla mobile usa un `@media` de ancho, ver desvío 9). Ronda 2: sin bloqueantes; los 9 menores aplicados salvo uno cosmético que queda anotado en los follow-ups (`hasCapacitorBridge()` duplica el chequeo inline de `isNativeMobile()`).

---

## Supuestos sobre la Fase 2 (implementada por otro plan en el mismo working tree)

Este plan asume que `docs/superpowers/plans/2026-09-01-mobile-phase2-capacitor-worker.md` ya está mergeado en `feature/mobile`. Nombres que usa, tal como los define ese plan:

| Símbolo / archivo | Origen |
|---|---|
| `src/shared/platform-detect.ts` → `isNativeMobile()` | Fase 2 Task 3 Step 5 |
| `src/global.d.ts` → `declare const __HUBTIFY_PLATFORM__: 'desktop' \| 'android' \| undefined` | Fase 2 Task 3 Step 4 |
| `vite.mobile.config.ts` (`define __HUBTIFY_PLATFORM__: '"android"'`, `outDir dist/mobile`) y `vite.renderer.config.ts` (`'"desktop"'`) | Fase 2 Task 3 |
| `capacitor.config.ts` (`appId com.hubtify.app`, `webDir dist/mobile`) | Fase 2 Task 3 Step 1 |
| `src/mobile/install-api.ts`, `src/mobile/FatalScreen.tsx`, `src/main.tsx` con `bootstrap()` | Fase 2 Tasks 8–9 |
| Scripts `mobile:build`, `mobile:sync`, `mobile:run`, `mobile:apk` | Fase 2 Task 13 Step 6 |
| `android/` commiteado, `android/variables.gradle` con `targetSdkVersion = 36` (template de Capacitor 8) | Fase 2 Task 13 Step 8 |
| Deps `@capacitor/core|app|device|status-bar`, `tests/mobile/` con tests del project `unit` | Fase 2 Tasks 2, 4–7 |

La Task 1 verifica todo esto con `rg` antes de tocar nada. Si algo difiere, se adapta el import en el archivo de este plan que lo usa; no se modifica la Fase 2 desde acá.

## Desvíos respecto de la spec (y por qué)

1. **Barra de estado: sin `setBackgroundColor` ni `setOverlaysWebView`.** La spec §7 pide `@capacitor/status-bar` `setStyle(Dark)`, `setBackgroundColor(--leather-dark)`, `setOverlaysWebView(false)`. Verificado en `node_modules/@capacitor/status-bar/README.md` («Android 16+ behavior change») y en `StatusBar.java` (`shouldSetStatusBarColor`): con targetSdk 36 —el template de Capacitor 8 que generó `cap add android`— esas dos llamadas no hacen nada. Quién decide dónde queda la barra es el plugin core **`SystemBars`** de Capacitor 8 (`plugin/SystemBars.java:200-244`), y hay DOS caminos según la versión del WebView: (a) **WebView ≥ 140 + `viewport-fit=cover`**: edge-to-edge real, la barra superpone al WebView, el plugin deja pasar los insets (`env()` funciona) y además inyecta `--safe-area-inset-*` con los px reales; la cabecera pinta cuero debajo de la barra con `padding-top: var(--safe-top)`. (b) **WebView < 140** (el emulador de la Fase 2 tiene 124): el plugin pone padding nativo al padre del WebView, el contenido web arranca DEBAJO de la barra, inyecta `--safe-area-inset-* = 0px`, y la franja de la barra muestra el `windowBackground` del tema Android — por eso `styles.xml` pasa a `#2a1d0e` (`--leather-dark`). En los dos caminos los iconos son claros (`plugins.SystemBars.style: 'DARK'` en `capacitor.config.ts`; `plugins.StatusBar` se configura igual para que el plugin de la Fase 2 no pise el estilo al cargar) y en los dos la cabecera queda pegada a la barra sin franja blanca. No hay llamadas en runtime.
2. **Safe areas: `--safe-area-inset-*` inyectadas por Capacitor + `env()` como respaldo.** `SystemBars` (`insetsHandling: 'css'`, el default) inyecta `--safe-area-inset-top/right/bottom/left` en `<html>` (px reales en el camino (a), `0px` en el (b), que es lo correcto porque ahí el WebView ya no está debajo de la barra). Por eso `theme.css` define `--safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px))` y todo el CSS usa `--safe-*`: funciona en los dos caminos y vale 0 en Electron y en vitest. `viewport-fit=cover` va en el `index.html` compartido (no hay un `index.html` mobile aparte; `vite.mobile.config.ts` usa el mismo): en Electron es inocuo, y en Android es lo que `SystemBars` chequea (`capacitorSystemBarsCheckMetaViewport`) para habilitar el camino (a).
3. **Arnés mobile: subconjunto nuevo en `tests/visual/mobile/`, no «los mismos tests».** Los 30 tests de `tests/visual/*.browser.test.tsx` llaman `page.viewport(1640, 900)` / `(760, 640)` explícitamente (p. ej. `audit-hub-dashboard.browser.test.tsx:59`), así que correrlos con otro viewport de proyecto no cambia nada. El project `browser-mobile` corre `tests/visual/mobile/**` (Dashboard, Questify, Coinify, Nutrify, Cauldron, Personaje/Logros/Recompensas y el shell) montando cada página DENTRO del `MobileShell` real, reusando `installApi`, `stats` y las mediciones de `tests/visual/audit-hub-harness.tsx`. Screenshots en `tests/visual/__screenshots__/mobile/` (spec §7; ya gitignored). Los tests de escritorio no se tocan.
4. **`TitleBar` se guarda sola.** `Layout.tsx` ya no la renderiza en mobile porque monta `MobileShell`, pero `AuthPage.tsx:129` y `Onboarding.tsx:380` también la montan: `TitleBar` devuelve `null` con `isNativeMobile()` y las tres pantallas quedan cubiertas sin duplicar el guard.
5. **Botón atrás sin registro por componente.** Todos los modales del proyecto (incluido el drawer) pasan por `useModalA11y`, que cierra el diálogo de más arriba con `Escape` en `window`. `native-shell.ts` detecta `[role="dialog"][aria-modal="true"]:not([inert])` y manda un `Escape` sintético; si no hay diálogo, `history.back()` si `canGoBack`, y en la raíz `App.minimizeApp()`. La lógica de decisión es pura (`src/mobile/back-button.ts`) y se testea en Node.
6. **Selección de shell: `isNativeMobile() || innerWidth < 600`** como dice la spec, en un hook `useShellKind()` con listener de `resize` (en Electron `minWidth` es 700, así que en escritorio nunca cambia; el hook es lo que hace que la regla sea la de la spec y no un `if` suelto). `DesktopShell.tsx` es una extracción 1:1 del JSX que estaba en `Layout.tsx`.
7. **El padding de página de Coinify y Nutrify se corrige en su propia hoja.** `.coin-book .qb-page` (`coinify.css:2141`) y `.nutri-page` (`nutri.css:28`) pisan a `shell.css` por especificidad/orden de import (`App.tsx` importa las hojas de módulo DESPUÉS de las del hub). Ponerlo en `layout.css` no aplicaría.
8. **Cuatro retoques JSX, no más.** Donde un `style={{ minWidth }}`/`nowrap` inline hace imposible el arreglo por CSS: `ScrollNotes.tsx:261` (`minWidth: 540` → clase), `TaskForm.tsx:144` (`flexWrap`), `FoodLogItem.tsx:284` (`whiteSpace: 'nowrap'`), `FinanceLayout.tsx` (`scrollIntoView` de la pestaña activa). Todo lo demás es CSS.
9. **Sin `@media` de ancho para mobile.** El pedido original era un `@media (max-width: 768px)` transversal, pero Electron permite 700 px (`electron/main.ts:205`) y los tests de escritorio bajan a 760 (`NARROW`), 430 (`coinify-installments-recurring`) y 420 px (`castle-chart-size`): cualquier breakpoint de ancho cambiaría el escritorio y rompería «`npm run test:visual` sin cambios» (p. ej. `audit-coin-ledger:154-169` compara las columnas del header con las de la fila). Toda regla mobile lleva el prefijo `[data-shell="mobile"]`, que solo existe cuando `MobileShell` está montado (Android y el arnés `browser-mobile`). `@media (hover: none)` sí se usa para lo que solo se revelaba con el puntero: los tests de escritorio no emulan touch, y en una pantalla táctil de escritorio esas reglas son las correctas; el project `browser-mobile` emula touch (`contextOptions`) para poder verificarlas.

**Follow-ups fuera de esta fase (anotados, no bloquean):** `Tooltip.tsx` y `HelpBubble.tsx` solo abren con hover/focus (en touch no se leen las explicaciones de virtudes y stats de la Ficha del Héroe); anchos inline en px de inputs (`Today.tsx:1456/1465/1928/1932/2018/2255`, `AccountManager.tsx:220/280/319`, `StatementDetail.tsx:195/201`, `Transactions.tsx:558`, `TaskForm.tsx:220/247/271`); `CharacterCanvas.tsx:174` sin tope de resolución con DPR 3; QuickAdd (Ctrl+K) no tiene disparador táctil; el `.tap-target` de la casa es 32 px (Android recomienda 44); `hasCapacitorBridge()` repite el chequeo de `window.Capacitor` que `isNativeMobile()` hace inline (unificar cuando se toque `platform-detect.ts`).

## Entorno (para las tareas con emulador)

Igual que la Fase 2: exportar en CADA shell nueva antes de Gradle/adb.

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="D:/android-sdk"
export ADB="D:/android-sdk/platform-tools/adb.exe"
"$ADB" devices    # esperado: emulator-5554   device
```

## File structure

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `src/hub/shell-types.ts` | `ShellProps` (stats, onBellClick, onToggleInn, children) que comparten los dos shells |
| `src/hub/useShellKind.ts` | `shellKindFor(native, width)` puro + hook `useShellKind()` |
| `src/hub/DesktopShell.tsx` | TitleBar + `.sidebar-wrapper` + toggle + `<main>`; el estado `sidebarCollapsed` y `AUTO_COLLAPSE_WIDTH` se mudan acá desde `Layout.tsx` |
| `src/hub/MobileShell.tsx` | Cabecera 56 px (hamburguesa, título de sección, campana), `<main>`, scrim y drawer con `<Sidebar>`; fija `data-shell="mobile"`; importa `native-shell` solo con bridge |
| `src/hub/styles/mobile-shell.css` | `.mobile-header`, `.mobile-scrim`, `.mobile-drawer`, override del `.sidebar` dentro del drawer |
| `src/mobile/back-button.ts` | `handleBackButton(ctx)` puro: diálogo → historial → minimizar |
| `src/mobile/native-shell.ts` | `bindNativeShell()`: `App.addListener('backButton')` sobre `handleBackButton`, detección del diálogo abierto |
| `tests/hub/shell-kind.test.ts`, `tests/mobile/back-button.test.ts` | Tests del project `unit` |
| `tests/visual/mobile/mobile-harness.tsx` | `mountInShell`, `MOBILE`, `SHOTS`, `docOverflowX`, `shoot` |
| `tests/visual/mobile/fixtures.ts` | Stubs de `window.api` compactos por módulo |
| `tests/visual/mobile/mobile-shell.browser.test.tsx`, `mobile-hub.browser.test.tsx`, `mobile-quests.browser.test.tsx`, `mobile-coinify.browser.test.tsx`, `mobile-nutrify.browser.test.tsx`, `mobile-cauldron.browser.test.tsx` | Tests del project `browser-mobile` |

**Modificados:**

| Archivo | Cambio |
|---|---|
| `src/hub/styles/theme.css` | Tokens `--shell-top`, `--safe-top/right/bottom/left` |
| `src/hub/styles/layout.css` | `.sidebar { top: var(--shell-top, 32px) }`, `.shell-frame`, reglas `[data-shell="mobile"]` transversales (página, header del códice, safe areas en overlays y capas fijas) |
| `src/hub/Layout.tsx` | Elige shell con `useShellKind()`; pierde TitleBar/Sidebar/colapso inline |
| `src/shared/components/TitleBar.tsx` | `return null` con `isNativeMobile()` |
| `src/shared/platform-detect.ts` | `hasCapacitorBridge()` |
| `src/shared/components/icons/CodexIcons.tsx` | Icono `MenuLines` |
| `src/i18n/es.json`, `src/i18n/en.json` | `hub.openMenu` |
| `index.html` | `viewport-fit=cover` |
| `capacitor.config.ts` | `plugins.SystemBars` y `plugins.StatusBar` |
| `android/app/src/main/res/values/styles.xml` | `android:windowBackground` = `#2a1d0e` (`--leather-dark`) en `AppTheme.NoActionBar`: la franja de la barra de estado cuando el WebView no va edge-to-edge |
| `vitest.config.ts`, `package.json` | Project `browser-mobile`, script `test:visual:mobile` |
| `src/modules/quests/styles/quests.css`, `src/modules/finance/styles/coinify.css`, `src/modules/nutrition/styles/nutri.css`, `src/modules/cauldron/styles/cauldron.css`, `src/hub/styles/dashboard-layouts.css`, `src/hub/styles/character.css`, `src/hub/styles/codex-seal.css`, `src/hub/rewards/rewards.css` | Bloques `[data-shell="mobile"]` / `@media (hover: none)` al final |
| `src/modules/quests/components/ScrollNotes.tsx`, `TaskForm.tsx`, `src/modules/nutrition/components/FoodLogItem.tsx`, `src/modules/finance/components/FinanceLayout.tsx` | Los cuatro retoques JSX |
| `DESIGN_SYSTEM.md`, `tests/visual/README.md`, `docs/superpowers/specs/2026-09-01-mobile-android-design.md` §7 | Breakpoints reales, arnés mobile, la spec alineada con los desvíos 1–4 y 9 |

---

## Chunk 1: Fundaciones (tokens, detección de shell, botón atrás, icono)

### Task 1: Verificar los supuestos de la Fase 2 y anotar la línea base

**Files:** ninguno (solo lectura).

- [ ] **Step 1: Rama y estado**

Run: `git branch --show-current && git status --short | head -5`
Expected: `feature/mobile` y ninguna línea de status (la Fase 2 está commiteada).

- [ ] **Step 2: Símbolos de la Fase 2 que usa este plan**

Run:
```bash
rg -n "export function isNativeMobile" src/shared/platform-detect.ts
rg -n "__HUBTIFY_PLATFORM__" src/global.d.ts vite.renderer.config.ts vite.mobile.config.ts
rg -n "webDir|androidScheme" capacitor.config.ts
rg -n "\"mobile:(build|sync|run|apk)\"|\"test:visual\"" package.json
rg -n "targetSdkVersion" android/variables.gradle
rg -n "installMobileApi|FatalScreen" src/main.tsx
ls src/mobile tests/mobile
node -p "['@capacitor/core','@capacitor/app','@capacitor/status-bar','@gsap/react'].map(p => p + ' ' + require(p + '/package.json').version).join('\n')"
```
Expected: cada `rg` imprime al menos una línea; `targetSdkVersion = 36`; `ls` lista `install-api.ts`, `FatalScreen.tsx`, `worker.ts`, etc.; las versiones son `8.5.1 / 8.1.1 / 8.0.3 / 2.x`. Si `targetSdkVersion` fuera 35 o menor, el desvío 1 no aplica al pie de la letra (la barra podría no superponer); igual se sigue este plan, que funciona en los dos casos.

- [ ] **Step 3: Hechos del código que este plan da por sentados**

Run:
```bash
rg -n "top: 32px" src/hub/styles/layout.css
rg -n "<TitleBar" src/hub/Layout.tsx src/hub/AuthPage.tsx src/hub/Onboarding.tsx
rg -n "AUTO_COLLAPSE_WIDTH|sidebar-wrapper" src/hub/Layout.tsx
rg -n "useModalA11y" src/shared/components/NotificationCenter.tsx src/shared/components/ConfirmDialog.tsx
rg -n "^const defaults" src/shared/components/icons/CodexIcons.tsx
rg -n "^  \"hub\": \{" src/i18n/es.json src/i18n/en.json
```
Expected: `layout.css:12`, tres `<TitleBar />`, `Layout.tsx` con `AUTO_COLLAPSE_WIDTH = 820` y la `sidebar-wrapper`, los dos `useModalA11y`, `const defaults`, y `"hub": {` en las dos hojas de idioma.

- [ ] **Step 4: Línea base de tests**

Run: `npm test 2>&1 | tail -4`
Expected: `Test Files  N passed (N)`, `Tests  M passed (M)`. Anotar N y M: al cerrar el plan deben ser **N+2** archivos y **M+6** tests.

Run: `npm run test:visual 2>&1 | tail -4`
Expected: `Test Files  30 passed (30)` (o el número que haya; anotarlo: NO cambia en esta fase). Si algún test visual ya falla en la línea base, anotarlo y no contarlo como regresión.

No hay commit en esta tarea.

### Task 2: Tokens de shell y safe areas; TitleBar se omite en mobile

**Files:**
- Modify: `src/hub/styles/theme.css:60` (después de `--z-system-toast`)
- Modify: `src/hub/styles/layout.css:1-5` y `:12`
- Modify: `src/shared/components/TitleBar.tsx`
- Modify: `index.html:5`

- [ ] **Step 1: Tokens en `theme.css`**

Insertar después de la línea `  --z-system-toast: 10003;  /* System toast container (topmost) */` y antes del bloque `/* ── Compatibility aliases`:

```css

  /* ── Shell geometry y safe areas ───────────────────
     --shell-top: alto de la barra de título de Electron; el sidebar arranca
     debajo (layout.css). El shell mobile no tiene TitleBar y lo pone en 0
     vía <html data-shell="mobile">.
     --safe-*: insets del sistema en Android. Capacitor 8 (plugin core
     SystemBars, insetsHandling 'css') inyecta --safe-area-inset-* en <html>
     con los píxeles reales de la barra de estado y de gestos; env() cubre el
     WebView >= 140 con viewport-fit=cover; en Electron y en vitest son 0. */
  --shell-top: 32px;
  --safe-top:    var(--safe-area-inset-top,    env(safe-area-inset-top, 0px));
  --safe-right:  var(--safe-area-inset-right,  env(safe-area-inset-right, 0px));
  --safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  --safe-left:   var(--safe-area-inset-left,   env(safe-area-inset-left, 0px));
```

- [ ] **Step 2: El sidebar arranca en `--shell-top`; el marco de la ventana pasa a CSS**

En `layout.css`, reemplazar las líneas 1–5:

```css

.app-layout {
  display: flex;
  width: 100vw;
}
```

por:

```css

/* El marco de la ventana: barra de título (o cabecera mobile) arriba y el
   .app-layout llenando el resto. Vivía inline en Layout.tsx. */
.shell-frame {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* El shell mobile (MobileShell.tsx) marca <html data-shell="mobile">: sin
   barra de título y con el alto dinámico del WebView. */
:root[data-shell="mobile"] {
  --shell-top: 0px;
}

:root[data-shell="mobile"] .shell-frame {
  height: 100dvh;
}

.app-layout {
  display: flex;
  width: 100vw;
}
```

Y en la regla `.sidebar` (línea ~12 original), reemplazar `  top: 32px; bottom: 0; left: 0;` por `  top: var(--shell-top, 32px); bottom: 0; left: 0;`.

- [ ] **Step 3: `TitleBar` devuelve `null` en mobile**

Reemplazar el principio de `src/shared/components/TitleBar.tsx` (líneas 1–2):

```tsx
export default function TitleBar() {
  return (
```

por:

```tsx
import { isNativeMobile } from '../platform-detect';

export default function TitleBar() {
  // Android no tiene ventana propia que minimizar/cerrar y la barra de estado
  // es del sistema (spec §7). Se guarda acá y no en cada caller: Layout,
  // AuthPage y Onboarding la montan las tres.
  if (isNativeMobile()) return null;
  return (
```

- [ ] **Step 4: `viewport-fit=cover`**

En `index.html` reemplazar la línea 5 por:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run test:visual -- sidebar-fit audit-hub-shell 2>&1 | tail -4`
Expected: tsc sin salida; `Test Files  2 passed (2)` — el riel sigue en `top: 32px` porque `--shell-top` vale 32px por defecto.

- [ ] **Step 6: Commit**

```bash
git add src/hub/styles/theme.css src/hub/styles/layout.css src/shared/components/TitleBar.tsx index.html
git commit -m "feat(hub): tokens de shell y safe areas; TitleBar se omite en mobile"
```

### Task 3: `useShellKind` — quién decide qué shell se monta

**Files:**
- Create: `src/hub/shell-types.ts`
- Create: `src/hub/useShellKind.ts`
- Test: `tests/hub/shell-kind.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
// tests/hub/shell-kind.test.ts
import { describe, it, expect } from 'vitest';
import { shellKindFor, MOBILE_SHELL_MAX_WIDTH } from '../../src/hub/useShellKind';

describe('shellKindFor (spec §7: isNativeMobile() || viewport < 600)', () => {
  it('con bridge nativo es mobile sin importar el ancho', () => {
    expect(shellKindFor(true, 1920)).toBe('mobile');
  });

  it('en escritorio, de 600 para arriba es desktop', () => {
    expect(shellKindFor(false, 700)).toBe('desktop');
    expect(shellKindFor(false, MOBILE_SHELL_MAX_WIDTH)).toBe('desktop');
  });

  it('en escritorio, por debajo de 600 es mobile', () => {
    expect(shellKindFor(false, MOBILE_SHELL_MAX_WIDTH - 1)).toBe('mobile');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/hub/shell-kind.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../src/hub/useShellKind"`.

- [ ] **Step 3: Crear `src/hub/shell-types.ts`**

```ts
import type { ReactNode } from 'react';
import type { PlayerStats } from '../../shared/types';

/** Lo que Layout le pasa a DesktopShell y a MobileShell por igual. */
export interface ShellProps {
  stats: PlayerStats | null;
  onBellClick: () => void;
  onToggleInn: () => void;
  children: ReactNode;
}
```

- [ ] **Step 4: Crear `src/hub/useShellKind.ts`**

```ts
import { useEffect, useState } from 'react';
import { isNativeMobile } from '../shared/platform-detect';

/**
 * Por debajo de este ancho de viewport el shell de escritorio no entra ni con
 * el riel colapsado (spec §7). En Electron la ventana no baja de 700 px
 * (electron/main.ts minWidth), así que en escritorio nunca dispara; existe
 * para que la regla sea la de la spec y no un `if` suelto.
 */
export const MOBILE_SHELL_MAX_WIDTH = 600;

export type ShellKind = 'desktop' | 'mobile';

export function shellKindFor(nativeMobile: boolean, viewportWidth: number): ShellKind {
  return nativeMobile || viewportWidth < MOBILE_SHELL_MAX_WIDTH ? 'mobile' : 'desktop';
}

export function useShellKind(): ShellKind {
  const [kind, setKind] = useState<ShellKind>(() => shellKindFor(isNativeMobile(), window.innerWidth));

  useEffect(() => {
    // Android es mobile fijo: no hay resize que lo cambie.
    if (isNativeMobile()) return;
    const onResize = () => setKind(shellKindFor(false, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return kind;
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test -- tests/hub/shell-kind.test.ts 2>&1 | tail -5`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 6: Commit**

```bash
git add src/hub/shell-types.ts src/hub/useShellKind.ts tests/hub/shell-kind.test.ts
git commit -m "feat(hub): useShellKind decide entre shell de escritorio y mobile"
```

### Task 4: `back-button.ts` — la decisión del botón atrás, pura

**Files:**
- Create: `src/mobile/back-button.ts`
- Test: `tests/mobile/back-button.test.ts`

Spec §7: «cierra drawer/modal; si no, `history.back()`; en la raíz `App.minimizeApp()`».

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/back-button.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleBackButton, type BackContext } from '../../src/mobile/back-button';

function ctx(over: Partial<BackContext> = {}): BackContext {
  return {
    openDialog: false,
    closeDialog: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
    minimize: vi.fn(),
    ...over,
  };
}

describe('handleBackButton (spec §7)', () => {
  it('con un diálogo abierto lo cierra y no navega', () => {
    const c = ctx({ openDialog: true, canGoBack: true });
    expect(handleBackButton(c)).toBe('dialog');
    expect(c.closeDialog).toHaveBeenCalledTimes(1);
    expect(c.goBack).not.toHaveBeenCalled();
    expect(c.minimize).not.toHaveBeenCalled();
  });

  it('sin diálogo y con historial vuelve atrás', () => {
    const c = ctx({ canGoBack: true });
    expect(handleBackButton(c)).toBe('history');
    expect(c.goBack).toHaveBeenCalledTimes(1);
    expect(c.minimize).not.toHaveBeenCalled();
  });

  it('en la raíz minimiza la app', () => {
    const c = ctx();
    expect(handleBackButton(c)).toBe('minimize');
    expect(c.minimize).toHaveBeenCalledTimes(1);
    expect(c.goBack).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- tests/mobile/back-button.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../src/mobile/back-button"`.

- [ ] **Step 3: Crear `src/mobile/back-button.ts`**

```ts
/**
 * Botón «atrás» de Android (spec §7): primero cierra lo que esté abierto
 * (drawer o modal), si no hay nada vuelve en el historial, y en la raíz
 * minimiza la app. Es pura a propósito —se testea en Node—; el cableado con
 * @capacitor/app y el DOM vive en native-shell.ts.
 */
export interface BackContext {
  /** Hay un diálogo modal abierto (el drawer incluido). */
  openDialog: boolean;
  /** Cierra el diálogo de más arriba. */
  closeDialog(): void;
  /** `canGoBack` del evento backButton de Capacitor (historial del WebView). */
  canGoBack: boolean;
  goBack(): void;
  minimize(): void;
}

export type BackOutcome = 'dialog' | 'history' | 'minimize';

export function handleBackButton(ctx: BackContext): BackOutcome {
  if (ctx.openDialog) {
    ctx.closeDialog();
    return 'dialog';
  }
  if (ctx.canGoBack) {
    ctx.goBack();
    return 'history';
  }
  ctx.minimize();
  return 'minimize';
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- tests/mobile/back-button.test.ts 2>&1 | tail -5`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/back-button.ts tests/mobile/back-button.test.ts
git commit -m "feat(mobile): decisión pura del botón atrás (diálogo, historial, minimizar)"
```

### Task 5: Icono `MenuLines`, `hub.openMenu`, `hasCapacitorBridge()`

**Files:**
- Modify: `src/shared/components/icons/CodexIcons.tsx` (antes de `export function MoonCrescent`, línea ~402)
- Modify: `src/i18n/es.json:896`, `src/i18n/en.json:896` (sección `hub`, orden alfabético)
- Modify: `src/shared/platform-detect.ts`

Skill: `~/.claude/skills/svg-icons/SKILL.md` (viewBox 24, `{...defaults} {...props}`, `currentColor`, comentarios por grupo, orden alfabético).

- [ ] **Step 1: El icono**

Insertar en `CodexIcons.tsx` inmediatamente antes de `export function MoonCrescent(`:

```tsx
/** Tres renglones trazados a pluma: el menú del shell mobile. */
export function MenuLines(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      {/* Three quill strokes, each a touch uneven */}
      <path d="M4 7.2c5-.5 11-.5 16 .1" strokeWidth={1.5} />
      <path d="M4 12c5.2-.4 10.6-.4 16 .2" strokeWidth={1.5} />
      <path d="M4 16.8c4.8-.6 11.2-.5 16 0" strokeWidth={1.5} />
      {/* Ink pooled where each stroke starts */}
      <circle cx="4.2" cy="7.2" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="4.2" cy="12" r=".6" fill="currentColor" fillOpacity=".2" />
      <circle cx="4.2" cy="16.8" r=".6" fill="currentColor" fillOpacity=".2" />
    </svg>
  );
}

```

- [ ] **Step 2: i18n**

En `src/i18n/es.json`, dentro de `"hub": {`, después de `"mainNavigation": "Navegación principal",` agregar:

```json
    "openMenu": "Abrir menú",
```

En `src/i18n/en.json`, después de `"mainNavigation": "Main navigation",`:

```json
    "openMenu": "Open menu",
```

Run: `node -e "for (const l of ['es','en']) console.log(l, require('./src/i18n/'+l+'.json').hub.openMenu)"`
Expected: `es Abrir menú` y `en Open menu`.

- [ ] **Step 3: `hasCapacitorBridge()`**

Agregar al final de `src/shared/platform-detect.ts`:

```ts

/**
 * ¿Está el bridge nativo de Capacitor (`window.Capacitor`)? Distingue la app
 * Android real del mismo bundle 'android' corriendo en el arnés browser-mobile
 * de vitest, donde no hay plugins que llamar.
 */
export function hasCapacitorBridge(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3`
Expected: sin errores.

```bash
git add src/shared/components/icons/CodexIcons.tsx src/i18n/es.json src/i18n/en.json src/shared/platform-detect.ts
git commit -m "feat(hub): icono MenuLines, hub.openMenu y hasCapacitorBridge()"
```


## Chunk 2: El shell (arnés browser-mobile, MobileShell, DesktopShell, Layout, nativo)

### Task 6: Project `browser-mobile`, script y arnés

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (scripts)
- Create: `tests/visual/mobile/mobile-harness.tsx`

Los tests de escritorio fijan su viewport con `page.viewport(...)` (desvío 3), así que el subárbol `tests/visual/mobile/` es propio del project nuevo y se excluye del project `browser`.

- [ ] **Step 1: Reescribir `vitest.config.ts`**

Contenido completo nuevo:

```ts
import { defineConfig, configDefaults } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import pkg from './package.json' with { type: 'json' };

// Absolute paths — Vite's browser transform won't resolve relative aliases.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@core': r('./src/core'),
  '@hub': r('./src/hub'),
  '@shared': r('./src/shared'),
  '@modules': r('./src/modules'),
  '@logic': r('./shared-logic'),
};

export default defineConfig({
  // El renderer se compila con este define (vite.renderer.config.ts); sin él un
  // test de browser que monte el shell revienta con «APP_VERSION is not defined».
  define: { APP_VERSION: JSON.stringify(pkg.version) },
  resolve: { alias },
  test: {
    projects: [
      {
        // Backend / IPC tests — run in Node with in-memory SQLite (unchanged).
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'tests/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        // Visual / component tests — run in a real Chromium via Playwright.
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/visual/**/*.test.tsx'],
          // El subárbol mobile corre en su propio project (abajo), con otro
          // viewport y el define de Android.
          exclude: [...configDefaults.exclude, 'tests/visual/mobile/**'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 900, height: 720 },
          },
        },
      },
      {
        // Arnés mobile (spec §7): mismo Chromium, viewport 390×844 y el define
        // de Android. Sin bridge de Capacitor, isNativeMobile() da true, Layout
        // monta MobileShell y TitleBar devuelve null.
        extends: true,
        define: { __HUBTIFY_PLATFORM__: '"android"' },
        test: {
          name: 'browser-mobile',
          include: ['tests/visual/mobile/**/*.test.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // Touch emulado: así `(hover: none)` matchea y las reglas de
            // touch de cada módulo se pueden verificar en el arnés.
            instances: [{ browser: 'chromium', contextOptions: { hasTouch: true, isMobile: true } }],
            viewport: { width: 390, height: 844 },
          },
        },
      },
    ],
  },
});
```

- [ ] **Step 2: Script**

En `package.json`, después de `"test:visual:watch": "vitest --project browser",` agregar:

```json
    "test:visual:mobile": "vitest run --project browser-mobile",
```

- [ ] **Step 3: Crear `tests/visual/mobile/mobile-harness.tsx`**

Importa `@hub/MobileShell`, que recién existe en la Task 7: es a propósito (el primer test de la Task 7 tiene que fallar por ese import). Ni `tsc` (`tests/` no está en el `include` del tsconfig raíz) ni lint lo marcan, y el commit de esta tarea deja el arnés listo para el TDD de la siguiente.

```tsx
/**
 * Arnés del project `browser-mobile` (spec §7): viewport 390×844 con el define
 * de Android. Reusa el stub de window.api y las mediciones del arnés del hub y
 * monta cada página DENTRO del MobileShell real, para medirla con la cabecera
 * de 56 px, sin sidebar y con el drawer disponible.
 *
 * `page.screenshot({ path })` resuelve relativo al archivo de test, por eso
 * SHOTS sube un nivel: las capturas caen en tests/visual/__screenshots__/mobile/
 * (gitignored, como screens/).
 */
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import MobileShell from '@hub/MobileShell';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { AnimatedNavigateContext } from '@shared/components/AnimatedOutlet';
import { installApi, stats, fitCapture, resetCapture, overflowingNodes } from '../audit-hub-harness';

export { installApi, stats, overflowingNodes };

export const MOBILE: [number, number] = [390, 844];
export const SHOTS = '../__screenshots__/mobile';

const authUser = {
  uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo',
} as unknown as NonNullable<React.ContextType<typeof AuthContext>['user']>;

export const baseAuth = {
  user: authUser,
  loading: false,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: true }),
  switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => ([
    { uid: 'u2', email: 'segunda@hubtify.app', firebaseAppName: 'a2', lastUsed: '', username: 'Segundo' },
  ]),
} as unknown as React.ContextType<typeof AuthContext>;

/** El Sidebar navega por AnimatedNavigateContext; acá lo puenteamos al router de memoria. */
function NavBridge({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <AnimatedNavigateContext.Provider value={(to) => navigate(to)}>
      {children}
    </AnimatedNavigateContext.Provider>
  );
}

/** Monta `node` como página del MobileShell en la ruta `route`. */
export function mountInShell(node: ReactNode, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider>
          <NavBridge>
            <div className="shell-frame">
              <MobileShell stats={stats} onBellClick={() => {}} onToggleInn={() => {}}>
                {node}
              </MobileShell>
            </div>
          </NavBridge>
        </ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

export const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

export async function setMobileViewport() {
  await page.viewport(...MOBILE);
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
}

/** Desborde horizontal del documento: el criterio de aceptación de la fase (spec §11). */
export function docOverflowX(): number {
  return document.documentElement.scrollWidth - window.innerWidth;
}

export function mainOverflowX(): number {
  const main = document.querySelector('.main-content') as HTMLElement;
  return main.scrollWidth - main.clientWidth;
}

/** Captura arriba y, si la página scrollea, abajo. */
export async function shoot(name: string) {
  const main = document.querySelector('.main-content') as HTMLElement | null;
  fitCapture();
  await page.screenshot({ path: `${SHOTS}/${name}-a.png` });
  if (main && main.scrollHeight - main.clientHeight > 40) {
    main.scrollTop = main.scrollHeight;
    await settle(250);
    await page.screenshot({ path: `${SHOTS}/${name}-b.png` });
    main.scrollTop = 0;
  }
  resetCapture();
}
```

- [ ] **Step 4: Verificar que los dos projects se reconocen**

Run: `npm run test:visual:mobile 2>&1 | tail -4`
Expected: `No test files found` (exit 1) — todavía no hay tests en `tests/visual/mobile/`; lo que importa es que NO diga «project not found».

Run: `npm run test:visual 2>&1 | tail -4`
Expected: los mismos `Test Files  30 passed (30)` de la Task 1 Step 4.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json tests/visual/mobile/mobile-harness.tsx
git commit -m "test(mobile): project vitest browser-mobile (390x844, define android) y arnés"
```

### Task 7: `MobileShell` — cabecera, drawer con el Sidebar real, scrim

**Files:**
- Create: `src/hub/styles/mobile-shell.css`
- Create: `src/hub/MobileShell.tsx`
- Test: `tests/visual/mobile/mobile-shell.browser.test.tsx`

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-shell.browser.test.tsx
import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { isNativeMobile } from '@shared/platform-detect';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX } from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/hub/styles/codex-seal.css';
import '../../../src/shared/styles/notifications.css';

beforeAll(() => {
  installApi();
});

function Page() {
  return <div className="qb-page"><h1 className="qb-title">Página de prueba</h1></div>;
}

const drawer = () => document.getElementById('mobile-drawer') as HTMLElement;
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

async function openDrawer() {
  await page.getByRole('button', { name: /Abrir menú/i }).click();
  await settle(400);
}

describe('MobileShell — cabecera y drawer', () => {
  test('el project corre como Android: sin TitleBar, --shell-top 0, cabecera de 56 px', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();

    expect(isNativeMobile()).toBe(true);
    expect(document.documentElement.dataset.shell).toBe('mobile');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--shell-top').trim()).toBe('0px');
    expect(document.querySelector('.title-bar')).toBeNull();
    const header = document.querySelector('.mobile-header') as HTMLElement;
    expect(Math.round(header.getBoundingClientRect().height)).toBe(56);
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    // El project emula touch (contextOptions en vitest.config.ts): si esto da
    // false, las reglas @media (hover: none) no se están verificando.
    expect(window.matchMedia('(hover: none)').matches).toBe(true);
    await shoot('shell-00-cerrado');
  });

  test('la hamburguesa abre el drawer con el Sidebar entero; la scrim lo cierra', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    expect(drawer().hasAttribute('inert')).toBe(true);

    await openDrawer();
    const r = drawer().getBoundingClientRect();
    expect(Math.round(r.left)).toBe(0);
    expect(r.width).toBeLessThanOrEqual(300);
    expect(drawer().hasAttribute('inert')).toBe(false);
    // Es el Sidebar real, expandido: las siete entradas están.
    await expect.element(page.getByRole('button', { name: /Recompensas/i })).toBeVisible();
    expect(document.querySelector('.mobile-drawer .sidebar--collapsed')).toBeNull();
    expect(docOverflowX()).toBeLessThanOrEqual(0);
    await shoot('shell-01-drawer-abierto');

    await page.getByTestId('mobile-scrim').click();
    await settle(400);
    expect(drawer().getBoundingClientRect().right).toBeLessThanOrEqual(0);
    expect(drawer().hasAttribute('inert')).toBe(true);
  });

  test('Escape cierra el drawer (es lo que manda el botón atrás de Android)', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    escape();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    expect(drawer().getBoundingClientRect().right).toBeLessThanOrEqual(0);
  });

  test('navegar desde el menú cierra el drawer y cambia el título de la cabecera', async () => {
    await setMobileViewport();
    mountInShell(<Page />);
    await settle();
    await expect.element(page.getByRole('heading', { name: /Tabla del Aventurero/i })).toBeVisible();

    await openDrawer();
    // El nombre accesible es «3 Questify»: el badge de vencidas (Sidebar.tsx:283-285) va antes del rótulo.
    await page.getByRole('button', { name: /Questify$/i }).click();
    await settle(400);
    expect(drawer().hasAttribute('inert')).toBe(true);
    await expect.element(page.getByRole('heading', { name: /^Questify$/i })).toBeVisible();
  });

  test('un inset de barra de estado empuja la cabecera, no la tapa', async () => {
    await setMobileViewport();
    // Lo que inyecta el plugin SystemBars de Capacitor en el WebView real.
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    mountInShell(<Page />);
    await settle();
    const header = document.querySelector('.mobile-header') as HTMLElement;
    const btn = page.getByRole('button', { name: /Abrir menú/i }).element() as HTMLElement;
    expect(Math.round(header.getBoundingClientRect().height)).toBe(80);
    expect(btn.getBoundingClientRect().top).toBeGreaterThanOrEqual(24);
    document.documentElement.style.removeProperty('--safe-area-inset-top');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run test:visual:mobile 2>&1 | tail -6`
Expected: `Failed to resolve import "@hub/MobileShell"`.

- [ ] **Step 3: Crear `src/hub/styles/mobile-shell.css`**

```css
/* ══════════════════════════════════════════════════════
   MOBILE SHELL — cabecera + drawer (Android; spec §7).
   Lo monta Layout cuando useShellKind() da 'mobile'. El drawer REUSA
   <Sidebar>: acá solo se le quita el `position: fixed; top: var(--shell-top)`
   del riel de escritorio. Tokens: theme.css (--safe-*, --z-*, --ff-*, --fs-*).
   ══════════════════════════════════════════════════════ */

/* ── Cabecera ────────────────────────────────────── */
.mobile-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  /* Con WebView >= 140 la barra de estado superpone al WebView y este padding
     (--safe-top = --safe-area-inset-top) es la franja de cuero que pinta la
     cabecera debajo de ella; con WebView < 140 vale 0 y la franja es el
     windowBackground de styles.xml. */
  height: calc(56px + var(--safe-top));
  padding: var(--safe-top) 6px 0 6px;
  background: linear-gradient(180deg, var(--leather) 0%, var(--leather-dark) 100%);
  border-bottom: 2px solid var(--gold);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
  color: var(--parch-0);
  user-select: none;
}

.mobile-header__btn {
  background: none;
  border: none;
  color: var(--gold);
  cursor: pointer;
  border-radius: 4px;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mobile-header__btn:active {
  background: rgba(168, 138, 60, 0.25);
}

.mobile-header__btn:focus-visible {
  outline: 2px solid var(--gold-light);
  outline-offset: -2px;
}

.mobile-header__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-family: var(--ff-display);
  font-size: var(--fs-heading);
  letter-spacing: 0.03em;
  color: var(--gold-light);   /* 6.21:1 sobre cuero, el mismo que .title-bar-text */
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-header__actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.mobile-header__actions .notif-bell {
  min-width: 44px;
  min-height: 44px;
}

/* ── Contenido ───────────────────────────────────── */
.app-layout--mobile {
  flex: 1;
  height: 0;
  width: 100%;
}

.app-layout--mobile .main-content {
  width: 100%;
  min-width: 0;
  overscroll-behavior: contain;
  padding-bottom: var(--safe-bottom);
}

/* ── Scrim ───────────────────────────────────────── */
.mobile-scrim {
  position: fixed;
  inset: 0;
  display: none;
  opacity: 0;
  background: rgba(42, 29, 14, 0.55);
  z-index: var(--z-overlay);
}

/* ── Drawer ──────────────────────────────────────── */
.mobile-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(300px, 85vw);
  transform: translateX(-100%);
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
  background: var(--leather-dark);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.6);
  outline: none;
}

/* El riel de escritorio es fixed / 260px (220 bajo 900px) / top --shell-top:
   dentro del drawer ocupa todo el ancho y el alto disponibles. La
   especificidad (0,3,0) gana a `.sidebar:not(.sidebar--collapsed)` del
   @media de layout.css. */
.mobile-drawer .sidebar,
.mobile-drawer .sidebar:not(.sidebar--collapsed) {
  position: relative;
  top: auto;
  width: 100%;
  flex: 1;
  min-height: 0;
  box-shadow: none;
  transition: none;
}
```

- [ ] **Step 4: Crear `src/hub/MobileShell.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import Sidebar from './Sidebar';
import NotificationBell from '../shared/components/NotificationBell';
import { MenuLines } from '../shared/components/icons';
import { useModalA11y } from '../shared/hooks/useModalA11y';
import { hasCapacitorBridge } from '../shared/platform-detect';
import type { ShellProps } from './shell-types';
import './styles/mobile-shell.css';

/** Título de la cabecera según la ruta: la misma clave que usa el menú. */
const SECTION_TITLES: Array<[prefix: string, key: string, fallback: string]> = [
  ['/quests', 'nav.questify', 'Questify'],
  ['/nutrition', 'nav.nutrify', 'Nutrify'],
  ['/finance', 'nav.coinify', 'Coinify'],
  ['/cauldron', 'nav.cauldron', 'Caldero'],
  ['/achievements', 'nav.achievements', 'Logros'],
  ['/rewards', 'nav.rewards', 'Recompensas'],
  ['/character', 'nav.character', 'Personaje'],
  ['/settings', 'nav.settings', 'Ajustes'],
];

export function sectionTitle(pathname: string): [key: string, fallback: string] {
  const hit = SECTION_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return hit ? [hit[1], hit[2]] : ['hub.dashboard', 'Tabla del Aventurero'];
}

/**
 * Shell de Android (spec §7): cabecera de 56 px con hamburguesa, título de la
 * sección y campana; el contenido en `.main-content` (mismo nombre que en
 * escritorio: AnimatedOutlet y el level-up lo buscan por clase); y el
 * <Sidebar> real, expandido, dentro de un drawer con scrim.
 *
 * El drawer es un modal como cualquier otro (useModalA11y): Escape lo cierra,
 * el foco entra y vuelve a la hamburguesa. Es lo que hace que el botón atrás
 * de Android (native-shell.ts manda un Escape) lo cierre sin cableado propio.
 */
export default function MobileShell({ stats, onBellClick, onToggleInn, children }: ShellProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const { dialogProps, containerRef } = useModalA11y<HTMLDivElement>({ onClose: closeDrawer, active: open });

  // --shell-top: 0 y las reglas [data-shell="mobile"] de layout.css.
  useEffect(() => {
    document.documentElement.dataset.shell = 'mobile';
    return () => { delete document.documentElement.dataset.shell; };
  }, []);

  // Navegar cierra el drawer: el destino ya se ve detrás.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  // Botón atrás: solo con el bridge nativo. El literal de `define` va primero
  // y a propósito (igual que src/main.tsx): esbuild pliega
  // `"desktop" === 'android'` a false y Rollup ELIMINA el import() del bundle
  // de Electron; con solo isNativeMobile() el chunk (y @capacitor/app) se
  // emitiría igual. En el arnés browser-mobile (define android, sin bridge)
  // no se importa nada.
  useEffect(() => {
    if (typeof __HUBTIFY_PLATFORM__ === 'undefined' || __HUBTIFY_PLATFORM__ !== 'android') return;
    if (!hasCapacitorBridge()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('../mobile/native-shell')
      .then(({ bindNativeShell }) => bindNativeShell())
      .then((off) => { if (cancelled) off(); else dispose = off; })
      .catch((err) => console.warn('[mobile] native shell:', err));
    return () => { cancelled = true; dispose?.(); };
  }, []);

  useGSAP(() => {
    const drawer = containerRef.current;
    const scrim = scrimRef.current;
    if (!drawer || !scrim) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const d = (s: number) => (reduced ? 0 : s);
    if (open) {
      gsap.set(scrim, { display: 'block' });
      gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: d(0.2) });
      gsap.fromTo(drawer, { x: '-100%' }, { x: '0%', duration: d(0.28), ease: 'power2.out' });
    } else {
      gsap.to(scrim, { opacity: 0, duration: d(0.2), onComplete: () => gsap.set(scrim, { display: 'none' }) });
      gsap.to(drawer, { x: '-100%', duration: d(0.22), ease: 'power2.in' });
    }
  }, [open]);

  const [titleKey, titleFallback] = sectionTitle(pathname);

  return (
    <>
      <header className="mobile-header">
        <button
          type="button"
          className="mobile-header__btn"
          onClick={() => setOpen(true)}
          aria-label={t('hub.openMenu', 'Abrir menú')}
          aria-expanded={open}
          aria-controls="mobile-drawer"
        >
          <MenuLines width={22} height={22} />
        </button>
        {/* La página conserva su propio h1; la cabecera es chrome. */}
        <div className="mobile-header__title" role="heading" aria-level={2}>{t(titleKey, titleFallback)}</div>
        <div className="mobile-header__actions">
          <NotificationBell onClick={onBellClick} />
        </div>
      </header>

      <div className="app-layout app-layout--mobile">
        <main className="main-content">{children}</main>
      </div>

      <div ref={scrimRef} className="mobile-scrim" data-testid="mobile-scrim" onClick={closeDrawer} aria-hidden="true" />
      <div
        {...dialogProps}
        id="mobile-drawer"
        className="mobile-drawer"
        aria-label={t('hub.mainNavigation', 'Navegación principal')}
        inert={!open}
      >
        <Sidebar stats={stats} collapsed={false} onBellClick={onBellClick} onToggleInn={onToggleInn} />
      </div>
    </>
  );
}
```

Notas para quien lo implementa:
- `inert` es prop booleana de React 19 (`@types/react` 19: `inert?: boolean`). Si tsc la marca, es que `@types/react` no es 19.
- `useGSAP(cb, [open])` es la misma firma que usa `NotificationCenter.tsx:57`.
- `containerRef` viene de `useModalA11y` (es el mismo `ref` que va en `dialogProps`): no crear un segundo ref para el drawer.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:visual:mobile 2>&1 | tail -8`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`, y en `tests/visual/__screenshots__/mobile/` aparecen `shell-00-cerrado-a.png` y `shell-01-drawer-abierto-a.png`. Abrir las dos: cabecera de cuero con hamburguesa dorada y título en Fraktur; el drawer muestra la ficha del jugador, las barras y los siete ítems, con la página oscurecida detrás.

Errores esperables:
- El test 4 no encuentra `heading Questify` → `NavBridge` del arnés no está envolviendo a `MobileShell` (revisar `mountInShell`).
- `--shell-top` da `32px` → la regla `:root[data-shell="mobile"]` de la Task 2 no está, o `dataset.shell` no se setea.
- El test 5 da 56 en vez de 80 → `.mobile-header` no usa `--safe-top` (theme.css Task 2 Step 1).

- [ ] **Step 6: Typecheck, lint y commit**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3`
Expected: sin errores.

```bash
git add src/hub/MobileShell.tsx src/hub/styles/mobile-shell.css tests/visual/mobile/mobile-shell.browser.test.tsx
git commit -m "feat(hub): MobileShell con cabecera y drawer que reusa el Sidebar"
```

### Task 8: `DesktopShell` + `Layout` elige el shell

**Files:**
- Create: `src/hub/DesktopShell.tsx`
- Modify: `src/hub/Layout.tsx` (imports, `AUTO_COLLAPSE_WIDTH`, estado de colapso líneas ~367–391, JSX líneas ~603–636)

- [ ] **Step 1: Crear `src/hub/DesktopShell.tsx`** (el JSX de `Layout.tsx:604-635` y el estado de colapso, movidos 1:1)

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
import type { ShellProps } from './shell-types';

/** Below this window width the sidebar collapses on its own. */
const AUTO_COLLAPSE_WIDTH = 820;

/**
 * El shell de escritorio, tal como vivía en Layout.tsx: barra de título de
 * Electron, riel fijo de 260/56 px con su botón de colapso y el <main>.
 * Layout lo elige (o a MobileShell) con useShellKind().
 */
export default function DesktopShell({ stats, onBellClick, onToggleInn, children }: ShellProps) {
  const { t } = useTranslation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (localStorage.getItem('hubtify_sidebar_collapsed') === 'true') return true;
    // Below ~820px the expanded rail leaves the content unusable and the 20px
    // toggle is basically undiscoverable, so start compact.
    return window.innerWidth < AUTO_COLLAPSE_WIDTH;
  });

  // Collapse automatically when the window shrinks past the threshold; leave the
  // user's own choice alone once they are back above it.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < AUTO_COLLAPSE_WIDTH) {
        setSidebarCollapsed(prev => (prev ? prev : true));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('hubtify_sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  return (
    <>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
          <Sidebar stats={stats} collapsed={sidebarCollapsed} onBellClick={onBellClick} onToggleInn={onToggleInn} />
          <button onClick={toggleSidebar} className={`sidebar-toggle tap-target ${sidebarCollapsed ? 'sidebar-toggle--collapsed' : ''}`}
            title={sidebarCollapsed ? t('hub.expand', 'Expandir') : t('hub.collapse', 'Colapsar')}
            aria-expanded={!sidebarCollapsed}
            aria-controls="main-sidebar"
            aria-label={t('hub.toggleSidebar', 'Alternar barra lateral')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ transition: 'transform 0.25s ease', transform: sidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <path d="M9 2L4 7l5 5"/>
            </svg>
          </button>
        </div>
        <main className="main-content">{children}</main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Imports de `Layout.tsx`**

Reemplazar las líneas 3–4:

```tsx
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
```

por:

```tsx
import DesktopShell from './DesktopShell';
import MobileShell from './MobileShell';
import { useShellKind } from './useShellKind';
```

- [ ] **Step 3: Borrar `AUTO_COLLAPSE_WIDTH` y el estado de colapso de `Layout.tsx`**

Borrar las dos líneas:

```tsx
/** Below this window width the sidebar collapses on its own. */
const AUTO_COLLAPSE_WIDTH = 820;
```

Borrar el bloque completo que va desde `  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {` hasta el cierre de `toggleSidebar` (`  }, []);` justo antes de `  const handleToggleInn = useCallback(async () => {`). Son ~25 líneas; ubicarlas por texto, no por número.

- [ ] **Step 4: Elegir el shell**

Justo después de `  const { shortcutModalOpen, setShortcutModalOpen } = useKeyboardShortcuts();` agregar:

```tsx
  const shellKind = useShellKind();
  const Shell = shellKind === 'mobile' ? MobileShell : DesktopShell;
```

- [ ] **Step 5: JSX**

Reemplazar desde `    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>` hasta el `</div>` que cierra `.app-layout` (el que está justo antes del comentario `{/* Level-up epic overlay`), es decir el bloque `TitleBar` + `app-layout` + `sidebar-wrapper` + `main`, por:

```tsx
    <div className="shell-frame">
      <Shell stats={stats} onBellClick={() => setShowNotifications(true)} onToggleInn={handleToggleInn}>
        {syncError && (
          <div role="alert" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '10px 16px', background: 'rgba(248, 113, 113, 0.15)',
            border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: '6px',
            margin: '8px 16px 0', color: '#f87171', fontSize: 'var(--fs-label)',
          }}>
            <span>{t('auth.syncPullFailed')}</span>
            <button className="rpg-button" onClick={retrySyncPull}
              style={{ padding: '4px 12px', fontSize: 'var(--fs-label)', flexShrink: 0 }}>
              {t('auth.syncRetry')}
            </button>
          </div>
        )}
        <AnimatedOutlet ref={outletHandleRef} />
      </Shell>
```

El resto del árbol (level-up, QuickAdd, ShortcutModal, CodexSealModal, CauldronFloatingTimer, NotificationCenter, ChangelogModal, UpdateBanner, UpdateNotification) queda igual, dentro del `<div className="shell-frame">`.

- [ ] **Step 6: Verificar que nada se rompió en escritorio ni en mobile**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3`
Expected: sin errores. `t` se sigue usando en Layout (toasts y modales); si lint marca un import sin uso en la línea 1, quitar solo ese.

Run: `rg -n "sidebarCollapsed|AUTO_COLLAPSE_WIDTH|TitleBar|<Sidebar" src/hub/Layout.tsx; echo "(vacío = ok)"`
Expected: vacío.

Run: `npm run test:visual 2>&1 | tail -4 && npm run test:visual:mobile 2>&1 | tail -4`
Expected: `30 passed` y `1 passed` (5 tests).

Run: `npm start`
Expected (manual, 1 minuto): la app de escritorio abre igual que antes: barra de título, riel de 260 px, el botón de colapso funciona y recuerda el estado, la campana abre el centro de notificaciones, «Posada» sigue en la racha. Cerrar.

- [ ] **Step 7: Commit**

```bash
git add src/hub/DesktopShell.tsx src/hub/Layout.tsx
git commit -m "refactor(hub): Layout elige DesktopShell o MobileShell con useShellKind"
```

### Task 9: `native-shell.ts` — botón atrás y barras del sistema

**Files:**
- Create: `src/mobile/native-shell.ts`
- Modify: `capacitor.config.ts`

- [ ] **Step 1: Crear `src/mobile/native-shell.ts`**

```ts
/**
 * Cableado nativo del shell Android (spec §7). Lo importa MobileShell de
 * forma dinámica y SOLO con el bridge de Capacitor presente: ni el bundle
 * desktop ni el arnés browser-mobile cargan @capacitor/app.
 *
 * Barra de estado: no hay llamadas en runtime. Con targetSdk 36 (template de
 * Capacitor 8) `StatusBar.setBackgroundColor` / `setOverlaysWebView` no
 * hacen nada (README de @capacitor/status-bar, «Android 16+ behavior
 * change»). El plugin core SystemBars decide: con WebView >= 140 la barra
 * superpone al WebView e inyecta --safe-area-inset-top (la cabecera pinta
 * cuero debajo con --safe-top); con WebView < 140 el contenido arranca bajo
 * la barra y la franja muestra windowBackground (styles.xml, cuero). El
 * estilo de los iconos (claros) va en capacitor.config.ts.
 */
import { App } from '@capacitor/app';
import { handleBackButton } from './back-button';

/** Un modal abierto: todos pasan por useModalA11y (role + aria-modal); el drawer cerrado lleva `inert`. */
const OPEN_DIALOG =
  '[role="dialog"][aria-modal="true"]:not([inert]), [role="alertdialog"][aria-modal="true"]:not([inert])';

export function hasOpenDialog(root: ParentNode = document): boolean {
  return root.querySelector(OPEN_DIALOG) !== null;
}

/** useModalA11y escucha keydown en window y solo reacciona el diálogo de más arriba. */
export function closeTopDialog(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** Devuelve la función que suelta el listener (MobileShell la llama al desmontar). */
export async function bindNativeShell(): Promise<() => void> {
  const handle = await App.addListener('backButton', ({ canGoBack }) => {
    handleBackButton({
      openDialog: hasOpenDialog(),
      closeDialog: closeTopDialog,
      canGoBack,
      goBack: () => window.history.back(),
      minimize: () => { void App.minimizeApp(); },
    });
  });
  return () => { void handle.remove(); };
}
```

- [ ] **Step 2: Estilo de las barras en `capacitor.config.ts`**

Reemplazar el objeto `config` completo por:

```ts
const config: CapacitorConfig = {
  appId: 'com.hubtify.app',
  appName: 'Hubtify',
  webDir: 'dist/mobile',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    // Iconos claros en la barra de estado y en la de gestos, sobre el cuero de
    // la cabecera (spec §7). SystemBars es el plugin core de Capacitor 8 y es
    // el que inyecta --safe-area-inset-* (insetsHandling 'css'). StatusBar
    // (instalado en la Fase 2) se configura igual para que al cargar no pise
    // el estilo con su default; setBackgroundColor/overlaysWebView no
    // funcionan con targetSdk 36 (README del plugin), por eso no se llaman.
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
    StatusBar: { style: 'DARK', overlaysWebView: true },
  },
};
```

- [ ] **Step 3: `styles.xml` — la franja de la barra en el camino (b)**

En `android/app/src/main/res/values/styles.xml`, dentro de `<style name="AppTheme.NoActionBar" …>`, después de `<item name="android:background">@null</item>` agregar:

```xml
        <!-- Con WebView < 140 el contenido web arranca debajo de la barra de
             estado y esta franja muestra el fondo de la ventana: cuero
             (theme.css --leather-dark), no el blanco/negro del tema. -->
        <item name="android:windowBackground">#2a1d0e</item>
```

- [ ] **Step 4: Verificar tipos, suite y que el bundle desktop no arrastra Capacitor**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: tsc sin salida; `Test Files  N+2 passed`, `Tests  M+6 passed` (shell-kind 3 + back-button 3).

Run: `npx vite build -c vite.renderer.config.ts --outDir dist/renderer-check 2>&1 | tail -2 && rg --files --no-ignore dist/renderer-check | rg -i "capacitor|native-shell"; echo "(sin líneas arriba = ok)"; node -e "require('fs').rmSync('dist/renderer-check', { recursive: true, force: true })"`
Expected: `✓ built in Xs` y el `rg` no imprime nada: es el mismo check de la Fase 2 (Task 9 Step 8). El guard de `MobileShell` compara el literal de `define` ANTES de la llamada en runtime, así que esbuild lo pliega a `false` y Rollup no emite ni `native-shell` ni `@capacitor/app` en el bundle de Electron. Si aparece `native-shell-*.js`, el guard quedó como `isNativeMobile() && …` (no plegable) — corregir el orden.

Run: `npm run mobile:build 2>&1 | tail -3 && rg --files --no-ignore dist/mobile/assets | rg "native-shell"`
Expected: `✓ built` y un `dist/mobile/assets/native-shell-<hash>.js` — el chunk existe SOLO en el build mobile.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/native-shell.ts capacitor.config.ts android/app/src/main/res/values/styles.xml
git commit -m "feat(mobile): botón atrás de Android y estilo de las barras del sistema"
```


## Chunk 3: Transversal — hub, safe areas en capas fijas, fixtures

### Task 10: Fixtures compactas por módulo

**Files:**
- Create: `tests/visual/mobile/fixtures.ts`

Versiones reducidas de los stubs de `tests/visual/audit-*.browser.test.tsx` (mismas formas, menos filas, con textos largos a propósito: los desbordes salen con texto real). No se exportan desde los tests de escritorio porque importar un archivo de test ejecuta sus `describe`.

- [ ] **Step 1: Crear `tests/visual/mobile/fixtures.ts`**

```ts
/**
 * Stubs de window.api para las páginas de módulo en el arnés browser-mobile.
 * Formas copiadas de tests/visual/audit-*.browser.test.tsx (validadas ahí);
 * menos filas, textos largos a propósito.
 */
type Row = Record<string, unknown>;

export function isoDay(offsetDays: number, time?: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${day}T${time}` : day;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const DAY = 24 * 60 * 60 * 1000;

export const LONG_TITLE =
  'Reorganizar el archivo completo de facturas del estudio, ordenarlas por proveedor y por mes, ' +
  'y después escanear las que faltan del ejercicio anterior antes de que cierre el balance';

// ── Questify ─────────────────────────────────────────────────────────────────

const baseTask = (over: Row): Row => ({
  description: '', status: false, category: '', projectId: null, dueDate: null,
  order: 0, completedAt: null, repeatRule: null, repeatOf: null,
  createdAt: '2026-08-01', updatedAt: '2026-08-01', tier: 2, ...over,
});

export const QUEST_PROJECTS: Row[] = [
  { id: 'p1', name: 'Hubtify', color: '#8b7355', order: 0, createdAt: '2026-01-01' },
  { id: 'p2', name: 'Reforma integral de la cocina y el lavadero del departamento', color: '#6b7c5e', order: 1, createdAt: '2026-01-01' },
];

export const QUEST_TASKS: Row[] = [
  baseTask({ id: 't1', name: 'Pagar el alquiler', tier: 3, dueDate: isoDay(-3), category: 'Hogar', order: 0 }),
  baseTask({ id: 't2', name: LONG_TITLE, tier: 2, dueDate: isoDay(-1), category: 'Trabajo', projectId: 'p2', order: 1 }),
  baseTask({
    id: 't3', name: 'Entrenar', tier: 1, dueDate: isoDay(0, '07:30'), category: 'Salud',
    repeatRule: '{"freq":"days","days":[1,3,5]}', order: 2,
  }),
  baseTask({ id: 't4', name: 'Llamar al contador', tier: 2, dueDate: isoDay(0, '16:00'), projectId: 'p1', order: 3 }),
  baseTask({ id: 't5', name: 'Backup mensual del servidor', tier: 3, repeatRule: '{"freq":"monthly"}', dueDate: isoDay(9), order: 4, category: 'Trabajo' }),
  baseTask({ id: 't6', name: 'Idea suelta sin fecha', tier: 2, order: 5 }),
  baseTask({ id: 'tc1', name: 'Mandar el presupuesto', tier: 3, status: true, completedAt: isoDay(0, '11:00'), projectId: 'p1', order: 6 }),
];

const habit = (over: Row): Row => ({
  frequency: 'daily', timesPerWeek: 1, createdAt: '2026-01-01', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: true, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true, shieldCount: 0, shieldUsed: false,
  ...over,
});

export const QUEST_HABITS: Row[] = [
  habit({ id: 'h1', name: 'Meditar', streak: 128, checkedToday: true, checksThisPeriod: 1, pendingToday: false, shieldCount: 3 }),
  habit({ id: 'h2', name: 'Gimnasio', frequency: 'weekly', timesPerWeek: 3, specificDays: [1, 3, 5], streak: 12, checksThisPeriod: 2, targetThisPeriod: 3, shieldUsed: true }),
  habit({ id: 'h3', name: 'Leer veinte páginas antes de dormir aunque sea de un libro que ya leí', streak: 4, shieldCount: 1 }),
];

const HEATMAP_DAYS = Array.from({ length: 30 }, (_, i) => ({ date: isoDay(i - 29), count: i % 4, skipCount: i % 7 === 0 ? 1 : 0 }));

export const QUESTS_API: Record<string, unknown> = {
  questsGetTasks: () => Promise.resolve(QUEST_TASKS),
  questsGetProjects: () => Promise.resolve(QUEST_PROJECTS),
  questsGetAllDrawingCounts: () => Promise.resolve([]),
  questsGetDrawings: () => Promise.resolve([]),
  questsGetSubtasks: () => Promise.resolve([]),
  questsGetHabits: () => Promise.resolve(QUEST_HABITS),
  questsGetCategories: () => Promise.resolve(['Hogar', 'Trabajo', 'Salud']),
  questsGetHabitHeatmap: () => Promise.resolve({ days: HEATMAP_DAYS, totalHabits: 3 }),
  questsGetHabitHistory: (_id: string, days = 91) => Promise.resolve({
    days: Array.from({ length: days }, (_, i) => ({ date: isoDay(i - (days - 1)), checked: i % 3 !== 0 })),
    bestStreak: 41,
  }),
  questsGetPendingCount: () => Promise.resolve(6),
  questsGetCompletedTodayCount: () => Promise.resolve(1),
  cauldronGetPresets: () => Promise.resolve([{ id: 'cp1', name: 'Clásico', focusMin: 25, quickStart: 1 }]),
  cauldronSetSessionTask: () => Promise.resolve(true),
  processRpgEvent: () => Promise.resolve({ xpGained: 15, bonusMultiplier: 1, comboMultiplier: 1, milestoneXp: 0 }),
};

// ── Coinify ──────────────────────────────────────────────────────────────────

export const COIN_ACCOUNTS: Row[] = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 },
  { id: 'a2', name: 'Banco Galicia — Caja de ahorro en pesos', kind: 'bank', currency: 'ARS', initialBalance: 0, accountOrder: 1, balance: 214_780_310, movements: 312 },
  { id: 'a3', name: 'Cuenta en dólares', kind: 'bank', currency: 'USD', initialBalance: 0, accountOrder: 2, balance: 12_450.75, movements: 9 },
];

const COIN_CATS = ['Comida', 'Hogar', 'Transporte', 'Salud', 'Suscripciones y servicios digitales del estudio'];

export const COIN_CATEGORIES: Row[] = [
  { category: 'Comida', ARS: 184_300_000, USD: 0 },
  { category: 'Hogar', ARS: 92_150_000, USD: 0 },
  { category: 'Transporte', ARS: 41_000_000, USD: 0 },
  { category: 'Suscripciones y servicios digitales del estudio', ARS: 8_400_000, USD: 0 },
  { category: 'Software', ARS: 0, USD: 240 },
];

export const COIN_BUDGETS = {
  month: '2026-09', totalLimit: 300_000_000, totalSpent: 365_150_000,
  categories: [
    { category: 'Comida', limit: 150_000_000, spent: 184_300_000, pct: 122.9 },
    { category: 'Hogar', limit: 100_000_000, spent: 92_150_000, pct: 92.2 },
    { category: 'Viajes', limit: 30_000_000, spent: 0, pct: 0 },
  ],
};

export const COIN_UPCOMING = {
  from: '2026-09-01', to: '2026-10-01', totals: { ARS: 987_654_321, USD: 240 },
  items: [
    { kind: 'recurring', date: '2026-09-02', label: 'Alquiler del departamento de Palermo', amount: 480_000_000, currency: 'ARS', refId: 'r1' },
    { kind: 'installment', date: '2026-09-05', label: LONG_TITLE, amount: 128_400_000, currency: 'ARS', refId: 'i1', detail: '(3/6)' },
    { kind: 'card_due', date: '2026-09-12', label: 'Visa Galicia', amount: 214_780_310, currency: 'ARS', refId: 'c1' },
    { kind: 'recurring', date: '2026-09-20', label: 'Software', amount: 240, currency: 'USD', refId: 'r3' },
  ],
};

const PMS = ['cash', 'debit', 'credit', 'transfer'];

export const COIN_TX: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`,
  type: i % 7 === 0 ? 'income' : 'expense',
  amount: i === 3 ? 214_780_310 : 1_000 * (i + 1) * (i % 5 + 1),
  currency: 'ARS',
  category: COIN_CATS[i % COIN_CATS.length],
  description: i === 1 ? LONG_TITLE : `Movimiento ${i + 1}`,
  date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  paymentMethod: PMS[i % PMS.length],
  source: i % 5 === 0 ? 'import' : 'manual',
  impactsBalance: i % 4 === 3 ? 0 : 1,
  accountId: 'a1',
}));

const bal = {
  ARS: { income: 987_654_321, expenses: 365_150_000, balance: 622_504_321 },
  USD: { income: 3_200, expenses: 240, balance: 2_960 },
};

export const FINANCE_API: Record<string, unknown> = {
  financeGetMonthlyBalance: () => Promise.resolve(bal),
  financeGetBalanceForRange: () => Promise.resolve(bal),
  financeGetCategoryBreakdown: () => Promise.resolve(COIN_CATEGORIES),
  financeGetCategoryBreakdownForRange: () => Promise.resolve(COIN_CATEGORIES),
  financeGetExpenseBreakdown: () => Promise.resolve({
    ARS: { total: 365_150_000, direct: 180_000_000, installments: 125_150_000, pendingCard: 60_000_000, cardPayments: 0 },
    USD: { total: 240, direct: 240, installments: 0, pendingCard: 0, cardPayments: 0 },
  }),
  financeGetMonthlyExpenses: () => Promise.resolve([280_000_000, 310_000_000, 295_000_000, 340_000_000, 352_000_000, 365_150_000]),
  financeGetProjection: () => Promise.resolve([]),
  financeGetInstallmentGroups: () => Promise.resolve([{}, {}, {}]),
  financeGetCreditCardStatements: () => Promise.resolve([]),
  financeGetActiveLoanSummary: () => Promise.resolve({
    ARS: { lent: 90_000_000, borrowed: 500_000_000, lentPending: 45_120_000, borrowedPending: 312_900_000 },
    USD: { lent: 0, borrowed: 0, lentPending: 1_250, borrowedPending: 0 },
    lent: 90_000_000, borrowed: 500_000_000,
  }),
  financeGetBudgetStatus: () => Promise.resolve(COIN_BUDGETS),
  financeSetBudget: () => Promise.resolve({ ok: true }),
  financeGetAccounts: () => Promise.resolve(COIN_ACCOUNTS),
  financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
  financeDeleteAccount: () => Promise.resolve({ ok: true }),
  financeGetAccountsOverview: () => Promise.resolve({ accounts: COIN_ACCOUNTS, totalArs: 0, totalUsd: 0 }),
  financeGetUpcoming: () => Promise.resolve(COIN_UPCOMING),
  financeGetValuedView: () => Promise.resolve(null),
  financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
  financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
  financeGetRecurring: () => Promise.resolve([]),
  financeGetTransactions: () => Promise.resolve(COIN_TX),
  financeGetCategories: () => Promise.resolve(COIN_CATS),
  financeGetCreditCards: () => Promise.resolve([]),
  financeGetCategoryAverages: () => Promise.resolve([]),
  financeGetImportBatches: () => Promise.resolve([]),
  financeUndoImportBatch: () => Promise.resolve({ ok: true, deleted: 0 }),
  financeExportCsv: () => Promise.resolve({ canceled: true }),
  dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
};

// ── Nutrify ──────────────────────────────────────────────────────────────────

export const NUTRI_LONG_DESC =
  'Milanesa napolitana de ternera con jamón crudo, muzzarella, salsa de tomate casera, ' +
  'papas fritas a la provenzal y ensalada mixta de lechuga, tomate, cebolla y zanahoria rallada';

const MEALS = ['breakfast', 'lunch', 'lunch', 'merienda', 'dinner', 'snack'];

export const NUTRI_FOODS: Row[] = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  date: '2026-06-26',
  time: `${String(7 + i * 2).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
  description: i === 3 ? NUTRI_LONG_DESC : `Comida número ${i + 1} del día`,
  calories: 120 + i * 137,
  source: i % 3 === 0 ? 'ai_estimate' : i % 3 === 1 ? 'manual' : 'favorite',
  frequentFoodId: null,
  aiBreakdown: i === 0 ? JSON.stringify([{ name: 'Avena', calories: 180 }, { name: 'Frutas', calories: 90 }]) : null,
  meal: MEALS[i % MEALS.length],
  proteinG: i % 2 === 0 ? 12 + i : null,
  ...(i === 5 ? { isEvent: 1, eventKcalMin: 1200, eventKcalMax: 1600, calories: 1400 } : {}),
}));

const daysAgo = (n: number) => isoDay(-n);

export const NUTRITION_API: Record<string, unknown> = {
  nutritionGetFoodByDate: async () => NUTRI_FOODS,
  nutritionGetSummary: async () => ({
    date: '2026-06-26', totalCaloriesIn: 3740, bmr: 1760, tdee: 2400, balance: -1740,
    activityLevel: 'moderate', proteinG: 232, carbsG: 431, fatG: 158,
  }),
  nutritionGetDailyMetrics: async () => ({ date: '2026-06-26', steps: 6200, gym: true }),
  nutritionGetFrequentFoods: async () => [
    { id: 1, name: 'Café con leche', calories: 120, timesUsed: 22, proteinG: 6, carbsG: 12, fatG: 5 },
    { id: 2, name: 'Yogur con granola y frutos rojos del bosque', calories: 260, timesUsed: 14, proteinG: 12, carbsG: 34, fatG: 8 },
    { id: 3, name: 'Sandwich de milanesa completo', calories: 720, timesUsed: 7, proteinG: 38, carbsG: 62, fatG: 28 },
  ],
  nutritionGetProfile: async () => ({
    age: 31, sex: 'M', heightCm: 178, initialWeightKg: 80, activityLevel: 'moderate', deficitTargetKcal: 400,
    dateOfBirth: '1995-03-12', weightCheckDay: 1, weightPopupEnabled: 1, mealSchedule: null, dayCutoffHour: 4,
    proteinTargetG: null, carbsTargetG: null, fatTargetG: null,
  }),
  nutritionGetTodayTarget: async () => 2000,
  nutritionIsDayClosed: async () => null,
  nutritionGetFavoriteFoods: async () => [
    { id: 'fav1', description: 'Milanesa napolitana con papas fritas y ensalada', calories: 980, source: 'ai_estimate', proteinG: 48, carbsG: 40, fatG: 32, createdAt: '2026-06-01' },
    { id: 'fav2', description: 'Tostadas con palta', calories: 310, source: 'manual', proteinG: 8, carbsG: 30, fatG: 18, createdAt: '2026-06-07' },
  ],
  nutritionGetMealSchedule: async () => null,
  nutritionGetMacroTargets: async () => ({ proteinG: 150, carbsG: 220, fatG: 60, auto: true }),
  nutritionGetPendingDays: async () => [],
  nutritionShouldAskWeight: async () => ({ shouldAsk: false }),
  nutritionGetRecentLoggedDays: async () => [
    { date: daysAgo(1), meals: 4, calories: 1980 },
    { date: daysAgo(2), meals: 3, calories: 1740 },
  ],
  nutritionGetWeights: async () => [
    { date: daysAgo(18), weightKg: 81.6 }, { date: daysAgo(11), weightKg: 82.1 }, { date: daysAgo(4), weightKg: 80.9 },
  ],
  nutritionGetSummaryRange: async () => Array.from({ length: 14 }, (_, i) => ({
    date: daysAgo(13 - i), totalCaloriesIn: 1700 + (i % 5) * 260, bmr: 1760, tdee: 2400, balance: 0,
    proteinG: 110 + (i % 3) * 18, carbsG: 210 + (i % 4) * 25, fatG: 55 + (i % 3) * 9,
  })),
  nutritionGetStreak: async () => ({ streak: 9, todayPending: true }),
  nutritionGetEventDays: async () => [],
  nutritionSearchHistory: async () => [],
  nutritionGetCachedEstimate: async () => null,
  nutritionCacheEstimate: async () => ({ cached: true }),
  nutritionGetAdaptiveTdee: async () => ({
    tdee: 2280, confidence: 'high', windowDays: 28, sampleDays: 25, weightSamples: 4, intakeAvg: 2000, deltaKg: -1,
  }),
  nutritionRepeatDay: async () => ({ copied: 3 }),
  nutritionCloseDay: async () => ({ success: false, alreadyClosed: false }),
  nutritionGetTodayCalories: async () => 1650,
  nutritionGetWeekCalories: async () => [1800, 2100, 1600, 2400, 1900, 2000, 1650],
};

// ── Cauldron ─────────────────────────────────────────────────────────────────

export const CAULDRON_PRESETS: Row[] = [
  { id: 'p1', name: 'Clásico', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLong: 4, autoStartBreak: 1, autoStartWork: 0, isDefault: 1 },
  { id: 'p2', name: 'Maratón de cierre contable de fin de trimestre', workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, cyclesBeforeLong: 3, autoStartBreak: 0, autoStartWork: 0, isDefault: 0 },
  { id: 'p3', name: 'Corto', workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, cyclesBeforeLong: 5, autoStartBreak: 1, autoStartWork: 1, isDefault: 0 },
];

export const CAULDRON_SESSIONS: Row[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`, presetId: 'p1', presetName: 'Clásico', sessionType: 'work',
  startedAt: new Date(Date.now() - Math.floor(i / 3) * DAY - i * 3600_000).toISOString(),
  completedAt: new Date(Date.now() - Math.floor(i / 3) * DAY - i * 3600_000 + 25 * 60_000).toISOString(),
  durationMinutes: 25, completed: 1, abandoned: i === 3, retroactive: i === 5, elapsedMinutes: i === 3 ? 9 : null,
  taskId: i % 2 === 0 ? 't1' : null,
  taskName: i % 2 === 0 ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio' : null,
  projectId: i % 2 === 0 ? 'pr1' : null, projectName: i % 2 === 0 ? 'Estudio contable' : null, projectColor: i % 2 === 0 ? '#7a1e1e' : null,
}));

export const CAULDRON_IDLE = { status: 'idle', remainingMs: 0, totalMs: 0, sessionType: 'work', presetId: 'p1', round: 1, currentCycle: 1, totalCycles: 4 };

export const CAULDRON_RUNNING = {
  status: 'work', remainingMs: 14 * 60_000 + 37_000, totalMs: 25 * 60_000, sessionType: 'work', presetId: 'p1',
  round: 2, currentCycle: 2, totalCycles: 4, taskId: 't1',
  taskName: 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky',
  taskProjectId: 'pr1', taskProjectColor: '#7a1e1e',
};

export function cauldronApi(state: unknown = CAULDRON_IDLE): Record<string, unknown> {
  return {
    cauldronGetPresets: () => Promise.resolve(CAULDRON_PRESETS),
    cauldronGetStats: () => Promise.resolve({ today: 6, week: 23, total: 481, streak: 12, longestStreak: 31, totalMinutes: 12_025 }),
    cauldronGetState: () => Promise.resolve(state),
    cauldronGetSessions: () => Promise.resolve({ sessions: CAULDRON_SESSIONS, hasMore: false }),
    cauldronGetWeeklyFocusTime: () => Promise.resolve([
      { label: 'Lun', value: 125 }, { label: 'Mar', value: 75 }, { label: 'Mié', value: 200 },
      { label: 'Jue', value: 50 }, { label: 'Vie', value: 175 }, { label: 'Sáb', value: 0 }, { label: 'Dom', value: 25 },
    ]),
    cauldronGetInterruptedSession: () => Promise.resolve(null),
    cauldronPause: () => Promise.resolve(CAULDRON_IDLE),
    cauldronStop: () => Promise.resolve(CAULDRON_IDLE),
    cauldronStart: () => Promise.resolve(state),
    cauldronSetSessionTask: () => Promise.resolve(state),
    cauldronGetWeekByProject: () => Promise.resolve([
      { taskId: 't1', taskName: 'Cerrar el balance', projectId: 'pr1', projectName: 'Estudio contable', projectColor: '#7a1e1e', sessions: 9, minutes: 225 },
      { taskId: null, taskName: null, projectId: null, projectName: null, projectColor: null, sessions: 1, minutes: 25 },
    ]),
    cauldronLogPastSession: () => Promise.resolve({ id: 'x', minutes: 30, startedAt: '', completedAt: '' }),
    questsGetTasks: () => Promise.resolve(Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, name: i === 0 ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky' : `Misión ${i}`,
      status: 0, projectId: i % 2 === 0 ? 'pr1' : 'pr2',
    }))),
    questsGetProjects: () => Promise.resolve([
      { id: 'pr1', name: 'Estudio contable', color: '#7a1e1e' },
      { id: 'pr2', name: 'Facultad', color: '#556b3c' },
    ]),
    onCauldronTick: () => () => undefined,
    onCauldronSessionEnd: () => () => undefined,
  };
}

export { minutesAgo };
```

- [ ] **Step 2: Typecheck y commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3`
Expected: sin salida (los tests no están en el `include` del tsconfig raíz, pero vitest los transpila; este paso solo confirma que no se rompió nada del árbol `src/`). Lint sí los ve: `npm run lint 2>&1 | tail -3` sin errores.

```bash
git add tests/visual/mobile/fixtures.ts
git commit -m "test(mobile): fixtures compactas de window.api para el arnés mobile"
```

### Task 11: Hub a 390 px — Dashboard, Ficha del Héroe, Logros, Recompensas + reglas transversales

**Files:**
- Test: `tests/visual/mobile/mobile-hub.browser.test.tsx`
- Modify: `src/hub/styles/layout.css` (al final)
- Modify: `src/hub/styles/dashboard-layouts.css`, `src/hub/styles/character.css`, `src/hub/styles/codex-seal.css`, `src/hub/rewards/rewards.css` (todos al final)

Problemas concretos a 390 px (366 px de columna con el padding de 12 px), verificados en el CSS:

| # | Selector | Archivo:línea | Problema | Arreglo |
|---|---|---|---|---|
| H1 | `.page-header__actions` | `components.css:445-452` | `position: absolute; right: 0; bottom: 0` — se pinta ENCIMA del título a 366 px; el `@media (max-width: 880px)` de la línea 462 repite `right: 0` (no-op) | `position: static; margin-top: 8px; flex-wrap: wrap` |
| H2 | `.qb-header` / `.qb-header-extra` | `codex.css:45-52, 59-70` | sin `flex-wrap`, `.qb-header-extra { flex-shrink: 0 }`: los chips de Coinify (~240 px) y el contador de Logros (~120 px) dejan 60–230 px al título | `flex-wrap: wrap`; extra a `flex: 1 1 100%` |
| H3 | `.qb-corner` | `codex.css:13-30` | ornamentos de 44 px a 4 px del borde, con la página a 12 px de padding quedan sobre el texto | `display: none` |
| H4 | `.settings-row`, `.settings-row__buttons` | `components.css:1096-1103, 1123-1126` | sin `flex-wrap`; dos `.rpg-btn-sm` + label + desc → ~150 px de texto | `flex-wrap: wrap`; botones a `width: 100%` |
| H5 | `.codex-cartouches` | `codex-seal.css:98-107` | 4 → 2 columnas a 720 px; a 366 px cada cartucho tiene 153 px y `COMPLETADAS HOY` no entra | `grid-template-columns: 1fr` en `codex-seal.css` (su `@media` de 720 px tiene la misma especificidad y se carga después) |
| H6 | `.widget-controls` | `dashboard-layouts.css:140-155` | `opacity: 0` hasta `:hover`/`:focus-within`: en touch los botones de mover/redimensionar widgets no existen | `@media (hover: none) { opacity: 1 }` en la misma hoja (se importa después de `layout.css`) |
| H7 | `.hero-stats-grid` | `character.css:220-224` | `repeat(4, 1fr)` sin breakpoint → 65 px de contenido por celda; `MISIONES` mide ~95 px | `repeat(2, 1fr)` |
| H8 | `.hero-virtues-grid` | `character.css:176-180` | `1fr 1fr` sin breakpoint → 153 px para nombre + numeral + gauge | `1fr` |
| H9 | `.hero-chronicle-grid` | `character.css:237-244` | `1fr 1fr` con `column-gap: 24px` → ~110 px por evento, todo ellipsis | `1fr; column-gap: 0` |
| H10 | `.hero-title-trail-grid` | `character.css:290-294` | `repeat(7, 1fr)` → 52 px por nodo; «Campesino» mide ~62 px | contenedor con `overflow-x: auto`, grilla `repeat(7, 64px)` |
| H11 | `.ach-filter` | `codex-seal.css:614-636` | control segmentado rígido de ~285 px; con `--font-scale 1.15` no entra | `width: 100%`; botones `flex: 1` |
| H12 | `.rwd-item__tool` | `rewards.css:168-190` | 24 px y borde solo en `:hover`: en touch los iconos de editar/borrar parecen decoración | `@media (hover: none)`: borde visible, 40 px |
| H13 | `.notif-drawer` | `notifications.css:64-78` | `width: 360px; max-width: 90vw` → 351 px; ok, pero sin safe areas | `padding-top/bottom: var(--safe-*)` (Task 12) |

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-hub.browser.test.tsx
import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Dashboard from '@hub/Dashboard';
import CharacterPage from '@hub/CharacterPage';
import AchievementsPage from '@hub/AchievementsPage';
import RewardsPage from '@hub/rewards/RewardsPage';
import { ACHIEVEMENTS } from '../../../shared/achievements';
import {
  installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes,
} from './mobile-harness';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/hub/styles/dashboard-layouts.css';
import '../../../src/hub/styles/character.css';
import '../../../src/hub/styles/codex-seal.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';

beforeAll(() => {
  installApi({
    rpgGetAchievements: () => Promise.resolve(ACHIEVEMENTS.map((a, i) => ({
      id: a.id,
      hidden: Boolean((a as { hidden?: boolean }).hidden),
      unlocked: i % 3 === 0,
      unlockedAt: i % 3 === 0 ? new Date(Date.now() - i * 86_400_000).toISOString() : undefined,
    }))),
  });
});

/** Lo que se le pide a CADA página de esta fase (spec §11): nada desborda a lo ancho. */
function expectNoHorizontalOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 10) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Hub a 390×844', () => {
  test('Tabla del Aventurero', async () => {
    await setMobileViewport();
    mountInShell(<Dashboard />, '/');
    await expect.element(page.getByText(/Tabla del Aventurero/i).first()).toBeVisible();
    await settle();
    await shoot('hub-01-dashboard');
    expectNoHorizontalOverflow('DASH MOBILE');
    // Los controles de los widgets no pueden depender del hover en touch (H6);
    // el project emula touch, así que (hover: none) aplica.
    const controls = document.querySelector('.widget-controls');
    expect(controls).not.toBeNull();
    expect(getComputedStyle(controls!).opacity).toBe('1');
  });

  test('Ficha del Héroe', async () => {
    await setMobileViewport();
    mountInShell(<CharacterPage />, '/character');
    await settle(700);
    await shoot('hub-02-personaje');
    expectNoHorizontalOverflow('PERSONAJE MOBILE');
    // Las cuatro stats y las virtudes ya no van en 4/2 columnas de 65 px (H7, H8).
    const stats = document.querySelector('.hero-stats-grid') as HTMLElement;
    expect(getComputedStyle(stats).gridTemplateColumns.split(' ').length).toBe(2);
    const virtues = document.querySelector('.hero-virtues-grid') as HTMLElement;
    expect(getComputedStyle(virtues).gridTemplateColumns.split(' ').length).toBe(1);
  });

  test('Estante de logros', async () => {
    await setMobileViewport();
    mountInShell(<AchievementsPage />, '/achievements');
    await expect.element(page.getByText(/Primer Paso/i)).toBeVisible();
    await settle();
    await shoot('hub-03-logros');
    expectNoHorizontalOverflow('LOGROS MOBILE');
    // El contador del header baja a su propio renglón (H2): no le roba ancho al título.
    const title = document.querySelector('.qb-header-text') as HTMLElement;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(300);
  });

  test('Mostrador de recompensas', async () => {
    await setMobileViewport();
    mountInShell(<RewardsPage />, '/rewards');
    await settle(600);
    await shoot('hub-04-recompensas');
    expectNoHorizontalOverflow('RECOMPENSAS MOBILE');
  });
});
```

- [ ] **Step 2: Correr y ver qué falla**

Run: `npm run test:visual:mobile -- mobile-hub 2>&1 | tail -30`
Expected: fallan «Ficha del Héroe» (4 columnas en `.hero-stats-grid`) y «Estante de logros» (`.qb-header-text` < 300 px); el log `PERSONAJE MOBILE` lista los nodos que desbordan (`.hero-chronicle-text`, `.hero-title-trail-label`…). Dashboard y Recompensas pueden pasar ya (sus grillas colapsan a 880 y 620 px): anotar cuáles fallaron.

- [ ] **Step 3: Reglas transversales en `layout.css`** (al final del archivo)

```css

/* ══════════════════════════════════════════════════════
   MOBILE — reglas transversales (Fase 3, spec §7)
   Prefijo [data-shell="mobile"]: lo pone MobileShell en <html>; Electron
   nunca lo tiene. El .main-content extra en cada selector es para ganarle por
   especificidad a codex.css, components.css y shell.css (780 px) sin depender
   del orden de import (App.tsx carga las hojas de módulo DESPUÉS de las del hub).
   ══════════════════════════════════════════════════════ */
[data-shell="mobile"] .main-content .qb-page,
[data-shell="mobile"] .main-content .settings-page {
  padding: 12px 12px 20px;
}

/* Ornamentos de 44 px a 4 px del borde: con 12 px de padding pisan el texto. */
[data-shell="mobile"] .main-content .qb-corner {
  display: none;
}

/* El header del códice no envolvía y `.qb-header-extra` no encogía: los
   chips de Coinify o el contador de Logros dejaban 60–230 px al título. */
[data-shell="mobile"] .main-content .qb-header {
  flex-wrap: wrap;
  gap: 8px;
}

[data-shell="mobile"] .main-content .qb-header-extra {
  flex: 1 1 100%;
  flex-shrink: 1;
  justify-content: flex-start;
}

[data-shell="mobile"] .main-content .qb-title {
  font-size: var(--fs-hero);
}

/* Estaba `position: absolute; right: 0; bottom: 0`: encima del título. */
[data-shell="mobile"] .main-content .page-header__actions {
  position: static;
  margin-top: 8px;
  flex-wrap: wrap;
}

[data-shell="mobile"] .main-content .settings-row {
  flex-wrap: wrap;
}

[data-shell="mobile"] .main-content .settings-row__buttons {
  width: 100%;
  justify-content: flex-end;
  flex-wrap: wrap;
}

[data-shell="mobile"] .account-dropdown {
  max-width: calc(100vw - 16px);
}

```

- [ ] **Step 4: `dashboard-layouts.css`** (al final; la regla vive acá porque esta hoja se importa DESPUÉS de `layout.css` y con la misma especificidad ganaría su `opacity: 0`)

```css

/* Sin puntero no hay hover: los controles de mover/redimensionar (H6) tienen
   que estar a la vista. */
@media (hover: none) {
  .widget-controls {
    opacity: 1;
  }
}
```

- [ ] **Step 5: `character.css`** (al final)

```css

/* ── Mobile (390 px; Fase 3) ────────────────────────
   Ninguna de estas grillas tenía breakpoint por debajo de 880 px. */
[data-shell="mobile"] .hero-stats-grid {
  grid-template-columns: repeat(2, 1fr);
}

[data-shell="mobile"] .hero-virtues-grid {
  grid-template-columns: 1fr;
}

[data-shell="mobile"] .hero-chronicle-grid {
  grid-template-columns: 1fr;
  column-gap: 0;
}

/* Siete nodos en 366 px son 52 px cada uno; «Campesino» mide ~62. La senda
   scrollea de costado en vez de apilar tres renglones por rótulo. */
[data-shell="mobile"] .hero-title-trail {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

[data-shell="mobile"] .hero-title-trail-grid {
  grid-template-columns: repeat(7, 64px);
  width: max-content;
}

@media (hover: none) {
  /* El texto completo vivía solo en `title`, que en touch no existe. */
  .hero-chronicle-text {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
}
```

- [ ] **Step 6: `codex-seal.css`** (al final)

```css

/* ── Mobile (390 px; Fase 3) ────────────────────────
   Va en esta hoja y no en layout.css: el @media de 720 px de arriba tiene la
   misma especificidad y se carga después. */
/* 4 → 2 a 720 px no alcanza: a 366 px cada cartucho tiene 153 px. */
[data-shell="mobile"] .codex-cartouches {
  grid-template-columns: 1fr;
}

/* Control segmentado de ~285 px: con --font-scale 1.15 no entraba. */
[data-shell="mobile"] .ach-filter {
  width: 100%;
}

[data-shell="mobile"] .ach-filter__btn {
  flex: 1;
  justify-content: center;
  padding: 5px 4px;
}
```

- [ ] **Step 7: `rewards.css`** (al final)

```css

/* ── Touch (Fase 3) ─────────────────────────────────
   Los iconos de editar/borrar solo mostraban su borde en :hover: en touch
   parecían adorno. */
@media (hover: none) {
  .rwd-item__tool {
    width: 40px;
    height: 40px;
    border-color: rgba(74, 55, 32, 0.4);
    color: var(--ink-soft);
  }

  .rwd-form__icon {
    width: 40px;
    height: 40px;
  }
}
```

- [ ] **Step 8: Correr y ver que pasa**

Run: `npm run test:visual:mobile -- mobile-hub 2>&1 | tail -8`
Expected: `Tests  4 passed (4)`. Mirar `__screenshots__/mobile/hub-0*-*.png`: en la Ficha, las cuatro stats en 2×2 y las virtudes en una columna; en Logros el contador «N / M» debajo del título.

Run: `npm run test:visual 2>&1 | tail -4`
Expected: `30 passed` — las reglas nuevas viven bajo `[data-shell="mobile"]` (que solo pone `MobileShell`) o `hover: none` (ningún test de escritorio emula touch).

- [ ] **Step 9: Commit**

```bash
git add tests/visual/mobile/mobile-hub.browser.test.tsx src/hub/styles/layout.css src/hub/styles/dashboard-layouts.css src/hub/styles/character.css src/hub/styles/codex-seal.css src/hub/rewards/rewards.css
git commit -m "fix(hub): las páginas del hub entran en 390 px; reglas transversales de mobile"
```

### Task 12: Safe areas en overlays y capas fijas

**Files:**
- Modify: `src/hub/styles/layout.css` (al final)
- Test: `tests/visual/mobile/mobile-shell.browser.test.tsx` (un test más)

Con la barra de estado superpuesta (desvío 1) y la barra de gestos abajo, todo lo `position: fixed; inset: 0` del proyecto se mete debajo de las dos. Lista explícita de overlays, con su archivo, para que quien implemente no invente selectores: `.notif-overlay`/`.notif-drawer` (`shared/styles/notifications.css:57,64`), `.codex-overlay` (`hub/styles/codex-seal.css:12`), `.update-dialog-overlay` (`hub/styles/shell.css:199`), `.changelog-overlay` (`shared/components/ChangelogModal.css:3`), `.quest-project-modal-overlay` (`quests.css:914`), `.quest-notes-overlay` (`quests.css:1128`), `.coin-modal-overlay` (`coinify.css:967`), `.coin-import-overlay` (`coinify.css:1018`), `.nutri-popup-overlay` (`nutri.css:1712`), `.cauldron-modal-overlay` (`cauldron.css:535`). El de `ConfirmDialog.tsx:62` es inline (`position: 'fixed', inset: 0`) y centra con flex: el contenido queda en el medio, lejos de las barras; no se toca. `.tour-overlay` es un foco, no un contenedor; no se toca.

- [ ] **Step 1: El test** — agregar al final del `describe` de `mobile-shell.browser.test.tsx`:

```tsx
  test('con insets, drawer y capas fijas no quedan debajo de las barras del sistema', async () => {
    await setMobileViewport();
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px');
    mountInShell(<Page />);
    await settle();
    await openDrawer();
    const side = document.querySelector('.mobile-drawer .sidebar') as HTMLElement;
    expect(side.getBoundingClientRect().top).toBeGreaterThanOrEqual(24);
    expect(window.innerHeight - side.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(20);
    const main = document.querySelector('.main-content') as HTMLElement;
    expect(parseFloat(getComputedStyle(main).paddingBottom)).toBe(20);
    document.documentElement.style.removeProperty('--safe-area-inset-top');
    document.documentElement.style.removeProperty('--safe-area-inset-bottom');
  });
```

Run: `npm run test:visual:mobile -- mobile-shell 2>&1 | tail -6`
Expected: pasa ya (el drawer y `.main-content` usan `--safe-*` desde la Task 7). Es la red para lo que sigue.

- [ ] **Step 2: Reglas en `layout.css`** (al final)

```css

/* ── Safe areas en capas fijas (solo shell mobile) ──
   Con edge-to-edge la barra de estado y la de gestos superponen al WebView;
   todo lo `position: fixed; inset: 0` tiene que dejarles su franja. Lista
   explícita: son los overlays del proyecto a la fecha (Fase 3). */
:root[data-shell="mobile"] .notif-drawer,
:root[data-shell="mobile"] .codex-overlay,
:root[data-shell="mobile"] .update-dialog-overlay,
:root[data-shell="mobile"] .changelog-overlay,
:root[data-shell="mobile"] .quest-project-modal-overlay,
:root[data-shell="mobile"] .quest-notes-overlay,
:root[data-shell="mobile"] .coin-modal-overlay,
:root[data-shell="mobile"] .coin-import-overlay,
:root[data-shell="mobile"] .nutri-popup-overlay,
:root[data-shell="mobile"] .cauldron-modal-overlay {
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}

/* Lo que está pegado abajo sube por encima de la barra de gestos. */
:root[data-shell="mobile"] .xp-toast {
  bottom: calc(12px + var(--safe-bottom));
}

:root[data-shell="mobile"] .update-chip {
  bottom: calc(16px + var(--safe-bottom));
}

:root[data-shell="mobile"] .cauldron-floating-timer {
  bottom: calc(8px + var(--safe-bottom));
}

/* Los toasts del sistema (top: 96px) caen debajo de la cabecera de 56 px:
   los corremos por el inset para que no se metan bajo la barra de estado. */
:root[data-shell="mobile"] .system-toast-container {
  top: calc(64px + var(--safe-top));
}
```

- [ ] **Step 3: Verificar y commitear**

Run: `npm run test:visual:mobile 2>&1 | tail -4 && npm run test:visual 2>&1 | tail -4`
Expected: `2 passed` (10 tests) y `30 passed`.

```bash
git add src/hub/styles/layout.css tests/visual/mobile/mobile-shell.browser.test.tsx
git commit -m "fix(hub): overlays y capas fijas respetan las safe areas en el shell mobile"
```


## Chunk 4: Pase responsive por módulo I (Questify, Coinify)

Patrón de cada tarea: test mobile que monta la página en el shell y exige cero desborde → correr y ver qué desborda (el log lista los nodos) → bloque de reglas `[data-shell="mobile"] …` + `@media (hover: none)` AL FINAL de la hoja del módulo (nunca un `@media` de ancho: Electron baja hasta 700 px y los tests de escritorio hasta 420, ver desvío 9) → pasa → `npm run test:visual` sigue en 30 → commit. Las tablas listan lo verificado leyendo el CSS; el log del test es la segunda fuente: si aparece un nodo que no está en la tabla, se agrega su regla al mismo bloque y se anota en el commit.

### Task 13: Questify a 390 px

**Files:**
- Test: `tests/visual/mobile/mobile-quests.browser.test.tsx`
- Modify: `src/modules/quests/styles/quests.css` (al final; el archivo termina en el `@container` de la línea 1554)
- Modify: `src/modules/quests/components/ScrollNotes.tsx:261`, `TaskForm.tsx:144`

Lo que ya cubre `quests.css:111-118` (`@media (max-width: 700px)`): `.quest-columns → 1fr` y `.quest-stats-strip → 2 columnas` — a 366 px cada stat tiene 158 px, entra. `quests.css:1188-1190` (`hover: none`) ya destapa `.quest-row-postpone`. Todo lo demás:

| # | Selector | Línea | Problema a 366 px | Arreglo |
|---|---|---|---|---|
| Q1 | `.quest-habit-row` | 611-624 | `minmax(88px,1fr) minmax(0,max-content) 24px 40px`: el piso es 170 px + ~220 px de badges (freq, días, progreso, racha, escudos) = 390 px; sin breakpoint | 3 columnas; `.quest-habit-right` a renglón propio |
| Q2 | `.quest-row-actions` + `@container (max-width: 460px)` | 317-323, 1554-1574 | la fila ya envuelve en 2 renglones pero el 2.º pide 62 + 90 + 228 = 380 px en 338: tercer renglón en cada fila con badges | `.quest-row-xp { margin-left: 0 }`, ocultar «XP BASE», `flex-wrap` en acciones |
| Q3 | `.quest-project-modal` | 924-926 | `width: 420px` sin `max-width` en un viewport de 390: 15 px cortados de cada lado; overlay sin padding | `width: 100%`, overlay con padding |
| Q4 | `ScrollNotes.tsx:261` | — | `minWidth: CANVAS_W + 40` = 540 px inline: 75 px cortados de cada lado y sin scroll a la izquierda | clase `quest-notes-dialog` con `min-width` en CSS + override |
| Q5 | `.quest-tabs` | 1089-1092 | `display: flex` sin wrap ni `min-width: 0`; con `--font-scale` 1.25 las tres pestañas miden 361 px | `flex-wrap: wrap; min-width: 0` |
| Q6 | `.quest-tab-bar-spacer` / `.quest-search-input` | 573-576, 559-565 | el spacer come el renglón y deja la búsqueda (`max-width: 180px`) sola a media ancho | ocultar spacer, búsqueda a `flex: 1 1 100%` |
| Q7 | `.quest-filter-select`, `.quest-project-select` | 578-588 | sin `max-width`: un nombre de proyecto largo hace el select más ancho que la página | `max-width: 100%; min-width: 0` |
| Q8 | `.quest-delete-bar`, `.quest-project-modal-row` | 591-599, 947-953 | sin `flex-wrap` | `flex-wrap: wrap` |
| Q9 | `TaskForm.tsx:144` | — | primera fila `display:flex` sin wrap: input + 2 botones; `<input>` no encoge por debajo de su tamaño intrínseco | `flexWrap: 'wrap'` + `.rpg-input { min-width: 0 }` |
| Q10 | `.quest-row-expanded` | 463-468 | `padding-left: 30px` más los 16 de la fila: las subtareas corren en 308 px | `padding-left: 12px` |
| Q11 | `.quest-habit-day` | 1223-1235 | 22 px de lado para 7 toggles: bajo el mínimo táctil | 34 px |
| Q12 | `.quest-habit-name:hover`, `.quest-cauldron-link:hover` | 644-648, 1031-1039 | el subrayado que dice «esto se toca» solo aparece en hover; el pulso solo se apaga en hover | `hover: none`: subrayado fijo, sin animación |
| Q13 | `.xp-toast` | 780-794 | `bottom: 24px; right: 24px` sin `max-width`: una línea larga de combo se sale por la izquierda | `left/right: 12px` |
| Q14 | `.quest-row-menu` | 360-362 | `min-width: 160px` sin `max-width`; `useAnchoredPopup` recorta el `left` pero no el ancho | `max-width: calc(100vw - 24px)` |

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-quests.browser.test.tsx
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import TaskList from '@modules/quests/components/TaskList';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { QUESTS_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/quests/styles/quests.css';

beforeAll(() => {
  try { localStorage.setItem('hubtify_sound', 'false'); } catch { /* ignore */ }
  installApi(QUESTS_API);
});

beforeEach(() => {
  try { localStorage.removeItem('questify_collapsed_projects'); } catch { /* ignore */ }
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

async function goTab(name: RegExp) {
  await page.getByRole('tab', { name }).click();
  await settle(300);
}

describe('Questify a 390×844', () => {
  test('Pendientes: filas, hábitos y barra de pestañas entran', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    await shoot('quests-01-pendientes');
    noOverflow('QUESTS PENDIENTES');
    for (const row of document.querySelectorAll<HTMLElement>('.quest-row, .quest-habit-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // Q1: los badges del hábito bajan a su propio renglón: la fila tiene 3 pistas, no 4.
    const habitRow = document.querySelector('.quest-habit-row') as HTMLElement;
    expect(getComputedStyle(habitRow).gridTemplateColumns.split(' ').length).toBe(3);
    // …y el tilde sigue en el renglón del nombre, no en un tercero.
    const name = habitRow.querySelector('.quest-habit-name') as HTMLElement;
    const tick = habitRow.querySelector('.quest-habit-tick') as HTMLElement;
    expect(Math.round(tick.getBoundingClientRect().top)).toBe(Math.round(name.getBoundingClientRect().top));
  });

  test('Hoy y Completadas', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Hoy$/i);
    await shoot('quests-02-hoy');
    noOverflow('QUESTS HOY');
    await goTab(/^Completadas$/i);
    noOverflow('QUESTS COMPLETADAS');
  });

  test('el gestor de proyectos entra en la pantalla (Q3)', async () => {
    await setMobileViewport();
    mountInShell(<TaskList />, '/quests');
    await settle();
    await goTab(/^Pendientes$/i);
    await page.getByRole('button', { name: /Gestionar proyectos/i }).click();
    await settle(300);
    const modal = document.querySelector('.quest-project-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    const r = modal.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth);
    await shoot('quests-03-proyectos');
  });
});
```

El botón que abre el gestor lleva `aria-label={t('questify.manageProjects')}` = «Gestionar proyectos» (`TaskList.tsx:637-639`, `es.json:1458`).

- [ ] **Step 2: Correr y ver qué falla**

Run: `npm run test:visual:mobile -- mobile-quests 2>&1 | tail -30`
Expected: fallan los tres. El log `QUESTS PENDIENTES` lista `.quest-habit-row`, `.quest-row-actions`, y el gestor mide 420 px.

- [ ] **Step 3: JSX — `ScrollNotes.tsx` (Q4) y `TaskForm.tsx` (Q9)**

En `ScrollNotes.tsx`, dentro del `style={{ … }}` del diálogo (línea ~254-263), borrar la línea `          minWidth: CANVAS_W + 40,` y agregar `className="quest-notes-dialog"` al mismo elemento (el `<div {...dialogProps} aria-label=…>`). Como `dialogProps` no trae `className`, no pisa nada. Si `CANVAS_W` queda sin otro uso, tsc/lint lo dirán: en ese caso dejar la constante (la usa el canvas).

En `quests.css`, justo después de la regla `.quest-notes-overlay { … }` (línea ~1136) agregar:

```css

/* El pergamino de notas: 500 px de lienzo + 40 de marco. Vivía inline en
   ScrollNotes.tsx y el @media de abajo no podía tocarlo. */
.quest-notes-dialog {
  min-width: 540px;
}
```

En `TaskForm.tsx:144` reemplazar `      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>` por `      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>`.

- [ ] **Step 4: CSS — al final de `quests.css`**

```css

/* ══════════════════════════════════════════════════════
   MOBILE — 390 px (Fase 3). Ver docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md, Task 13.
   ══════════════════════════════════════════════════════ */
/* Q1: cuatro pistas con un piso de 170 px más ~220 px de badges no entran
   en 366. Los badges bajan a un renglón propio bajo el nombre. */
[data-shell="mobile"] .quest-habit-row {
  grid-template-columns: minmax(0, 1fr) 24px 40px;
}

/* Orden DOM (HabitTracker.tsx:412-514): name, right, tick, actions. Sin
   posiciones explícitas el autoplacement mandaba tilde y menú a un TERCER
   renglón. */
[data-shell="mobile"] .quest-habit-name { grid-row: 1; grid-column: 1; }
[data-shell="mobile"] .quest-habit-tick { grid-row: 1; grid-column: 2; }
[data-shell="mobile"] .quest-habit-actions { grid-row: 1; grid-column: 3; }

[data-shell="mobile"] .quest-habit-right {
  grid-row: 2;
  grid-column: 1 / -1;
  justify-content: flex-start;
}

/* Q2: el segundo renglón de la fila (container query de arriba) pedía
   62 + 90 + 228 px; sin el desplazamiento ni «XP BASE» entra en 338. */
[data-shell="mobile"] .quest-row-xp {
  margin-left: 0;
}

[data-shell="mobile"] .quest-row-xp-label {
  display: none;
}

[data-shell="mobile"] .quest-row-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Q3 */
[data-shell="mobile"] .quest-project-modal-overlay {
  padding: 12px;
  align-items: flex-start;
}

[data-shell="mobile"] .quest-project-modal {
  width: 100%;
  max-width: 100%;
  max-height: 92vh;
  padding: 14px;
}

/* Q4 */
[data-shell="mobile"] .quest-notes-overlay {
  padding: 12px;
}

[data-shell="mobile"] .quest-notes-dialog {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

/* Q5, Q6, Q7, Q8: la barra de pestañas y sus controles */
[data-shell="mobile"] .quest-tabs {
  flex-wrap: wrap;
  min-width: 0;
}

[data-shell="mobile"] .quest-tab-bar-spacer {
  display: none;
}

[data-shell="mobile"] .quest-search-input {
  max-width: none;
  flex: 1 1 100%;
}

[data-shell="mobile"] .quest-filter-select,
[data-shell="mobile"] .quest-project-select {
  max-width: 100%;
  min-width: 0;
  flex: 1 1 140px;
}

[data-shell="mobile"] .quest-delete-bar,
[data-shell="mobile"] .quest-project-modal-row {
  flex-wrap: wrap;
}

/* Q9: el <input> no encoge por debajo de su tamaño intrínseco. */
[data-shell="mobile"] .quest-form-wrapper .rpg-input {
  min-width: 0;
}

/* Q10 */
[data-shell="mobile"] .quest-row-expanded {
  padding-left: 12px;
}

/* Q13 */
[data-shell="mobile"] .xp-toast {
  left: 12px;
  right: 12px;
  bottom: 12px;
  align-items: center;
}

/* Q14 */
[data-shell="mobile"] .quest-row-menu,
[data-shell="mobile"] .quest-postpone-menu {
  max-width: calc(100vw - 24px);
}

@media (hover: none) {
  /* Q11: siete toggles de 22 px */
  .quest-habit-day {
    width: 34px;
    height: 34px;
  }

  .subtask-cell--action {
    width: 32px;
    min-height: 32px;
  }

  /* Q12: el nombre del hábito ES el botón; el subrayado que lo decía solo
     aparecía en hover. Y el pulso del vínculo al Caldero solo se apagaba
     en hover: en touch latía para siempre. */
  .quest-habit-name {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }

  .quest-cauldron-link {
    animation: none;
  }
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:visual:mobile -- mobile-quests 2>&1 | tail -8`
Expected: `Tests  3 passed (3)`. Mirar `quests-01-pendientes-a.png`: cada hábito con el nombre entero y los badges debajo; las filas de misión en dos renglones, sin tercero.

Run: `npm run test:visual -- audit-quests 2>&1 | tail -4`
Expected: `2 passed` (tasklist + widgets) — el `@container (max-width: 460px)` y las reglas de escritorio no cambiaron.

- [ ] **Step 6: Commit**

```bash
git add tests/visual/mobile/mobile-quests.browser.test.tsx src/modules/quests/styles/quests.css src/modules/quests/components/ScrollNotes.tsx src/modules/quests/components/TaskForm.tsx
git commit -m "fix(quests): Questify entra en 390 px; hábitos, acciones de fila y modales"
```

### Task 14: Coinify a 390 px

**Files:**
- Test: `tests/visual/mobile/mobile-coinify.browser.test.tsx`
- Modify: `src/modules/finance/styles/coinify.css` (al final)
- Modify: `src/modules/finance/components/FinanceLayout.tsx`

`coinify.css` no tiene ninguna regla por debajo de 780 px (el comentario de `2095-2103` lo documenta: la franja 390–780 comparte reglas pensadas para ~440 px de contenido). Además, `.coin-book .qb-page` (`:2141`, 50/20 px de padding lateral) le gana a `shell.css` por orden de import: la columna real es **320 px**, no 366.

| # | Selector | Línea | Problema a 320 px | Arreglo |
|---|---|---|---|---|
| C1 | `.coin-book .qb-page` | 56-59, 2141-2146 | 70 px de padding lateral de 390 | `12px` |
| C2 | `.coin-ledger-header/.coin-ledger-row` | 490-495, 2162-2166 | `28px 1fr 96px 88px 68px` + gaps + chrome = 330 px fijos: la columna «concepto» queda en 0 y la fila desborda | grilla de 3 pistas con `grid-template-areas`; cabecera oculta |
| C3 | `.coin-import-modal` | 1028-1036 | `width: 700px` sin `max-width`, overlay sin padding: 155 px fuera de cada lado, el izquierdo inalcanzable | `width: 100%`; tabla con `overflow-x: auto` |
| C4 | `.coin-budget-pencil` | 2456-2478 | `opacity: 0` hasta `:hover`/`:focus-within`: en touch no se puede poner un presupuesto por primera vez | `hover: none`: visible, 32 px |
| C5 | `.coin-loan-header` | 1482-1487 | sin wrap: pestañas (~268 px) + «Agregar préstamo» (~150) en 320 | `flex-wrap`; pestañas a renglón propio |
| C6 | `.coin-loan-card__row` | 1551-1558, 2130-2137 | `auto 1fr 90px 100px` deja 56 px a la descripción | 3 pistas; progreso en 2.ª fila |
| C7 | `.coin-installment-group__header` | 1357-1364, 1382-1388 | sin wrap y `__progress { flex: 0 0 165px }`: el título queda en ~95 px | wrap; progreso al 100 % |
| C8 | `.coin-category-legend__row` | 347-356, 2452-2454 | `minmax(80px,auto)` para el monto crece con 7 dígitos y se come el rótulo | pistas `auto`; sin `%` |
| C9 | `.coin-tab-link` | 84-122 | scrollea (ok) pero 32 px de alto y sin `scrollIntoView` de la activa: en `/finance/loans` la pestaña activa queda fuera de vista | padding táctil; `scrollIntoView` en `FinanceLayout.tsx` |
| C10 | `.coin-dollar-menu` | 2252-2264 | `min-width: 200px` anclado a la derecha: entra, pero con `--font-scale` 1.3 las filas envuelven | ancho a `calc(100vw - 24px)`, centrado |
| C11 | `.coin-month-nav` | 1313-1317 | `gap: 12px` + rótulo de 130 px: 218 px de 320 | gap 6, rótulo más chico |
| C12 | `.coin-quick-add-form--open` | 774-789 | `max-height: 760px` con las filas apiladas se queda corto y el `overflow: hidden` recorta el formulario | 1400 px; filas con wrap |
| C13 | `.coin-editable-amount__pencil` | 712-721 | `opacity: 0` hasta hover | `hover: none`: 0.55 |
| C14 | `.coin-upcoming__row` | 2651-2691 | fila de alto fijo: fecha + tipo (~90) + monto (~80) dejan ~92 px al rótulo | ocultar `__kind` (el borde de color ya lo dice) |
| C15 | `.coin-ledger-row` | 554-560 | 30 px de alto de fila | `padding: 10px 2px` |
| C16 | `.coin-sort-header` | 515-531 | `text-overflow: ellipsis` recorta «CATEGORÍA» y con él la flecha de orden | (la cabecera se oculta en C2) |

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-coinify.browser.test.tsx
import { beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Routes, Route } from 'react-router-dom';
import FinanceLayout from '@modules/finance/components/FinanceLayout';
import FinanceDashboard from '@modules/finance/components/Dashboard';
import Transactions from '@modules/finance/components/Transactions';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { FINANCE_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/finance/styles/coinify.css';

beforeAll(() => {
  installApi(FINANCE_API);
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

/** El mismo árbol de rutas que App.tsx para /finance, con el layout de pestañas real. */
function Finance() {
  return (
    <Routes>
      <Route path="/finance" element={<FinanceLayout />}>
        <Route index element={<FinanceDashboard />} />
        <Route path="transactions" element={<Transactions />} />
      </Route>
    </Routes>
  );
}

describe('Coinify a 390×844', () => {
  test('Panel: la página respira y nada desborda (C1)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance');
    await expect.element(page.getByText(/Libro del Tesorero/i)).toBeVisible();
    await settle(700);
    await shoot('coinify-01-panel');
    noOverflow('COIN PANEL');
    const pageEl = document.querySelector('.coin-book .qb-page') as HTMLElement;
    expect(parseFloat(getComputedStyle(pageEl).paddingLeft)).toBeLessThanOrEqual(12);
  });

  test('Libro mayor: cada fila entra entera (C2)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/transactions');
    await settle(700);
    await shoot('coinify-02-movimientos');
    noOverflow('COIN LEDGER');
    const rows = document.querySelectorAll<HTMLElement>('.coin-ledger-row');
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // El concepto ya no queda en 0 px: la columna es legible.
    const desc = document.querySelector('.coin-ledger-row__desc') as HTMLElement;
    expect(desc.getBoundingClientRect().width).toBeGreaterThan(120);
  });

  test('la pestaña activa se ve aunque sea la última (C9)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance/transactions');
    await settle(700);
    const active = document.querySelector('.coin-tab-link--active') as HTMLElement;
    const nav = document.querySelector('.coin-tab-nav') as HTMLElement;
    const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
    expect(a.left).toBeGreaterThanOrEqual(n.left - 1);
    expect(a.right).toBeLessThanOrEqual(n.right + 1);
    expect(active.getBoundingClientRect().height).toBeGreaterThanOrEqual(38);
  });

  test('el lápiz de presupuesto existe sin hover (C4)', async () => {
    await setMobileViewport();
    mountInShell(<Finance />, '/finance');
    await settle(700);
    // El project emula touch: (hover: none) aplica y el lápiz tiene que verse.
    const pencil = document.querySelector('.coin-budget-pencil') as HTMLElement;
    expect(pencil).not.toBeNull();
    expect(parseFloat(getComputedStyle(pencil).opacity)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Correr y ver qué falla**

Run: `npm run test:visual:mobile -- mobile-coinify 2>&1 | tail -30`
Expected: fallan el panel (padding 50 px), el libro mayor (`.coin-ledger-row` desborda, `__desc` en ~0 px) y la pestaña activa (fuera de vista / 32 px).

- [ ] **Step 3: `FinanceLayout.tsx` — la pestaña activa a la vista (C9)**

Reemplazar el archivo completo por:

```tsx
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookPage } from '../../../shared/components/codex/BookPage';
import { DollarChip } from './shared/DollarChip';
import { CryptoChip } from './shared/CryptoChip';

const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/installments', label: 'coinify.installments' },
  { path: '/finance/recurring', label: 'coinify.recurringLabel' },
  { path: '/finance/cards', label: 'coinify.creditCards' },
  { path: '/finance/loans', label: 'coinify.loans' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  // Seis pestañas no entran en 390 px y la tira scrollea: al llegar por link
  // directo a la sexta, la activa quedaba fuera de vista y la primera parecía
  // la elegida. `nearest` no mueve nada cuando ya se ve.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('.coin-tab-link--active');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  return (
    <BookPage
      eyebrow={t('coinify.bookEyebrow', '† TOMO IV †  —  DE REBUS AERIS')}
      title={t('coinify.title', 'Libro del Tesorero')}
      subtitle={t('coinify.bookSubtitle', 'Registro de dádivas, tributos, préstamos y del estado del cofre real')}
      headerExtra={<div style={{ display: 'flex', gap: 6 }}><DollarChip /><CryptoChip /></div>}
      className="coin-book"
    >
      {/* Tab navigation. Scrolls horizontally rather than overflowing the page
          when the window is narrow — six tabs do not fit at the 700px minimum. */}
      <div className="coin-tab-nav-wrap">
        <nav ref={navRef} className="coin-tab-nav" role="tablist">
          {tabs.map((tab) => {
            const isActive = 'end' in tab && tab.end
              ? location.pathname === tab.path
              : location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                end={'end' in tab ? tab.end : undefined}
                role="tab"
                aria-selected={isActive}
                className={({ isActive: active }) =>
                  `coin-tab-link ${active ? 'coin-tab-link--active' : ''}`
                }
              >
                {t(tab.label)}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="coin-layout__content">
        <Outlet />
      </div>
    </BookPage>
  );
}
```

- [ ] **Step 4: CSS — al final de `coinify.css`**

```css

/* ══════════════════════════════════════════════════════
   MOBILE — 390 px (Fase 3). Ver docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md, Task 14.
   El comentario de «Responsive» más arriba asume 700 px de ventana mínima;
   en Android la columna es de ~366 px y ninguna regla de 780 px la contempla.
   ══════════════════════════════════════════════════════ */
/* C1: 50/20 px de margen del libro en 390 px de pantalla. Misma
   especificidad que la regla de 780 px de arriba; esta va después y gana. */
[data-shell="mobile"] .coin-book .qb-page {
  padding-left: 12px;
  padding-right: 12px;
  padding-top: 16px;
  padding-bottom: 20px;
}

/* C2: cinco pistas fijas suman 330 px; el concepto quedaba en cero. Tres
   pistas y dos renglones: día | concepto | monto, y debajo categoría | acciones. */
[data-shell="mobile"] .coin-ledger-header {
  display: none;
}

[data-shell="mobile"] .coin-ledger-row:not(.coin-ledger-row--editing) {
  grid-template-columns: 26px minmax(0, 1fr) auto;
  grid-template-areas:
    'day desc amount'
    '. cat actions';
  row-gap: 2px;
  padding: 10px 2px;   /* C15 */
}

[data-shell="mobile"] .coin-ledger-row__day { grid-area: day; }
[data-shell="mobile"] .coin-ledger-row__desc { grid-area: desc; }
[data-shell="mobile"] .coin-ledger-row__amount { grid-area: amount; }
[data-shell="mobile"] .coin-ledger-row__cat { grid-area: cat; }
[data-shell="mobile"] .coin-ledger-row__actions { grid-area: actions; justify-self: end; }

/* C3 */
[data-shell="mobile"] .coin-import-overlay {
  padding: 8px;
  align-items: flex-start;
}

[data-shell="mobile"] .coin-import-modal {
  width: 100%;
  max-width: 100%;
  max-height: 92vh;
  padding: 12px;
}

[data-shell="mobile"] .coin-import-table {
  display: block;
  overflow-x: auto;
  white-space: nowrap;
}

[data-shell="mobile"] .coin-import-row__merchant {
  max-width: 120px;
}

[data-shell="mobile"] .coin-import-card__select {
  max-width: 100%;
}

[data-shell="mobile"] .coin-modal-overlay {
  padding: 8px;
  align-items: flex-start;
}

[data-shell="mobile"] .coin-modal,
[data-shell="mobile"] .coin-modal--narrow {
  width: 100%;
  max-height: 90vh;
}

/* C5 */
[data-shell="mobile"] .coin-loan-header {
  flex-wrap: wrap;
  gap: 8px;
}

[data-shell="mobile"] .coin-loan-tabs {
  flex: 1 1 100%;
}

[data-shell="mobile"] .coin-loan-tab {
  flex: 1;
  justify-content: center;
  white-space: nowrap;
}

/* C6 */
[data-shell="mobile"] .coin-loan-card__row {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

[data-shell="mobile"] .coin-loan-card__progress {
  grid-column: 2 / -1;
}

/* C7 */
[data-shell="mobile"] .coin-installment-group__header {
  flex-wrap: wrap;
}

[data-shell="mobile"] .coin-installment-group__progress {
  flex: 1 1 100%;
  order: 3;
}

/* C8 */
[data-shell="mobile"] .coin-category-legend__row,
[data-shell="mobile"] .coin-category-legend__item .coin-category-legend__row {
  grid-template-columns: 10px minmax(0, 1fr) auto 34px 18px;
  gap: 4px;
}

[data-shell="mobile"] .coin-category-legend__pct {
  display: none;
}

/* C9: alto táctil; con scroll-snap la pestaña queda centrada. */
[data-shell="mobile"] .coin-tab-nav {
  scroll-snap-type: x proximity;
}

[data-shell="mobile"] .coin-tab-link {
  padding: 12px 10px 13px;
  letter-spacing: 0.06em;
  scroll-snap-align: center;
}

/* C10 */
[data-shell="mobile"] .coin-dollar-menu {
  min-width: 0;
  width: calc(100vw - 24px);
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}

/* C11 */
[data-shell="mobile"] .coin-month-nav {
  gap: 6px;
}

[data-shell="mobile"] .coin-month-nav__label {
  font-size: calc(12px * var(--font-scale));
  letter-spacing: 0.04em;
}

/* C12 */
[data-shell="mobile"] .coin-quick-add-form--open {
  max-height: 1400px;
}

[data-shell="mobile"] .coin-quick-add-form__amount-row,
[data-shell="mobile"] .coin-quick-add-form__installment-row {
  flex-wrap: wrap;
}

/* C14 */
[data-shell="mobile"] .coin-upcoming__kind {
  display: none;
}

@media (hover: none) {
  /* C4: poner un presupuesto por primera vez era imposible en touch. */
  .coin-budget-pencil {
    opacity: 0.75;
    width: 32px;
    height: 32px;
  }

  /* C13 */
  .coin-editable-amount__pencil {
    opacity: 0.55;
  }

  .coin-fx-house-pick,
  .coin-budget-edit__btn,
  .coin-recurring-card__toggle {
    min-width: 40px;
    min-height: 40px;
  }

  .coin-action-btn {
    min-width: 40px;
    min-height: 40px;
  }

  .coin-account-row {
    padding: 10px 6px;
  }
}
```

Celdas de la fila del libro mayor, verificadas en `Transactions.tsx:582-655`: exactamente seis en el flujo — `__day`, `__desc`, `__cat`, `__meta` (ya `display: none` a ≤780 px, línea 2157), `__amount`, `__actions`. Las cinco visibles tienen área; la fila en edición (`.coin-ledger-row--editing`, `display: block`, línea 570) queda fuera de la grilla a propósito.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:visual:mobile -- mobile-coinify 2>&1 | tail -8`
Expected: `Tests  4 passed (4)`. En `coinify-02-movimientos-a.png` cada movimiento ocupa dos renglones: concepto y monto arriba, categoría y los dos botones abajo.

Run: `npm run test:visual -- audit-coin 2>&1 | tail -4`
Expected: `5 passed` (dashboard, ledger, layout, managers, cauldron).

- [ ] **Step 6: Commit**

```bash
git add tests/visual/mobile/mobile-coinify.browser.test.tsx src/modules/finance/styles/coinify.css src/modules/finance/components/FinanceLayout.tsx
git commit -m "fix(finance): Coinify entra en 390 px; libro mayor en dos renglones y pestaña activa a la vista"
```

## Chunk 5: Pase responsive por módulo II (Nutrify, Cauldron)

### Task 15: Nutrify a 390 px

**Files:**
- Test: `tests/visual/mobile/mobile-nutrify.browser.test.tsx`
- Modify: `src/modules/nutrition/styles/nutri.css` (al final; los bloques de 768/480 px existentes en 2693-2737 se conservan)
- Modify: `src/modules/nutrition/components/FoodLogItem.tsx:284`

Lo que ya cubren `nutri.css:2693-2737`: `.nutri-charts-grid`, `.nutri-kpi-strip`, `.nutri-close-stats`, `.nutri-config-grid` a una columna y `.nutri-meal-row` a 4 pistas con la hora oculta. Lo demás:

| # | Selector | Línea | Problema | Arreglo |
|---|---|---|---|---|
| N1 | `.nutri-page` | 28-29 | `padding: 24px 28px 32px` sin media; no es `.qb-page`, `shell.css` no lo alcanza: 334 px de columna | `14px 12px 24px` |
| N2 | `.nutri-page-head` | 56-64 | sin wrap; en `/nutrition/dashboard` las 4 pestañas de rango (~221 px) dejan ~100 px al título | `flex-wrap`; acciones al 100 % |
| N3 | `.nutri-card-title` | 635-678 | título + subtítulo/meta con `margin-left: auto` sin wrap: se comprimen en 2–4 renglones cada uno | wrap; sub/meta al 100 % |
| N4 | `.nutri-close-day` / `.nutri-reward-card` | 1535-1540, 1593 | `1fr auto` con `min-width: 170px` en la columna auto: la izquierda queda en 112 px | `1fr`; `min-width: 0` |
| N5 | `.nutri-meal-row--edit` | 1155-1158 | 5 pistas (`32 1fr 72 auto auto`) sin breakpoint; la regla de 480 px con 4 pistas manda el 5.º hijo a una columna implícita | 3 pistas; botones con `grid-column: span 1` |
| N6 | `.nutri-meal-row` (≤480) | 2730-2732 | `32px 1fr auto minmax(100px,auto)` deja ~72 px al nombre | `32px 1fr auto`; acciones al 2.º renglón |
| N7 | `.nutri-field.span-2` | 1850 | en la grilla de 1 columna crea una pista implícita: la fila puede exceder 298 px | `grid-column: auto` en ≤480 |
| N8 | `.nutri-meal-schedule-row` | 2469-2534 | sin wrap: 18+16+80+90+8+90+gaps ≈ 342 px | wrap; horas al 100 % |
| N9 | `.nutri-popup` / `.nutri-popup-overlay` | 1712-1732 | sin `max-height` ni scroll; el popup de cerrar el día supera 844 px y el tope queda fuera de pantalla | `max-height: 88vh; overflow-y: auto`; overlay arriba |
| N10 | `.nutri-event-band-row` | 3097-3101 | dos campos de 157 px + gap en 295 | wrap |
| N11 | `.nutri-goal-opt` | 2120-2126 | `SUPERÁVIT` + icono ≈ 121 px en celdas de 96 | padding/tracking |
| N12 | `.nutri-macro-targets-foot`, `.nutri-input-mode-row` | 591-597, 3012-3017 | sin wrap | wrap |
| N13 | `FoodLogItem.tsx:284` | — | `whiteSpace: 'nowrap'` en «¿Eliminar esta entrada?» + 2 botones = 324 px en 290 | quitar el nowrap |
| N14 | `.nutri-food-action svg`, `.nutri-breakdown-toggle`, `.nutri-est-remove` | 1274-1280, 1360-1367, 1072-1079 | `opacity: 0.6/0.5` hasta hover | `hover: none`: 1 |
| N15 | `.nutri-day-btn`, `.nutri-food-action`, `--nutri-control-h` | 261-263, 1260-1262, 124 | 28 / 30 / 36 px; `--nutri-control-h` nunca se define | 40 px; `--nutri-control-h: 44px` |

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-nutrify.browser.test.tsx
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

// Mismo seam que audit-nutri-screens: la callable de Firebase no corre en el browser.
vi.mock('../../../src/modules/nutrition/estimate-service', () => ({
  estimateNutrition: async () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, items: [] }),
}));

import Today from '@modules/nutrition/components/Today';
import NutritionCharts from '@modules/nutrition/components/NutritionCharts';
import NutritionSettings from '@modules/nutrition/components/NutritionSettings';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { NUTRITION_API } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/nutrition/styles/nutri.css';

beforeAll(() => {
  installApi(NUTRITION_API);
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Nutrify a 390×844', () => {
  test('Today: comidas, evento y macros (N1, N6)', async () => {
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    await shoot('nutrify-01-today');
    noOverflow('NUTRI TODAY');
    const pageEl = document.querySelector('.nutri-page') as HTMLElement;
    expect(parseFloat(getComputedStyle(pageEl).paddingLeft)).toBeLessThanOrEqual(12);
    for (const row of document.querySelectorAll<HTMLElement>('.nutri-meal-row')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    // N6: el nombre de la comida tiene renglón de verdad.
    const name = document.querySelector('.nutri-meal-row .nutri-meal-name') as HTMLElement;
    expect(name.getBoundingClientRect().width).toBeGreaterThan(150);
  });

  test('Crónica: cabecera con pestañas de rango (N2)', async () => {
    await setMobileViewport();
    mountInShell(<NutritionCharts />, '/nutrition/dashboard');
    await settle(700);
    await shoot('nutrify-02-cronica');
    noOverflow('NUTRI CRONICA');
    const title = document.querySelector('.nutri-page-title') as HTMLElement;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(250);
  });

  test('Configuración: objetivo, macros y horarios (N4, N8, N11)', async () => {
    await setMobileViewport();
    mountInShell(<NutritionSettings />, '/nutrition/settings');
    await settle(700);
    await shoot('nutrify-03-config');
    noOverflow('NUTRI CONFIG');
    for (const row of document.querySelectorAll<HTMLElement>('.nutri-meal-schedule-row, .nutri-goal-toggle')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test('el popup de cerrar el día scrollea en vez de salirse (N9)', async () => {
    await setMobileViewport();
    mountInShell(<Today />, '/nutrition');
    await settle(700);
    // Today.tsx:2094-2100: «Cerrar el Día» (o «Confirmar Día» si el día está pendiente).
    await page.getByRole('button', { name: /Cerrar el Día|Confirmar Día/i }).click();
    await settle(300);
    const popup = document.querySelector('.nutri-popup') as HTMLElement;
    expect(popup).not.toBeNull();
    const r = popup.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(getComputedStyle(popup).overflowY).toBe('auto');
    await shoot('nutrify-04-cerrar-dia');
  });
});
```

El botón está deshabilitado con cero comidas (`Today.tsx:2091-2093`); el fixture carga siete, así que abre.

- [ ] **Step 2: Correr y ver qué falla**

Run: `npm run test:visual:mobile -- mobile-nutrify 2>&1 | tail -30`
Expected: fallan Today (padding 28 px; `.nutri-meal-row` desborda), Crónica (título < 250 px) y el popup (`overflowY: visible`). Configuración puede fallar por `.nutri-meal-schedule-row`.

- [ ] **Step 3: JSX — `FoodLogItem.tsx:284` (N13)**

Reemplazar `              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)', whiteSpace: 'nowrap' }}>` por `              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>` y en el `div` de la línea 278-283 agregar `flexWrap: 'wrap',` después de `gap: 8,`.

- [ ] **Step 4: CSS — al final de `nutri.css`**

```css

/* ══════════════════════════════════════════════════════
   MOBILE — 390 px (Fase 3). Ver docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md, Task 15.
   Los bloques de 768/480 px de arriba se conservan; esto los completa.
   ══════════════════════════════════════════════════════ */
/* N1: 28 px de gutter en un teléfono. N15: la variable de alto de control
   que .nutri-btn y .nutri-text-input ya leen y nadie definía. */
[data-shell="mobile"] .nutri-page,
[data-shell="mobile"] .nutri-popup-overlay {
  --nutri-control-h: 44px;
}

[data-shell="mobile"] .nutri-page {
  padding: 14px 12px 24px;
}

/* N2 */
[data-shell="mobile"] .nutri-page-head {
  flex-wrap: wrap;
}

[data-shell="mobile"] .nutri-head-actions {
  width: 100%;
  justify-content: flex-start;
}

/* N3: el título de tarjeta y su subtítulo/meta ya no se disputan un renglón.
   El padding derecho deja lugar al sello de ayuda absoluto (help-bubble). */
[data-shell="mobile"] .nutri-card-title {
  flex-wrap: wrap;
  padding-right: 28px;
}

[data-shell="mobile"] .nutri-card-subtitle,
[data-shell="mobile"] .nutri-card-meta {
  margin-left: 0;
  margin-right: 0;
  flex-basis: 100%;
}

/* N4 */
[data-shell="mobile"] .nutri-close-day {
  grid-template-columns: 1fr;
}

[data-shell="mobile"] .nutri-reward-card {
  min-width: 0;
}

/* N5 */
[data-shell="mobile"] .nutri-meal-row--edit {
  grid-template-columns: 32px minmax(0, 1fr) 72px;
}

/* Cinco hijos (FoodLogItem.tsx:160-186: ícono, dos inputs, dos botones): cada
   botón baja a su propio renglón, a lo ancho, sin caer en la pista de 32 px. */
[data-shell="mobile"] .nutri-meal-row--edit > .nutri-btn {
  grid-column: 2 / -1;
  justify-self: start;
}

/* N8 */
[data-shell="mobile"] .nutri-meal-schedule-row {
  flex-wrap: wrap;
}

[data-shell="mobile"] .nutri-meal-schedule-times {
  flex-basis: 100%;
  padding-left: 44px;
}

/* N9: el popup de cerrar el día mide más que la pantalla. */
[data-shell="mobile"] .nutri-popup-overlay {
  place-items: start center;
  padding: 16px 0;
}

[data-shell="mobile"] .nutri-popup {
  max-height: 88vh;
  overflow-y: auto;
  padding: 18px 16px;
}

/* N10 */
[data-shell="mobile"] .nutri-event-band-row {
  flex-wrap: wrap;
}

[data-shell="mobile"] .nutri-event-band-row .nutri-popup-field {
  flex: 1 1 100%;
  justify-content: space-between;
}

/* N11 */
[data-shell="mobile"] .nutri-goal-opt {
  padding: 8px 4px;
  letter-spacing: 0.02em;
  gap: 4px;
}

/* N12 */
[data-shell="mobile"] .nutri-macro-targets-foot,
[data-shell="mobile"] .nutri-input-mode-row {
  flex-wrap: wrap;
}

/* N15 */
[data-shell="mobile"] .nutri-day-btn {
  width: 40px;
  height: 40px;
}

[data-shell="mobile"] .nutri-food-action {
  min-width: 40px;
  min-height: 40px;
}

/* N7: un span-2 en una grilla de una columna abre una pista implícita. */
[data-shell="mobile"] .nutri-field.span-2 {
  grid-column: auto;
}

/* N6: con 4 pistas el nombre quedaba en ~72 px; las acciones bajan al
   segundo renglón. */
[data-shell="mobile"] .nutri-meal-row:not(.nutri-meal-row--edit) {
  grid-template-columns: 32px minmax(0, 1fr) auto;
}

[data-shell="mobile"] .nutri-meal-row:not(.nutri-meal-row--edit) .nutri-meal-del {
  grid-column: 2 / -1;
  justify-content: flex-start;
}

@media (hover: none) {
  /* N14: iconos a media opacidad hasta el hover que en touch no llega. */
  .nutri-food-action svg,
  .nutri-breakdown-toggle,
  .nutri-est-remove {
    opacity: 1;
  }

  /* Android deja el :hover pegado al último toque. */
  .nutri-meal-row:hover,
  .nutri-suggest-opt:hover {
    background: transparent;
  }
}
```

Celdas de la fila de comida, verificadas en `FoodLogItem.tsx`: `.nutri-meal-ico` (160), `.nutri-meal-name` (237), `.nutri-meal-time` (265), `.nutri-meal-kcal` (266), `.nutri-meal-del` (297).

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:visual:mobile -- mobile-nutrify 2>&1 | tail -8`
Expected: `Tests  4 passed (4)`.

Run: `npm run test:visual -- nutrify audit-nutri 2>&1 | tail -4`
Expected: los 9 archivos de Nutrify de escritorio siguen pasando (`8 nutrify-*` + `audit-nutri-screens`).

- [ ] **Step 6: Commit**

```bash
git add tests/visual/mobile/mobile-nutrify.browser.test.tsx src/modules/nutrition/styles/nutri.css src/modules/nutrition/components/FoodLogItem.tsx
git commit -m "fix(nutrition): Nutrify entra en 390 px; filas de comida, popups y configuración"
```

### Task 16: Cauldron a 390 px (página y temporizador flotante)

**Files:**
- Test: `tests/visual/mobile/mobile-cauldron.browser.test.tsx`
- Modify: `src/modules/cauldron/styles/cauldron.css` (un bloque al final)

`cauldron.css:1348-1361` (`max-width: 1100px`) ya apila `.cauldron-timer-hero` y deja `.cauldron-stats-grid` en 2 columnas. La query `@media (max-height: 780px)` (1370-1384) —la que achica el caldero a 200 px y el reloj a 44 px para que «Iniciar Poción» quede sobre el pliegue— **no dispara en 844 px de alto**: la pantalla del teléfono repite el problema documentado en 1365-1369. `cauldron-window.css` es la ventana PiP de Electron: no se toca.

| # | Selector | Línea | Problema | Arreglo |
|---|---|---|---|---|
| K1 | `.cauldron-stage`, `.cauldron-svg`, `.cauldron-time-remaining` | 1370-1384 | 324 px de caldero + 64 px de reloj + acciones ≈ 532 px más el header: el botón de inicio queda ~200 px bajo el pliegue | las mismas tres reglas de la query de 780 px de alto, bajo el prefijo mobile |
| K2 | `.cauldron-floating-timer` | 726-746 | `right: 20px; bottom: 20px`, sin `max-width` ni wrap; con misión y 5 botones mide 448 px; con auto-start 480: se sale 60–110 px por la izquierda | `left/right: 8px`; wrap |
| K3 | `.cauldron-ft-btn` | 805-817 | 24 px de lado, cinco o seis seguidos | 40 px en touch (con el wrap de K2, 6×40 = 240 px entran) |
| K4 | `.cauldron-stats-grid` | 379-383, 1353 | 2 columnas de 177 px; `COMPLETADAS HOY` con `letter-spacing: .2em` no entra | `1fr` |
| K5 | `.cauldron-form-grid` | 604-608 | `1fr 1fr` dentro del modal de 358 px: 145 px por campo, los rótulos envuelven | `1fr` |
| K6 | `.cauldron-mission-popover` | 1133-1157 | `max-width: 320px` anclado al centro puede recortarse; lista de 300 px | ancho al viewport; lista `45vh` |
| K7 | `.cauldron-resume-text` | 1462-1468 | `min-width: 200px` fuerza la fila a envolver de forma irregular | `min-width: 100%` |
| K8 | `.cauldron-jar:hover`, `.cauldron-jar--broken:hover` | 1264-1275 | el estado solo cambia en hover | `hover: none`: sin transform, roto al 0.75 |
| K9 | `.cauldron-edit-btn`, `.cauldron-collapse-toggle` | 107-117, 998-1013 (y 1477) | 26 / 28 px | 40 px en touch |

- [ ] **Step 1: Escribir el test**

```tsx
// tests/visual/mobile/mobile-cauldron.browser.test.tsx
import { beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import CauldronPage from '@modules/cauldron/components/CauldronPage';
import CauldronFloatingTimer from '@modules/cauldron/components/CauldronFloatingTimer';
import { installApi, mountInShell, setMobileViewport, settle, shoot, docOverflowX, mainOverflowX, overflowingNodes } from './mobile-harness';
import { cauldronApi, CAULDRON_RUNNING } from './fixtures';

import '../../../src/i18n';
import '../../../src/hub/styles/theme.css';
import '../../../src/hub/styles/components.css';
import '../../../src/hub/styles/layout.css';
import '../../../src/hub/styles/shell.css';
import '../../../src/shared/components/codex/codex.css';
import '../../../src/shared/components/charts/charts.css';
import '../../../src/shared/styles/help-bubble.css';
import '../../../src/shared/styles/notifications.css';
import '../../../src/modules/cauldron/styles/cauldron.css';

beforeEach(() => {
  localStorage.clear();
});

function noOverflow(tag: string) {
  const main = document.querySelector('.main-content')!;
  // eslint-disable-next-line no-console
  console.log(tag, JSON.stringify({ doc: docOverflowX(), main: mainOverflowX(), nodes: overflowingNodes(main).slice(0, 12) }, null, 1));
  expect(docOverflowX()).toBeLessThanOrEqual(0);
  expect(mainOverflowX()).toBeLessThanOrEqual(1);
}

describe('Caldero a 390×844', () => {
  test('en reposo: el botón de inicio queda a la vista sin scrollear (K1)', async () => {
    await setMobileViewport();
    installApi(cauldronApi());
    mountInShell(<CauldronPage />, '/cauldron');
    await settle(800);
    await shoot('cauldron-01-reposo');
    noOverflow('CAULDRON IDLE');
    const svg = document.querySelector('.cauldron-svg') as HTMLElement;
    expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(200);
    const start = document.querySelector('.cauldron-stage-actions button') as HTMLElement;
    expect(start.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    // K4: una cartela por renglón.
    const stats = document.querySelector('.cauldron-stats-grid') as HTMLElement;
    expect(getComputedStyle(stats).gridTemplateColumns.split(' ').length).toBe(1);
  });

  test('corriendo con misión: la página y el temporizador flotante entran (K2)', async () => {
    await setMobileViewport();
    installApi(cauldronApi(CAULDRON_RUNNING));
    mountInShell(<><CauldronPage /><CauldronFloatingTimer /></>, '/cauldron');
    await settle(800);
    await shoot('cauldron-02-corriendo');
    noOverflow('CAULDRON RUNNING');
    const ft = document.querySelector('.cauldron-floating-timer') as HTMLElement | null;
    if (ft) {
      const r = ft.getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(window.innerWidth);
      expect(ft.scrollWidth).toBeLessThanOrEqual(ft.clientWidth + 1);
    }
  });

  test('el editor de recetas es de una columna (K5)', async () => {
    await setMobileViewport();
    installApi(cauldronApi());
    mountInShell(<CauldronPage />, '/cauldron');
    await settle(800);
    // CauldronPage.tsx:786-788: «+ Crear Receta» abre el editor vacío (.cauldron-modal con .cauldron-form-grid).
    await page.getByRole('button', { name: /Crear Receta/i }).click();
    await settle(300);
    const grid = document.querySelector('.cauldron-form-grid') as HTMLElement | null;
    expect(grid).not.toBeNull();
    expect(getComputedStyle(grid!).gridTemplateColumns.split(' ').length).toBe(1);
    const modal = document.querySelector('.cauldron-modal') as HTMLElement;
    expect(modal.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });
});
```

`CauldronFloatingTimer` en la app vive fuera del shell (`Layout.tsx`, después del `<Shell>`); acá se monta dentro para que el test lo vea, es `position: fixed` y da igual.

- [ ] **Step 2: Correr y ver qué falla**

Run: `npm run test:visual:mobile -- mobile-cauldron 2>&1 | tail -30`
Expected: fallan reposo (caldero de 324 px, stats en 2 columnas, botón bajo el pliegue), corriendo (`.cauldron-floating-timer` con `left < 0`) y el editor (2 columnas).

- [ ] **Step 3: CSS — al final de `cauldron.css`** (K1 repite las tres reglas de la query `max-height: 780px` de la línea 1370 bajo el prefijo mobile en vez de tocar esa query: una ventana de Electron alta y angosta —750×900— no tiene por qué cambiar)

```css

/* ══════════════════════════════════════════════════════
   MOBILE — 390 px (Fase 3). Ver docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md, Task 16.
   ══════════════════════════════════════════════════════ */
/* K4: dos cartelas de 177 px no sostienen «COMPLETADAS HOY» a .2em. */
/* K1: las mismas tres reglas de @media (max-height: 780px) (línea ~1370):
   en un teléfono la sala está igual de apretada aunque mida 844 px de alto. */
[data-shell="mobile"] .cauldron-stage {
  min-height: 0;
  padding: 12px;
}

[data-shell="mobile"] .cauldron-svg {
  width: min(100%, 200px);
}

[data-shell="mobile"] .cauldron-time-remaining {
  font-size: calc(44px * var(--font-scale));
  margin: 4px 0;
}

[data-shell="mobile"] .cauldron-stats-grid {
  grid-template-columns: 1fr;
}

/* K5: dentro del modal de 358 px cada campo tenía 145. */
[data-shell="mobile"] .cauldron-form-grid {
  grid-template-columns: 1fr;
}

/* K6 */
[data-shell="mobile"] .cauldron-mission-popover {
  min-width: 0;
  width: calc(100vw - 24px);
  max-width: none;
  left: 12px !important;   /* el componente lo posiciona inline */
}

[data-shell="mobile"] .cauldron-mission-list {
  max-height: 45vh;
}

/* K7 */
[data-shell="mobile"] .cauldron-resume-text {
  min-width: 100%;
}

/* K2: el chip flotante medía 448 px con misión (480 con auto-start) anclado
   a la derecha de una pantalla de 390. Se estira de lado a lado y envuelve;
   el bottom con safe area lo pone layout.css ([data-shell="mobile"]). */
[data-shell="mobile"] .cauldron-floating-timer {
  left: 8px;
  right: 8px;
  bottom: 8px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px;
}

[data-shell="mobile"] .cauldron-ft-mission {
  max-width: 10ch;
}

[data-shell="mobile"] .cauldron-ft-controls {
  margin-left: auto;
}

@media (hover: none) {
  /* K3, K9 */
  .cauldron-ft-btn,
  .cauldron-edit-btn,
  .cauldron-collapse-toggle {
    min-width: 40px;
    min-height: 40px;
  }

  .cauldron-ft-btn {
    width: 40px;
    height: 40px;
  }

  /* K8: un frasco es un botón sin rótulo; que no dependa del hover. */
  .cauldron-jar {
    transform: none;
  }

  .cauldron-jar--broken {
    opacity: 0.75;
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm run test:visual:mobile -- mobile-cauldron 2>&1 | tail -8`
Expected: `Tests  3 passed (3)`. En `cauldron-01-reposo-a.png` el caldero de 200 px, el reloj a 44 px y «Iniciar Poción» visible sin scroll.

Run: `npm run test:visual -- audit-coin-cauldron 2>&1 | tail -4`
Expected: `1 passed` — la query de 780 px de alto no se tocó.

- [ ] **Step 5: Commit**

```bash
git add tests/visual/mobile/mobile-cauldron.browser.test.tsx src/modules/cauldron/styles/cauldron.css
git commit -m "fix(cauldron): el Caldero entra en 390 px; el temporizador flotante no se sale de la pantalla"
```


## Chunk 6: Emulador, documentación y cierre

### Task 17: Smoke en el emulador — drawer, botón atrás, barras, safe areas

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md` (sección «Resultado del smoke» al final)

Los criterios de la spec §11 fila 3 que solo se ven en el dispositivo: el drawer abre/cierra con el dedo, el botón atrás cierra el drawer y después navega, la barra de estado tiene iconos claros sobre cuero y nada queda debajo de las barras.

- [ ] **Step 1: Build, sync, instalar**

En una shell con el «Entorno» exportado:

```bash
npm run mobile:apk 2>&1 | tail -5
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" logcat -c
"$ADB" shell am start -n com.hubtify.app/.MainActivity
```
Expected: `BUILD SUCCESSFUL`, `Success`, `Starting: Intent { cmp=com.hubtify.app/.MainActivity }`.

- [ ] **Step 2: Barra de estado y safe areas**

Primero, qué camino toca (desvío 1):

Run: `"$ADB" shell dumpsys package com.google.android.webview | rg versionName | head -1`
Expected: `versionName=<major>.…`. Anotar el major: **< 140 → camino (b)**, **≥ 140 → camino (a)**.

Con la app abierta y logueada (cuenta de prueba de la Fase 2):

1. La barra de estado del sistema muestra hora/batería en **claro** sobre cuero; la cabecera de la app está pegada a la barra, sin franja blanca ni negra entre ambas. (En el camino (b) la franja de la barra es el `windowBackground` de `styles.xml`; si se ve blanca, el Step 3 de la Task 9 no llegó al APK: `npm run mobile:sync` de nuevo.)
2. `chrome://inspect` en Chrome de escritorio → WebView de `com.hubtify.app` → consola:

```js
getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')
getComputedStyle(document.querySelector('.mobile-header')).paddingTop
document.documentElement.dataset.shell
```
Expected: camino (a): un valor en px > 0 (p. ej. `24px`) y el mismo valor como `paddingTop`; camino (b): `0px` y `0px` (el WebView ya no está debajo de la barra). En los dos, `"mobile"`. Si la variable está VACÍA (no `0px`), el plugin no inyectó nada: `plugins.SystemBars.insetsHandling` no es `'css'` o `cap sync` no copió el `capacitor.config.json` nuevo (repetir `npm run mobile:sync`).

3. Abrir el centro de notificaciones (campana) y el Cierre del Códice (sellar el día): ninguno de los dos empieza debajo de la barra de estado.

- [ ] **Step 3: Drawer**

1. Tocar la hamburguesa → el drawer entra desde la izquierda con la scrim detrás; se ve la ficha del jugador, VIGOR/XP/RACHA y los siete ítems.
2. Tocar fuera (la scrim) → se cierra.
3. Abrir de nuevo y tocar «Questify» → se cierra y la cabecera dice «Questify».

- [ ] **Step 4: Botón atrás (el criterio de la spec)**

1. En Questify, abrir el drawer y tocar el botón atrás del sistema → **el drawer se cierra y la app sigue en Questify**.
2. Tocar atrás otra vez → vuelve a la Tabla del Aventurero (`history.back()`).
3. En la Tabla, tocar atrás → la app se minimiza (`App.minimizeApp()`), no se cierra: al volver desde recientes sigue logueada y en la Tabla.
4. Abrir el centro de notificaciones y tocar atrás → se cierra y la ruta no cambia.

Run: `"$ADB" logcat -d | rg -i "native shell|Uncaught" | head`
Expected: ninguna línea (el `catch` de `MobileShell` solo loguea si `bindNativeShell` falló).

- [ ] **Step 5: Sin desborde horizontal, con datos reales**

En cada página (Tabla, Questify, Nutrify, Coinify y su libro mayor, Caldero, Personaje, Logros, Recompensas, Ajustes), en la consola de `chrome://inspect`:

```js
document.documentElement.scrollWidth <= window.innerWidth
```
Expected: `true` en las nueve. Si alguna da `false`, `document.querySelectorAll('*')` con el filtro de `overflowingNodes` de `tests/visual/audit-hub-harness.tsx:156` dice qué nodo es; agregar la regla al bloque mobile de esa hoja y volver a este paso.

- [ ] **Step 6: Anotar y commitear**

Completar la sección «Resultado del smoke» al final de este plan con: fecha, versión de Android del AVD (`"$ADB" shell getprop ro.build.version.release`), versión del WebView y el camino (a)/(b) del Step 2, el valor de `--safe-area-inset-top`, y el resultado de los pasos 3–5 (OK / qué falló y cómo se arregló).

```bash
git add docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md
git commit -m "docs(mobile): resultado del smoke del shell en el emulador"
```

### Task 18: Documentación y cierre de la fase

**Files:**
- Modify: `DESIGN_SYSTEM.md` (sección «Responsive Breakpoints», líneas ~745-753)
- Modify: `tests/visual/README.md`

- [ ] **Step 1: `DESIGN_SYSTEM.md` — la tabla de breakpoints dice la verdad**

Reemplazar la tabla de «Responsive Breakpoints» (desde `| Breakpoint | Changes |` hasta la fila `| `< 500px` | Finance narrow mode |`) por:

```markdown
| Breakpoint | Changes |
|------------|---------|
| `> 900px` | Full layout — sidebar 260px, 2-col grids |
| `700px–900px` | Sidebar 220px, reduced nav padding (`layout.css`) |
| `< 880px` | Dashboard grids single column (`components.css`, `dashboard-layouts.css`), character sheet single column (`character.css`) |
| `< 780px` | Coinify compact ledger, page padding 14/12 (`coinify.css`, `shell.css`) |
| `< 480px` | Nutrify meal rows drop the time column (`nutri.css`, desktop-era rule; never reached by the window) |
| `html[data-shell="mobile"]` | **Mobile (Android, 390px) — not a width breakpoint:** `MobileShell` sets the attribute; transversal rules in `layout.css` (`.qb-page` padding 12, `.qb-header` wraps, `.page-header__actions` static, `.qb-corner` hidden) plus one `[data-shell="mobile"] …` block at the end of each module sheet (`quests.css`, `coinify.css`, `nutri.css`, `cauldron.css`, `character.css`, `codex-seal.css`) |
| `(hover: none)` | Touch: anything revealed only on hover is shown (`.widget-controls`, `.coin-budget-pencil`, quest postpone, nutri row icons); tap targets grow to 40–44px |

The desktop window never goes below 700px (`electron/main.ts` minWidth) and the
desktop visual tests go down to 420px, so mobile rules are keyed on
`html[data-shell="mobile"]` (set by `src/hub/MobileShell.tsx`) rather than on a
width, and verified by `npm run test:visual:mobile` at 390×844 with touch emulated.

### Shell tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--shell-top` | `32px` (desktop) / `0px` (`html[data-shell="mobile"]`) | Where the fixed sidebar starts |
| `--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left` | Capacitor-injected `--safe-area-inset-*`, else `env(safe-area-inset-*)`, else `0px` | Status bar / gesture bar insets on Android; `.mobile-header`, `.mobile-drawer`, every fixed overlay |
```

Y en la sección «Page Structure» (líneas ~155-167) agregar debajo del árbol existente:

```markdown
Mobile (Android, `useShellKind() === 'mobile'`):

```
.shell-frame (100dvh, flex column)
├── .mobile-header (56px + --safe-top: hamburger, section title, bell)
└── .app-layout--mobile
    └── .main-content (100% width, scrolls, padding-bottom --safe-bottom)
.mobile-scrim + .mobile-drawer (fixed, min(300px, 85vw)) → <Sidebar collapsed={false}>
```
```

- [ ] **Step 2: `tests/visual/README.md` — el arnés mobile**

Agregar después de la sección «A. Component visual tests» (antes de «## B. End-to-end Electron»):

```markdown
### A2. Mobile (Android shell)

`npm run test:visual:mobile` runs the `browser-mobile` project: same Chromium,
viewport **390×844**, and `__HUBTIFY_PLATFORM__ = "android"` so `isNativeMobile()`
is true without Capacitor and `Layout` mounts `MobileShell`. Tests live in
`tests/visual/mobile/` and mount each page **inside the real shell** via
`mountInShell()` (`mobile-harness.tsx`); stubs come from `fixtures.ts`.
Every page test asserts `document.documentElement.scrollWidth <= innerWidth`.
Screenshots land in `tests/visual/__screenshots__/mobile/` (gitignored).

The desktop tests pin their own viewport with `page.viewport(...)`, which is why
they are not reused here.
```

- [ ] **Step 3: La spec deja de contradecir al código**

En `docs/superpowers/specs/2026-09-01-mobile-android-design.md` §7, reemplazar cuatro viñetas. La viñeta

```markdown
- **StatusBar**: `@capacitor/status-bar` `setStyle(Dark)`, `setBackgroundColor(--leather-dark)`, `setOverlaysWebView(false)`.
```

por:

```markdown
- **StatusBar**: iconos claros vía el plugin core `SystemBars` de Capacitor 8 (`plugins.SystemBars.style: 'DARK'` en `capacitor.config.ts`; `plugins.StatusBar` igual). Con targetSdk 36 `setBackgroundColor`/`setOverlaysWebView` no hacen nada: el color lo pinta `.mobile-header` con `--safe-top` (WebView ≥ 140, edge-to-edge) o el `windowBackground` de `styles.xml` (WebView < 140). Ver plan Fase 3, desvíos 1–2.
```

la viñeta

```markdown
- **Sin TitleBar**: `Layout.tsx` renderiza `<TitleBar/>` solo si `!isNativeMobile()`. `.sidebar { top: 32px }` pasa a `top: var(--shell-top, 32px)`; mobile setea `--shell-top: 0`.
```

por:

```markdown
- **Sin TitleBar**: `TitleBar` devuelve `null` con `isNativeMobile()` (cubre Layout, AuthPage y Onboarding); `Layout.tsx` elige `DesktopShell`/`MobileShell` con `useShellKind()`. `.sidebar { top: 32px }` pasa a `top: var(--shell-top, 32px)`; `<html data-shell="mobile">` setea `--shell-top: 0`.
```

la viñeta

```markdown
- **Safe areas**: `viewport-fit=cover`; `env(safe-area-inset-*)` en header, drawer y modales.
```

por:

```markdown
- **Safe areas**: `viewport-fit=cover` en el `index.html` compartido; tokens `--safe-top/right/bottom/left` en `theme.css` = `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))` (las variables las inyecta el plugin `SystemBars`), usados en header, drawer, overlays y capas fijas.
```

y

```markdown
- **Arnés visual**: project vitest `browser-mobile` (mismos tests `tests/visual/**`, viewport 390×844, `define __HUBTIFY_PLATFORM__:'"android"'`), screenshots en `tests/visual/__screenshots__/mobile/`.
```

por:

```markdown
- **Arnés visual**: project vitest `browser-mobile` (`tests/visual/mobile/**`, viewport 390×844 con touch emulado, `define __HUBTIFY_PLATFORM__:'"android"'`; los tests de escritorio fijan su propio viewport y no se reusan), cada página montada dentro de `MobileShell`, screenshots en `tests/visual/__screenshots__/mobile/`. Las reglas CSS mobile llevan el prefijo `[data-shell="mobile"]`, no un `@media` de ancho (Electron baja a 700 px).
```

- [ ] **Step 4: Verificación final completa**

Run: `npx tsc --noEmit && npx tsc -p shared-logic --noEmit && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -4`
Expected: sin errores; `Test Files  N+2 passed`, `Tests  M+6 passed` (N y M de la Task 1).

Run: `npm run test:visual 2>&1 | tail -4 && npm run test:visual:mobile 2>&1 | tail -4`
Expected: `Test Files  30 passed (30)` (los mismos de la línea base: cero cambios en escritorio) y `Test Files  6 passed (6)` con `Tests  24 passed (24)` (shell 6, hub 4, quests 3, coinify 4, nutrify 4, cauldron 3).

Run: `npm run mobile:build 2>&1 | tail -2 && ls tests/visual/__screenshots__/mobile | wc -l`
Expected: `✓ built` y ≥ 20 PNG.

- [ ] **Step 5: Checklist de aceptación (spec §11, fila 3)**

- [ ] `MobileShell` con drawer que reusa `<Sidebar>`; sin `TitleBar` (`--shell-top: 0`)
- [ ] Barra de estado con iconos claros sobre cuero; safe areas en cabecera, drawer y modales (`--safe-*`)
- [ ] Botón atrás: cierra drawer/modal → `history.back()` → `minimizeApp()` (Task 17 Step 4)
- [ ] Project `browser-mobile` verde con screenshots 390×844 de Dashboard, Questify, Coinify, Nutrify, Cauldron (más Personaje/Logros/Recompensas)
- [ ] Ninguna página desborda a lo ancho: `document.documentElement.scrollWidth <= innerWidth` en el arnés y en el emulador
- [ ] `npm run test:visual` de escritorio: mismos archivos, mismos resultados que la línea base
- [ ] `npm test`, `tsc` (raíz y `shared-logic`) y lint verdes

- [ ] **Step 6: Commit y estado de la rama**

```bash
git add DESIGN_SYSTEM.md tests/visual/README.md docs/superpowers/specs/2026-09-01-mobile-android-design.md
git commit -m "docs(mobile): breakpoints reales, tokens del shell y arnés browser-mobile"
git log --oneline master..feature/mobile | head -30 && git status --short
```
Expected: los commits de este plan (Tasks 2–18) encima de los de las Fases 1 y 2, y el working tree limpio.

---

## Resultado del smoke (se completa en Task 17 Step 6)

_pendiente_

Formato: `YYYY-MM-DD — Android <release> — WebView <versionName> (camino a|b) — --safe-area-inset-top: <px> — drawer OK | atrás: drawer/historial/minimizar OK | desborde: 9/9 OK` (o qué falló y el commit que lo arregló).
