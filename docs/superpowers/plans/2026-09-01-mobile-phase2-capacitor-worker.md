# Hubtify Mobile — Fase 2: Capacitor, worker y sqlite-wasm — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Hubtify arranque como app Android (Capacitor 8.5) con un Dedicated Worker que corre la misma lógica de negocio de `shared-logic/` sobre SQLite WASM durable (`opfs-sahpool`), y que una tarea creada en Questify sobreviva a matar y reabrir la app en el emulador.

**Architecture:** El renderer React no cambia: `window.api` se construye con el mismo generador que el preload (`shared/build-api.ts`) pero sobre un `Transport` que habla `postMessage` con `src/mobile/worker.ts`. El worker instala el VFS `opfs-sahpool`, registra los handlers de `shared-logic` con `registerAllHandlers()`, inyecta un `SqlDatabase` implementado sobre `sqlite3.oo1.DB` (`src/mobile/db/wasm-database.ts`) y un `PlatformPort` proxy hacia el hilo UI. El ciclo de vida (suspend/resume) cierra la DB y pausa el VFS cuando la app pasa a segundo plano; los fallos antes de `ready` renderizan `FatalScreen`.

**Tech Stack:** Capacitor 8.5.1 (`core`, `cli`, `android`, plugins `app` 8.1.1, `device` 8.0.3, `status-bar` 8.0.3), `@sqlite.org/sqlite-wasm` 3.53.0-build1, Vite 5 (`vite.mobile.config.ts`), Vitest 4 (project `unit`), Gradle/AGP del template de Capacitor, JDK 21 Temurin, Android SDK en `D:\android-sdk`.

**Spec (fuente de verdad):** `docs/superpowers/specs/2026-09-01-mobile-android-design.md` (§3.1, §3.2, §3.4, §3.5, §4, §5, §6, §10, §11 fila «2. Capacitor + worker»).

**Rama:** `feature/mobile`. Cada tarea termina en un commit `type(scope): descripción` sin líneas de atribución.

---

## Supuestos sobre la Fase 1 (la implementa OTRO plan en paralelo)

Este plan **asume que la Fase 1 ya está mergeada en `feature/mobile`** exactamente como la describe la spec. No la reimplementa. Los nombres y paths que usa son los de la spec; la Tarea 1 los verifica con `rg` antes de tocar nada. Si algún nombre difiere, se adapta el import en el archivo que lo usa (todos están listados en la tabla) — NO se cambia la Fase 1 desde este plan.

| Import que usa este plan | Símbolos asumidos | Referencia en la spec |
|---|---|---|
| `@logic/registry` (alias de `shared-logic/registry.ts`) | `registerAllHandlers()`, `getHandler(ch)`, `runSuspend()`, `runResume()`, `registerLifecycle({suspend, resume})`, tipo `Handler = (event: {}, ...args: any[]) => unknown \| Promise<unknown>` | §3.2 |
| `@logic/db` (`shared-logic/db/index.ts`) | `getDb()`, `setDbFactory(fn: () => SqlDatabase)`, `closeDb()`, `runAllModuleMigrations()`, tipos `SqlDatabase`, `SqlStatement<Row>`, `RunResult` | §3.3, §3.4 |
| `@logic/platform` | `setPlatform(port)`, tipos `PlatformPort`, `FileFilter` | §6 |
| `@logic/events` | `setEventSink((channel: string, payload: unknown) => void)` | §3.3 |
| `@logic/modules/cauldron.ipc` | `registerCauldronIpcHandlers()` (mismo basename que `electron/modules/cauldron.ipc.ts`) | §3.2 «conservan su nombre» |
| `@logic/modules/notifications.ipc` | `registerNotificationIpcHandlers()`, `startNotificationEngine()`, `stopNotificationEngine()`, `isModuleNotificationEnabled()` | §3.2 |
| `@logic/modules/finance.balance` | `generateRecurringForMonth(db, 'YYYY-MM')` (hoy en `electron/modules/finance.balance.ts:530`) | §11 fila 1 |
| `shared/api-channels.ts` | `API_CHANNELS` (`ChannelSpec { channel, kind, platforms?, unwrap? }`) | §3.1 |
| `shared/build-api.ts` | `buildApi(transport: Transport): HubtifyApi`, tipo `Transport { invoke, send, on, off }` | §3.1 |
| Alias `@logic/*` → `shared-logic/*` | en `tsconfig.json` `paths` y en `vitest.config.ts` `resolve.alias` | §5 |
| `vite.renderer.config.ts` | `define: { __HUBTIFY_PLATFORM__: '"desktop"' }` | §5 |
| `src/global.d.ts` | `declare const __HUBTIFY_PLATFORM__: 'desktop' \| 'android' \| undefined` | §5 |
| `src/shared/platform-detect.ts` | `isNativeMobile(): boolean` | §5 |

**Qué pasa si la Fase 1 NO está todavía:** las Tareas 2–7 (deps, configs, `protocol.ts`, shim WASM, `worker-protocol.ts`, `worker-client.ts`) compilan y se testean sin ella: **no importan nada de `@logic`, ni siquiera tipos** (el shim declara la forma de §3.4 localmente; el chequeo estructural contra `SqlDatabase` ocurre en `worker.ts` al pasar la factory a `setDbFactory`). Las Tareas 8–13 (lifecycle de cauldron/notifications, `worker.ts`, `install-api.ts`, build/APK) SÍ la necesitan. Si al llegar a la Tarea 8 la Fase 1 no está mergeada, parar ahí y avisar.

## Desvíos respecto de la spec (y por qué)

1. **`mobile:apk` genera el APK *debug*** (`assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`). La spec §5 dice `assembleRelease`, pero sin `signingConfigs.release` (Fase 4) `assembleRelease` produce `app-release-unsigned.apk`, que `adb install` rechaza. El criterio de aceptación de esta fase es instalar en el emulador, así que en Fase 2 `mobile:apk` = debug; la Fase 4 agrega `mobile:apk:release`.
2. **`versionName`/`versionCode` los escribe `scripts/android-version.mjs`** en `android/app/build.gradle` (regex sobre `versionCode N` / `versionName "x"`), corrido por `mobile:sync`. La spec §5 propone un bloque Groovy con `node -p`; se prefiere el script porque no depende de que `node` esté en el PATH de Gradle (Android Studio / CI) y deja el diff en git (`versionCode 802` es leíble en el commit del release). **Consecuencia para la Fase 4:** el job `build-android` de §8 corre `mobile:build` → `cap sync` → `gradlew` (no `mobile:sync`), así que `release.yml` y `ci.yml` DEBEN agregar `node scripts/android-version.mjs` antes de `cap sync` (o usar `npm run mobile:sync`); si no, el APK del release sale con la versión del último `mobile:sync` local commiteado.
3. **`appVersion()` y `osInfo()` no viajan por el proxy** `{type:'platform'}`: son métodos **síncronos** de `PlatformPort` (§6) y un round-trip a la UI es asíncrono. La UI los manda una vez en un mensaje `{ type:'init', appVersion, osInfo }` inmediatamente después de crear el worker; el proxy los devuelve desde memoria. Los 7 métodos asíncronos sí van por el proxy.
4. **El log de VFS es `[worker] vfs: opfs-sahpool name=hubtify`**. La spec pide `name: 'hubtify'` en `installOpfsSAHPoolVfs` (§4) y a la vez que se loguee `vfs: opfs-sahpool` (§11). `poolUtil.vfsName` va a ser `hubtify`; el log incluye ambos.
5. **`pragma()` del shim usa `db.exec({ sql, rowMode:'object', resultRows })`** en vez de `selectValue`: devuelve un array de filas-objeto, que es exactamente lo que devuelve `better-sqlite3` (`db.pragma('table_info(x)')` → `Array<{name,...}>`, usado así en 14 tests). `journal_mode` se ignora (sahpool sin WAL, §3.4).
6. **`worker.ts` se parte en dos**: `worker-protocol.ts` (máquina de mensajes pura, testeable en Node con un `post` falso) y `worker.ts` (entry: sqlite-wasm, VFS, bindings). Ídem `install-api.ts` → `worker-client.ts` (transport puro) + `install-api.ts` (Worker real, Capacitor). Es lo que permite los tests de §10 sin OPFS.
7. **Un `fatal` recibido DESPUÉS de `ready`** (p. ej. `unpauseVfs()` falla al reanudar) se trata igual que un crash: rechaza pendientes con `WorkerCrashed` y dispara `mobile:workerCrashed`. La spec solo define `fatal` antes de `ready`; esto cubre el hueco sin inventar un tercer estado.

## Entorno (exportar en CADA shell nueva antes de Gradle/adb)

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="D:/android-sdk"
export ADB="D:/android-sdk/platform-tools/adb.exe"
java -version 2>&1 | head -1     # esperado: openjdk version "21.0.5" ...
"$ADB" devices                   # esperado: emulator-5554   device
```

`JAVA_HOME` del sistema apunta al JDK 24 y el `java` del PATH es el 25: Gradle/AGP del template de Capacitor están validados con 21, por eso el export es obligatorio. `adb` no está en el PATH de Git Bash; se usa siempre `"$ADB"`.

## File structure

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `capacitor.config.ts` | appId/appName/webDir/androidScheme (§5) |
| `vite.mobile.config.ts` | build del renderer para Android → `dist/mobile` (§5) |
| `src/mobile/protocol.ts` | tipos de mensajes UI⇄worker, errores (`MobileFatal`, `WorkerCrashed`), `serializeError`, `collectTransferables` |
| `src/mobile/db/wasm-database.ts` | `WasmDatabase`: `SqlDatabase` sobre `sqlite3.oo1.DB` (LRU 256, transacciones anidadas, normalización de parámetros) |
| `src/mobile/worker-protocol.ts` | `createWorkerProtocol(host)`: despacho de `invoke`/`suspend`/`resume`/`init`/`platform-result`, gate durante suspend |
| `src/mobile/worker.ts` | entry del worker: sqlite-wasm + `opfs-sahpool` con reintentos, `setDbFactory`, `setPlatform`, `setEventSink`, `registerAllHandlers`, migraciones, `ready`/`fatal` |
| `src/mobile/worker-client.ts` | `createWorkerClient(worker, platformHost)`: `Transport` sobre `postMessage`, pendientes, cola durante suspend, `WorkerCrashed` |
| `src/mobile/platform-host.ts` | lado UI del `PlatformPort`: `notify` no-op, `pickPdfText` → `{unsupported:true}`, el resto no-op/`null`/`false` hasta Fase 5; `readOsInfo()` vía `@capacitor/device` |
| `src/mobile/install-api.ts` | crea el Worker, espera `ready`, asigna `window.api`, `appStateChange` → suspend/resume, `pagehide` → terminate |
| `src/mobile/FatalScreen.tsx` + `src/mobile/fatal-screen.css` | pantalla de fallo con tokens del design system |
| `scripts/android-version.mjs` | escribe `versionCode`/`versionName` en `android/app/build.gradle` desde `package.json` |
| `scripts/gradle.mjs` | invoca `gradlew.bat` / `./gradlew` según SO (para `npm run mobile:apk` cross-platform) |
| `android/` | scaffold generado por `npx cap add android`, commiteado |
| `tests/mobile/protocol.test.ts`, `tests/mobile/wasm-database.test.ts`, `tests/mobile/worker-protocol.test.ts`, `tests/mobile/worker-client.test.ts`, `tests/mobile/android-version.test.ts` | tests unitarios (project `unit`) |
| `tests/modules/cauldron/cauldron.suspend.test.ts`, `tests/modules/notifications/notification-lifecycle.test.ts` | `completed_at = targetEndTime` y lifecycle suspend/resume |

**Modificados:**

| Archivo | Cambio |
|---|---|
| `package.json` | deps Capacitor + sqlite-wasm; scripts `mobile:*` |
| `.gitignore` | `android/app/build/`, `android/.gradle/`, `android/local.properties`, `android/keystore.properties`, `android/*.jks`, `dist/mobile/` |
| `src/shared/platform-detect.ts`, `src/global.d.ts` | (creados por Fase 1) se verifica/ajusta el contenido final |
| `src/main.tsx` | `bootstrap()` async: `if (__HUBTIFY_PLATFORM__ === 'android' && isNativeMobile()) await installMobileApi()` antes de `createRoot`; `FatalScreen` si falla |
| `src/App.tsx` | escucha `mobile:workerCrashed` → `FatalScreen reason="crash"` |
| `src/i18n/es.json`, `src/i18n/en.json` | sección `mobile.fatal.*` |
| `shared-logic/modules/cauldron.ipc.ts` | `completed_at = new Date(targetEndTime).toISOString()`; `registerLifecycle` |
| `shared-logic/modules/notifications.ipc.ts` | `registerLifecycle`; guard de doble `startNotificationEngine` |

---

## Chunk 1: Verificación, dependencias, configuración y protocolo

### Task 1: Verificar los supuestos de la Fase 1

**Files:** ninguno (solo lectura).

- [ ] **Step 1: Confirmar rama y estado limpio**

Run: `git branch --show-current && git status --short | head -5`
Expected: `feature/mobile` y ninguna línea de status.

- [ ] **Step 2: Verificar los símbolos de `shared-logic` que usa este plan**

Run:
```bash
rg -n "export function (registerAllHandlers|getHandler|runSuspend|runResume|registerLifecycle)\b" shared-logic/registry.ts
rg -n "export (function|\{|type|interface|\*)" shared-logic/db/index.ts
rg -n "DbSuspended|suspend" shared-logic/db/          # ¿el provider tiene estado de suspensión propio? (ver notas de Task 12)
rg -n "export function (setPlatform|platform)\b|export interface (PlatformPort|FileFilter)" shared-logic/platform.ts
rg -n "export function (setEventSink|emit)\b" shared-logic/events.ts
rg -n "export function (registerCauldronIpcHandlers|registerNotificationIpcHandlers|startNotificationEngine|stopNotificationEngine|generateRecurringForMonth)\b" shared-logic/modules/
rg -n "export (const API_CHANNELS|function buildApi|interface Transport|type Transport)" shared/api-channels.ts shared/build-api.ts
rg -n '"@logic/\*"' tsconfig.json && rg -n "'@logic'" vitest.config.ts
rg -n "__HUBTIFY_PLATFORM__" vite.renderer.config.ts src/global.d.ts src/shared/platform-detect.ts
```
Expected: cada comando imprime al menos una línea con el símbolo buscado. Anotar los que difieran: son los únicos imports que hay que adaptar en las tareas 8–13.

- [ ] **Step 3: Confirmar que la suite base está verde antes de tocar nada**

Run: `npm test 2>&1 | tail -5`
Expected: `Test Files  N passed (N)` y `Tests  M passed (M)` (sin `failed`). Anotar N y M: al final de este plan deben ser N+7 archivos y M+69 tests.

No hay commit en esta tarea.

### Task 2: Dependencias

**Files:**
- Modify: `package.json` (`dependencies`, `devDependencies`)

- [ ] **Step 1: Instalar runtime deps con versión exacta**

Run:
```bash
npm install --save-exact @capacitor/core@8.5.1 @capacitor/android@8.5.1 @capacitor/app@8.1.1 @capacitor/device@8.0.3 @capacitor/status-bar@8.0.3 @sqlite.org/sqlite-wasm@3.53.0-build1
```
Expected: termina con `added K packages` sin `ERR!`. (Versiones verificadas con `npm view` el 2026-09-01: `@capacitor/core|cli|android` 8.5.1, `@capacitor/app` 8.1.1, `@capacitor/device` 8.0.3, `@capacitor/status-bar` 8.0.3, `@sqlite.org/sqlite-wasm` 3.53.0-build1.)

- [ ] **Step 2: Instalar la CLI como devDependency**

Run: `npm install --save-dev --save-exact @capacitor/cli@8.5.1`
Expected: `added K packages`.

- [ ] **Step 3: Verificar el mapa `exports` de sqlite-wasm (lo que este plan asume)**

Run: `node -p "JSON.stringify(require('./node_modules/@sqlite.org/sqlite-wasm/package.json').exports, null, 1)"`
Expected:
```
{
 ".": { "types": "./dist/index.d.mts", "node": "./dist/node.mjs", "import": "./dist/index.mjs", "main": "./dist/index.mjs", "browser": "./dist/index.mjs" },
 "./package.json": "./package.json",
 "./sqlite3.wasm": "./dist/sqlite3.wasm"
}
```
La condición `node` (vitest) resuelve `dist/node.mjs`, que carga el `.wasm` con `fs.readFileSync` y funciona sin globals de browser; `import`/`browser` (worker en Vite) resuelven `dist/index.mjs`.

- [ ] **Step 4: Confirmar que la suite sigue verde (better-sqlite3 no se rompió con el install)**

Run: `npm test 2>&1 | tail -3`
Expected: mismos N/M que en Task 1. Si aparece `NODE_MODULE_VERSION` mismatch: `npm run rebuild` y repetir.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(mobile): dependencias de capacitor 8.5 y sqlite-wasm 3.53"
```

### Task 3: `capacitor.config.ts`, `vite.mobile.config.ts`, `.gitignore`, detección de plataforma

**Files:**
- Create: `capacitor.config.ts`
- Create: `vite.mobile.config.ts`
- Modify: `.gitignore`
- Verify/Modify: `src/global.d.ts`, `src/shared/platform-detect.ts` (creados por Fase 1)

- [ ] **Step 1: Crear `capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

// Spec §5. `androidScheme: 'https'` es lo que hace que el WebView sirva la app
// desde https://localhost — contexto seguro, sin el cual no hay OPFS y el
// worker muere con fatal(reason:'vfs'). Live reload (`cap run -l`) sirve por
// http:// y por eso NO está soportado.
const config: CapacitorConfig = {
  appId: 'com.hubtify.app',
  appName: 'Hubtify',
  webDir: 'dist/mobile',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
```

- [ ] **Step 2: Crear `vite.mobile.config.ts`**

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import pkg from './package.json';

// Mismos aliases que vitest.config.ts (absolutos) más `@logic` (spec §5).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@core': r('./src/core'),
  '@hub': r('./src/hub'),
  '@shared': r('./src/shared'),
  '@modules': r('./src/modules'),
  '@logic': r('./shared-logic'),
};

// Build del renderer para Android (Capacitor). Entrada: index.html.
// - target es2022: el worker usa top-level await.
// - worker.format 'es': el worker es un módulo (import de sqlite-wasm).
// - base './': Capacitor sirve el webDir desde https://localhost/ y los assets
//   se referencian relativos al index.
export default defineConfig({
  base: './',
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
    __HUBTIFY_PLATFORM__: '"android"',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: { alias },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist/mobile',
    emptyOutDir: true,
    target: 'es2022',
  },
});
```

- [ ] **Step 3: Agregar entradas a `.gitignore`** (al final del archivo, después de `.claude/`)

```gitignore

# Android (Capacitor) — el scaffold android/ SÍ se commitea; esto es build local
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/keystore.properties
android/*.jks
android/capacitor-cordova-android-plugins/build/
dist/mobile/
```

(`dist/` ya está ignorado globalmente; `dist/mobile/` se lista igual porque la spec §5 lo pide explícito y así sobrevive si alguien afina `dist/` más adelante.)

- [ ] **Step 4: Verificar/ajustar `src/global.d.ts`**

El contenido final debe ser exactamente este (la Fase 1 agrega la declaración; si falta, agregarla):

```ts
import type { HubtifyApi } from '../shared/types';

declare global {
  const APP_VERSION: string;
  /** Inyectada por `define` en vite.renderer.config.ts ('desktop') y vite.mobile.config.ts ('android'). */
  const __HUBTIFY_PLATFORM__: 'desktop' | 'android' | undefined;
  interface Window {
    api: HubtifyApi;
  }
}

