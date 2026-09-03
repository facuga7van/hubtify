# Hubtify Mobile (Android) — Diseño

**Fecha:** 2026-09-01 · **Rama:** `feature/mobile` · **Base:** v0.8.2 · **Estado:** aprobado (camino C), revisión cerrada

## 1. Contexto y objetivo

Hubtify corre hoy como Electron 41 + React 19 + better-sqlite3. Se quiere una versión **Android** (sin iOS) con **paridad funcional**: Questify, Coinify, Nutrify, Character y Cauldron. Requisitos duros:

- Un solo repo, un solo renderer, una sola lógica de negocio. Agregar una feature = un cambio que llega a los dos targets.
- Release simultáneo: el mismo tag `v*` produce el instalador Windows **y** un APK firmado, ambos en el mismo GitHub Release de `facuga7van/hubtify-releases`.
- Firestore, merge de sync y Syl (integrador externo) **no cambian**.

**Fuera de alcance en v1 (explícito):** ejecución en background. En Android el WebView y su Worker se congelan cuando la app pasa a segundo plano; el temporizador del Cauldron y el motor de notificaciones solo corren con la app abierta (ver §6 y §12 Fase 6). Import de resúmenes PDF en mobile. Backup ZIP en mobile (usa `.db` crudo).

Stack mobile: Capacitor 8.5.x (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`) + plugins `app`, `device`, `status-bar`, `local-notifications`, `filesystem`, `share`, `browser`; JDK 21 (Temurin instalado); Android SDK 35/36; `@sqlite.org/sqlite-wasm` 3.53.0-build1.

Los hechos del código que sustentan cada decisión están en el **Anexo A**.

## 2. Decisión: camino C — el Worker es el "main process"

**Elegido:** en Android, un Dedicated Worker cumple el rol del main process de Electron. Corre la MISMA lógica síncrona sobre SQLite WASM durable, y el renderer le habla por `postMessage` con los mismos canales `module:action` que hoy viajan por `ipcRenderer.invoke`.

**Descartado A (adapter async):** better-sqlite3 exige callbacks síncronos en `transaction()`. Volver async los ~10k LOC de handlers implica tocar 69 tests, serializar handlers para evitar que dos `invoke` concurrentes interleaven escrituras dentro de una transacción ajena, y no aporta nada funcional.

**Descartado B (sql.js en el hilo UI):** DB en memoria, persistir es exportar el archivo entero tras cada escritura; bloquea el hilo de UI; durabilidad "si el flush llega antes de que Android mate el proceso".

## 3. Arquitectura

```
                         shared-logic/               (TS puro, síncrono, sin electron/node/dom)
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ registry.ts     registerHandler · getHandler · listChannels · clearHandlers
   │                 registerLifecycle({suspend, resume}) · runSuspend/runResume
   │                 registerAllHandlers()  (llama a los 14 register*IpcHandlers)
   │ db/sql-database.ts   interfaces SqlDatabase / SqlStatement / RunResult    │
   │ db/provider.ts       getDb() · setDbFactory() · closeDb()                 │
   │ db/migrate.ts        initCoreTables · coreMigrations · applyMigrations ·  │
   │                      runModuleMigrations                                  │
   │ db/all-migrations.ts runAllModuleMigrations()  (6 módulos + notifications)│
   │ db/index.ts          re-exporta todo lo anterior (ÚNICO path de import)   │
   │ platform.ts     PlatformPort iface · setPlatform() · platform()           │
   │ events.ts       emit(channel, payload) · setEventSink()                   │
   │ ids.ts          genId()  (globalThis.crypto.randomUUID)                   │
   │ modules/        quests, quests.habits, nutrition, finance, finance.balance,
   │                 finance-import, character, sync, cauldron, notifications, │
   │                 notifications.schema, notification-engine, dollar, crypto,│
   │                 feedback, syl, syl.snapshot, rpg-handlers, rpg-stats       │
   └─────────────────────────────────────────────────────────────────────────┘
              ▲ import                                       ▲ import
   ┌──────────┴────────────────────┐            ┌────────────┴──────────────────┐
   │ electron/ (binding desktop)   │            │ src/mobile/ (binding Android)  │
   │ ipc/db.ts  (fino) crea el     │            │ worker.ts  setDbFactory(wasm   │
   │  Database better-sqlite3 en   │            │  opfs-sahpool) · setPlatform(  │
   │  app.getPath('userData')      │            │  proxy→UI) · registerAll...()  │
   │ platform.ts  PlatformPort     │            │  · onmessage → getHandler(ch)  │
   │  COMPLETO (dialog, fs, pdf-   │            │  · suspend/resume              │
   │  parse, app, os, Notification)│            │ install-api.ts  window.api     │
   │ modules/pdf-parse.d.ts        │            │  desde shared/api-channels.ts  │
   │ ipc/registry.ts registerAll-  │            │ platform-host.ts  ejecuta      │
   │  IpcHandlers(): registerAll-  │            │  PlatformPort con plugins Cap. │
   │  Handlers() + bind a ipcMain  │            │ backup.ts (Fase 5), updater.ts │
   │ preload.ts  window.api desde  │            │  (Fase 6), FatalScreen.tsx     │
   │  shared/api-channels.ts       │            │                                │
   │ modules/backup.ipc.ts, updater│            │                                │
   │  .ts, main.ts (tray, ventanas)│            │                                │
   └───────────────────────────────┘            └────────────────────────────────┘

   main.ts (orden de arranque): setDbFactory(openDesktopDb) → setPlatform(electronPlatform)
     → setEventSink(webContentsSink) → registerAllIpcHandlers() → getDb() → runAllModuleMigrations()
                     src/ (renderer React) — API `window.api` sin cambios
```

**Qué queda en `electron/` y no se comparte:** `ipc/db.ts` (fino: `openDesktopDb()`), `platform.ts` + `modules/pdf-parse.d.ts`, `modules/backup.ipc.ts` (adm-zip, fs, `db.backup()`), `modules/updater.ts` (Squirrel), `main.ts` (Tray, ventanas, `window:*`, ventana flotante del Cauldron). `adm-zip` y `pdf-parse` solo se importan desde `electron/`.

### 3.1 `shared/api-channels.ts` — la tabla única

```ts
export type ChannelKind = 'invoke' | 'send' | 'on';
export interface ChannelSpec {
  channel: string;
  kind: ChannelKind;
  platforms?: 'desktop';                       // ausente = ambos
  unwrap?: (payload: unknown) => unknown;      // solo kind 'on'; ver abajo
}
export const API_CHANNELS = {
  getTasks:        { channel: 'quests:getTasks',     kind: 'invoke' },
  windowMinimize:  { channel: 'window:minimize',     kind: 'send' },
  backupExport:    { channel: 'backup:export',       kind: 'invoke', platforms: 'desktop' },
  onCauldronTick:  { channel: 'cauldron:tick',       kind: 'on' },
  onRpgAchievementUnlocked:   { channel: 'rpg:achievementUnlocked',   kind: 'on', unwrap: (p) => (p as {id?: string})?.id },
  onRpgAchievementsBackfilled:{ channel: 'rpg:achievementsBackfilled',kind: 'on', unwrap: (p) => (p as {ids?: string[]})?.ids ?? [] },
  onUpdateDownloaded:         { channel: 'updater:update-downloaded', kind: 'on', unwrap: () => undefined },
  // … 253 entradas
} as const satisfies Record<keyof HubtifyApi, ChannelSpec>;
```

`satisfies Record<keyof HubtifyApi, …>` hace que **olvidarse una entrada sea error de tipos**. `preload.ts` y `src/mobile/install-api.ts` iteran la tabla y construyen `window.api` con el mismo generador (`shared/build-api.ts`, recibe un `Transport { invoke, send, on, off }`):

- `invoke` → `(...args) => transport.invoke(channel, ...args)`
- `send` → `(...args) => transport.send(channel, ...args)`; en mobile `send` es no-op (`window:*` no tiene sentido).
- `on` → `(cb) => { const h = (payload) => cb(unwrap ? unwrap(payload) : payload); transport.on(channel, h); return () => transport.off(channel, h); }`. Los 3 `unwrap` de arriba son los únicos casos donde el preload actual no pasa el payload tal cual (verificado en `preload.ts:148-156` y `339`).

**Canales desktop-only** (`platforms: 'desktop'`): `backupExport`, `backupPickImportFile`, `backupImport`, `cauldronOpenWindow`, `cauldronCloseWindow`, `updaterCheck`, `updaterDownload`, `updaterRestart`. `installMobileApi()` **omite** esas propiedades (quedan `undefined`) y en `HubtifyApi` pasan a ser opcionales (`?:`); los consumidores en `src/` ya se protegen o se envuelven en `if (window.api.x)`. No hay canales de Tray en `HubtifyApi`. `window*` (kind `send`) y `onUpdate*` (kind `on`) NO se marcan desktop-only: en mobile `send` es no-op y los eventos `updater:*` los emitirá `src/mobile/updater.ts` en Fase 6.

`cauldron:openWindow` / `cauldron:closeWindow` (hoy `ipcMain.handle` directo en `main.ts:351-352`) pasan por `ipcHandle` en Fase 1 dentro de `electron/` (siguen siendo desktop-only; el worker no los registra).

### 3.2 Registro de handlers

```ts
// shared-logic/registry.ts
export type HandlerEvent = {};      // fijo: IpcMainInvokeEvent se descarta; worker y tests pasan {}
export type Handler = (event: HandlerEvent, ...args: any[]) => unknown | Promise<unknown>;
export function registerHandler(channel: string, fn: Handler): void  // throw si duplicado
export function getHandler(channel: string): Handler | undefined
export function listChannels(): string[]
export function clearHandlers(): void     // solo tests
export function registerAllHandlers(): void   // invoca los 14 register*IpcHandlers de modules/ (conservan su nombre: cero churn)

export interface Lifecycle { suspend(): void; resume(): void }
export function registerLifecycle(l: Lifecycle): void
export function runSuspend(): void        // ejecuta todos los suspend() registrados
export function runResume(): void
```

`registerLifecycle` existe porque `cauldron.ipc.ts` (5 `setInterval`: tick de 1 s y auto-start) y `notifications.ipc.ts` (`pollingInterval`, línea 98) mantienen timers que tocan la DB; con la DB cerrada durante `suspend` esos callbacks reventarían. Cada uno registra `{ suspend: clearInterval…, resume: re-crear el interval si había sesión activa }`. En Electron nunca se invoca (no hay suspend).

Se conserva la firma `(event, ...args)` a propósito: 148 handlers ya la tienen como `(_e, ...)` y 21 tests los invocan como `fn(null, ...args)`. Quitar el parámetro es un follow-up cosmético.

`electron/ipc/ipc-handle.ts` queda como `export { registerHandler as ipcHandle }`. `electron/ipc/registry.ts` conserva `registerAllIpcHandlers()`, que llama a `registerAllHandlers()` de shared-logic y luego `for (const ch of listChannels()) ipcMain.handle(ch, async (_e, ...a) => { try { return await fn({}, ...a) } catch (err) { console.error(`[${ch}]`, err); throw err } })`. Mismo logging que hoy. El worker hace lo equivalente con `fn({}, ...args)`; un canal sin handler responde `{ ok:false, error:{ name:'NoHandler', message: channel } }` e `install-api.ts` rechaza la promesa con ese error.

### 3.3 Contexto implícito: `getDb()`, `platform()`, `emit()`

Los handlers llaman `getDb()` inline (229 veces). **No se cambia la firma de los handlers.** El contexto se inyecta por proveedores globales de `shared-logic`:

- `getDb()` (`shared-logic/db`) → en la primera llamada invoca la factory de `setDbFactory()` (better-sqlite3 en Electron y tests, shim WASM en el worker), aplica pragmas comunes, `initCoreTables` y `coreMigrations`, como hoy `db.ts`. Luego cada binding llama `runAllModuleMigrations()` (`db/all-migrations.ts`), que reemplaza las 6 llamadas sueltas de `main.ts:360-365` y suma `notifications.schema.ts` (que se mueve a `shared-logic/modules/`). `closeDb()` cierra y descarta el singleton; tras `closeDb()` y mientras el worker está suspendido, `getDb()` lanza `DbSuspended` (en Electron `closeDb()` solo lo usa `backup.ipc.ts` al restaurar, y la siguiente `getDb()` reabre normalmente). `electron/ipc/db.ts` SE CONSERVA como archivo fino: exporta `openDesktopDb()` que crea el `Database` de better-sqlite3 en `app.getPath('userData')/hubtify.db`; `main.ts` hace `setDbFactory(openDesktopDb)` antes de `registerAllIpcHandlers()`. `backup.ipc.ts` importa `closeDb` desde `shared-logic/db` en lugar del `require('../ipc/db')` dinámico de la línea 92.
- `platform()` → `PlatformPort` inyectado con `setPlatform()` (§6).
- `emit(channel, payload)` → reemplaza los `broadcast()` de `rpg-handlers.ts` y `cauldron.ipc.ts` y los `webContents.send` de `notifications.ipc.ts`. Sink inyectado con `setEventSink()`: Electron → `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` en try/catch como hoy; worker → `self.postMessage({ type:'event', channel, payload })`.

Todos los módulos importan DB **solo** desde `shared-logic/db` (`index.ts`), que re-exporta `getDb`, `setDbFactory`, `closeDb`, `initCoreTables`, `coreMigrations`, `applyMigrations`, `runModuleMigrations`, `runAllModuleMigrations` y los tipos. Los 21 tests que hoy hacen `vi.mock('../../../electron/ipc/db', () => ({ getDb: () => harness.db }))` pasan a mockear `shared-logic/db` — un solo mock. Los 14 tests que importan `coreMigrations` cambian solo la ruta.

### 3.4 Interfaz `SqlDatabase` (subconjunto exacto usado)

```ts
// shared-logic/db/sql-database.ts
export interface RunResult { changes: number; lastInsertRowid: number | bigint }
export interface SqlStatement<Row = unknown> {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}
export interface SqlDatabase {
  prepare<Row = unknown>(sql: string): SqlStatement<Row>;
  exec(sql: string): void;
  pragma(directive: string): unknown;
  transaction<F extends (...a: any[]) => any>(fn: F): F;   // devuelve función; se invoca luego
  close(): void;
}
```

`db.backup()` no forma parte: solo lo usa `backup.ipc.ts`, que queda en `electron/` con el tipo de better-sqlite3. `import type Database from 'better-sqlite3'` en 8 archivos de shared-logic pasa a `import type { SqlDatabase } from '../db'`. better-sqlite3 satisface la interfaz estructuralmente.

**Shim WASM (`src/mobile/db/wasm-database.ts`)** sobre `sqlite3.oo1.DB`:

- Los 601 `.prepare(` del código están todos inline dentro de funciones (0 a nivel de módulo), así que cada llamada prepararía de nuevo. El shim cachea por string SQL con LRU de 256 entradas; al evictar llama `stmt.finalize()`. `run` = `bind(params).stepReset()`, `changes = db.changes()`, `lastInsertRowid = sqlite3.capi.sqlite3_last_insert_rowid(db.pointer)`. `get/all` = `bind`, iterar `step()` con `stmt.get({})` (objetos por nombre de columna), `reset()` en `finally`.
- Parámetros: solo posicionales (0 nombrados en el código). `true/false` → 1/0, `undefined` → `null`, `bigint` → `Number`.
- `transaction(fn)` → `(...a) => { BEGIN; try { r = fn(...a); COMMIT; return r } catch { ROLLBACK; throw } }`; anidado con `SAVEPOINT sN` / `RELEASE` / `ROLLBACK TO` (como better-sqlite3).
- `pragma(s)` → escritura `db.exec('PRAGMA '+s)`, lectura `db.selectValue`. `journal_mode=WAL` se omite en sahpool (no soportado).
- `exec(sql)` → `db.exec(sql)` (multi-statement).

### 3.5 Transporte worker ⇄ UI

- UI→worker: `{ id, type:'invoke', channel, args }`. Worker→UI: `{ id, type:'result', ok:true, value } | { id, type:'result', ok:false, error:{ name, message } }`; eventos `{ type:'event', channel, payload }`.
- PlatformPort inverso: worker→UI `{ id, type:'platform', method, args }`; UI→worker `{ id, type:'platform-result', ok, value | error }`.
- `Uint8Array` (backup, `pickBinaryFile`) viaja con **transfer list** en ambos sentidos (`postMessage(msg, [buf])`).
- Arranque: `src/main.tsx` hace `if (isNativeMobile()) await installMobileApi()` antes de `createRoot`. `installMobileApi()` crea el worker, espera `{ type:'ready' }` (VFS instalado, DB abierta, migraciones aplicadas) y asigna `window.api`. Ningún módulo lee `window.api` en top-level (verificado), así que el orden es seguro.
- Fallos: `{ type:'fatal', reason:'vfs'|'migration'|'open', message, namespace?, version? }` antes de `ready` → se renderiza `src/mobile/FatalScreen.tsx` (mensaje, razón, botón "Reiniciar" = `location.reload()`; el botón "Exportar .db" llega en Fase 5 vía `src/mobile/backup.ts`). Después de `ready`, `worker.onerror`/`onmessageerror` → `install-api.ts` rechaza TODOS los invokes pendientes con `WorkerCrashed`, emite el `window` event `mobile:workerCrashed`, y `App` muestra `FatalScreen`. Sin recreación automática del worker. Sin timeout por invoke (paridad con `ipcRenderer.invoke`).
- Ciclo de vida: `install-api.ts` escucha `App.addListener('appStateChange')` de `@capacitor/app` → `isActive:false` envía `{ type:'suspend' }`; el worker ejecuta **primero `runSuspend()`** (todos los `suspend()` de lifecycle: cauldron y notifications limpian sus intervals), **luego `closeDb()` y `poolUtil.pauseVfs()`**. `isActive:true` envía `{ type:'resume' }`; el worker hace `await poolUtil.unpauseVfs()`, reabre vía `getDb()` y corre `runResume()`. `pagehide` → `worker.terminate()`. Mientras está suspendido, los invokes se encolan en `install-api.ts` y se despachan tras `resume`; si un handler igual llega a `getDb()` en ese estado recibe `DbSuspended`.

## 4. Persistencia mobile

- `@sqlite.org/sqlite-wasm` 3.53.0-build1. El mapa `exports` del paquete expone solo `.`, `./package.json` y **`./sqlite3.wasm`** (→ `dist/sqlite3.wasm`); `dist/` no es importable por subpath. Import: `import sqlite3InitModule from '@sqlite.org/sqlite-wasm'` y `import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'`; `sqlite3InitModule({ locateFile: () => wasmUrl })`. La condición `node` de `exports` resuelve `dist/node.mjs` (es lo que ven vitest y los tests del shim); `browser`/`import` resuelven `dist/index.mjs` (worker en Vite).
- VFS **`opfs-sahpool`**: `const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'hubtify', initialCapacity: 6 })`; `db = new poolUtil.OpfsSAHPoolDb('/hubtify.db')`. No requiere `SharedArrayBuffer` ni COOP/COEP. `pauseVfs()` / `unpauseVfs()` / `isPaused()` existen desde 3.50 (doc `persistence.md`).
- Exclusividad: la instalación falla si el VFS está activo en otro contexto del mismo origen con el mismo `name`. El worker reintenta `installOpfsSAHPoolVfs` 3 veces con backoff 300/600/1200 ms antes de `fatal(reason:'vfs')`. El suspend/resume de §3.5 evita que una instancia zombi retenga los handles.
- Requisitos: contexto seguro. Capacitor sirve en `https://localhost` (`androidScheme:'https'`). **Live reload (`cap run -l`) sirve por `http://` → sin OPFS → NO soportado**; el flujo de desarrollo es `npm run mobile:sync && npx cap run android`.
- MIME de `.wasm`: si el WebView no sirve `application/wasm`, `instantiateStreaming` falla y sqlite-wasm cae a `WebAssembly.instantiate` (más lento al cargar, aceptable). Se verifica en el emulador y se anota el resultado en el plan.
- Pragmas: `foreign_keys=ON`, `synchronous=NORMAL`, `cache_size=10000`, `temp_store=MEMORY`; `journal_mode=WAL` se omite.
- Fallback (documentado, **no implementado**): DB en memoria + export periódico (`sqlite3_js_db_export`) a `@capacitor/filesystem` con debounce 500 ms y flush en `appStateChange`.

## 5. Build y configuración

- **`vite.mobile.config.ts`**: entrada `index.html`, `build.outDir: 'dist/mobile'`, `build.target: 'es2022'` (top-level await en el worker), `worker.format: 'es'`, `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`, `base: './'`, `define: { APP_VERSION, __HUBTIFY_PLATFORM__: '"android"' }`, mismos aliases + `@logic`. `vite.renderer.config.ts` define `__HUBTIFY_PLATFORM__: '"desktop"'`.
- **Detección**: `src/shared/platform-detect.ts` exporta `isNativeMobile(): boolean` (`__HUBTIFY_PLATFORM__ === 'android'`, con `Capacitor.isNativePlatform()` como confirmación en runtime). `src/global.d.ts` agrega `declare const __HUBTIFY_PLATFORM__: 'desktop' | 'android' | undefined`.
- **`capacitor.config.ts`**: `appId: 'com.hubtify.app'`, `appName: 'Hubtify'`, `webDir: 'dist/mobile'`, `server: { androidScheme: 'https' }`, `android: { allowMixedContent: false }`.
- **Scripts**: `mobile:build` = `vite build -c vite.mobile.config.ts`; `mobile:sync` = `npm run mobile:build && cap sync android`; `mobile:run` = `npm run mobile:sync && cap run android`; `mobile:apk` = `npm run mobile:sync && cd android && ./gradlew assembleRelease`.
- **`android/`**: generado por `cap add android`, commiteado. `app/build.gradle` lee `versionName` de `package.json` (bloque Groovy con `node -p`) y `versionCode = major*10000 + minor*100 + patch`. `signingConfigs.release` lee `android/keystore.properties` (gitignored) o variables de entorno.
- **tsconfig**: `shared-logic/tsconfig.json` con `lib: ["ES2022", "WebWorker"]` (declara `console`, timers, `fetch`, `crypto`, `setInterval`; NO `window`/`document`), `types: []`, `include: ["./**/*", "../shared/**/*", "../src/modules/**/*.schema.ts"]`, `exclude: ["**/*.test.ts"]`. `npx tsc -p shared-logic --noEmit` en CI garantiza que `shared-logic` no dependa de Electron/Node/DOM. El `tsconfig.json` raíz suma `shared-logic/**/*` y `src/mobile/**/*`. Alias `@logic/*` → `shared-logic/*` en tsconfig, los 4 vite configs y vitest.
- **`.gitignore`**: `android/app/build/`, `android/.gradle/`, `android/keystore.properties`, `android/*.jks`, `dist/mobile/`.

## 6. PlatformPort

```ts
// shared-logic/platform.ts
export interface FileFilter { name: string; extensions: string[] }
export interface PlatformPort {
  appVersion(): string;
  osInfo(): string;
  notify(n: { title: string; body: string; tag?: string }): Promise<void>;
  openExternal(url: string): Promise<void>;
  pickTextFile(filters: FileFilter[]): Promise<{ name: string; content: string } | null>;
  pickPdfText(): Promise<{ name: string; text: string } | { unsupported: true } | null>;
  pickBinaryFile(filters: FileFilter[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveTextFile(defaultName: string, content: string): Promise<boolean>;
  saveBinaryFile(defaultName: string, bytes: Uint8Array): Promise<boolean>;
}
```

| Uso hoy | Archivo | Fase 1 (shared-logic) | Electron (`electron/platform.ts`, completo en Fase 1) | Mobile (`platform-host.ts`) |
|---|---|---|---|---|
| `new Notification({title, body}).show()` + click enfoca ventana | `notifications.ipc.ts:63`, `cauldron.ipc.ts:317,326` | `platform().notify(...)` | `Notification` + foco de `mainWindow` | `@capacitor/local-notifications` `schedule` inmediato (Fase 5; hasta entonces no-op) |
| `BrowserWindow.getAllWindows().webContents.send` | `rpg-handlers.ts`, `cauldron.ipc.ts`, `notifications.ipc.ts` | `emit(channel, payload)` | sink → `webContents.send` | sink → `postMessage` |
| `app.getVersion()`, `os.release()`, `process.platform` | `feedback.ipc.ts:19-20`, `syl.ipc.ts:22` | `platform().appVersion()/osInfo()` | `app.getVersion()`, `${process.platform} ${os.release()}` | `APP_VERSION`, `android ${Device.getInfo().osVersion}` |
| `dialog.showSaveDialog` + `fs.writeFileSync` (export CSV) | `finance.ipc.ts:1792-1824` | `platform().saveTextFile(name, csv)` | dialog + fs | `@capacitor/filesystem` (Cache) + `@capacitor/share` (Fase 5) |
| `dialog.showOpenDialog` + `fs.readFileSync` + `require('pdf-parse')` | `finance-import.ipc.ts:260-273` | `platform().pickPdfText()`; `{unsupported:true}` → handler devuelve `{ ok:false, reason:'unsupported_platform' }` | dialog + fs + pdf-parse | devuelve `{ unsupported: true }` |
| `crypto.randomUUID()` (8 `import crypto from 'crypto'` + 5 `genId` locales) | rpg-handlers, cauldron, quests, quests.habits, finance, finance-import, finance.balance, notification-engine (+ nutrition con `genId` propio) | `genId()` de `shared-logic/ids.ts` (`globalThis.crypto.randomUUID()`) | igual | igual |
| `fetch` | `dollar.ipc.ts`, `crypto.ipc.ts`, `feedback.ipc.ts` | sin cambios | — | — |
| `dialog`, `fs`, `AdmZip`, `db.backup()` | `backup.ipc.ts` | **no se mueve**; queda en `electron/` | — | `src/mobile/backup.ts` (Fase 5): `saveBinaryFile('hubtify-<fecha>.db', poolUtil.exportFile('/hubtify.db'))` / `pickBinaryFile` → `poolUtil.importDb` + reload |
| Squirrel updater, Tray, ventanas | `updater.ts`, `main.ts` | no se mueven | — | `src/mobile/updater.ts` (Fase 6) |

El `PlatformPort` del worker es un proxy: cada método envía `{ type:'platform', method, args }` al hilo UI y espera `platform-result`. Las Fases 1–2 necesitan `appVersion`, `osInfo`, `notify` (no-op) y `pickPdfText` (`{unsupported:true}`); el resto se implementa en Fase 5 y hasta entonces devuelve `false`/`null`.

**Background (sin paridad en v1):** con la app en segundo plano el Worker se congela (y en `suspend` los intervals se limpian). Al reanudar, el tick del Cauldron recalcula `remainingMs = targetEndTime - Date.now()` (`cauldron.ipc.ts:263`) y dispara `onTimeUp()`. **Cambio de comportamiento (Fase 2, con test):** hoy `onTimeUp()` escribe `completed_at = new Date().toISOString()` (`cauldron.ipc.ts:274-282`), es decir la hora en que corrió el callback; pasa a `completed_at = new Date(targetEndTime).toISOString()`, la hora en que la sesión realmente terminó. En desktop es equivalente (el tick corre a ≤1 s del target); en mobile evita que una sesión reanudada 40 min tarde quede registrada 40 min después. Las notificaciones de rachas/recordatorios solo se evalúan con la app abierta hasta la Fase 6.

## 7. Shell mobile

- **Sin TitleBar**: `TitleBar` devuelve `null` con `isNativeMobile()` (cubre Layout, AuthPage y Onboarding); `Layout.tsx` elige `DesktopShell`/`MobileShell` con `useShellKind()`. `.sidebar { top: 32px }` pasa a `top: var(--shell-top, 32px)`; `<html data-shell="mobile">` setea `--shell-top: 0`.
- **StatusBar**: iconos claros vía el plugin core `SystemBars` de Capacitor 8 (`plugins.SystemBars.style: 'DARK'` en `capacitor.config.ts`; `plugins.StatusBar` igual). Con targetSdk 36 `setBackgroundColor`/`setOverlaysWebView` no hacen nada: el color lo pinta `.mobile-header` con `--safe-top` (WebView ≥ 140, edge-to-edge) o el `windowBackground` de `styles.xml` (WebView < 140). Ver plan Fase 3, desvíos 1–2.
- **Safe areas**: `viewport-fit=cover` en el `index.html` compartido; tokens `--safe-top/right/bottom/left` en `theme.css` = `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))` (las variables las inyecta el plugin `SystemBars`), usados en header, drawer, overlays y capas fijas.
- **Drawer**: `src/hub/MobileShell.tsx`: header 56 px (hamburguesa, título de sección, campana) + `<Sidebar collapsed={false}>` reusado dentro de un drawer (`width: min(300px, 85vw)`, `translateX(-100%)` → `0` con GSAP; backdrop cierra). `Layout.tsx` elige `MobileShell` cuando `isNativeMobile() || viewport < 600`. Sin bottom tabs.
- **Botón atrás**: `@capacitor/app` `backButton` → cierra drawer/modal; si no, `history.back()`; en la raíz `App.minimizeApp()`.
- **Arnés visual**: project vitest `browser-mobile` (`tests/visual/mobile/**`, viewport 390×844 con touch emulado en `playwright.contextOptions` —en vitest 4 no va por entrada de `instances[]`—, `define __HUBTIFY_PLATFORM__:'"android"'`; los tests de escritorio fijan su propio viewport y no se reusan), cada página montada dentro de `MobileShell`, screenshots en `tests/visual/__screenshots__/mobile/` (las de fallo de vitest, en `tests/visual/mobile/__screenshots__/`; las dos, gitignored). Las reglas CSS mobile llevan el prefijo `[data-shell="mobile"]`, no un `@media` de ancho (Electron baja a 700 px). Ningún test del project puede importar `src/mobile/native-shell.ts` (arrastra `@capacitor/core` y define `window.Capacitor`): las funciones puras de DOM viven en `src/mobile/dialog-dom.ts`.

## 8. CI / Release

`release.yml` pasa a tres jobs:

1. **`build-windows`** (windows-latest): idéntico al job actual hasta `npm run make`; artifact `windows` con `out/make/**`.
2. **`build-android`** (ubuntu-latest, `actions/setup-java@v4` temurin 21): `npm ci` → `npx tsc -p shared-logic --noEmit` → `npm run mobile:build` → `npx cap sync android` → decodifica `ANDROID_KEYSTORE_BASE64` a `android/release.jks`, escribe `android/keystore.properties` con `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` → `./gradlew assembleRelease` → renombra a `Hubtify-<version>.apk` → artifact `android`.
3. **`publish`** (`needs: [build-windows, build-android]`, ubuntu-latest): **`actions/checkout@v4` + `setup-node@v4`** (el paso de changelog importa `src/shared/changelog.ts`), descarga ambos artifacts, extrae el changelog (paso actual sin cambios), `softprops/action-gh-release@v2` con los archivos Windows más `Hubtify-<version>.apk`, y el deploy de Functions al final (best-effort).

`ci.yml` suma un job `android-build` (ubuntu) que compila el APK **debug** sin secrets.

Keystore: `keytool -genkeypair -v -keystore release.jks -alias hubtify -keyalg RSA -keysize 2048 -validity 10000`; `.jks` y contraseñas fuera del repo (gestor de contraseñas) y como secrets. Perder el keystore = no poder actualizar la app instalada sobre sí misma.

## 9. Sync y Syl

Sin cambios en `src/shared/sync.ts`, `sync-merge.ts`, `habit-checks-sync.ts` ni en el layout Firestore. Corren en el renderer con el SDK web de Firebase, igual en WebView. Auth (`signInWithEmailAndPassword`, `indexedDBLocalPersistence`) idem. Las 6 tablas sin `updated_at` conservan su semántica actual. Antes del primer release mobile se avisa al usuario para validar Syl.

## 10. Testing

- **Suite existente**: intacta salvo imports (`electron/modules/x` → `shared-logic/modules/x`; `electron/ipc/db` → `shared-logic/db`). Los `vi.mock('electron')` quedan inertes. Los 21 tests con `vi.mock('.../electron/ipc/db')` pasan a `vi.mock('.../shared-logic/db')`. Los 21 que capturan handlers vía mock de `ipcMain.handle` pasan a `getHandler(ch)` + `clearHandlers()` en `beforeEach`; la invocación `fn(null, ...args)` no cambia (pasa a `fn({}, ...args)` donde se toque).
- **Nuevos tests** (project `unit`): `registry` (duplicado lanza, `listChannels`, `runSuspend/runResume` en orden de registro), `provider` (`closeDb` → `getDb` lanza `DbSuspended` mientras está suspendido, reabre después), `onTimeUp` con `completed_at = targetEndTime`, `api-channels` (cada clave de `HubtifyApi` tiene entrada, canales únicos, los 8 desktop-only marcados), `build-api` (unwrap aplicado, `send` no-op en mobile), transporte (`install-api` con `MessageChannel` falso: invoke ok/error, `NoHandler`, event, platform round-trip con transfer, `WorkerCrashed` rechaza pendientes, cola durante `suspend`), shim WASM en memoria (`run/get/all`, `changes`, `lastInsertRowid`, LRU con `finalize`, rollback y savepoint anidado, booleanos), `electron/platform.ts` con `electron` mockeado.
- **Fase 6**: `tests/helpers/createTestDb.ts` + project `unit-wasm` que corre la misma suite con `setDbFactory(wasmInMemory)`.
- **Gate de aislamiento**: `tsc -p shared-logic` en CI.
- **Smoke mobile** (manual, emulador): login, crear tarea, completar, matar app, reabrir → persiste.

## 11. Fases y criterios de aceptación

| Fase | Contenido | Aceptación |
|---|---|---|
| 1. Extracción | `shared-logic/` completo (registry + lifecycle, db/* con `closeDb`/`coreMigrations`, platform, events, ids, modules/ incl. `notifications.schema.ts`), `shared/api-channels.ts` + `build-api.ts`, `preload.ts` generado, `electron/platform.ts` COMPLETO, `electron/ipc/db.ts` reducido a `openDesktopDb()`, `electron/ipc/registry.ts` como binding, `backup.ipc.ts` usando `closeDb` de `shared-logic/db`, `cauldron:openWindow/closeWindow` vía `ipcHandle`, `HubtifyApi` con los 8 desktop-only opcionales, edición mínima de cuerpos (tabla §6: crypto→`genId`, app/os→`platform()`, Notification→`notify`, broadcast→`emit`, dialog/fs→`platform()`), imports de tests actualizados | `npx tsc --noEmit` y `tsc -p shared-logic` verdes; `npm test` verde con la misma cantidad de tests que en `master`; `npm start` funciona igual (export CSV, import PDF, notificaciones, Cauldron flotante probados a mano); `git diff master -- src/` solo toca `global.d.ts`, `platform-detect.ts` y los `if (window.api.x)` de los 8 opcionales |
| 2. Capacitor + worker | deps Capacitor 8.5, `capacitor.config.ts`, `android/`, `vite.mobile.config.ts`, `src/mobile/{worker,install-api,platform-host,FatalScreen}.ts(x)`, `db/wasm-database.ts`, suspend/resume con lifecycle de cauldron y notifications, `completed_at = targetEndTime` en `onTimeUp` (con test), scripts | `npm run mobile:apk` produce un APK; existe `dist/mobile/assets/sqlite3-*.wasm`; el worker loguea `vfs: opfs-sahpool`; en emulador: login, crear tarea, matar app, reabrir → persiste; resultado del MIME `.wasm` anotado |
| 3. Shell mobile | `MobileShell`, drawer, sin TitleBar, StatusBar, safe areas, back button, project `browser-mobile` | Screenshots 390×844 de Dashboard, Questify, Coinify, Nutrify, Cauldron sin overflow horizontal; drawer abre/cierra; back cierra drawer |
| 4. CI/keystore | keystore generado, `release.yml` en 3 jobs, `ci.yml` con APK debug, `.gitignore` | Revisión del YAML + `assembleRelease` firmado local; `apksigner verify` OK |
| 5. PlatformPort mobile | `notify` real, `saveTextFile`, `pickBinaryFile`, `saveBinaryFile`, `src/mobile/backup.ts`, botón "Exportar .db" en `FatalScreen`; toast i18n `unsupported_platform` para import PDF | Export CSV y `.db` comparten por Share; import `.db` restaura y recarga; el import PDF muestra el toast y no rompe nada |
| 6. Pendientes | Cauldron como notificación `ongoing`, notificaciones con app cerrada, updater in-app (GitHub API + `@capacitor/browser`), WHPX del emulador, `createTestDb` + `unit-wasm` | Fuera del alcance de esta rama. **Los avisos con la app cerrada y el `ongoing` del Caldero se hicieron en `feat/android-background`: ver `2026-09-03-android-background-notifications.md`** |

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| OPFS/`opfs-sahpool` no disponible en el WebView | `fatal(reason:'vfs')` visible en Fase 2; fallback a Filesystem documentado (§4) |
| VFS "already in use" tras un crash/reload | 3 reintentos con backoff; suspend/resume libera handles; `pagehide` → `terminate()` |
| Worker muere después de `ready` | pendientes rechazados con `WorkerCrashed`, `FatalScreen` + Reiniciar; sin recreación silenciosa |
| Migración falla en mobile | `fatal(reason:'migration', namespace, version)`; export `.db` desde `FatalScreen` en Fase 5 |
| Tamaño WASM (865 KB) | una carga por sesión, cacheado por el WebView |
| `postMessage` structured clone | payloads ya JSON-serializables (viajan por IPC hoy); binarios con transfer list |
| Sin background en Android | declarado fuera de alcance v1; `targetEndTime` wall-clock preserva el crédito del Cauldron |
| Los 69 tests con better-sqlite3 no ejercitan el shim | tests unitarios del shim en Fase 2; `unit-wasm` en Fase 6 |
| `pdf-parse`, `adm-zip` Node-only | quedan en `electron/`; mobile `{unsupported:true}` (PDF) y `.db` crudo (backup) |
| Keystore perdido | `.jks` + contraseñas fuera del repo además de los secrets |
| Gradle/AGP/JDK 21 | Temurin 21 instalado; `setup-java` en CI |

---

## Anexo A — Hechos verificados (master @ v0.8.2)

| Hecho | Valor |
|---|---|
| `electron/` | 27 archivos, 15.317 LOC |
| Frontera renderer→main | 100% vía `window.api` (253 métodos en `HubtifyApi`). 0 imports de `electron`/`fs`/`path`/`process` en `src/`. Ningún `window.api` en top-level de módulo |
| `preload.ts` | 237 `invoke`, 13 `on`, 3 `send` (`window:minimize/maximize/close`). 3 wrappers que transforman el payload: `onRpgAchievementUnlocked` (`payload?.id`), `onRpgAchievementsBackfilled` (`payload?.ids ?? []`), `onUpdateDownloaded` (callback crudo) |
| Eventos main→renderer con listener en `HubtifyApi` (13) | `rpg:achievementUnlocked`, `rpg:achievementsBackfilled`, `rpg:daySealed`, `rpg:pardonUsed`, `notifications:updated`, `cauldron:tick`, `cauldron:sessionEnd`, `cauldron:windowOpened`, `cauldron:windowClosed`, `updater:update-available`, `updater:update-downloaded`, `updater:download-progress`, `updater:error` |
| Eventos emitidos **sin suscriptor** en renderer | `rpg:obolosChanged` (3 `broadcast` en `rpg-handlers.ts`), `rpg:shopChanged` (3). Se siguen emitiendo por `emit()`; no entran en `api-channels` |
| `ipcHandle` | wrapper de `ipcMain.handle` con log `[channel]` y re-throw. 83 handlers `()`, 148 `(_e, ...args)`; ninguno usa el event. Además `main.ts` registra directo `window:*` (`ipcMain.on`) y `cauldron:openWindow/closeWindow` (`ipcMain.handle`, líneas 351-352) |
| Registro | `electron/ipc/registry.ts` → 14 `register*IpcHandlers()` |
| DB | `db.ts`: singleton `getDb()` sobre `userData/hubtify.db`, pragmas WAL/foreign_keys/synchronous/cache_size/temp_store, `initCoreTables`, `applyMigrations` transaccional, `runModuleMigrations`. `getDb()` inline: 229 llamadas en 15 archivos. `main.ts:360-365` llama 6 `runModuleMigrations` (quests, nutrition, finance, character, notifications, cauldron) |
| Esquemas | `src/modules/*/*.schema.ts` (1.387 LOC) + `electron/modules/notifications.schema.ts` (30 LOC) |
| API better-sqlite3 usada | `prepare` ×601 (todos inline en funciones, 0 a nivel de módulo), `transaction` ×46, `pragma` ×7, `exec` ×3 (db.ts), `close` ×1, `backup` ×1 (backup.ipc). Statement: `run` ×134, `all` ×132, `get` ×111. Nada de `iterate/pluck/raw/expand/bind/columns`, `.immediate()/.exclusive()`, `function/aggregate`. Parámetros solo posicionales `?` (0 nombrados, 0 binding por objeto). `changes` ×36, `lastInsertRowid` ×1 (`nutrition.ipc.ts:631`) |
| `import type Database from 'better-sqlite3'` | 9 archivos (8 van a shared-logic + `db.ts`) |
| `crypto` | `import crypto from 'crypto'` en 8 archivos; `genId()` local en quests, nutrition, finance, cauldron, notification-engine |
| Node/Electron en módulos | `Notification` (notifications.ipc ×2 sitios, cauldron.ipc ×2), `dialog`+`fs` (backup, finance.ipc:1792, finance-import.ipc:260), `require('pdf-parse')` (finance-import:273), `AdmZip` (backup), `app.getVersion` (feedback, syl), `os.release`+`process.platform` (feedback), `app.getPath` (backup, updater, db.ts), `spawn` (updater), `fetch` (dollar, crypto, feedback) |
| Cauldron timer | `targetEndTime` wall-clock (`cauldron.ipc.ts:135,263,454`), `onTimeUp()` en 272 escribe `completed_at = new Date().toISOString()`; 5 `setInterval` (tick + auto-start). `notifications.ipc.ts:98` `pollingInterval` |
| `backup.ipc.ts:92` | `const { closeDb } = require('../ipc/db')` dinámico antes de restaurar |
| `coreMigrations` | exportado en `db.ts:91`; 14 archivos de test lo importan |
| sqlite-wasm `exports` | `.` (node→`dist/node.mjs`, browser/import→`dist/index.mjs`), `./package.json`, `./sqlite3.wasm`→`dist/sqlite3.wasm`. Sin subpath `./dist/*` |
| Tests | 120 archivos; 69 usan `better-sqlite3`; 60 importan rutas `electron/`; 21 hacen `vi.mock('.../electron/ipc/db')`; 21 capturan handlers con mock de `ipcMain.handle`; 26 `vi.mock('electron')`; `tests/setup.ts` vacío |
| Shell | `Layout.tsx:604-619`: `<TitleBar/>` (32 px) + `.sidebar-wrapper` (260/56 px) + `<Sidebar>` `position:fixed; top:32px` + `<main.main-content>`; `AUTO_COLLAPSE_WIDTH = 820`; `minWidth: 700` en `main.ts:206` |
| Build | Forge 7.11 + plugin-vite (`vite.main/preload/renderer.config.ts`); `vite.main` externaliza `better-sqlite3`, `adm-zip`, `pdf-parse`. Un `tsconfig.json` (`include: src, electron, shared`), aliases `@core/@hub/@shared/@modules` duplicados en `vitest.config.ts` |
| CI | `ci.yml` (windows-latest: rebuild, tsc, test, lint). `release.yml` (un job windows-latest: gates → `make` → changelog vía `node --experimental-strip-types` → `softprops/action-gh-release` a `hubtify-releases` → deploy functions) |
| sqlite-wasm | `@sqlite.org/sqlite-wasm@3.53.0-build1`: archivos `dist/index.mjs` (579 KB), `dist/sqlite3.wasm` (865 KB). `OpfsSAHPoolUtil`: `pauseVfs/unpauseVfs/isPaused` (≥3.50), `exportFile`, `importDb`, `wipeFiles`, `removeVfs`, `OpfsSAHPoolDb` |
