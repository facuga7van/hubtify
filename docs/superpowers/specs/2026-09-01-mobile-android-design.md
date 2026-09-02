# Hubtify Mobile (Android) — Diseño

**Fecha:** 2026-09-01 · **Rama:** `feature/mobile` · **Base:** v0.8.2 · **Estado:** aprobado (camino C)

## 1. Contexto y objetivo

Hubtify corre hoy como Electron 41 + React 19 + better-sqlite3. Se quiere una versión **Android** (sin iOS) con **paridad total**: Questify, Coinify, Nutrify, Character y Cauldron. Requisitos duros:

- Un solo repo, un solo renderer, una sola lógica de negocio. Agregar una feature = un cambio que llega a los dos targets.
- Release simultáneo: el mismo tag `v*` produce el instalador Windows **y** un APK firmado, ambos en el mismo GitHub Release de `facuga7van/hubtify-releases`.
- Firestore, merge de sync y Syl (integrador externo) **no cambian**.

Stack mobile: Capacitor 8.5.x (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`), JDK 21 (Temurin instalado), Android SDK 35/36, `@sqlite.org/sqlite-wasm`.

## 2. Hechos del código que condicionan el diseño

Verificados con `rg` sobre `master` @ v0.8.2:

| Hecho | Valor |
|---|---|
| `electron/` | 27 archivos, 15.317 LOC |
| Frontera renderer→main | 100% vía `window.api` (253 métodos en `HubtifyApi`, `shared/types.ts`). 0 imports de `electron`/`fs`/`path`/`process` en `src/`. Ningún uso de `window.api` en top-level de módulo; el primero ocurre dentro de componentes/hooks, después de montar React |
| `preload.ts` | 237 `ipcRenderer.invoke`, 13 `ipcRenderer.on` (eventos main→renderer), 3 `ipcRenderer.send` (`window:minimize/maximize/close`) |
| Eventos main→renderer | `rpg:achievementUnlocked`, `rpg:achievementsBackfilled`, `rpg:daySealed`, `rpg:pardonUsed`, `notifications:updated`, `cauldron:tick`, `cauldron:sessionEnd`, `cauldron:windowOpened`, `cauldron:windowClosed`, `updater:update-available`, `updater:update-downloaded`, `updater:download-progress`, `updater:error`. Emitidos con `BrowserWindow.getAllWindows()[i].webContents.send` desde `rpg-handlers.ts:broadcast`, `cauldron.ipc.ts:broadcast`, `notifications.ipc.ts`, `updater.ts`, `main.ts` |
| `ipcHandle(channel, handler)` | Wrapper de `ipcMain.handle` que loguea `[channel]` y re-lanza. Firmas: 83 handlers `()` y 148 `(_e, ...args)`; **ninguno usa el `event`**, solo lo reciben por la convención de Electron |
| Registro | `electron/ipc/registry.ts` llama 14 `registerXIpcHandlers()`; cada uno hace N `ipcHandle(...)`. Además `main.ts` registra directo `window:*` (3 `ipcMain.on`) y `cauldron:openWindow/closeWindow` |
| DB | `electron/ipc/db.ts`: singleton `getDb()` sobre `userData/hubtify.db`, pragmas `journal_mode=WAL, foreign_keys=ON, synchronous=NORMAL, cache_size=10000, temp_store=MEMORY`; `initCoreTables`, `applyMigrations(db, migrations)` transaccional, `runModuleMigrations(migrations)` usa el singleton. Una DB para todas las cuentas (filtrado por uid en SQL). `getDb()` se invoca inline en handlers: 229 llamadas en 15 archivos |
| Esquemas | Ya viven en `src/modules/*/*.schema.ts` (1.387 LOC), importados por `main.ts` |
| API better-sqlite3 usada | `Database`: `prepare` ×550, `transaction` ×46, `pragma` ×7, `backup` ×1 (backup.ipc), `exec` ×3 (db.ts), `close` ×1. `Statement`: `run` ×134, `all` ×132, `get` ×111. **Nada de** `iterate/pluck/raw/expand/bind/columns`, ni `.immediate()/.exclusive()/.deferred()`, ni `function/aggregate`. Parámetros **solo posicionales `?`** (0 placeholders nombrados, 0 binding por objeto). `RunResult.changes` ×36, `lastInsertRowid` ×1 (`nutrition.ipc.ts:631`, `Number(info.lastInsertRowid)`) |
| Node/Electron en módulos | ver tabla §6 |
| `crypto` | solo `crypto.randomUUID()` (19 usos en 9 archivos) → `globalThis.crypto.randomUUID()` existe en Node ≥19 y en Workers |
| Tests | 120 archivos; 69 usan `better-sqlite3` en memoria, 60 importan rutas `electron/`, 34 importan `electron/ipc/db`, 26 hacen `vi.mock('electron')`, **21 capturan handlers vía mock de `ipcMain.handle`** (`handle: (channel, fn) => harness.handlers.set(channel, fn)`) y los invocan como `fn(null, ...args)` |
| Shell | `Layout.tsx`: `<TitleBar/>` (32 px, botones que llaman `window.api.window*`) + `.app-layout` con `.sidebar-wrapper` (spacer 260/56 px) + `<Sidebar/>` `position:fixed; top:32px; width:260px` + `<main.main-content>`. `AUTO_COLLAPSE_WIDTH = 820`. `minWidth: 700` en `main.ts` |
| Build | Forge 7.11 + `plugin-vite` con 3 configs (`vite.main/preload/renderer.config.ts`); `vite.main` externaliza `better-sqlite3`, `adm-zip`, `pdf-parse`. Un solo `tsconfig.json` (`include: src, electron, shared`), aliases `@core/@hub/@shared/@modules` duplicados en `vitest.config.ts` |
| CI | `ci.yml` (windows-latest: rebuild, tsc, test, lint). `release.yml` (windows-latest, un job: gates → `make` → notas → `softprops/action-gh-release` a `hubtify-releases` → deploy functions) |

## 3. Decisión: camino C — el Worker es el "main process"

**Elegido:** en Android, un Dedicated Worker cumple el rol del main process de Electron. Corre la MISMA lógica síncrona sobre SQLite WASM durable, y el renderer le habla por `postMessage` con los mismos canales `module:action` que hoy viajan por `ipcRenderer.invoke`.

**Descartado A (adapter async):** better-sqlite3 exige callbacks síncronos en `transaction()`. Volver async los ~10k LOC de handlers implica tocar 69 tests, serializar handlers para evitar que dos `invoke` concurrentes interleaven escrituras dentro de una transacción ajena, y no aporta nada funcional. Riesgo alto de regresión en desktop.

**Descartado B (sql.js en el hilo UI):** API síncrona pero DB en memoria; persistir es exportar el archivo entero tras cada escritura. Durabilidad "si el flush llega antes de que Android mate el proceso". Además bloquea el hilo de UI.

## 4. Arquitectura

```
                         shared-logic/                (TS puro, síncrono, sin electron/node)
   ┌───────────────────────────────────────────────────────────────────────┐
   │ registry.ts    registerHandler(channel, fn) · getHandler · listChannels│
   │ db/provider.ts getDb() · setDbFactory(factory) · SqlDatabase iface     │
   │ db/migrate.ts  initCoreTables · applyMigrations · runModuleMigrations  │
   │ platform.ts    PlatformPort iface · setPlatform() · platform()          │
   │ events.ts      emit(channel, payload) → sink inyectado por el binding   │
   │ modules/       quests, quests.habits, nutrition, finance, finance.balance,
   │                finance-import, character, sync, cauldron, notifications,
   │                notification-engine, dollar, crypto, feedback, syl,
   │                rpg-handlers, rpg-stats, backup                          │
   └───────────────────────────────────────────────────────────────────────┘
              ▲ import                                       ▲ import
   ┌──────────┴───────────────────┐            ┌─────────────┴────────────────┐
   │ electron/ (binding desktop)  │            │ src/mobile/ (binding Android) │
   │ main.ts: setDbFactory(better-│            │ worker.ts: setDbFactory(wasm  │
   │  sqlite3), setPlatform(elec- │            │  opfs-sahpool), setPlatform(  │
   │  tronPort), registerAll(),   │            │  proxy→UI), registerAll(),    │
   │  for ch of listChannels():   │            │  onmessage {id,ch,args} →     │
   │    ipcMain.handle(ch, …)     │            │    getHandler(ch)(...args)    │
   │ preload.ts: window.api desde │            │ install-api.ts: window.api    │
   │  shared/api-channels.ts      │            │  desde shared/api-channels.ts │
   └──────────────────────────────┘            │ platform-host.ts: recibe      │
                                               │  {platform:'notify',…} y llama│
   src/ (renderer React, SIN CAMBIOS de API)   │  plugins Capacitor            │
                                               └───────────────────────────────┘
```

### 4.1 `shared/api-channels.ts` — la tabla única

```ts
export type ChannelKind = 'invoke' | 'send' | 'on';
export const API_CHANNELS = {
  getTasks:            { channel: 'quests:getTasks',       kind: 'invoke' },
  windowMinimize:      { channel: 'window:minimize',       kind: 'send'   },
  onCauldronTick:      { channel: 'cauldron:tick',         kind: 'on'     },
  // … 253 entradas, una por método de HubtifyApi
} as const satisfies Record<keyof HubtifyApi, { channel: string; kind: ChannelKind }>;
```

`satisfies Record<keyof HubtifyApi, …>` hace que **olvidarse una entrada sea error de tipos**. `preload.ts` y `src/mobile/install-api.ts` iteran la tabla y construyen `window.api`:

- `invoke` → `(...args) => transport.invoke(channel, ...args)`
- `send` → `(...args) => transport.send(channel, ...args)` (desktop: `ipcRenderer.send`; mobile: no-op, ver §8)
- `on` → `(handler) => { transport.on(channel, wrapped); return () => transport.off(channel, wrapped); }`

Los 13 métodos `on*` de preload hoy envuelven el handler para descartar `event` y pasar solo `payload`; el generador hace lo mismo. Métodos con firma especial (si los hay tras el inventario del preload: p.ej. `onUpdateDownloaded(callback)` pasa `callback` directo) se listan en un `OVERRIDES` mínimo dentro del mismo archivo; el objetivo es que `preload.ts` quede en < 60 líneas.

### 4.2 Registro de handlers

```ts
// shared-logic/registry.ts
export type HandlerEvent = unknown;               // IpcMainInvokeEvent en Electron, {} en el worker
export type Handler = (event: HandlerEvent, ...args: any[]) => unknown | Promise<unknown>;
const handlers = new Map<string, Handler>();
export function registerHandler(channel: string, fn: Handler): void  // throw si duplicado
export function getHandler(channel: string): Handler | undefined
export function listChannels(): string[]
export function clearHandlers(): void   // solo tests
```

Se conserva la firma `(event, ...args)` de Electron a propósito: 148 handlers ya la tienen como `(_e, ...)` y 21 tests los invocan como `fn(null, ...args)`. Así la Fase 1 mueve archivos sin editar cuerpos. Quitar el parámetro es un follow-up cosmético.

`electron/ipc/ipc-handle.ts` se reduce a `export { registerHandler as ipcHandle }` durante la Fase 1 (los 14 `register*IpcHandlers` no cambian de forma, solo de import). El binding Electron, tras `registerAllHandlers()`, hace `for (const ch of listChannels()) ipcMain.handle(ch, async (e, ...a) => { try { return await fn(e, ...a) } catch (err) { console.error(`[${ch}]`, err); throw err } })`. Mismo logging que hoy. El worker invoca `fn({}, ...args)`.

### 4.3 `HandlerContext` implícito

Los handlers hoy llaman `getDb()` inline (229 veces). **No se cambia la firma de los handlers.** El contexto se inyecta por proveedores globales del módulo `shared-logic`:

- `getDb()` → en la primera llamada invoca la factory de `setDbFactory()` (better-sqlite3 en Electron/tests, shim WASM en worker), aplica los pragmas comunes, `initCoreTables` y las migraciones core, exactamente como hoy `db.ts`. La lista de migraciones de módulo (hoy 6 llamadas sueltas en `main.ts:360-365`) pasa a `shared-logic/db/all-migrations.ts` (`runAllModuleMigrations()`), que ambos bindings llaman tras `getDb()`.
- `platform()` → `PlatformPort` inyectado con `setPlatform()`.
- `emit(channel, payload)` → reemplaza los tres `broadcast()` locales y los `webContents.send` sueltos. Sink inyectado con `setEventSink()`: Electron → `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` envuelto en try/catch como hoy; worker → `self.postMessage({ type: 'event', channel, payload })`.

Esto mantiene los 60 tests que importan handlers y `getDb` funcionando con un cambio de ruta de import.

### 4.4 Interfaz `SqlDatabase` (subconjunto exacto usado)

```ts
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
  backup(destPath: string): Promise<unknown>;               // solo Electron; el shim lanza
  close(): void;
}
```

`import type Database from 'better-sqlite3'` en 9 archivos pasa a `import type { SqlDatabase } from '../db/sql-database'`. better-sqlite3 satisface esta interfaz estructuralmente (sin adapter).

**Shim WASM (`src/mobile/db/wasm-database.ts`)** sobre `sqlite3.oo1.DB` de `@sqlite.org/sqlite-wasm`:

- `prepare(sql)` → cachea `db.prepare(sql)` (LRU 256; hay 342 statements preparados a nivel de módulo, muchos se preparan una vez). `run` = `stmt.bind(params).stepReset()`, `changes = db.changes()`, `lastInsertRowid = sqlite3.capi.sqlite3_last_insert_rowid(db)`. `get/all` = `stmt.bind(params)`, iterar `step()` con `stmt.get({})` (objetos por nombre de columna, como better-sqlite3), `reset()` siempre en `finally`.
- Parámetros: solo posicionales, se pasan tal cual. Booleanos: better-sqlite3 los rechaza (TypeError), así que el código ya usa 0/1; el shim convierte `true/false` a 1/0 defensivamente. `undefined` → `null`. `bigint` → number (`Number(v)`).
- `transaction(fn)` → devuelve `(...a) => { db.exec('BEGIN'); try { r = fn(...a); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }`. Anidamiento: contador de profundidad; niveles internos usan `SAVEPOINT sN` / `RELEASE` / `ROLLBACK TO` (better-sqlite3 hace lo mismo).
- `pragma(s)` → `db.exec('PRAGMA ' + s)`; para lecturas (`PRAGMA foreign_keys`) `db.selectValue`. `journal_mode=WAL` se ignora en sahpool (no soportado; devuelve `delete`), documentado.
- `exec(sql)` → `db.exec(sql)` (multi-statement OK).
- `backup()` → lanza `PlatformUnsupported`; el backup mobile se implementa por otra vía (§6).

### 4.5 Transporte worker ⇄ UI

Mensajes UI→worker: `{ id: number, type: 'invoke', channel, args }`. Worker→UI: `{ id, type: 'result', ok: true, value } | { id, type: 'result', ok: false, error: { message, name } }` y `{ type: 'event', channel, payload }`. Inverso (PlatformPort): worker→UI `{ id, type: 'platform', method, args }`, UI→worker `{ id, type: 'platform-result', ok, value | error }`.

`install-api.ts` mantiene `Map<id, {resolve, reject}>`; los errores rehidratan `new Error(message)` con `name`. Timeout: ninguno (paridad con `ipcRenderer.invoke`). Antes de montar React, `src/main.tsx` hace `if (isNative) await installMobileApi()` que crea el worker, espera `{ type: 'ready' }` (DB abierta + migraciones aplicadas) y recién entonces asigna `window.api`. Si el worker manda `{ type: 'fatal', error }` (p.ej. OPFS no disponible) se renderiza una pantalla de error con el mensaje; sin fallback automático en esta versión.

## 5. Persistencia mobile

- Paquete: `@sqlite.org/sqlite-wasm` (oficial), VFS **`opfs-sahpool`** (`sqlite3.installOpfsSAHPoolVfs({ name: 'hubtify' })`), en Dedicated Worker. No requiere `SharedArrayBuffer` ni cabeceras COOP/COEP (a diferencia del VFS `opfs` clásico). Escrituras síncronas vía `FileSystemSyncAccessHandle`.
- Requisitos: contexto seguro. Capacitor Android sirve en `https://localhost` (`androidScheme: 'https'`), que es secure context. `navigator.storage.getDirectory()` en Android WebView (Chromium ≥ 108) está disponible.
- Archivo lógico: `/hubtify.db`. Pragmas aplicados: `foreign_keys=ON`, `synchronous=NORMAL`, `cache_size`, `temp_store=MEMORY`; `journal_mode=WAL` se omite.
- Riesgo y fallback (documentado, **no implementado ahora**): si `installOpfsSAHPoolVfs` falla, alternativa = DB en memoria + export periódico (`sqlite3_js_db_export`) a `@capacitor/filesystem` (Directory.Data) con debounce 500 ms y flush en `appStateChange`. Hasta entonces, error fatal visible.
- El worker se instancia con `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`; Vite empaqueta el `.wasm` como asset y el worker con `worker.format = 'es'`.

## 6. PlatformPort

Inventario handler → dependencia nativa (verificado):

| Archivo | API nativa | Mobile |
|---|---|---|
| `notifications.ipc.ts` | `new Notification({title, body}).show()`, click → enfocar ventana; `BrowserWindow.getAllWindows` para broadcast | `platform.notify({title, body})` → `@capacitor/local-notifications` (`schedule` inmediato). Broadcast → `emit` |
| `cauldron.ipc.ts` | `Notification` (fin de sesión) ×2, `BrowserWindow.getAllWindows` broadcast, `setInterval` ticks | `platform.notify`; ticks siguen en el worker (los Workers tienen timers). Ventana flotante: `main.ts` `cauldron:openWindow/closeWindow` → handlers mobile no-op que emiten `cauldron:windowClosed` |
| `backup.ipc.ts` | `dialog.showSaveDialog/showOpenDialog`, `app.getPath`, `fs`, `AdmZip`, `db.backup()` | `platform.exportBackup(bytes)` → `@capacitor/filesystem` (Directory.Cache) + `@capacitor/share`; `platform.importBackup()` → file picker (`<input type=file>` en UI) → bytes. Formato: el `.db` crudo (sin zip) en mobile; el desktop sigue con ZIP. Fase 5 |
| `finance.ipc.ts:1792` (export CSV) | `dialog.showSaveDialog`, `fs.writeFileSync` | `platform.saveTextFile({ name, mime, text })` → Filesystem + Share. Fase 5 |
| `finance-import.ipc.ts:260` | `dialog.showOpenDialog`, `fs.readFileSync`, `require('pdf-parse')` | `platform.pickFile({ accept })` → bytes; PDF: `pdf-parse` es Node-only → en mobile solo CSV en esta versión; PDF devuelve `{ ok:false, reason:'unsupported_platform' }`. Fase 5 |
| `updater.ts` | `app.getVersion/isPackaged/getPath('temp')`, `fs`, `spawn(Update.exe)` | No se comparte. Mobile: `src/mobile/updater.ts` consulta `https://api.github.com/repos/facuga7van/hubtify-releases/releases/latest`, compara con `APP_VERSION`, emite `updater:update-available`; "instalar" abre la URL del `.apk` con `@capacitor/browser`. Fase 6 |
| `feedback.ipc.ts`, `syl.ipc.ts` | `app.getVersion()`, `os.release()`, `process.platform` | `platform.appVersion()`, `platform.osInfo()` |
| `dollar.ipc.ts`, `crypto.ipc.ts` | `fetch` global | Igual en worker |
| `main.ts` | Tray, `window:*`, `screen`, Squirrel | Fuera de `shared-logic`. Mobile: `window:*` no-op |

```ts
export interface PlatformPort {
  appVersion(): string;
  osInfo(): string;
  notify(n: { title: string; body: string }): Promise<void>;
  saveTextFile(f: { name: string; mime: string; text: string }): Promise<{ ok: boolean }>;
  pickFile(o: { accept: string[] }): Promise<{ name: string; bytes: Uint8Array } | null>;
  exportBackup(bytes: Uint8Array, name: string): Promise<{ ok: boolean }>;
}
```

Electron implementa todo con las APIs actuales (comportamiento idéntico). En el worker cada método es un proxy que envía `{ type: 'platform' }` al hilo UI, donde `platform-host.ts` llama a los plugins de Capacitor y responde. Las Fases 1–2 solo necesitan `appVersion`, `osInfo` y `notify`; el resto se implementa en Fase 5 y hasta entonces los métodos mobile devuelven `{ ok: false }`.

## 7. Build y configuración

- **`vite.mobile.config.ts`**: `root: '.'`, entrada `index.html`, `build.outDir: 'dist/mobile'`, `define: { APP_VERSION, __HUBTIFY_PLATFORM__: '"android"' }`, mismos aliases, `worker.format: 'es'`, `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`, `base: './'`.
- **Detección de plataforma**: `src/shared/platform.ts` exporta `isNativeMobile = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android'` (constante de build, tree-shakeable) y `Capacitor.isNativePlatform()` como confirmación en runtime.
- **`capacitor.config.ts`**: `appId: 'com.hubtify.app'`, `appName: 'Hubtify'`, `webDir: 'dist/mobile'`, `android: { allowMixedContent: false }`, `server: { androidScheme: 'https' }`.
- **Scripts**: `mobile:build` = `vite build -c vite.mobile.config.ts`; `mobile:sync` = `npm run mobile:build && cap sync android`; `mobile:run` = `npm run mobile:sync && cap run android`; `mobile:apk` = `npm run mobile:sync && cd android && ./gradlew assembleRelease`.
- **`android/`**: generado por `cap add android`, **commiteado** (Capacitor lo recomienda). `android/app/build.gradle` lee `versionName`/`versionCode` de `package.json` vía un bloque Groovy que ejecuta `node -p`; `versionCode = major*10000 + minor*100 + patch`. `signingConfigs.release` lee de `android/keystore.properties` (gitignored) o variables de entorno.
- **tsconfig**: se agrega `shared-logic/tsconfig.json` con `lib: ["ES2022"]` (sin `dom`), `types: []`, `include: ["../shared-logic/**/*", "../shared/**/*", "../src/modules/**/*.schema.ts"]`; `npx tsc -p shared-logic --noEmit` en CI garantiza que `shared-logic` no dependa de Electron/Node/DOM. El `tsconfig.json` raíz suma `shared-logic/**/*` y `src/mobile/**/*` a `include` (con `types: ["node"]` implícito para electron). Alias nuevo `@logic/*` → `shared-logic/*` en tsconfig, los 4 vite configs y vitest.
- **`.gitignore`**: `android/app/build/`, `android/.gradle/`, `android/keystore.properties`, `android/*.jks`, `dist/mobile/`.

## 8. Shell mobile

- **Sin TitleBar**: `Layout.tsx` renderiza `<TitleBar/>` solo si `!isNativeMobile`. `.sidebar { top: 32px }` pasa a `top: var(--shell-top, 32px)` y mobile setea `--shell-top: 0`.
- **StatusBar**: `@capacitor/status-bar` con `setStyle(Dark)` y `setBackgroundColor(--leather-dark)`; `setOverlaysWebView(false)`.
- **Safe areas**: `viewport-fit=cover` en `index.html`; `padding-top: env(safe-area-inset-top)` en el header mobile; `padding-bottom: env(safe-area-inset-bottom)` en drawer y modales.
- **Drawer**: nuevo `src/hub/MobileShell.tsx`: header 56 px (botón hamburguesa, título de sección, campana) + `<Sidebar collapsed={false}>` reusado dentro de un drawer (`position: fixed; left: 0; width: min(300px, 85vw); transform: translateX(-100%)`; abierto → `translateX(0)` con GSAP; backdrop cierra). `Layout.tsx` elige `MobileShell` cuando `isNativeMobile || viewport < 600`. Sin bottom tabs.
- **Botón atrás de Android**: `@capacitor/app` `backButton` → cierra drawer/modal si hay, si no `history.back()`, y en la raíz minimiza (`App.minimizeApp()`).
- **`minWidth`**: solo afecta Electron; en mobile no aplica. Las páginas de módulo se adaptan por iteraciones posteriores usando el arnés visual.
- **Arnés visual**: `vitest.config.ts` suma project `browser-mobile` (mismos tests `tests/visual/**`, viewport 390×844, `define __HUBTIFY_PLATFORM__`), screenshots en `tests/visual/__screenshots__/mobile/`.

## 9. CI / Release

`release.yml` pasa a tres jobs:

1. **`build-windows`** (windows-latest): idéntico al job actual hasta `npm run make`; sube `out/make/**` como artifact `windows`.
2. **`build-android`** (ubuntu-latest; SDK y JDK preinstalados en el runner; `actions/setup-java@v4` con `temurin 21` por las dudas): `npm ci` → `npx tsc -p shared-logic --noEmit` → `npm run mobile:build` → `npx cap sync android` → decodifica `ANDROID_KEYSTORE_BASE64` a `android/release.jks` y escribe `android/keystore.properties` con `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` → `./gradlew assembleRelease` → renombra a `Hubtify-<version>.apk` → artifact `android`.
3. **`publish`** (`needs: [build-windows, build-android]`, ubuntu-latest): descarga ambos artifacts, extrae el changelog (paso actual sin cambios), `softprops/action-gh-release@v2` con los archivos Windows **más** `Hubtify-<version>.apk`, y el deploy de Functions al final (best-effort, como hoy).

`ci.yml` suma un job `android-build` que compila el APK **debug** (sin secrets) para que un PR que rompa el build mobile falle antes del release. Los tests unitarios no cambian de runner.

Keystore: se genera una vez con `keytool -genkeypair -v -keystore release.jks -alias hubtify -keyalg RSA -keysize 2048 -validity 10000`; el `.jks` y las contraseñas se guardan fuera del repo y como secrets. Perder el keystore = no poder actualizar la app instalada sobre sí misma.

## 10. Sync y Syl

Sin cambios en `src/shared/sync.ts`, `sync-merge.ts`, `habit-checks-sync.ts`, ni en el layout Firestore. Corren en el renderer con el SDK web de Firebase, que funciona igual en WebView. Auth (`signInWithEmailAndPassword`, persistencia `indexedDBLocalPersistence`) idem. Las 6 tablas sin `updated_at` (`player_stats`, `rpg_events`, `finance_recurring_amount_history`, `finance_category_mappings`, `finance_import_batches`, `finance_income_sources`) ya se sincronizan hoy con su semántica actual (union/LWW por `createdAt`); no se toca. Antes del primer release mobile se avisa al usuario para validar Syl, como marca la convención del proyecto.

## 11. Testing

- **Suite existente**: intacta salvo imports (`electron/modules/x` → `shared-logic/modules/x`, `electron/ipc/db` → `shared-logic/db/...`). Los `vi.mock('electron')` quedan inertes en módulos que ya no importan electron. Los 21 tests que capturan handlers vía mock de `ipcMain.handle` pasan a `getHandler(channel)` del registro (`harness.handlers.get(ch)` → `getHandler(ch)`, `clearHandlers()` en `beforeEach`); la forma de invocación `fn(null, ...args)` no cambia.
- **Nuevos tests unitarios** (Node, project `unit`): `shared-logic/registry`, `api-channels` (cada clave de `HubtifyApi` tiene entrada; canales únicos), el transporte (`install-api` con un `MessageChannel` falso: invoke ok, invoke error, event, platform round-trip), y el shim WASM en memoria (`@sqlite.org/sqlite-wasm` corre en Node): `run/get/all`, `changes`, `lastInsertRowid`, transacción con rollback y savepoint anidado, booleanos.
- **Paridad de dialecto** (Fase posterior): project `unit-wasm` que ejecuta la misma suite con `setDbFactory(wasmInMemory)` en `setupFiles`; requiere que los tests creen la DB vía `createTestDb()` de `tests/helpers` en lugar de `new Database(':memory:')`. Se hace cuando el helper exista en todos los tests; no bloquea el release.
- **Gate de aislamiento**: `tsc -p shared-logic` en CI.
- **Smoke mobile**: `cap run android` en emulador: login, crear tarea, completar, cerrar app, reabrir → la tarea persiste. Manual hasta que haya Playwright sobre WebView.

## 12. Fases y criterios de aceptación

| Fase | Contenido | Aceptación |
|---|---|---|
| 1. Extracción | `shared-logic/` (registry, provider, migrate, platform, events, modules/), `shared/api-channels.ts`, `preload.ts` generado, `electron/` como binding, imports de tests actualizados | `npx tsc --noEmit` y `tsc -p shared-logic` verdes; `npm test` verde con la misma cantidad de tests que en `master`; `npm start` abre la app y funciona igual; `git diff` de `src/` (excluyendo `src/mobile`) vacío |
| 2. Capacitor + worker | deps Capacitor 8.5, `capacitor.config.ts`, `android/`, `vite.mobile.config.ts`, `src/mobile/{worker,install-api,db/wasm-database,platform-host}.ts`, scripts | `npm run mobile:apk` produce un APK; en emulador la app abre, loguea, crea y persiste una tarea tras reinicio |
| 3. Shell mobile | `MobileShell`, drawer, sin TitleBar, StatusBar, safe areas, back button, project `browser-mobile` | Screenshots 390×844 de Dashboard, Questify, Coinify, Nutrify, Cauldron sin overflow horizontal; drawer abre/cierra |
| 4. CI/keystore | keystore generado, `release.yml` en 3 jobs, `ci.yml` con APK debug, `.gitignore` | `act`/dry-run no disponible: revisión manual del YAML + build local `assembleRelease` firmado |
| 5. PlatformPort completo | notify, saveTextFile, pickFile, exportBackup en mobile; CSV import | Export CSV y backup comparten por Share; import CSV funciona; PDF devuelve `unsupported_platform` con toast |
| 6. Pendientes | Cauldron como notificación persistente (`ongoing`), updater in-app vía GitHub API, WHPX del emulador, `unit-wasm` | Fuera del alcance de esta rama |

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| OPFS/`opfs-sahpool` no disponible en el WebView del dispositivo | Error fatal explícito en Fase 2; fallback por export a Filesystem documentado (§5) |
| Tamaño del bundle WASM (~1 MB) | Se carga una vez en el worker; asset cacheado por el WebView |
| `postMessage` con structured clone en 253 canales | Payloads ya son JSON-serializables (viajan por IPC hoy); el costo es equivalente al de Electron |
| Gradle/AGP/JDK: Capacitor 8 exige JDK 21 y AGP 8.x | JDK 21 Temurin ya instalado; `setup-java` en CI |
| Los 69 tests con better-sqlite3 no ejercitan el shim | Tests unitarios del shim en Fase 2 + `unit-wasm` en Fase 6 |
| Tests que dependen del mock de `ipcMain.handle` | 21 identificados, se migran a `getHandler` en Fase 1 |
| `pdf-parse`, `adm-zip` son Node-only | Quedan en `electron/`; mobile devuelve `unsupported_platform` (PDF) y usa `.db` crudo (backup) |
| Keystore perdido | Guardar `.jks` + contraseñas fuera del repo (gestor de contraseñas) además de los secrets |