export {};
```

- [ ] **Step 5: Verificar/ajustar `src/shared/platform-detect.ts`**

Contenido final (spec §5: `define` primero, `Capacitor.isNativePlatform()` como confirmación en runtime). La confirmación solo se exige si el runtime de Capacitor está presente: así el arnés visual `browser-mobile` de la Fase 3 (define `android`, sin Capacitor) también obtiene `true`.

```ts
/**
 * ¿Estamos corriendo como app Android (Capacitor)?
 *
 * `__HUBTIFY_PLATFORM__` lo fija el build (`vite.mobile.config.ts` → 'android',
 * `vite.renderer.config.ts` → 'desktop'). Cuando el bridge nativo de Capacitor
 * está presente (`window.Capacitor`), su `isNativePlatform()` confirma que no
 * es el mismo bundle abierto en un navegador de escritorio.
 */
export function isNativeMobile(): boolean {
  if (typeof __HUBTIFY_PLATFORM__ === 'undefined' || __HUBTIFY_PLATFORM__ !== 'android') {
    return false;
  }
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform) return cap.isNativePlatform() === true;
  return true;
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: sin salida (exit 0). Si `capacitor.config.ts` marca `Cannot find module '@capacitor/cli'`, la Task 2 Step 2 no corrió.

- [ ] **Step 7: Commit**

```bash
git add capacitor.config.ts vite.mobile.config.ts .gitignore src/global.d.ts src/shared/platform-detect.ts
git commit -m "feat(mobile): configuración de capacitor y build vite para android"
```

### Task 4: `src/mobile/protocol.ts` — mensajes, errores y transferables

**Files:**
- Create: `src/mobile/protocol.ts`
- Test: `tests/mobile/protocol.test.ts`

Spec §3.5 define los mensajes. Este módulo NO importa nada de `@logic` ni de Capacitor: lo comparten worker y UI.

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/protocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  collectTransferables,
  serializeError,
  MobileFatal,
  WorkerCrashed,
} from '../../src/mobile/protocol';

describe('collectTransferables', () => {
  it('devuelve el buffer de un Uint8Array suelto', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(collectTransferables(bytes)).toEqual([bytes.buffer]);
  });

  it('encuentra Uint8Array anidados hasta 2 niveles (pickBinaryFile → { name, bytes })', () => {
    const bytes = new Uint8Array([9]);
    expect(collectTransferables({ name: 'x.db', bytes })).toEqual([bytes.buffer]);
    expect(collectTransferables({ ok: true, file: { name: 'x.db', bytes } })).toEqual([bytes.buffer]);
  });

  it('no baja más de 2 niveles ni entra en arrays', () => {
    const bytes = new Uint8Array([9]);
    expect(collectTransferables({ a: { b: { bytes } } })).toEqual([]);
    expect(collectTransferables([bytes])).toEqual([]);
  });

  it('devuelve [] para primitivas, null y objetos sin binarios', () => {
    expect(collectTransferables(null)).toEqual([]);
    expect(collectTransferables(42)).toEqual([]);
    expect(collectTransferables({ tasks: [{ id: '1' }] })).toEqual([]);
  });
});

describe('serializeError', () => {
  it('conserva name y message de un Error', () => {
    class Custom extends Error { name = 'Custom'; }
    expect(serializeError(new Custom('boom'))).toEqual({ name: 'Custom', message: 'boom' });
  });

  it('convierte no-Errors a Error genérico', () => {
    expect(serializeError('texto')).toEqual({ name: 'Error', message: 'texto' });
    expect(serializeError(undefined)).toEqual({ name: 'Error', message: 'undefined' });
  });
});

describe('errores', () => {
  it('MobileFatal lleva reason, namespace y version', () => {
    const e = new MobileFatal('migration', 'ALTER falló', { namespace: 'quests', version: 7 });
    expect(e.reason).toBe('migration');
    expect(e.namespace).toBe('quests');
    expect(e.version).toBe(7);
    expect(e.name).toBe('MobileFatal');
    expect(e).toBeInstanceOf(Error);
  });

  it('WorkerCrashed tiene name estable', () => {
    expect(new WorkerCrashed('x').name).toBe('WorkerCrashed');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/protocol.test.ts 2>&1 | tail -5`
Expected: `Error: Failed to resolve import "../../src/mobile/protocol"` (o `Cannot find module`).

- [ ] **Step 3: Crear `src/mobile/protocol.ts`**

```ts
/**
 * Protocolo UI ⇄ worker (spec §3.5).
 *
 * Este módulo lo importan los dos lados: NO puede depender de `@logic`, de
 * Capacitor ni de nada del DOM. Solo tipos, dos clases de error y dos helpers.
 */

export type FatalReason = 'vfs' | 'open' | 'migration';

export interface SerializedError {
  name: string;
  message: string;
}

/** Métodos de `PlatformPort` (shared-logic/platform.ts) que viajan por el proxy. */
export type PlatformMethod =
  | 'notify'
  | 'openExternal'
  | 'pickTextFile'
  | 'pickPdfText'
  | 'pickBinaryFile'
  | 'saveTextFile'
  | 'saveBinaryFile';

// ── UI → worker ────────────────────────────────────────────────────────────

/** Valores síncronos de PlatformPort que el worker no puede pedir por round-trip. */
export interface InitMsg { type: 'init'; appVersion: string; osInfo: string }
export interface InvokeMsg { id: number; type: 'invoke'; channel: string; args: unknown[] }
export interface SuspendMsg { type: 'suspend' }
export interface ResumeMsg { type: 'resume' }
export type PlatformResultMsg =
  | { id: number; type: 'platform-result'; ok: true; value: unknown }
  | { id: number; type: 'platform-result'; ok: false; error: SerializedError };

export type UiToWorker = InitMsg | InvokeMsg | SuspendMsg | ResumeMsg | PlatformResultMsg;

// ── worker → UI ────────────────────────────────────────────────────────────

export interface ReadyMsg { type: 'ready' }
export interface FatalMsg {
  type: 'fatal';
  reason: FatalReason;
  message: string;
  namespace?: string;
  version?: number;
}
export type ResultMsg =
  | { id: number; type: 'result'; ok: true; value: unknown }
  | { id: number; type: 'result'; ok: false; error: SerializedError };
export interface EventMsg { type: 'event'; channel: string; payload: unknown }
export interface PlatformMsg { id: number; type: 'platform'; method: PlatformMethod; args: unknown[] }

export type WorkerToUi = ReadyMsg | FatalMsg | ResultMsg | EventMsg | PlatformMsg;

// ── Errores ────────────────────────────────────────────────────────────────

/** Fallo del worker ANTES de `ready` (VFS, apertura o migración). */
export class MobileFatal extends Error {
  readonly name = 'MobileFatal';
  readonly reason: FatalReason;
  readonly namespace?: string;
  readonly version?: number;

  constructor(reason: FatalReason, message: string, detail: { namespace?: string; version?: number } = {}) {
    super(message);
    this.reason = reason;
    this.namespace = detail.namespace;
    this.version = detail.version;
  }
}

/** El worker murió después de `ready`: todo invoke pendiente o posterior se rechaza con esto. */
export class WorkerCrashed extends Error {
  readonly name = 'WorkerCrashed';
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) return { name: err.name || 'Error', message: err.message };
  return { name: 'Error', message: String(err) };
}

/**
 * Buffers a pasar como transfer list de `postMessage` (spec §3.5: los
 * `Uint8Array` de backup/pickBinaryFile viajan sin copia). Mira el valor, sus
 * propiedades y las de éstas (2 niveles: `{ ok, file: { name, bytes } }`);
 * no entra en arrays porque ningún payload binario es una lista.
 */
export function collectTransferables(value: unknown, depth = 0): Transferable[] {
  if (value instanceof Uint8Array) {
    return value.buffer instanceof ArrayBuffer ? [value.buffer] : [];
  }
  if (value instanceof ArrayBuffer) return [value];
  if (depth >= 2 || value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: Transferable[] = [];
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...collectTransferables(v, depth + 1));
  }
  return out;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/protocol.test.ts 2>&1 | tail -5`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/protocol.ts tests/mobile/protocol.test.ts
git commit -m "feat(mobile): tipos del protocolo ui-worker, errores y transfer list"
```


## Chunk 2: Shim SQLite WASM y protocolo del worker

### Task 5: `src/mobile/db/wasm-database.ts` — `SqlDatabase` sobre `sqlite3.oo1.DB`

**Files:**
- Create: `src/mobile/db/wasm-database.ts`
- Test: `tests/mobile/wasm-database.test.ts`

Contrato (spec §3.4): `prepare/exec/pragma/transaction/close`; statement `run/get/all`; parámetros solo posicionales; `true/false → 1/0`, `undefined → null`, `bigint → Number`; LRU de 256 statements con `finalize()` al evictar; `transaction()` devuelve una función, con `BEGIN/COMMIT/ROLLBACK` y anidado por `SAVEPOINT` como better-sqlite3; `pragma('journal_mode = …')` se ignora.

API real de sqlite-wasm que se usa (doc `api-oo1.md`, tipos `dist/index.d.mts` 3.53.0-build1):
- `new sqlite3.oo1.DB(':memory:')` (tests) / `new poolUtil.OpfsSAHPoolDb('/hubtify.db')` (worker); `db.prepare(sql)`, `db.exec(sql)`, `db.exec({ sql, rowMode: 'object', resultRows })`, `db.changes()`, `db.close()`, `db.pointer`.
- `stmt.parameterCount`, `stmt.clearBindings()`, `stmt.bind(array)` (0-based → índices 1-based; **lanza si el statement no tiene parámetros**, por eso solo se llama con `length > 0`), `stmt.step(): boolean`, `stmt.get({})` (objeto por nombre de columna; solo válido tras `step()` verdadero), `stmt.reset()`, `stmt.finalize()`, `stmt.pointer` (`undefined` tras `finalize`).
- `sqlite3.capi.sqlite3_last_insert_rowid(db.pointer): bigint`, `sqlite3.capi.sqlite3_get_autocommit(db.pointer): number` (0 = dentro de una transacción).
- Enteros en rango seguro vuelven como `number` (el build tiene BigInt habilitado y convierte cuando cabe en 2^53), igual que better-sqlite3 por defecto.

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/wasm-database.test.ts
/**
 * El shim corre sqlite-wasm EN NODE (condición `node` del paquete → dist/node.mjs,
 * que carga el .wasm con fs). Sin OPFS: DB en memoria. Lo que se prueba es la
 * semántica better-sqlite3 que los ~600 `prepare` de shared-logic dan por hecha.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { WasmDatabase } from '../../src/mobile/db/wasm-database';

type InitModule = (opts?: {
  print?: (...a: unknown[]) => void;
  printErr?: (...a: unknown[]) => void;
}) => Promise<Sqlite3Static>;

// El build de Node avisa por printErr que no hay OPFS; no es parte del test.
const sqlite3 = await (sqlite3InitModule as unknown as InitModule)({
  print: () => {},
  printErr: () => {},
});

function openMemory(): WasmDatabase {
  return new WasmDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'));
}

const SCHEMA = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    done INTEGER NOT NULL DEFAULT 0,
    blob BLOB
  )`;

describe('WasmDatabase (shim better-sqlite3 sobre sqlite3.oo1.DB)', () => {
  let db: WasmDatabase;

  beforeEach(() => {
    db = openMemory();
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  it('run devuelve changes y lastInsertRowid como numbers', () => {
    const r = db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(db.prepare('INSERT INTO t (name) VALUES (?)').run('b').lastInsertRowid).toBe(2);
    expect(db.prepare('UPDATE t SET done = 1').run().changes).toBe(2);
  });

  it('get devuelve un objeto por nombre de columna (alias incluidos) o undefined', () => {
    db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(db.prepare('SELECT id, name AS taskName FROM t WHERE name = ?').get('a'))
      .toEqual({ id: 1, taskName: 'a' });
    expect(db.prepare('SELECT id FROM t WHERE name = ?').get('zzz')).toBeUndefined();
  });

  it('all devuelve todas las filas en orden y [] si no hay', () => {
    expect(db.prepare('SELECT name FROM t').all()).toEqual([]);
    db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    db.prepare('INSERT INTO t (name) VALUES (?)').run('b');
    expect(db.prepare('SELECT name FROM t ORDER BY id').all()).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('los enteros vuelven como number, no bigint', () => {
    const row = db.prepare('SELECT 1 AS n, 9007199254740991 AS big').get() as { n: unknown; big: unknown };
    expect(typeof row.n).toBe('number');
    expect(typeof row.big).toBe('number');
  });

  it('booleanos → 0/1, undefined → NULL, bigint → number', () => {
    db.prepare('INSERT INTO t (name, done, blob) VALUES (?, ?, ?)').run('a', true, undefined);
    db.prepare('INSERT INTO t (name, done) VALUES (?, ?)').run('b', false);
    expect(db.prepare('SELECT done, blob FROM t WHERE name = ?').get('a')).toEqual({ done: 1, blob: null });
    expect(db.prepare('SELECT done FROM t WHERE name = ?').get('b')).toEqual({ done: 0 });
    expect(db.prepare('SELECT ? AS big').get(42n)).toEqual({ big: 42 });
  });

  it('blobs entran y salen como Uint8Array', () => {
    db.prepare('INSERT INTO t (name, blob) VALUES (?, ?)').run('a', new Uint8Array([1, 2, 3]));
    const row = db.prepare('SELECT blob FROM t WHERE name = ?').get('a') as { blob: Uint8Array };
    expect(row.blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.blob)).toEqual([1, 2, 3]);
  });

  it('objetos no bindeables lanzan TypeError', () => {
    expect(() => db.prepare('SELECT ? AS x').get(new Date())).toThrow(TypeError);
  });

  it('cantidad de parámetros incorrecta lanza como better-sqlite3', () => {
    expect(() => db.prepare('SELECT ? AS a, ? AS b').get(1)).toThrow(/Too few parameter/);
    expect(() => db.prepare('SELECT ? AS a').get(1, 2)).toThrow(/Too many parameter/);
  });

  it('un error de step deja el statement cacheado reutilizable', () => {
    const ins = db.prepare('INSERT INTO t (name) VALUES (?)');
    ins.run('a');
    expect(() => ins.run('a')).toThrow(/UNIQUE/);
    expect(ins.run('b').changes).toBe(1);
  });

  it('el mismo SQL reutiliza el statement cacheado', () => {
    db.prepare('SELECT 1 AS x').get();
    db.prepare('SELECT 1 AS x').get();
    expect(db.statementCacheSize).toBe(1);
  });

  it('LRU 256: evicta y finaliza el más viejo; un statement en mano se re-prepara', () => {
    const held = db.prepare('SELECT 0 AS held');
    held.get();
    const raw = db.peekStatement('SELECT 0 AS held');
    expect(raw?.pointer).toBeDefined();

    for (let i = 1; i <= 256; i++) db.prepare(`SELECT ${i} AS n`).get();

    expect(db.statementCacheSize).toBe(256);
    expect(raw?.pointer).toBeUndefined(); // finalizado al evictar
    expect(db.peekStatement('SELECT 0 AS held')).toBeUndefined();

    expect(held.get()).toEqual({ held: 0 }); // se volvió a preparar
    expect(db.peekStatement('SELECT 0 AS held')).toBeDefined();
    expect(db.statementCacheSize).toBe(256);
  });

  it('transaction devuelve una función: COMMIT al retornar, ROLLBACK al lanzar', () => {
    const insert = db.transaction((names: string[]) => {
      for (const n of names) db.prepare('INSERT INTO t (name) VALUES (?)').run(n);
      return names.length;
    });
    expect(insert(['a', 'b'])).toBe(2);
    expect(() => insert(['c', 'a'])).toThrow(/UNIQUE/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 }); // 'c' revertido
    expect(db.inTransaction()).toBe(false);
  });

  it('transacción anidada usa SAVEPOINT: el fallo interno no tira la externa', () => {
    const inner = db.transaction((name: string) => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run(name);
      if (name === 'bad') throw new Error('inner');
    });
    const outer = db.transaction(() => {
      inner('ok');
      expect(db.inTransaction()).toBe(true);
      try { inner('bad'); } catch { /* absorbido: la externa sigue */ }
      inner('ok2');
    });
    outer();
    expect(db.prepare('SELECT name FROM t ORDER BY id').all()).toEqual([{ name: 'ok' }, { name: 'ok2' }]);
  });

  it('pragma: lectura devuelve filas-objeto, escritura devuelve [], journal_mode se ignora', () => {
    expect(db.pragma('journal_mode = WAL')).toEqual([]);
    expect(db.pragma('foreign_keys = ON')).toEqual([]);
    expect(db.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    const cols = (db.pragma('table_info(t)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(['id', 'name', 'done', 'blob']);
  });

  it('exec acepta varias sentencias', () => {
    db.exec(`INSERT INTO t (name) VALUES ('x'); INSERT INTO t (name) VALUES ('y');`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 });
  });

  it('close cierra la conexión y todo uso posterior lanza', () => {
    db.close();
    expect(() => db.prepare('SELECT 1').get()).toThrow(/not open/);
    expect(() => db.exec('SELECT 1')).toThrow(/not open/);
    db.close(); // idempotente
    db = openMemory(); // para el afterEach
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/wasm-database.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../src/mobile/db/wasm-database"`.

Si en cambio falla al cargar `@sqlite.org/sqlite-wasm` (p. ej. `fetch is not defined` o intenta `instantiateStreaming`), vitest no resolvió la condición `node`: agregar `resolve: { conditions: ['node'] }` al project `unit` en `vitest.config.ts` y repetir.

- [ ] **Step 3: Crear `src/mobile/db/wasm-database.ts`**

```ts
/**
 * `SqlDatabase` (shared-logic/db/sql-database.ts, spec §3.4) implementado sobre
 * `sqlite3.oo1.DB` de @sqlite.org/sqlite-wasm.
 *
 * Reproduce la parte de better-sqlite3 que usa shared-logic — prepare/run/get/
 * all/exec/pragma/transaction/close, parámetros posicionales — y NADA más.
 * No importa de `@logic` a propósito: el chequeo estructural contra
 * `SqlDatabase` lo hace `worker.ts` al pasar la factory a `setDbFactory()`.
 *
 * Statements: los ~600 `prepare()` del código están inline en funciones, así
 * que cada llamada volvería a compilar el SQL. Se cachea por string con LRU de
 * 256 y `finalize()` al evictar. Un `WasmStatement` no guarda el statement
 * nativo: lo pide al cache en cada uso, y si fue evictado se vuelve a preparar.
 */
import type {
  Sqlite3Static,
  Database as OoDatabase,
  PreparedStatement,
  SqlValue,
} from '@sqlite.org/sqlite-wasm';

const STATEMENT_CACHE_MAX = 256;

export interface WasmRunResult {
  changes: number;
  lastInsertRowid: number;
}

function normalizeParam(value: unknown, index: number): SqlValue {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'number':
    case 'string':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    case 'bigint':
      return Number(value);
    default:
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
      throw new TypeError(
        `SQLite3 can only bind numbers, strings, bigints, buffers, and null (parameter ${index + 1})`,
      );
  }
}

/** `reset()` re-lanza el error del último `step()`; ese error ya se propagó. */
function safeReset(stmt: PreparedStatement): void {
  try {
    stmt.reset();
  } catch {
    /* ya reportado por step() */
  }
}

export class WasmStatement<Row = unknown> {
  constructor(
    private readonly owner: WasmDatabase,
    private readonly sql: string,
  ) {}

  run(...params: unknown[]): WasmRunResult {
    const stmt = this.bind(params);
    try {
      stmt.step();
    } finally {
      safeReset(stmt);
    }
    return { changes: this.owner.changes(), lastInsertRowid: this.owner.lastInsertRowid() };
  }

  get(...params: unknown[]): Row | undefined {
    const stmt = this.bind(params);
    try {
      return stmt.step() ? (stmt.get({}) as Row) : undefined;
    } finally {
      safeReset(stmt);
    }
  }

  all(...params: unknown[]): Row[] {
    const stmt = this.bind(params);
    const rows: Row[] = [];
    try {
      while (stmt.step()) rows.push(stmt.get({}) as Row);
    } finally {
      safeReset(stmt);
    }
    return rows;
  }

  private bind(params: unknown[]): PreparedStatement {
    const stmt = this.owner.acquire(this.sql);
    const expected = stmt.parameterCount;
    if (params.length !== expected) {
      throw new RangeError(
        params.length < expected
          ? 'Too few parameter values were provided'
          : 'Too many parameter values were provided',
      );
    }
    stmt.clearBindings();
    // `bind([])` lanza «This statement has no bindable parameters».
    if (expected > 0) stmt.bind(params.map(normalizeParam));
    return stmt;
  }
}

export class WasmDatabase {
  private readonly cache = new Map<string, PreparedStatement>();
  private savepointSeq = 0;
  private open = true;

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: OoDatabase,
  ) {}

  // ── SqlDatabase ─────────────────────────────────────────────────────────

  prepare<Row = unknown>(sql: string): WasmStatement<Row> {
    this.assertOpen();
    return new WasmStatement<Row>(this, sql);
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /**
   * Devuelve las filas como better-sqlite3 (`Array<Record<col, valor>>`): una
   * escritura (`foreign_keys = ON`) da `[]`, una lectura (`table_info(x)`) da
   * una fila por columna. `journal_mode` se ignora: opfs-sahpool no usa WAL.
   */
  pragma(directive: string): unknown {
    this.assertOpen();
    if (/^\s*journal_mode\b/i.test(directive)) return [];
    const resultRows: Record<string, SqlValue>[] = [];
    this.db.exec({ sql: `PRAGMA ${directive}`, rowMode: 'object', resultRows });
    return resultRows;
  }

  /**
   * Como better-sqlite3: devuelve una función que corre `fn` dentro de
   * BEGIN/COMMIT (ROLLBACK si lanza). Si ya hay una transacción abierta usa
   * SAVEPOINT/RELEASE/ROLLBACK TO, así una transacción interna que falla no
   * tira la externa.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<F extends (...args: any[]) => any>(fn: F): F {
    const wrapped = (...args: unknown[]): unknown => {
      this.assertOpen();
      if (!this.inTransaction()) {
        this.db.exec('BEGIN');
        try {
          const result = fn(...args);
          this.db.exec('COMMIT');
          return result;
        } catch (err) {
          // Algunos errores ya revierten solos; ROLLBACK sin transacción lanzaría.
          if (this.inTransaction()) this.db.exec('ROLLBACK');
          throw err;
        }
      }
      const sp = `sp_${++this.savepointSeq}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const result = fn(...args);
        this.db.exec(`RELEASE ${sp}`);
        return result;
      } catch (err) {
        // Un error que aborta la transacción entera (SQLITE_FULL/IOERR/BUSY/
        // NOMEM/INTERRUPT) se lleva el savepoint consigo: `ROLLBACK TO` lanzaría
        // «no such savepoint» y taparía el error real. Mismo guard que
        // better-sqlite3 (`if (db.inTransaction)`).
        if (this.inTransaction()) {
          this.db.exec(`ROLLBACK TO ${sp}`);
          this.db.exec(`RELEASE ${sp}`);
        }
        throw err;
      }
    };
    return wrapped as unknown as F;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const stmt of this.cache.values()) stmt.finalize();
    this.cache.clear();
    this.db.close();
  }

  // ── Soporte ─────────────────────────────────────────────────────────────

  changes(): number {
    return this.db.changes();
  }

  lastInsertRowid(): number {
    return Number(this.sqlite3.capi.sqlite3_last_insert_rowid(this.pointer()));
  }

  inTransaction(): boolean {
    return this.sqlite3.capi.sqlite3_get_autocommit(this.pointer()) === 0;
  }

  get statementCacheSize(): number {
    return this.cache.size;
  }

  /** @internal Solo tests: el statement nativo cacheado para ese SQL, si existe. */
  peekStatement(sql: string): PreparedStatement | undefined {
    return this.cache.get(sql);
  }

  /** @internal Usado por WasmStatement: statement nativo vivo para `sql`, tocando el LRU. */
  acquire(sql: string): PreparedStatement {
    this.assertOpen();
    const cached = this.cache.get(sql);
    if (cached && cached.pointer !== undefined) {
      this.cache.delete(sql);
      this.cache.set(sql, cached); // el más reciente va al final
      return cached;
    }
    const stmt = this.db.prepare(sql);
    this.cache.set(sql, stmt);
    if (this.cache.size > STATEMENT_CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      const victim = this.cache.get(oldest);
      this.cache.delete(oldest);
      victim?.finalize();
    }
    return stmt;
  }

  private pointer(): NonNullable<OoDatabase['pointer']> {
    const p = this.db.pointer;
    if (p === undefined) throw new TypeError('The database connection is not open');
    return p;
  }

  private assertOpen(): void {
    if (!this.open) throw new TypeError('The database connection is not open');
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/wasm-database.test.ts 2>&1 | tail -5`
Expected: `Tests  16 passed (16)`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: sin salida. Si `Database`/`PreparedStatement` no existen como export de tipos, abrir `node_modules/@sqlite.org/sqlite-wasm/dist/index.d.mts` y usar los nombres que exporte (`rg -n "^export (declare )?(class|interface|type) " node_modules/@sqlite.org/sqlite-wasm/dist/index.d.mts`).

- [ ] **Step 6: Commit**

```bash
git add src/mobile/db/wasm-database.ts tests/mobile/wasm-database.test.ts
git commit -m "feat(mobile): shim SqlDatabase sobre sqlite-wasm con cache LRU y savepoints"
```

### Task 6: `src/mobile/worker-protocol.ts` — la máquina de mensajes del worker

**Files:**
- Create: `src/mobile/worker-protocol.ts`
- Test: `tests/mobile/worker-protocol.test.ts`

Pura: recibe un `host` con `post/getHandler/suspend/resume/onInit/log` y devuelve `onMessage` + `callPlatform`. `worker.ts` (Task 12) la conecta a `self.postMessage`, `getHandler` de `@logic/registry`, etc.

Comportamiento (spec §3.2, §3.5):
- `invoke` → `fn({}, ...args)`; sin handler → `{ ok:false, error:{ name:'NoHandler', message: channel } }`; si lanza → `console.error('[channel]', err)` + `{ ok:false, error }`. `Uint8Array` en el valor viaja con transfer list.
- `suspend` → `host.suspend()` (worker.ts: `runSuspend()` → `closeDb()` → `pauseVfs()`); desde ahí los `invoke` **esperan** (gate) hasta `resume`.
- `resume` → `await host.resume()` (worker.ts: `unpauseVfs()` → `getDb()` → `runResume()`), después abre el gate. Si `resume` falla → `fatal` (desvío 7).
- `platform` (worker→UI) con `id`; `platform-result` resuelve/rechaza.
- `init` → `host.onInit({ appVersion, osInfo })`.

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/worker-protocol.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkerProtocol, type WorkerHandler, type WorkerHost } from '../../src/mobile/worker-protocol';
import type { WorkerToUi } from '../../src/mobile/protocol';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeHost() {
  const posted: Array<{ msg: WorkerToUi; transfer?: Transferable[] }> = [];
  const handlers = new Map<string, WorkerHandler>();
  const host: WorkerHost = {
    post: vi.fn((msg: WorkerToUi, transfer?: Transferable[]) => { posted.push({ msg, transfer }); }),
    getHandler: (ch) => handlers.get(ch),
    onInit: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(async () => {}),
    log: vi.fn(),
  };
  return { host, posted, handlers };
}

describe('worker-protocol: invoke', () => {
  it('llama al handler con ({}, ...args) y responde ok:true con el valor', async () => {
    const { host, posted, handlers } = makeHost();
    const fn = vi.fn((_e: unknown, a: string, b: number) => [a, b]);
    handlers.set('quests:getTasks', fn);
    const p = createWorkerProtocol(host);

    await p.onMessage({ id: 7, type: 'invoke', channel: 'quests:getTasks', args: ['x', 2] });

    expect(fn).toHaveBeenCalledWith({}, 'x', 2);
    expect(posted[0].msg).toEqual({ id: 7, type: 'result', ok: true, value: ['x', 2] });
  });

  it('espera handlers async', async () => {
    const { host, posted, handlers } = makeHost();
    handlers.set('dollar:get', async () => 1234);
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 1, type: 'invoke', channel: 'dollar:get', args: [] });
    expect(posted[0].msg).toMatchObject({ id: 1, ok: true, value: 1234 });
  });

  it('canal sin handler → NoHandler con el canal como message', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 2, type: 'invoke', channel: 'backup:export', args: [] });
    expect(posted[0].msg).toEqual({
      id: 2, type: 'result', ok: false, error: { name: 'NoHandler', message: 'backup:export' },
    });
  });

  it('handler que lanza → ok:false con name/message y log "[canal]"', async () => {
    const { host, posted, handlers } = makeHost();
    handlers.set('cauldron:start', () => { throw new Error('Timer already active'); });
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 3, type: 'invoke', channel: 'cauldron:start', args: ['p1'] });
    expect(posted[0].msg).toEqual({
      id: 3, type: 'result', ok: false, error: { name: 'Error', message: 'Timer already active' },
    });
    expect(host.log).toHaveBeenCalledWith('[cauldron:start]', expect.any(Error));
  });

  it('un Uint8Array en el resultado viaja en la transfer list', async () => {
    const { host, posted, handlers } = makeHost();
    const bytes = new Uint8Array([1, 2]);
    handlers.set('x:bytes', () => ({ name: 'f.db', bytes }));
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 4, type: 'invoke', channel: 'x:bytes', args: [] });
    expect(posted[0].transfer).toEqual([bytes.buffer]);
  });
});

describe('worker-protocol: suspend / resume', () => {
  it('suspend llama host.suspend; los invokes esperan hasta que resume termina', async () => {
    const { host, posted, handlers } = makeHost();
    const order: string[] = [];
    (host.resume as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('resume'); });
    handlers.set('a', () => { order.push('handler'); return 'ok'; });
    const p = createWorkerProtocol(host);

    await p.onMessage({ type: 'suspend' });
    expect(host.suspend).toHaveBeenCalledTimes(1);
    expect(p.isSuspended()).toBe(true);

    const pending = p.onMessage({ id: 1, type: 'invoke', channel: 'a', args: [] });
    await flush();
    expect(posted).toHaveLength(0);

    await p.onMessage({ type: 'resume' });
    await pending;
    expect(order).toEqual(['resume', 'handler']);
    expect(p.isSuspended()).toBe(false);
    expect(posted[0].msg).toMatchObject({ id: 1, ok: true, value: 'ok' });
  });

  it('suspend y resume repetidos son idempotentes', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'resume' });
    expect(host.resume).not.toHaveBeenCalled();
    await p.onMessage({ type: 'suspend' });
    await p.onMessage({ type: 'suspend' });
    expect(host.suspend).toHaveBeenCalledTimes(1);
    await p.onMessage({ type: 'resume' });
    await p.onMessage({ type: 'resume' });
    expect(host.resume).toHaveBeenCalledTimes(1);
  });

  it('si resume falla postea fatal y sigue suspendido', async () => {
    const { host, posted } = makeHost();
    (host.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unpause failed'));
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'suspend' });
    await p.onMessage({ type: 'resume' });
    expect(posted[0].msg).toEqual({ type: 'fatal', reason: 'open', message: 'unpause failed' });
    expect(p.isSuspended()).toBe(true);
  });
});

describe('worker-protocol: platform proxy e init', () => {
  it('callPlatform postea {type:platform,id} y resuelve con platform-result ok', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    const call = p.callPlatform('pickPdfText', []);
    const msg = posted[0].msg as { id: number; type: string; method: string; args: unknown[] };
    expect(msg).toEqual({ id: 1, type: 'platform', method: 'pickPdfText', args: [] });
    await p.onMessage({ id: 1, type: 'platform-result', ok: true, value: { unsupported: true } });
    await expect(call).resolves.toEqual({ unsupported: true });
  });

  it('platform-result ok:false rechaza conservando name', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    const call = p.callPlatform('notify', [{ title: 't', body: 'b' }]);
    await p.onMessage({ id: 1, type: 'platform-result', ok: false, error: { name: 'Denied', message: 'no' } });
    await expect(call).rejects.toMatchObject({ name: 'Denied', message: 'no' });
  });

  it('callPlatform transfiere los Uint8Array de los args', () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    const bytes = new Uint8Array([5]);
    void p.callPlatform('saveBinaryFile', ['x.db', bytes]);
    expect(posted[0].transfer).toEqual([bytes.buffer]);
  });

  it('ids de platform son crecientes y un result desconocido se ignora', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    void p.callPlatform('notify', []);
    void p.callPlatform('notify', []);
    expect((posted[1].msg as { id: number }).id).toBe(2);
    await expect(p.onMessage({ id: 99, type: 'platform-result', ok: true, value: null })).resolves.toBeUndefined();
  });

  it('init pasa appVersion y osInfo al host', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'init', appVersion: '0.8.2', osInfo: 'android 14' });
    expect(host.onInit).toHaveBeenCalledWith({ appVersion: '0.8.2', osInfo: 'android 14' });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/worker-protocol.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../src/mobile/worker-protocol"`.

- [ ] **Step 3: Crear `src/mobile/worker-protocol.ts`**

```ts
/**
 * Máquina de mensajes del worker (spec §3.2 y §3.5), separada de `worker.ts`
 * para poder testearla en Node con un `host` falso.
 *
 * El host es lo que `worker.ts` sabe hacer: postear al hilo UI, buscar
 * handlers en el registry, cerrar/pausar la DB en suspend y reabrirla en
 * resume. Acá solo vive el orden y el contrato de los mensajes.
 */
import {
  collectTransferables,
  serializeError,
  type InitMsg,
  type InvokeMsg,
  type PlatformMethod,
  type UiToWorker,
  type WorkerToUi,
} from './protocol';

/** Forma de `Handler` en shared-logic/registry.ts: `(event, ...args)`; el worker pasa `{}`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerHandler = (event: Record<string, never>, ...args: any[]) => unknown;

export interface WorkerHost {
  post(msg: WorkerToUi, transfer?: Transferable[]): void;
  getHandler(channel: string): WorkerHandler | undefined;
  onInit(info: Omit<InitMsg, 'type'>): void;
  /** runSuspend() → closeDb() → poolUtil.pauseVfs() */
  suspend(): void;
  /** await poolUtil.unpauseVfs() → getDb() → runResume() */
  resume(): Promise<void>;
  log(...args: unknown[]): void;
}

export interface WorkerProtocol {
  onMessage(msg: UiToWorker): Promise<void>;
  callPlatform(method: PlatformMethod, args: unknown[]): Promise<unknown>;
  isSuspended(): boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export function createWorkerProtocol(host: WorkerHost): WorkerProtocol {
  let suspended = false;
  // Cerrado durante suspend: cada invoke lo espera antes de tocar el handler.
  let gate: Promise<void> = Promise.resolve();
  let openGate: (() => void) | null = null;
  let nextPlatformId = 1;
  const pendingPlatform = new Map<number, Pending>();

  async function invoke(msg: InvokeMsg): Promise<void> {
    await gate;
    const fn = host.getHandler(msg.channel);
    if (!fn) {
      host.post({ id: msg.id, type: 'result', ok: false, error: { name: 'NoHandler', message: msg.channel } });
      return;
    }
    try {
      const value = await fn({}, ...msg.args);
      host.post({ id: msg.id, type: 'result', ok: true, value }, collectTransferables(value));
    } catch (err) {
      // Mismo logging que ipcMain.handle en electron/ipc/registry.ts.
      host.log(`[${msg.channel}]`, err);
      host.post({ id: msg.id, type: 'result', ok: false, error: serializeError(err) });
    }
  }

  function suspend(): void {
    if (suspended) return;
    suspended = true;
    gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    try {
      host.suspend();
    } catch (err) {
      host.log('[worker] suspend falló', err);
    }
  }

  async function resume(): Promise<void> {
    if (!suspended) return;
    try {
      await host.resume();
    } catch (err) {
      host.log('[worker] resume falló', err);
      // El gate queda cerrado: la UI trata un fatal post-ready como crash y
      // rechaza los invokes pendientes con WorkerCrashed.
      host.post({ type: 'fatal', reason: 'open', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    suspended = false;
    openGate?.();
    openGate = null;
  }

  function platformResult(msg: Extract<UiToWorker, { type: 'platform-result' }>): void {
    const pending = pendingPlatform.get(msg.id);
    if (!pending) return;
    pendingPlatform.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.value);
    } else {
      const err = new Error(msg.error.message);
      err.name = msg.error.name;
      pending.reject(err);
    }
  }

  return {
    async onMessage(msg) {
      switch (msg.type) {
        case 'init':
          host.onInit({ appVersion: msg.appVersion, osInfo: msg.osInfo });
          return;
        case 'invoke':
          return invoke(msg);
        case 'suspend':
          suspend();
          return;
        case 'resume':
          return resume();
        case 'platform-result':
          platformResult(msg);
          return;
      }
    },

    callPlatform(method, args) {
      const id = nextPlatformId++;
      return new Promise((resolve, reject) => {
        pendingPlatform.set(id, { resolve, reject });
        host.post(
          { id, type: 'platform', method, args },
          args.flatMap((a) => collectTransferables(a)),
        );
      });
    },

    isSuspended: () => suspended,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/worker-protocol.test.ts 2>&1 | tail -5`
Expected: `Tests  13 passed (13)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/worker-protocol.ts tests/mobile/worker-protocol.test.ts
git commit -m "feat(mobile): protocolo del worker con gate de suspend y proxy de plataforma"
```


## Chunk 3: Lado UI — transport, instalación de `window.api` y pantalla de fallo

### Task 7: `src/mobile/worker-client.ts` — `Transport` sobre `postMessage`

**Files:**
- Create: `src/mobile/worker-client.ts`
- Test: `tests/mobile/worker-client.test.ts`

Es el `Transport { invoke, send, on, off }` que `shared/build-api.ts` convierte en `window.api` (spec §3.1). Además: espera `ready`/`fatal` (§3.5), atiende los `platform` del worker con el host de la UI, encola invokes durante `suspend`, y ante `error`/`messageerror` rechaza todo con `WorkerCrashed` y avisa (`onCrash`).

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/worker-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  createWorkerClient,
  type PlatformHostFns,
  type WorkerLike,
} from '../../src/mobile/worker-client';
import { MobileFatal, WorkerCrashed, type UiToWorker, type WorkerToUi } from '../../src/mobile/protocol';

const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeWorker implements WorkerLike {
  sent: Array<{ msg: UiToWorker; transfer?: Transferable[] }> = [];
  terminate = vi.fn();
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  postMessage(msg: UiToWorker, transfer?: Transferable[]): void {
    this.sent.push({ msg, transfer });
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(type: string, ev: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
  receive(msg: WorkerToUi): void {
    this.emit('message', { data: msg });
  }
}

function makePlatform(overrides: Partial<PlatformHostFns> = {}): PlatformHostFns {
  return {
    notify: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    pickTextFile: vi.fn(async () => null),
    pickPdfText: vi.fn(async () => ({ unsupported: true })),
    pickBinaryFile: vi.fn(async () => null),
    saveTextFile: vi.fn(async () => false),
    saveBinaryFile: vi.fn(async () => false),
    ...overrides,
  };
}

function setup(overrides: Partial<PlatformHostFns> = {}) {
  const worker = new FakeWorker();
  const onCrash = vi.fn();
  const client = createWorkerClient(worker, makePlatform(overrides), { onCrash });
  return { worker, client, onCrash };
}

describe('worker-client: arranque', () => {
  it('ready resuelve con {type:ready}', async () => {
    const { worker, client } = setup();
    worker.receive({ type: 'ready' });
    await expect(client.ready).resolves.toBeUndefined();
  });

  it('fatal antes de ready rechaza con MobileFatal (reason, namespace, version)', async () => {
    const { worker, client } = setup();
    worker.receive({ type: 'fatal', reason: 'migration', message: 'ALTER falló', namespace: 'quests', version: 7 });
    await expect(client.ready).rejects.toMatchObject({
      name: 'MobileFatal', reason: 'migration', message: 'ALTER falló', namespace: 'quests', version: 7,
    });
    await expect(client.ready).rejects.toBeInstanceOf(MobileFatal);
  });

  it('init postea appVersion y osInfo', () => {
    const { worker, client } = setup();
    client.init({ appVersion: '0.8.2', osInfo: 'android 14' });
    expect(worker.sent[0].msg).toEqual({ type: 'init', appVersion: '0.8.2', osInfo: 'android 14' });
  });
});

describe('worker-client: invoke', () => {
  it('postea {id,type:invoke,channel,args} y resuelve con el result ok:true', async () => {
    const { worker, client } = setup();
    const p = client.transport.invoke('quests:getTasks', 'arg1', 2);
    expect(worker.sent[0].msg).toEqual({ id: 1, type: 'invoke', channel: 'quests:getTasks', args: ['arg1', 2] });
    worker.receive({ id: 1, type: 'result', ok: true, value: [{ id: 't1' }] });
    await expect(p).resolves.toEqual([{ id: 't1' }]);
  });

  it('rechaza con name/message del result ok:false (NoHandler incluido)', async () => {
    const { worker, client } = setup();
    const p = client.transport.invoke('backup:export');
    worker.receive({ id: 1, type: 'result', ok: false, error: { name: 'NoHandler', message: 'backup:export' } });
    await expect(p).rejects.toMatchObject({ name: 'NoHandler', message: 'backup:export' });
  });

  it('los ids son crecientes y cada result resuelve solo su invoke', async () => {
    const { worker, client } = setup();
    const a = client.transport.invoke('a');
    const b = client.transport.invoke('b');
    worker.receive({ id: 2, type: 'result', ok: true, value: 'B' });
    worker.receive({ id: 1, type: 'result', ok: true, value: 'A' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('un Uint8Array en los args viaja en la transfer list', () => {
    const { worker, client } = setup();
    const bytes = new Uint8Array([1]);
    void client.transport.invoke('backup:import', bytes);
    expect(worker.sent[0].transfer).toEqual([bytes.buffer]);
  });

  it('send es no-op en mobile', () => {
    const { worker, client } = setup();
    client.transport.send('window:minimize');
    expect(worker.sent).toHaveLength(0);
  });
});

describe('worker-client: eventos', () => {
  it('on recibe el payload del evento; off deja de recibir', () => {
    const { worker, client } = setup();
    const h = vi.fn();
    client.transport.on('cauldron:tick', h);
    worker.receive({ type: 'event', channel: 'cauldron:tick', payload: { remainingMs: 5 } });
    expect(h).toHaveBeenCalledWith({ remainingMs: 5 });
    client.transport.off('cauldron:tick', h);
    worker.receive({ type: 'event', channel: 'cauldron:tick', payload: { remainingMs: 4 } });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('un listener que lanza no frena a los demás', () => {
    const { worker, client } = setup();
    const bad = vi.fn(() => { throw new Error('ui'); });
    const good = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    client.transport.on('rpg:daySealed', bad);
    client.transport.on('rpg:daySealed', good);
    worker.receive({ type: 'event', channel: 'rpg:daySealed', payload: 1 });
    expect(good).toHaveBeenCalledWith(1);
    spy.mockRestore();
  });
});

describe('worker-client: proxy de plataforma', () => {
  it('platform → llama al host y responde platform-result con transfer list', async () => {
    const bytes = new Uint8Array([7, 7]);
    const pickBinaryFile = vi.fn(async () => ({ name: 'x.db', bytes }));
    const { worker } = setup({ pickBinaryFile });
    worker.receive({ id: 3, type: 'platform', method: 'pickBinaryFile', args: [[{ name: 'DB', extensions: ['db'] }]] });
    await flush();
    expect(pickBinaryFile).toHaveBeenCalledWith([{ name: 'DB', extensions: ['db'] }]);
    expect(worker.sent[0]).toEqual({
      msg: { id: 3, type: 'platform-result', ok: true, value: { name: 'x.db', bytes } },
      transfer: [bytes.buffer],
    });
  });

  it('si el host lanza responde ok:false con name/message', async () => {
    const { worker } = setup({ notify: vi.fn(async () => { throw new Error('denied'); }) });
    worker.receive({ id: 4, type: 'platform', method: 'notify', args: [{ title: 't', body: 'b' }] });
    await flush();
    expect(worker.sent[0].msg).toEqual({ id: 4, type: 'platform-result', ok: false, error: { name: 'Error', message: 'denied' } });
  });
});

describe('worker-client: suspend / resume', () => {
  it('suspend postea {type:suspend}; los invokes se encolan y salen tras resume, en orden', async () => {
    const { worker, client } = setup();
    client.suspend();
    expect(worker.sent.map((s) => s.msg)).toEqual([{ type: 'suspend' }]);
    expect(client.isSuspended()).toBe(true);

    const a = client.transport.invoke('a');
    const b = client.transport.invoke('b');
    expect(worker.sent).toHaveLength(1);

    client.resume();
    expect(worker.sent.map((s) => s.msg)).toEqual([
      { type: 'suspend' },
      { type: 'resume' },
      { id: 1, type: 'invoke', channel: 'a', args: [] },
      { id: 2, type: 'invoke', channel: 'b', args: [] },
    ]);
    worker.receive({ id: 1, type: 'result', ok: true, value: 'A' });
    worker.receive({ id: 2, type: 'result', ok: true, value: 'B' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
    expect(client.isSuspended()).toBe(false);
  });

  it('suspend/resume repetidos no duplican mensajes', () => {
    const { worker, client } = setup();
    client.resume();
    client.suspend();
    client.suspend();
    client.resume();
    client.resume();
    expect(worker.sent.map((s) => s.msg)).toEqual([{ type: 'suspend' }, { type: 'resume' }]);
  });
});

describe('worker-client: crash', () => {
  it('error del worker rechaza pendientes y encolados con WorkerCrashed, llama onCrash y rechaza invokes posteriores', async () => {
    const { worker, client, onCrash } = setup();
    worker.receive({ type: 'ready' });
    const pending = client.transport.invoke('a');
    client.suspend();
    const queued = client.transport.invoke('b');

    worker.emit('error', { message: 'Uncaught RangeError: boom' });

    await expect(pending).rejects.toBeInstanceOf(WorkerCrashed);
    await expect(queued).rejects.toBeInstanceOf(WorkerCrashed);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash.mock.calls[0][0]).toMatchObject({ name: 'WorkerCrashed', message: 'Uncaught RangeError: boom' });
    await expect(client.transport.invoke('c')).rejects.toBeInstanceOf(WorkerCrashed);
    expect(client.isCrashed()).toBe(true);
  });

  it('un fatal DESPUÉS de ready se trata como crash', async () => {
    const { worker, client, onCrash } = setup();
    worker.receive({ type: 'ready' });
    await client.ready;
    const p = client.transport.invoke('a');
    worker.receive({ type: 'fatal', reason: 'open', message: 'unpause failed' });
    await expect(p).rejects.toBeInstanceOf(WorkerCrashed);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('un crash ANTES de ready rechaza ready con MobileFatal', async () => {
    const { worker, client } = setup();
    worker.emit('error', { message: 'boom' });
    await expect(client.ready).rejects.toMatchObject({ name: 'MobileFatal', reason: 'open', message: 'boom' });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/worker-client.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../src/mobile/worker-client"`.

- [ ] **Step 3: Crear `src/mobile/worker-client.ts`**

```ts
/**
 * Lado UI del transporte worker ⇄ UI (spec §3.1 y §3.5).
 *
 * Expone el `Transport { invoke, send, on, off }` que `shared/build-api.ts`
 * convierte en `window.api`, y encima: espera `ready`, atiende los pedidos
 * `platform` del worker con el host de la UI, encola invokes mientras la app
 * está suspendida, y ante un crash rechaza todo con `WorkerCrashed`.
 *
 * No crea el Worker ni toca Capacitor: eso es `install-api.ts`. Acá el worker
 * es cualquier cosa con `postMessage/addEventListener/terminate` (tests).
 */
import {
  collectTransferables,
  serializeError,
  MobileFatal,
  WorkerCrashed,
  type InitMsg,
  type InvokeMsg,
  type PlatformMethod,
  type PlatformMsg,
  type UiToWorker,
  type WorkerToUi,
} from './protocol';

export interface WorkerLike {
  postMessage(message: UiToWorker, transfer?: Transferable[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (ev: any) => void): void;
  terminate(): void;
}

/** Los 7 métodos asíncronos de PlatformPort, ejecutados en la UI (platform-host.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlatformHostFns = Record<PlatformMethod, (...args: any[]) => Promise<unknown>>;

/** Misma forma que `Transport` en shared/build-api.ts; el chequeo ocurre en install-api.ts al llamar buildApi(). */
export interface WorkerTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, handler: (payload: unknown) => void): void;
  off(channel: string, handler: (payload: unknown) => void): void;
}

export interface WorkerClientOptions {
  onCrash?: (err: WorkerCrashed) => void;
}

export interface WorkerClient {
  transport: WorkerTransport;
  /** Resuelve con `{type:'ready'}`; rechaza con `MobileFatal` si el worker falla antes. */
  ready: Promise<void>;
  init(info: Omit<InitMsg, 'type'>): void;
  suspend(): void;
  resume(): void;
  isSuspended(): boolean;
  isCrashed(): boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export function createWorkerClient(
  worker: WorkerLike,
  platform: PlatformHostFns,
  opts: WorkerClientOptions = {},
): WorkerClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const queued: Array<{ msg: InvokeMsg; transfer: Transferable[] }> = [];
  let suspended = false;
  let crashed: WorkerCrashed | null = null;
  let isReady = false;

  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Quien la espere la maneja; esto solo evita un "unhandled rejection" si el
  // fatal llega antes de que install-api.ts haga el await.
  ready.catch(() => {});

  function crash(message: string): void {
    if (crashed) return;
    crashed = new WorkerCrashed(message);
    for (const p of pending.values()) p.reject(crashed);
    pending.clear();
    queued.length = 0;
    if (!isReady) rejectReady(new MobileFatal('open', message));
    opts.onCrash?.(crashed);
  }

  function settle(id: number, result: Extract<WorkerToUi, { type: 'result' }>): void {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (result.ok) {
      p.resolve(result.value);
    } else {
      const err = new Error(result.error.message);
      err.name = result.error.name;
      p.reject(err);
    }
  }

  async function servePlatform(msg: PlatformMsg): Promise<void> {
    try {
      const fn = platform[msg.method];
      if (typeof fn !== 'function') throw new Error(`PlatformPort.${msg.method} no implementado en mobile`);
      const value = await fn(...msg.args);
      worker.postMessage({ id: msg.id, type: 'platform-result', ok: true, value }, collectTransferables(value));
    } catch (err) {
      worker.postMessage({ id: msg.id, type: 'platform-result', ok: false, error: serializeError(err) });
    }
  }

  function onMessage(ev: MessageEvent<WorkerToUi>): void {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        isReady = true;
        resolveReady();
        return;
      case 'fatal':
        if (!isReady) {
          rejectReady(new MobileFatal(msg.reason, msg.message, { namespace: msg.namespace, version: msg.version }));
        } else {
          crash(`${msg.reason}: ${msg.message}`);
        }
        return;
      case 'result':
        settle(msg.id, msg);
        return;
      case 'event':
        listeners.get(msg.channel)?.forEach((handler) => {
          try {
            handler(msg.payload);
          } catch (err) {
            console.error(`[event ${msg.channel}]`, err);
          }
        });
        return;
      case 'platform':
        void servePlatform(msg);
        return;
    }
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', (ev: ErrorEvent) => crash(ev.message || 'Worker error'));
  worker.addEventListener('messageerror', () => crash('Worker messageerror'));

  const transport: WorkerTransport = {
    invoke(channel, ...args) {
      if (crashed) return Promise.reject(crashed);
      const id = nextId++;
      const msg: InvokeMsg = { id, type: 'invoke', channel, args };
      const transfer = args.flatMap((a) => collectTransferables(a));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        if (suspended) queued.push({ msg, transfer });
        else worker.postMessage(msg, transfer);
      });
    },
    send() {
      // `window:*` no tiene sentido en mobile (spec §3.1): no-op.
    },
    on(channel, handler) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(handler);
    },
    off(channel, handler) {
      listeners.get(channel)?.delete(handler);
    },
  };

  return {
    transport,
    ready,
    init(info) {
      worker.postMessage({ type: 'init', ...info });
    },
    suspend() {
      if (suspended || crashed) return;
      suspended = true;
      worker.postMessage({ type: 'suspend' });
    },
    resume() {
      if (!suspended || crashed) return;
      suspended = false;
      worker.postMessage({ type: 'resume' });
      for (const q of queued.splice(0)) worker.postMessage(q.msg, q.transfer);
    },
    isSuspended: () => suspended,
    isCrashed: () => crashed !== null,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/worker-client.test.ts 2>&1 | tail -5`
Expected: `Tests  17 passed (17)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/worker-client.ts tests/mobile/worker-client.test.ts
git commit -m "feat(mobile): transport del worker con cola en suspend y WorkerCrashed"
```

### Task 8: `platform-host.ts` e `install-api.ts`

**Files:**
- Create: `src/mobile/platform-host.ts`
- Create: `src/mobile/install-api.ts`

Requiere Fase 1 (`shared/api-channels.ts`, `shared/build-api.ts`). No hay test unitario propio: `install-api.ts` es cableado (Worker real + Capacitor) y se verifica en el emulador (Task 14); la lógica está testeada en `worker-client`.

- [ ] **Step 1: Crear `src/mobile/platform-host.ts`**

```ts
/**
 * Lado UI del `PlatformPort` (spec §6, columna «Mobile»). El worker manda
 * `{ type:'platform', method, args }` y esto lo atiende con plugins de
 * Capacitor. Fase 2 solo necesita `notify` (no-op) y `pickPdfText`
 * (`{ unsupported:true }`); el resto es no-op / `null` / `false` hasta la
 * Fase 5 (`@capacitor/browser`, `@capacitor/filesystem`, `@capacitor/share`).
 *
 * `appVersion()` y `osInfo()` son síncronos en la interfaz y no pueden hacer
 * round-trip: la UI los manda una vez con `{ type:'init' }` (ver install-api).
 */
import { Device } from '@capacitor/device';
import type { PlatformHostFns } from './worker-client';

export async function readOsInfo(): Promise<string> {
  try {
    const info = await Device.getInfo();
    return `${info.platform} ${info.osVersion}`;
  } catch (err) {
    console.warn('[mobile] Device.getInfo falló:', err);
    return 'android';
  }
}

export function createPlatformHost(): PlatformHostFns {
  return {
    // Fase 5: @capacitor/local-notifications con schedule inmediato.
    notify: async () => undefined,
    // Fase 5: @capacitor/browser (`window.open` en el WebView de Capacitor no
    // garantiza abrir el navegador del sistema). Hasta entonces, no-op (spec §6).
    openExternal: async (url: string) => {
      console.warn('[mobile] openExternal no implementado hasta Fase 5:', url);
    },
    pickTextFile: async () => null,
    // Import de resúmenes PDF: fuera de alcance en mobile (spec §1). El handler
    // de finance-import responde { ok:false, reason:'unsupported_platform' }.
    pickPdfText: async () => ({ unsupported: true as const }),
    pickBinaryFile: async () => null,
    saveTextFile: async () => false,
    saveBinaryFile: async () => false,
  };
}
```

- [ ] **Step 2: Crear `src/mobile/install-api.ts`**

```ts
/**
 * Arranque del binding Android (spec §3.5): crea el worker, espera `ready`
 * (VFS instalado, DB abierta, migraciones aplicadas) y recién ahí asigna
 * `window.api`. `src/main.tsx` lo espera antes de `createRoot`.
 */
import { App } from '@capacitor/app';
import { API_CHANNELS } from '../../shared/api-channels';
import { buildApi } from '../../shared/build-api';
import { createWorkerClient } from './worker-client';
import { createPlatformHost, readOsInfo } from './platform-host';

export async function installMobileApi(): Promise<void> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'hubtify-logic',
  });

  const client = createWorkerClient(worker, createPlatformHost(), {
    onCrash: (err) => {
      console.error('[mobile] worker crashed:', err.message);
      // App.tsx lo escucha y muestra FatalScreen (sin recrear el worker).
      window.dispatchEvent(new CustomEvent('mobile:workerCrashed', { detail: err.message }));
    },
  });

  // `init` sale ANTES de esperar ready: el orden de mensajes garantiza que el
  // worker lo tenga antes de cualquier invoke.
  client.init({ appVersion: APP_VERSION, osInfo: await readOsInfo() });
  await client.ready;

  const api = buildApi(client.transport);
  // Los 8 canales desktop-only (spec §3.1) quedan `undefined`: HubtifyApi los
  // declara opcionales y los consumidores ya hacen `if (window.api.x)`.
  for (const [key, spec] of Object.entries(API_CHANNELS)) {
    if (spec.platforms === 'desktop') delete (api as unknown as Record<string, unknown>)[key];
  }
  window.api = api;

  // Segundo plano: runSuspend → closeDb → pauseVfs en el worker; al volver,
  // unpauseVfs → getDb → runResume. Los invokes del medio quedan en cola.
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) client.resume();
    else client.suspend();
  });

  // El WebView se descarta: soltar los handles del VFS para que la próxima
  // instancia no encuentre el pool "in use".
  window.addEventListener('pagehide', () => worker.terminate());
}
```

Si `buildApi` de la Fase 1 acepta un filtro de plataforma (p. ej. `buildApi(transport, { platform: 'android' })`), usarlo y borrar el bucle `delete`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: sin salida. Errores esperables y su arreglo:
- `Argument of type 'WorkerTransport' is not assignable to parameter of type 'Transport'` → la forma de `Transport` en `shared/build-api.ts` difiere; ajustar `WorkerTransport` en `worker-client.ts` a esa forma (no al revés).
- `Cannot find module './worker'` → todavía no existe (Task 12); es aceptable hasta esa tarea SOLO si tsc no lo marca (Vite resuelve `new URL('./worker.ts', import.meta.url)` como string, tsc no la valida). Si tsc lo marca, crear `src/mobile/worker.ts` vacío con `export {};` y seguir.

- [ ] **Step 4: Commit**

```bash
git add src/mobile/platform-host.ts src/mobile/install-api.ts
git commit -m "feat(mobile): install-api arma window.api desde api-channels sobre el worker"
```

### Task 9: `FatalScreen`, i18n, `main.tsx`, `App.tsx`

**Files:**
- Create: `src/mobile/FatalScreen.tsx`, `src/mobile/fatal-screen.css`
- Modify: `src/i18n/es.json`, `src/i18n/en.json` (nueva sección `mobile`, entre `hub` y `nav`)
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Agregar la sección `mobile` a `src/i18n/es.json`**

Insertar entre el cierre de `"hub": { … },` (línea ~899) y `"nav": {` (línea ~900):

```json
  "mobile": {
    "fatal": {
      "crash": "El motor de datos se detuvo de forma inesperada.",
      "migration": "No se pudo actualizar la base de datos.",
      "migrationDetail": "Migración {{namespace}} v{{version}}",
      "open": "No se pudo abrir la base de datos.",
      "restart": "Reiniciar",
      "title": "El grimorio no se pudo abrir",
      "vfs": "El almacenamiento local no está disponible en este dispositivo."
    }
  },
```

- [ ] **Step 2: Agregar la sección `mobile` a `src/i18n/en.json`** (misma posición, entre `hub` y `nav`)

```json
  "mobile": {
    "fatal": {
      "crash": "The data engine stopped unexpectedly.",
      "migration": "The database could not be updated.",
      "migrationDetail": "Migration {{namespace}} v{{version}}",
      "open": "The database could not be opened.",
      "restart": "Restart",
      "title": "The grimoire could not be opened",
      "vfs": "Local storage is not available on this device."
    }
  },
```

Run: `node -e "for (const l of ['es','en']) { const j = require('./src/i18n/'+l+'.json'); console.log(l, Object.keys(j.mobile.fatal).join(',')) }"`
Expected: dos líneas `es crash,migration,migrationDetail,open,restart,title,vfs` y `en …` idénticas.

- [ ] **Step 3: Crear `src/mobile/fatal-screen.css`** (tokens de `src/hub/styles/theme.css`; ver `DESIGN_SYSTEM.md` §RPG Card)

```css
/* Pantalla de fallo del arranque mobile. Pantalla completa sobre cuero, una
   tarjeta de pergamino centrada. Sin dependencias de components.css: puede
   renderizarse antes de que exista window.api. */
.mobile-fatal {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
  background: var(--leather-dark);
}

.mobile-fatal__card {
  width: min(420px, 100%);
  padding: 24px 20px;
  border: 2px solid var(--gold-dark);
  border-radius: 6px;
  background: linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%);
  box-shadow: 0 2px 8px rgba(42, 29, 14, 0.3), inset 0 1px 3px rgba(42, 29, 14, 0.1);
  color: var(--ink);
  text-align: center;
}

.mobile-fatal__title {
  margin: 0 0 12px;
  font-family: var(--ff-display);
  font-size: var(--fs-heading);
  color: var(--rubric);
}

.mobile-fatal__reason {
  margin: 0 0 8px;
  font-family: var(--ff-body);
  font-size: var(--fs-body);
  color: var(--ink);
}

.mobile-fatal__detail {
  margin: 0 0 8px;
  font-family: var(--ff-accent);
  font-size: var(--fs-label);
  color: var(--ink-soft);
}

.mobile-fatal__message {
  margin: 0 0 16px;
  padding: 8px;
  max-height: 30vh;
  overflow: auto;
  border-radius: 3px;
  background: var(--parch-3);
  color: var(--ink-faded);
  font-family: 'Fira Code', monospace;
  font-size: var(--fs-label);
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
}

.mobile-fatal__button {
  padding: 8px 16px;
  border: 1px solid var(--gold-dark);
  border-radius: 6px;
  background: linear-gradient(180deg, var(--leather-light) 0%, var(--leather) 100%);
  color: var(--gold);
  font-family: var(--ff-accent);
  font-size: var(--fs-body);
  box-shadow: 0 2px 4px rgba(42, 29, 14, 0.3);
  cursor: pointer;
}

.mobile-fatal__button:active {
  background: linear-gradient(180deg, var(--gold) 0%, var(--gold-dark) 100%);
  color: var(--ink);
}
```

- [ ] **Step 4: Crear `src/mobile/FatalScreen.tsx`**

```tsx
/**
 * Pantalla terminal del binding Android (spec §3.5).
 *
 * Antes de `ready`: `main.tsx` la monta en lugar de <App/> con el `reason` del
 * mensaje `fatal` ('vfs' | 'open' | 'migration'). Después de `ready`: App.tsx
 * la muestra con reason 'crash' cuando llega `mobile:workerCrashed`.
 * «Reiniciar» recarga el WebView; no se recrea el worker en silencio.
 * El botón «Exportar .db» llega en la Fase 5 (src/mobile/backup.ts).
 */
import { useTranslation } from 'react-i18next';
import type { FatalReason } from './protocol';
import './fatal-screen.css';

export type FatalScreenReason = FatalReason | 'crash';

interface Props {
  reason: FatalScreenReason;
  message: string;
  namespace?: string;
  version?: number;
}

const FALLBACK: Record<FatalScreenReason, string> = {
  vfs: 'El almacenamiento local no está disponible en este dispositivo.',
  open: 'No se pudo abrir la base de datos.',
  migration: 'No se pudo actualizar la base de datos.',
  crash: 'El motor de datos se detuvo de forma inesperada.',
};

export default function FatalScreen({ reason, message, namespace, version }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mobile-fatal" role="alert">
      <div className="mobile-fatal__card">
        <h1 className="mobile-fatal__title">{t('mobile.fatal.title', 'El grimorio no se pudo abrir')}</h1>
        <p className="mobile-fatal__reason">{t(`mobile.fatal.${reason}`, FALLBACK[reason])}</p>
        {reason === 'migration' && namespace && (
          <p className="mobile-fatal__detail">
            {t('mobile.fatal.migrationDetail', 'Migración {{namespace}} v{{version}}', { namespace, version })}
          </p>
        )}
        <pre className="mobile-fatal__message">{message}</pre>
        <button type="button" className="mobile-fatal__button" onClick={() => window.location.reload()}>
          {t('mobile.fatal.restart', 'Reiniciar')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Reescribir `src/main.tsx`**

Contenido completo nuevo (el árbol de render no cambia; se envuelve en `bootstrap()` porque `await installMobileApi()` debe correr antes de `createRoot`, y el renderer desktop no tiene `build.target` para top-level await):

```tsx
import { createRoot } from 'react-dom/client';
import './shared/animations/gsap-setup';
import './i18n';
import './hub/styles/theme.css';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './shared/AuthContext';
import { ConfirmProvider } from './shared/components/ConfirmDialog';
import { isNativeMobile } from './shared/platform-detect';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const isFloatingTimer = new URLSearchParams(window.location.search).get('view') === 'floating-timer';

function renderApp(): void {
  if (isFloatingTimer) {
    import('./modules/cauldron/components/CauldronFloatingWindow').then(({ default: CauldronFloatingWindow }) => {
      createRoot(root).render(
        <ConfirmProvider>
          <CauldronFloatingWindow />
        </ConfirmProvider>
      );
    });
  } else {
    createRoot(root).render(
      <HashRouter>
        <AuthProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </AuthProvider>
      </HashRouter>
    );
  }
}

/**
 * En Android `window.api` no existe hasta que el worker instaló el VFS, abrió la
 * DB y aplicó las migraciones (spec §3.5): se espera ANTES de montar React.
 * Ningún módulo lee `window.api` a nivel de módulo, así que el orden es seguro.
 *
 * El guard usa la constante de `define` ADEMÁS de `isNativeMobile()`: esbuild
 * pliega `"desktop" === 'android'` a `false` y Rollup elimina los `import()`
 * de abajo del bundle desktop. Con solo la llamada en runtime, el renderer de
 * Electron emitiría chunks para install-api, Capacitor, el worker entero,
 * sqlite-wasm (579 KB + 865 KB de .wasm) y una copia de shared-logic.
 */
async function bootstrap(): Promise<void> {
  if (typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android' && isNativeMobile()) {
    const { installMobileApi } = await import('./mobile/install-api');
    try {
      await installMobileApi();
    } catch (err) {
      const [{ default: FatalScreen }, { MobileFatal }] = await Promise.all([
        import('./mobile/FatalScreen'),
        import('./mobile/protocol'),
      ]);
      const fatal =
        err instanceof MobileFatal
          ? err
          : new MobileFatal('open', err instanceof Error ? err.message : String(err));
      console.error('[mobile] arranque fallido:', fatal.reason, fatal.message);
      createRoot(root).render(
        <FatalScreen
          reason={fatal.reason}
          message={fatal.message}
          namespace={fatal.namespace}
          version={fatal.version}
        />
      );
      return;
    }
  }
  renderApp();
}

void bootstrap();
```

- [ ] **Step 6: Modificar `src/App.tsx`**

(a) Junto a los otros `lazy` (después de `const RewardsPage = …`, línea ~39):

```tsx
// Solo se carga si el worker mobile muere después de `ready` (spec §3.5).
// Aceptado: el bundle desktop emite este chunk (FatalScreen + su CSS, unos KB)
// aunque nunca lo pida; `protocol.ts` no entra porque solo se importan tipos.
const FatalScreen = lazy(() => import('./mobile/FatalScreen'));
```

(b) Dentro de `App()`, después del `useEffect` de `prefetchRoutes` (línea ~78) y ANTES de `if (loading) return null;`:

```tsx
  // Android: el worker de datos murió. Sin recreación silenciosa: pantalla
  // terminal con «Reiniciar» (spec §3.5).
  const [workerCrash, setWorkerCrash] = useState<string | null>(null);
  useEffect(() => {
    const onCrash = (e: Event) => setWorkerCrash((e as CustomEvent<string>).detail || 'Worker crashed');
    window.addEventListener('mobile:workerCrashed', onCrash);
    return () => window.removeEventListener('mobile:workerCrashed', onCrash);
  }, []);

  if (workerCrash !== null) {
    return (
      <Suspense fallback={null}>
        <FatalScreen reason="crash" message={workerCrash} />
      </Suspense>
    );
  }
```

- [ ] **Step 7: Typecheck, lint y suite**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: tsc sin salida; lint sin errores; `Test Files  N+4 passed`, todos `passed`.

- [ ] **Step 8: Verificar que el bundle desktop NO arrastra el binding mobile**

Run: `npx vite build -c vite.renderer.config.ts --outDir dist/renderer-check 2>&1 | tail -3 && rg --files --no-ignore dist/renderer-check | rg -i "sqlite3|worker-|install-api|capacitor"; echo "(sin líneas arriba = ok)"`
Expected: el build termina con `✓ built in Xs` y el `rg` no imprime nada. Si aparece `sqlite3-*.wasm` o un chunk `worker-*`, el guard de `bootstrap()` no se plegó: confirmar que `vite.renderer.config.ts` define `__HUBTIFY_PLATFORM__: '"desktop"'` (Fase 1).

Run: `node -e "require('fs').rmSync('dist/renderer-check', { recursive: true, force: true })"`

- [ ] **Step 9: Commit**

```bash
git add src/mobile/FatalScreen.tsx src/mobile/fatal-screen.css src/i18n/es.json src/i18n/en.json src/main.tsx src/App.tsx
git commit -m "feat(mobile): arranque con installMobileApi y FatalScreen ante fallos del worker"
```


## Chunk 4: Lifecycle de cauldron y notifications, `completed_at = targetEndTime`

Estas dos tareas tocan `shared-logic/` (Fase 1 mergeada). Los tests siguen el patrón que la Fase 1 deja en la suite (spec §10): `vi.mock('.../shared-logic/db')` con una DB en memoria, handlers vía `getHandler()`, invocación `fn({}, ...args)`.

### Task 10: Cauldron — `completed_at` real y suspend/resume de los intervals

**Files:**
- Modify: `shared-logic/modules/cauldron.ipc.ts` (`onTimeUp` ~línea 272; nuevo `suspendTimers`/`resumeTimers`; `registerLifecycle` al final de `registerCauldronIpcHandlers`)
- Test: `tests/modules/cauldron/cauldron.suspend.test.ts`

Contexto (spec §6 «Background» y §3.2): hoy `onTimeUp()` escribe `completed_at = new Date().toISOString()` — la hora en que corrió el callback. En Android el worker se congela en segundo plano; al reanudar, el tick recalcula `remainingMs = targetEndTime - Date.now()` y dispara `onTimeUp()` quizá 40 minutos tarde. Pasa a `completed_at = new Date(targetEndTime).toISOString()`. Y como el worker cierra la DB al suspender, los 2 intervals del caldero (`timerInterval`, `autoStartInterval`) se limpian en `suspend` y se rearman en `resume`.

- [ ] **Step 1: Escribir el test**

```ts
// tests/modules/cauldron/cauldron.suspend.test.ts
/**
 * Fase 2 mobile (spec §6 «Background» y §3.2 lifecycle).
 *
 * 1) `completed_at` es la hora en que la sesión REALMENTE terminó
 *    (`targetEndTime`), no la hora en que corrió el callback: en Android el
 *    worker se congela en segundo plano y el tick puede llegar 40 min tarde.
 * 2) `runSuspend()` limpia los intervals del caldero sin tocar el estado;
 *    `runResume()` los rearma y tickea de inmediato.
 *
 * Igual que cauldron.autostart.test.ts: handlers REALES + DB inyectada + fake
 * timers. `vi.setSystemTime` mueve el reloj de pared SIN disparar timers — es
 * exactamente lo que le pasa al worker congelado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';

interface TimerState {
  status: string;
  autoStartAt: number | null;
}

const harness = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => false,
}));

const { getHandler, runSuspend, runResume } = await import('../../../shared-logic/registry');
const { setEventSink } = await import('../../../shared-logic/events');
const { setPlatform } = await import('../../../shared-logic/platform');
const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');

// `onTimeUp` llama `platform().notify(...)` (Fase 1 reemplazó `Notification`):
// un port inerte, equivalente al mock de `Notification` de cauldron.autostart.test.ts.
setPlatform({
  appVersion: () => '0.0.0-test',
  osInfo: () => 'test',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
});

registerCauldronIpcHandlers();

const events: Array<{ channel: string; payload: unknown }> = [];
setEventSink((channel, payload) => {
  events.push({ channel, payload });
});
const ticks = () => events.filter((e) => e.channel === 'cauldron:tick').length;

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const state = () => invoke<TimerState>('cauldron:getState');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) db.exec(m.up);
  return db;
}

/** Segmentos de un minuto para que la aritmética del reloj falso sea legible. */
const MIN = 60_000;

async function makePreset(opts: { autoStartBreak: boolean } = { autoStartBreak: false }): Promise<string> {
  return invoke<string>('cauldron:upsertPreset', {
    name: `T-${Math.random()}`,
    workMinutes: 1,
    breakMinutes: 1,
    longBreakMinutes: 1,
    cyclesBeforeLong: 2,
    extensionMinutes: 5,
    autoStartBreak: opts.autoStartBreak,
    autoStartWork: false,
  });
}

function completedRows(): Array<{ type: string; completedAt: string }> {
  return harness.db
    .prepare(
      `SELECT type, completed_at AS completedAt FROM cauldron_sessions
       WHERE completed = 1 AND deleted_at IS NULL ORDER BY created_at`,
    )
    .all() as Array<{ type: string; completedAt: string }>;
}

beforeEach(async () => {
  harness.db = setupDb();
  vi.useFakeTimers();
  // Mediodía: la suite mueve el reloj decenas de minutos y no debe cruzar el día.
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  await invoke('cauldron:stop'); // el estado del timer es de módulo: arrancar en idle
  events.length = 0;
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

describe('onTimeUp: completed_at es la hora en que la sesión terminó', () => {
  it('un tick que llega 40 min tarde registra targetEndTime, no la hora actual', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);

    // Worker congelado: el reloj de pared salta sin que corra ningún tick.
    vi.setSystemTime(target + 40 * MIN);
    vi.advanceTimersByTime(1000); // un solo tick al descongelar

    const rows = completedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('work');
    expect(rows[0].completedAt).toBe(new Date(target).toISOString());
    expect(rows[0].completedAt).not.toBe(new Date().toISOString());
  });

  it('a tiempo, completed_at coincide con el target', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(1 * MIN);
    expect(completedRows()[0].completedAt).toBe(new Date(target).toISOString());
  });
});

describe('lifecycle: runSuspend / runResume', () => {
  it('suspend frena los ticks; resume rearma el interval y tickea de inmediato', async () => {
    const presetId = await makePreset();
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(2000);
    const before = ticks();
    expect(before).toBeGreaterThanOrEqual(2);
    expect(vi.getTimerCount()).toBe(1);

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(ticks()).toBe(before);

    runResume();
    expect(ticks()).toBe(before + 1); // tick inmediato
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(ticks()).toBe(before + 2);
    expect((await state()).status).toBe('work');
  });

  it('una sesión vencida durante la suspensión se completa al reanudar, con completed_at = target', async () => {
    const presetId = await makePreset();
    const target = Date.now() + 1 * MIN;
    await invoke('cauldron:start', presetId);

    runSuspend();
    vi.setSystemTime(target + 5 * MIN);
    runResume();

    const rows = completedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].completedAt).toBe(new Date(target).toISOString());
    expect((await state()).status).toBe('awaiting_next');
  });

  it('en idle, suspend y resume no arman nada', () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resume durante la cuenta regresiva de auto-inicio la rearma y dispara el descanso', async () => {
    const presetId = await makePreset({ autoStartBreak: true });
    await invoke('cauldron:start', presetId);
    vi.advanceTimersByTime(1 * MIN); // termina el enfoque → awaiting_next con autoStartAt
    expect((await state()).status).toBe('awaiting_next');
    expect((await state()).autoStartAt).not.toBeNull();

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    expect((await state()).autoStartAt).not.toBeNull(); // el estado no se toca

    vi.setSystemTime(Date.now() + 10_000); // la gracia de 5 s ya pasó
    runResume();
    vi.advanceTimersByTime(1000);
    expect((await state()).status).toBe('on_break');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/cauldron/cauldron.suspend.test.ts 2>&1 | tail -15`
Expected: `Tests  4 failed | 2 passed (6)`. El primero falla con `expected "2026-09-01T15:41:01.000Z" to be "2026-09-01T15:01:00.000Z"` (completed_at 40 min tarde); los de lifecycle fallan con `expected 1 to be 0` en `getTimerCount` (el interval sigue vivo tras `runSuspend`), salvo «sesión vencida durante la suspensión», que falla con `expected [] to have a length of 1` (sin lifecycle nada tickea al reanudar). Si en cambio falla el import de `shared-logic/registry` o `shared-logic/events`, la Fase 1 no está: parar.

- [ ] **Step 3: Cambiar `onTimeUp` en `shared-logic/modules/cauldron.ipc.ts`**

Buscar (`rg -n "function onTimeUp" shared-logic/modules/cauldron.ipc.ts`) y reemplazar el inicio de la función:

```ts
function onTimeUp(): void {
  const db = getDb();
  const now = new Date().toISOString();
  // La sesión terminó en `targetEndTime`, no cuando corrió este callback. En
  // desktop es lo mismo (el tick corre ≤ 1 s después del target); en Android el
  // worker se congela en segundo plano y el tick puede llegar minutos tarde —
  // sin esto una sesión reanudada 40 min después quedaba registrada 40 min
  // después (spec §6).
  const endedAt = new Date(targetEndTime).toISOString();
  const wasWork = timerState.sessionType === 'work';
  const wasExtension = currentSessionIsExtension;

  // Mark session as completed in DB
  if (currentSessionDbId) {
    db.prepare(
      'UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ?, target_end_time = NULL WHERE id = ?',
    ).run(endedAt, now, currentSessionDbId);
```

(El resto de la función no cambia: `updated_at` sigue siendo `now`.)

- [ ] **Step 4: Agregar `suspendTimers`/`resumeTimers` y registrar el lifecycle**

Import (junto a los otros de `../`):

```ts
import { registerLifecycle } from '../registry';
```

Después de `armAutoStart()` (`rg -n "^function armAutoStart" shared-logic/modules/cauldron.ipc.ts`), agregar:

```ts
// ─── Segundo plano (Android) ───────────────────────────────

/**
 * En Android el worker cierra la DB al suspender (spec §3.5): un tick que
 * corriera en ese estado reventaría con DbSuspended. Se limpian los DOS
 * intervals SIN tocar el estado (status, targetEndTime, autoStartAt), que es
 * lo que permite rearmarlos al volver. En Electron nunca se invoca.
 */
function suspendTimers(): void {
  clearTimer();
  if (autoStartInterval) {
    clearInterval(autoStartInterval);
    autoStartInterval = null;
  }
}

/**
 * Rearma lo que `suspendTimers` desarmó. El tick inmediato importa: si la
 * sesión venció mientras estábamos congelados, se completa AHORA (con
 * `completed_at = targetEndTime`) en vez de un segundo después.
 */
function resumeTimers(): void {
  if ((timerState.status === 'work' || timerState.status === 'on_break') && !timerInterval) {
    timerInterval = setInterval(tick, 1000);
    tick();
    return;
  }
  if (timerState.status === 'awaiting_next' && timerState.autoStartAt !== null && !autoStartInterval) {
    armAutoStart();
  }
}
```

Al final de `registerCauldronIpcHandlers()` (antes de su `}` de cierre):

```ts
  registerLifecycle({ suspend: suspendTimers, resume: resumeTimers });
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/cauldron/cauldron.suspend.test.ts 2>&1 | tail -5`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 6: Correr toda la suite del caldero**

Run: `npm test -- tests/modules/cauldron 2>&1 | tail -5`
Expected: todos `passed`. (`cauldron.autostart.test.ts` y `cauldron.phase2.test.ts` afirman sobre `completed_at` solo indirectamente; si alguno compara `completed_at` con `new Date().toISOString()` tras `advanceTimersByTime` exacto, sigue pasando porque en ese caso `now === targetEndTime`.)

- [ ] **Step 7: Commit**

```bash
git add shared-logic/modules/cauldron.ipc.ts tests/modules/cauldron/cauldron.suspend.test.ts
git commit -m "fix(cauldron): completed_at es la hora del target y los intervals sobreviven a suspend/resume"
```

### Task 11: Notifications — el polling se detiene en suspend y se rearma en resume

**Files:**
- Modify: `shared-logic/modules/notifications.ipc.ts` (`startNotificationEngine` ~línea 94; `registerLifecycle` al final de `registerNotificationIpcHandlers`)
- Test: `tests/modules/notifications/notification-lifecycle.test.ts`

`pollingInterval` (cada 30 min) llama `runNotificationCheck()`, que toca la DB. Con la DB cerrada durante suspend, reventaría. `startNotificationEngine()` además pasa a ser idempotente (hoy un segundo start filtraría un interval).

- [ ] **Step 1: Escribir el test**

```ts
// tests/modules/notifications/notification-lifecycle.test.ts
/**
 * Fase 2 mobile (spec §3.2): el polling de notificaciones (30 min, toca la DB)
 * se detiene cuando el worker suspende y se rearma al reanudar — solo si
 * estaba corriendo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const harness = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { runSuspend, runResume } = await import('../../../shared-logic/registry');
const { registerNotificationIpcHandlers, startNotificationEngine, stopNotificationEngine } =
  await import('../../../shared-logic/modules/notifications.ipc');

registerNotificationIpcHandlers();

beforeEach(() => {
  harness.db = new Database(':memory:');
  vi.useFakeTimers();
});

afterEach(() => {
  stopNotificationEngine();
  vi.useRealTimers();
});

describe('notification engine lifecycle', () => {
  it('startNotificationEngine es idempotente', () => {
    startNotificationEngine();
    startNotificationEngine();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('suspend detiene el polling y resume lo rearma', () => {
    startNotificationEngine();
    expect(vi.getTimerCount()).toBe(1);
    runSuspend();
    expect(vi.getTimerCount()).toBe(0);
    runResume();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('si el motor no estaba corriendo, resume no lo arranca', () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop explícito después de un ciclo suspend/resume deja todo limpio', () => {
    startNotificationEngine();
    runSuspend();
    runResume();
    stopNotificationEngine();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/notifications/notification-lifecycle.test.ts 2>&1 | tail -8`
Expected: `Tests  2 failed | 2 passed (4)` — «idempotente» falla con `expected 2 to be 1`; «suspend detiene» falla con `expected 1 to be 0`.

- [ ] **Step 3: Modificar `shared-logic/modules/notifications.ipc.ts`**

Import:

```ts
import { registerLifecycle } from '../registry';
```

Junto a `let pollingInterval …` (línea ~17):

```ts
/** Si el motor corría al suspender, se rearma al reanudar (spec §3.2). */
let engineWasRunning = false;
```

Reemplazar `startNotificationEngine`:

```ts
export function startNotificationEngine(): void {
  // Idempotente: `resume` lo llama sin saber si el arranque ya lo hizo.
  if (pollingInterval) return;
  // The callback MUST NOT be allowed to throw: an unhandled throw inside a
  // setInterval callback has no catch frame above it and takes the whole main
  // process down (there is no uncaughtException handler registered).
  pollingInterval = setInterval(() => {
    try {
      runNotificationCheck();
    } catch (err) {
      console.error('[notifications] scheduled check failed:', err);
    }
  }, POLLING_INTERVAL_MS);
}
```

Al final de `registerNotificationIpcHandlers()`:

```ts
  // Android: la DB se cierra durante suspend; un poll en ese estado reventaría.
  registerLifecycle({
    suspend() {
      engineWasRunning = pollingInterval !== null;
      stopNotificationEngine();
    },
    resume() {
      if (engineWasRunning) startNotificationEngine();
    },
  });
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/notifications/notification-lifecycle.test.ts 2>&1 | tail -5`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Suite completa + typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npx tsc -p shared-logic --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: ambos tsc sin salida; `Test Files  N+6 passed`, todos `passed`.

- [ ] **Step 6: Commit**

```bash
git add shared-logic/modules/notifications.ipc.ts tests/modules/notifications/notification-lifecycle.test.ts
git commit -m "fix(notifications): el polling se detiene en suspend y se rearma en resume"
```


## Chunk 5: El worker, el build Android y el smoke en el emulador

### Task 12: `src/mobile/worker.ts` — entry del worker

**Files:**
- Create: `src/mobile/worker.ts`

Requiere Fase 1. Sin test unitario propio (necesita OPFS, que solo existe en un Worker de browser en contexto seguro): la máquina de mensajes ya está testeada (Task 6) y el shim también (Task 5); esto es cableado y se verifica en el emulador (Task 14).

API real de sqlite-wasm usada (doc `persistence.md`, tipos `dist/index.d.mts`): `sqlite3.installOpfsSAHPoolVfs({ name, initialCapacity, forceReinitIfPreviouslyFailed }): Promise<SAHPoolUtil>` (lanza si el VFS «is already active in another browsing context in the same origin with the same directory»; requiere Worker + contexto seguro; sin SharedArrayBuffer ni COOP/COEP). **El resultado se cachea, éxito o fallo**: «future calls to `installOpfsSAHPoolVfs()` return consistent results» — sin `forceReinitIfPreviouslyFailed: true` (≥ 3.47) un segundo intento devuelve al instante el mismo error cacheado, así que los reintentos DEBEN pasar ese flag. `poolUtil.OpfsSAHPoolDb` (subclase de `oo1.DB`), `poolUtil.vfsName`, `poolUtil.getFileNames()`, `poolUtil.pauseVfs()` (no debe haber archivos abiertos), `poolUtil.unpauseVfs(): Promise`, `poolUtil.isPaused()`.

- [ ] **Step 1: Crear `src/mobile/worker.ts`**

```ts
/**
 * Entry del Dedicated Worker de Android (spec §2, §3.5, §4): cumple el rol del
 * main process de Electron. Corre la MISMA lógica de `shared-logic/` sobre
 * SQLite WASM con VFS `opfs-sahpool` (durable; sin SharedArrayBuffer ni
 * COOP/COEP).
 *
 * Orden de arranque — espejo de electron/main.ts:
 *   sqlite3InitModule → installOpfsSAHPoolVfs (3 reintentos) → setDbFactory
 *   → setPlatform(proxy) → setEventSink(postMessage) → registerAllHandlers()
 *   → getDb() → runAllModuleMigrations() → recurrentes del mes
 *   → startNotificationEngine() → { type:'ready' }
 *
 * Cualquier fallo antes de `ready` postea `{ type:'fatal', reason }` y el
 * worker queda inerte; la UI muestra FatalScreen.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type { Sqlite3Static, SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import { getHandler, registerAllHandlers, runResume, runSuspend } from '@logic/registry';
import { closeDb, getDb, runAllModuleMigrations, setDbFactory } from '@logic/db';
import { setPlatform, type PlatformPort } from '@logic/platform';
import { setEventSink } from '@logic/events';
import { startNotificationEngine } from '@logic/modules/notifications.ipc';
import { generateRecurringForMonth } from '@logic/modules/finance.balance';
import { todayDateString } from '../../shared/date-utils';
import { WasmDatabase } from './db/wasm-database';
import { createWorkerProtocol } from './worker-protocol';
import type { FatalMsg, UiToWorker, WorkerToUi } from './protocol';

const DB_FILE = '/hubtify.db';
const VFS_NAME = 'hubtify';
const VFS_RETRY_DELAYS_MS = [300, 600, 1200];

// El tsconfig raíz usa lib DOM (no WebWorker): se declara lo mínimo que se usa
// del scope del worker en vez de mezclar las dos libs.
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<UiToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

function post(msg: WorkerToUi, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

/** Lo que recibe un handler si llega a `getDb()` con la app en segundo plano (spec §3.3). */
class DbSuspended extends Error {
  readonly name = 'DbSuspended';
}

let sqlite3: Sqlite3Static | null = null;
let poolUtil: SAHPoolUtil | null = null;
let booted = false;
let suspended = false;
let initInfo = { appVersion: APP_VERSION, osInfo: 'android' };

const protocol = createWorkerProtocol({
  post,
  getHandler,
  onInit(info) {
    initInfo = info;
  },
  suspend() {
    suspended = true;
    // Un suspend durante el arranque (< 1 s) no tiene nada que cerrar todavía;
    // el flag basta y `resume` lo levanta.
    if (!booted) return;
    // Orden obligatorio (spec §3.5): primero los lifecycles (cauldron y
    // notifications limpian sus intervals), después la DB, después el VFS —
    // pauseVfs() exige que no haya archivos abiertos.
    runSuspend();
    closeDb();
    poolUtil?.pauseVfs();
    console.log('[worker] suspended');
  },
  async resume() {
    if (poolUtil?.isPaused()) await poolUtil.unpauseVfs();
    suspended = false;
    if (!booted) return;
    // Reabre vía la factory (closeDb descartó el singleton). El provider vuelve
    // a aplicar pragmas + initCoreTables + coreMigrations (spec §3.3): todo
    // idempotente y barato (IF NOT EXISTS / migrations_applied).
    getDb();
    runResume();
    console.log('[worker] resumed');
  },
  log: (...args) => console.error(...args),
});

// ANTES de cualquier await: los mensajes que lleguen durante el arranque
// (`init`, o un `suspend` temprano) no se pierden.
scope.onmessage = (ev) => {
  void protocol.onMessage(ev.data);
};

// PlatformPort proxy (spec §6): los métodos async hacen round-trip a la UI;
// los dos síncronos devuelven lo que llegó en `init`.
const proxyPlatform: PlatformPort = {
  appVersion: () => initInfo.appVersion,
  osInfo: () => initInfo.osInfo,
  notify: (n) => protocol.callPlatform('notify', [n]) as Promise<void>,
  openExternal: (url) => protocol.callPlatform('openExternal', [url]) as Promise<void>,
  pickTextFile: (filters) =>
    protocol.callPlatform('pickTextFile', [filters]) as ReturnType<PlatformPort['pickTextFile']>,
  pickPdfText: () => protocol.callPlatform('pickPdfText', []) as ReturnType<PlatformPort['pickPdfText']>,
  pickBinaryFile: (filters) =>
    protocol.callPlatform('pickBinaryFile', [filters]) as ReturnType<PlatformPort['pickBinaryFile']>,
  saveTextFile: (name, content) => protocol.callPlatform('saveTextFile', [name, content]) as Promise<boolean>,
  saveBinaryFile: (name, bytes) => protocol.callPlatform('saveBinaryFile', [name, bytes]) as Promise<boolean>,
};

function fatal(reason: FatalMsg['reason'], err: unknown): void {
  const e = err as { message?: string; namespace?: string; version?: number } | undefined;
  const msg: FatalMsg = { type: 'fatal', reason, message: e?.message ?? String(err) };
  if (typeof e?.namespace === 'string') msg.namespace = e.namespace;
  if (typeof e?.version === 'number') msg.version = e.version;
  console.error('[worker] fatal', reason, err);
  post(msg);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// El .d.mts 3.53.0-build1 no tipa `forceReinitIfPreviouslyFailed` (existe
// desde 3.47, doc persistence.md); se amplía el tipo localmente.
type SahPoolOptions = Parameters<Sqlite3Static['installOpfsSAHPoolVfs']>[0] & {
  forceReinitIfPreviouslyFailed?: boolean;
};

/**
 * El VFS es exclusivo por origen + name: si un WebView anterior (reload,
 * crash) todavía retiene los handles, la instalación falla. Reintento con
 * backoff 300/600/1200 ms (spec §4) antes de rendirse.
 *
 * sqlite-wasm CACHEA el resultado de installOpfsSAHPoolVfs (éxito o fallo):
 * sin `forceReinitIfPreviouslyFailed` los intentos 2..4 devolverían el mismo
 * error al instante y el backoff sería puro teatro.
 */
async function installVfs(sq: Sqlite3Static): Promise<SAHPoolUtil> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    const opts: SahPoolOptions = {
      name: VFS_NAME,
      initialCapacity: 6,
      forceReinitIfPreviouslyFailed: attempt > 0,
    };
    try {
      return await sq.installOpfsSAHPoolVfs(opts);
    } catch (err) {
      lastErr = err;
      const delay = VFS_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      console.warn(`[worker] installOpfsSAHPoolVfs falló (intento ${attempt + 1}), reintento en ${delay} ms:`, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}

type InitModule = (opts: {
  locateFile: (path: string, prefix: string) => string;
  print?: (...a: unknown[]) => void;
  printErr?: (...a: unknown[]) => void;
}) => Promise<Sqlite3Static>;

async function boot(): Promise<void> {
  // 1. Runtime WASM. `locateFile` apunta al asset que Vite emite para
  //    '@sqlite.org/sqlite-wasm/sqlite3.wasm?url' → dist/mobile/assets/sqlite3-*.wasm.
  try {
    sqlite3 = await (sqlite3InitModule as unknown as InitModule)({
      locateFile: () => wasmUrl,
      print: (...a) => console.log('[sqlite]', ...a),
      printErr: (...a) => console.warn('[sqlite]', ...a),
    });
  } catch (err) {
    fatal('open', err);
    return;
  }

  // 2. VFS durable.
  try {
    poolUtil = await installVfs(sqlite3);
  } catch (err) {
    fatal('vfs', err);
    return;
  }
  console.log(`[worker] vfs: opfs-sahpool name=${poolUtil.vfsName} files=${JSON.stringify(poolUtil.getFileNames())}`);

  // 3. Contexto implícito de shared-logic (spec §3.3).
  const sq = sqlite3;
  const pool = poolUtil;
  setDbFactory(() => {
    if (suspended && booted) throw new DbSuspended('DB suspendida: la app está en segundo plano');
    return new WasmDatabase(sq, new pool.OpfsSAHPoolDb(DB_FILE));
  });
  setPlatform(proxyPlatform);
  setEventSink((channel, payload) => post({ type: 'event', channel, payload }));

  // 4. Handlers, DB y migraciones (espejo de electron/main.ts).
  registerAllHandlers();
  try {
    getDb(); // pragmas + initCoreTables + coreMigrations
  } catch (err) {
    fatal((err as { namespace?: string })?.namespace ? 'migration' : 'open', err);
    return;
  }
  try {
    runAllModuleMigrations();
  } catch (err) {
    fatal('migration', err);
    return;
  }

  // 5. Recurrentes del mes: best-effort, igual que main.ts.
  try {
    const currentMonth = todayDateString().slice(0, 7); // YYYY-MM
    const generated = generateRecurringForMonth(getDb(), currentMonth);
    if (generated > 0) console.log(`[worker] generated ${generated} recurring transaction(s) for ${currentMonth}`);
  } catch (err) {
    console.error('[worker] recurring generation failed:', err);
  }

  startNotificationEngine();
  booted = true;
  post({ type: 'ready' });
  console.log('[worker] ready');
}

void boot();
```

Notas de compatibilidad con la Fase 1:
- `setDbFactory` recibe `() => SqlDatabase`; `WasmDatabase` debe satisfacerla estructuralmente. Si tsc marca `transaction`/`pragma`, ajustar la firma en `wasm-database.ts` a la de `shared-logic/db/sql-database.ts` (no al revés).
- `DbSuspended`: la spec §3.3/§10 lo ubica en el provider de la Fase 1 («`closeDb` → `getDb` lanza `DbSuspended` mientras está suspendido»), lo que sugiere que el provider tiene su propio estado de suspensión. Task 1 Step 2 lo verifica con `rg -n "DbSuspended|suspend" shared-logic/db/`. Según lo que haya:
  - el provider exporta `DbSuspended` → importarlo desde `@logic/db` y borrar la clase local;
  - el provider expone un API de suspensión (p. ej. `suspendDb()`/`resumeDb()`, o `closeDb({ suspend: true })`) → llamarla en `suspend()`/`resume()` de arriba (en lugar del `closeDb()` pelado y ANTES del `getDb()` del resume) y dejar la factory sin el `throw` (el provider ya lanza);
  - el provider no tiene nada de eso → queda tal como está: `closeDb()` + siguiente `getDb()` reabre (así lo usa `backup.ipc.ts`) y el «lanza mientras está suspendido» lo aporta la factory.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: sin salida. Si `'@sqlite.org/sqlite-wasm/sqlite3.wasm?url'` no resuelve: `src/vite-env.d.ts` (`/// <reference types="vite/client" />`) ya existe y declara `*?url`; confirmar que sigue en `src/`.

- [ ] **Step 3: Commit**

```bash
git add src/mobile/worker.ts
git commit -m "feat(mobile): worker con sqlite-wasm sobre opfs-sahpool, suspend/resume y proxy de plataforma"
```

### Task 13: Scripts, build web, scaffold `android/` y APK

**Files:**
- Create: `scripts/android-version.mjs`, `scripts/gradle.mjs`
- Test: `tests/mobile/android-version.test.ts`
- Modify: `package.json` (scripts)
- Create: `android/` (generado por `npx cap add android`)

- [ ] **Step 1: Escribir el test del script de versión**

```ts
// tests/mobile/android-version.test.ts
import { describe, it, expect } from 'vitest';
import { versionCodeFrom, patchBuildGradle } from '../../scripts/android-version.mjs';

const TEMPLATE = `    defaultConfig {
        applicationId "com.hubtify.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }`;

describe('android-version', () => {
  it('versionCode = major*10000 + minor*100 + patch', () => {
    expect(versionCodeFrom('0.8.2')).toBe(802);
    expect(versionCodeFrom('1.2.3')).toBe(10203);
    expect(versionCodeFrom('2.0.0-beta.1')).toBe(20000);
  });

  it('rechaza versiones que no son semver o que desbordan', () => {
    expect(() => versionCodeFrom('abc')).toThrow(/inválida/);
    expect(() => versionCodeFrom('1.100.0')).toThrow(/versionCode/);
  });

  it('reescribe versionCode y versionName en el template de Capacitor', () => {
    const out = patchBuildGradle(TEMPLATE, '0.8.2');
    expect(out).toContain('versionCode 802');
    expect(out).toContain('versionName "0.8.2"');
    expect(out).toContain('applicationId "com.hubtify.app"');
  });

  it('es idempotente', () => {
    const once = patchBuildGradle(TEMPLATE, '0.8.2');
    expect(patchBuildGradle(once, '0.8.2')).toBe(once);
  });

  it('lanza si el gradle no tiene los campos', () => {
    expect(() => patchBuildGradle('android {}', '0.8.2')).toThrow(/versionCode/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/android-version.test.ts 2>&1 | tail -5`
Expected: `Failed to resolve import "../../scripts/android-version.mjs"`.

- [ ] **Step 3: Crear `scripts/android-version.mjs`**

```js
#!/usr/bin/env node
/**
 * Escribe `versionName` y `versionCode` en android/app/build.gradle a partir
 * de package.json (spec §5: versionCode = major*10000 + minor*100 + patch).
 * Lo corre `npm run mobile:sync` antes de `cap sync`. Sin dependencias.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function versionCodeFrom(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`versión inválida en package.json: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`minor/patch > 99 rompen el orden de versionCode: ${version}`);
  }
  return major * 10000 + minor * 100 + patch;
}

export function patchBuildGradle(source, version) {
  const code = versionCodeFrom(version);
  let hits = 0;
  const out = source
    .replace(/versionCode\s+\d+/, () => {
      hits++;
      return `versionCode ${code}`;
    })
    .replace(/versionName\s+"[^"]*"/, () => {
      hits++;
      return `versionName "${version}"`;
    });
  if (hits !== 2) throw new Error('no encontré versionCode/versionName en android/app/build.gradle');
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
  const before = readFileSync(gradlePath, 'utf8');
  const after = patchBuildGradle(before, version);
  if (after !== before) writeFileSync(gradlePath, after);
  console.log(`[android-version] versionName ${version} versionCode ${versionCodeFrom(version)}`);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/android-version.test.ts 2>&1 | tail -5`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Crear `scripts/gradle.mjs`**

```js
#!/usr/bin/env node
/**
 * `npm run mobile:apk` cross-platform. npm corre los scripts con cmd.exe en
 * Windows (no existe `./gradlew`) y con sh en CI/ubuntu (no existe
 * gradlew.bat). Uso: node scripts/gradle.mjs assembleDebug
 *
 * JAVA_HOME debe apuntar a un JDK 21 (ver «Entorno» del plan).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('uso: node scripts/gradle.mjs <tarea gradle…>');
  process.exit(2);
}
if (!process.env.JAVA_HOME) {
  console.warn('[gradle] JAVA_HOME no está seteado: Gradle usará el java del PATH (se espera JDK 21).');
}

const result = spawnSync(isWin ? path.join(androidDir, 'gradlew.bat') : './gradlew', args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(result.status ?? 1);
```

- [ ] **Step 6: Agregar los scripts a `package.json`** (después de `"rebuild"`)

```json
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "mobile:build": "vite build -c vite.mobile.config.ts",
    "mobile:sync": "npm run mobile:build && node scripts/android-version.mjs && cap sync android",
    "mobile:run": "npm run mobile:sync && cap run android",
    "mobile:apk": "npm run mobile:sync && node scripts/gradle.mjs assembleDebug"
```

- [ ] **Step 7: Build web mobile**

Run: `npm run mobile:build 2>&1 | tail -15`
Expected: termina con `✓ built in Xs`, y entre las líneas `dist/mobile/...` aparecen `dist/mobile/index.html`, `dist/mobile/assets/sqlite3-<hash>.wasm` (~865 kB) y `dist/mobile/assets/worker-<hash>.js`. Confirmar:

Run: `rg --files --no-ignore dist/mobile/assets | rg "sqlite3-.+\.wasm$|worker-.+\.js$"`
Expected: dos líneas, una por archivo.

Errores esperables:
- `Top-level await is not available in the configured target` → `build.target` no es `es2022`; revisar `vite.mobile.config.ts`.
- `Could not resolve "@logic/..."` → falta el alias en `vite.mobile.config.ts` o la Fase 1 no está.

- [ ] **Step 8: Generar el scaffold Android**

Run: `npx cap add android 2>&1 | tail -8`
Expected:
```
✔ Adding native android project in android in Xms
✔ Syncing Gradle in Xms
✔ add in Xms
[success] android platform added!
```
(`cap add` lee `appId`/`appName` de `capacitor.config.ts`: `android/app/src/main/AndroidManifest.xml` y `android/app/build.gradle` salen con `com.hubtify.app`.)

Run: `rg -n "applicationId|namespace|versionCode|versionName" android/app/build.gradle && rg -n "app_name" android/app/src/main/res/values/strings.xml`
Expected: `applicationId "com.hubtify.app"`, `namespace "com.hubtify.app"`, `versionCode 1`, `versionName "1.0"`, `<string name="app_name">Hubtify</string>`.

No tocar `android/variables.gradle` (minSdk 24, compile/target 36 en el template de Capacitor 8).

- [ ] **Step 9: Sync (copia `dist/mobile` + plugins + versión)**

Run: `npm run mobile:sync 2>&1 | tail -12`
Expected, en orden: el build de Vite, `[android-version] versionName 0.8.2 versionCode 802`, y de `cap sync`:
```
✔ Copying web assets from dist/mobile to android/app/src/main/assets/public
✔ Creating capacitor.config.json in android/app/src/main/assets
[info] Found 3 Capacitor plugins for android:
       @capacitor/app@8.1.1
       @capacitor/device@8.0.3
       @capacitor/status-bar@8.0.3
✔ Updating Android plugins
[success] Sync finished
```

Run: `rg -n "versionCode|versionName" android/app/build.gradle`
Expected: `versionCode 802` y `versionName "0.8.2"`.

- [ ] **Step 10: Verificar qué entra en git del scaffold**

Run: `git check-ignore -v android/app/src/main/assets/public android/app/build android/.gradle android/local.properties 2>&1`
Expected: las cuatro rutas listadas como ignoradas (el `android/.gitignore` del template cubre `app/src/main/assets/public`, `build/`, `.gradle`, `local.properties`; el raíz cubre el resto). Si `assets/public` NO aparece, agregar `android/app/src/main/assets/public/` al `.gitignore` raíz.

Run: `git status --short | rg -v "^\?\? android/" | head`
Expected: solo `package.json`, `package-lock.json` (si cambió) y los `scripts/`/`tests/` nuevos; `android/` entero aparece como untracked (`?? android/`).

- [ ] **Step 11: Compilar el APK debug**

En una shell con el «Entorno» exportado:

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="D:/android-sdk"
npm run mobile:apk 2>&1 | tail -15
```
Expected: (la primera vez Gradle descarga su distribución y las dependencias — varios minutos) termina con `BUILD SUCCESSFUL in Xm Ys`.

Run: `node -e "const s=require('fs').statSync('android/app/build/outputs/apk/debug/app-debug.apk').size; console.log('app-debug.apk', (s/1e6).toFixed(1), 'MB')"`
Expected: `app-debug.apk N.N MB` (N > 3).

Errores esperables:
- `SDK location not found` → `ANDROID_HOME` no exportado en esta shell.
- `Unsupported class file major version` / `Your build is currently configured to use incompatible Java 24` → `JAVA_HOME` sigue apuntando al 24/25.
- `Could not resolve all files for configuration ':app:debugRuntimeClasspath'` → sin red para Maven; reintentar.

- [ ] **Step 12: Suite, lint, typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: sin errores; `Test Files  N+7 passed`.

- [ ] **Step 13: Commit (scripts + scaffold)**

```bash
git add package.json package-lock.json scripts/android-version.mjs scripts/gradle.mjs tests/mobile/android-version.test.ts android
git status --short android | rg "build/|\.gradle/|assets/public" ; echo "(vacío = ok)"
git commit -m "feat(mobile): scaffold android, scripts mobile:* y versionado desde package.json"
```

### Task 14: Smoke en el emulador y anotación del MIME `.wasm`

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-mobile-phase2-capacitor-worker.md` (sección «Resultado MIME `.wasm`», al final)

Emulador AVD `hubtify` ya booteado (`emulator-5554`, WebView Chromium 124). Criterios de aceptación de la spec §11 fila 2.

- [ ] **Step 1: Instalar y arrancar**

```bash
export ADB="D:/android-sdk/platform-tools/adb.exe"
"$ADB" devices
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" logcat -c
"$ADB" shell am start -n com.hubtify.app/.MainActivity
```
Expected: `emulator-5554   device`; `Success`; `Starting: Intent { cmp=com.hubtify.app/.MainActivity }`.

- [ ] **Step 2: Verificar el log del worker**

Esperar ~10 s y:

Run: `"$ADB" logcat -d | rg -i "\[worker\]|\[sqlite\]|falling back to ArrayBuffer|wasm streaming compile failed|fatal"`
Expected (los mensajes de consola del WebView salen con tag `chromium`, formato `[INFO:CONSOLE(n)] "..."`):
```
... "[worker] vfs: opfs-sahpool name=hubtify files=[]", source: https://localhost/assets/worker-<hash>.js
... "[worker] ready", source: ...
```
Puede aparecer una línea `[sqlite] Ignoring inability to install OPFS sqlite3_vfs: ... SharedArrayBuffer` — es el VFS `opfs` clásico (necesita COOP/COEP), no el `opfs-sahpool`; es esperable y no es error.

Si aparece `fatal vfs`: el WebView no expone OPFS (`navigator.storage.getDirectory` / `createSyncAccessHandle`). Verificar la versión del WebView: `"$ADB" shell dumpsys package com.google.android.webview | rg versionName` (se espera ≥ 108). Es el riesgo #1 de la spec §12; el fallback (Filesystem + export periódico) está documentado en §4 y NO se implementa en esta fase.

- [ ] **Step 3: Anotar el resultado del MIME `.wasm`**

Run: `"$ADB" logcat -d | rg -c "falling back to ArrayBuffer instantiation"`
- `0` → el WebView sirvió `application/wasm` e `instantiateStreaming` funcionó.
- `1` (precedido de `wasm streaming compile failed: TypeError: ... MIME type`) → cayó a `WebAssembly.instantiate`: más lento al cargar, aceptable (spec §4).

Escribir el resultado en la sección «Resultado MIME `.wasm`» al final de este plan (reemplazar «_pendiente_») con: fecha, versión del WebView, y cuál de los dos casos fue.

- [ ] **Step 4: Persistencia (el criterio que importa)**

Manual, en el emulador:
1. Login con la cuenta de prueba (Firebase Auth, el emulador tiene red).
2. Questify → crear una tarea `smoke fase 2`.
3. Matar la app: `"$ADB" shell am force-stop com.hubtify.app`.
4. Reabrir: `"$ADB" shell am start -n com.hubtify.app/.MainActivity`.
5. La tarea `smoke fase 2` sigue ahí.

Evidencia objetiva además del ojo: en el segundo arranque el log dice `files=["/hubtify.db"]`:

Run: `"$ADB" logcat -d | rg "\[worker\] vfs"`
Expected: la última línea contiene `files=["/hubtify.db"]`.

- [ ] **Step 5: Suspend/resume**

1. Con la app abierta, ir a Cauldron y arrancar una sesión.
2. Home del emulador (app a segundo plano) → `"$ADB" logcat -d | rg "\[worker\] (suspended|resumed)"` muestra `suspended`.
3. Volver a la app → aparece `resumed` y el timer sigue descontando.

Expected: las dos líneas, en ese orden, sin `fatal` ni `DbSuspended` en el log.

Para inspeccionar con DevTools: abrir `chrome://inspect` en Chrome de escritorio con el emulador conectado; el WebView de `com.hubtify.app` aparece (los builds debug de Capacitor habilitan `setWebContentsDebuggingEnabled`).

- [ ] **Step 6: Commit de la anotación**

```bash
git add docs/superpowers/plans/2026-09-01-mobile-phase2-capacitor-worker.md
git commit -m "docs(mobile): resultado del MIME .wasm y smoke de persistencia en el emulador"
```

### Task 15: Cierre de la fase

- [ ] **Step 1: Verificación final completa**

Run: `npx tsc --noEmit && npx tsc -p shared-logic --noEmit && npm run lint && npm test 2>&1 | tail -4`
Expected: sin errores; `Test Files  N+7 passed`, `Tests  M+69 passed` (7 archivos nuevos: protocol 8, wasm-database 16, worker-protocol 13, worker-client 17, android-version 5, cauldron.suspend 6, notification-lifecycle 4 = 69 tests).

- [ ] **Step 2: Checklist de aceptación (spec §11, fila 2)**

- [ ] `npm run mobile:apk` produce `android/app/build/outputs/apk/debug/app-debug.apk`
- [ ] existe `dist/mobile/assets/sqlite3-*.wasm`
- [ ] el worker loguea `vfs: opfs-sahpool`
- [ ] emulador: login, crear tarea, matar app, reabrir → persiste
- [ ] resultado del MIME `.wasm` anotado abajo
- [ ] `npm test` verde, `tsc` (raíz y `shared-logic`) verde, lint verde

- [ ] **Step 3: Estado de la rama**

Run: `git log --oneline master..feature/mobile | head -20 && git status --short`
Expected: los commits de este plan (más los de la Fase 1) y working tree limpio.

---

## Resultado MIME `.wasm` (se completa en Task 14 Step 3)

_pendiente_

Formato: `YYYY-MM-DD — WebView <versionName> — instantiateStreaming OK | fallback a WebAssembly.instantiate ("wasm streaming compile failed: <motivo>")`.
