# Mobile Fase 1 — `shared-logic/` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer toda la lógica de negocio del main process de Electron a `shared-logic/` (TS puro, síncrono, sin `electron`/`node`/`dom`), dejando `electron/` como un binding fino, con el desktop funcionando exactamente igual que hoy.

**Architecture:** `shared-logic/` aporta un registro de handlers neutral (`registry.ts`), un proveedor de DB inyectable (`db/provider.ts` + interfaz `SqlDatabase`), tres contextos implícitos (`platform()`, `emit()`, `genId()`) y los 19 módulos movidos con `git mv` desde `electron/modules` y `electron/ipc`. `electron/` conserva `main.ts`, `preload.ts` (generado desde la tabla `shared/api-channels.ts`), `platform.ts` (PlatformPort completo), `ipc/db.ts` (`openDesktopDb()`), `ipc/registry.ts` (bind a `ipcMain`), `backup.ipc.ts` y `updater.ts`. Los tests existentes cambian solo imports; se agregan tests para las piezas nuevas.

**Tech Stack:** Electron 41, React 19, TypeScript 5.7, better-sqlite3, vitest 4 (project `unit`, corre bajo `ELECTRON_RUN_AS_NODE=1`), perl (para reemplazos; `sd` NO está instalado), rg.

**Spec (fuente de verdad):** `docs/superpowers/specs/2026-09-01-mobile-android-design.md` (§3, §6, §10, §11 fila "1. Extracción").

---

## Baseline verificado (rama `feature/mobile`, 2026-09-01)

| Qué | Valor |
|---|---|
| `npx tsc --noEmit` | verde |
| `npm test` | **91 files, 1247 tests**, todos verdes |
| Tests que mockean `electron/ipc/db` | 21 (lista en Task 3) |
| Tests que importan `coreMigrations` de `electron/ipc/db` | 13 + 1 dinámico (`reopen-combo`) |
| Tests que capturan handlers vía mock de `ipcMain.handle` | 21 (18 con `harness.handlers.get(channel)`, 3 con `handlers.get('…')`) |
| Tests que afirman sobre `webContents.send` (broadcasts) | 3: `rpg-economy-audit`, `cauldron.retro`, `cauldron.phase2` |
| `import crypto from 'crypto'` | 8 archivos; `genId` local en `quests.ipc:8`, `nutrition.ipc:17`, `cauldron.ipc:13`, `finance.ipc:50`, `notification-engine:11` |
| `broadcast()` local | `rpg-handlers.ts:188` (firma `(channel, ...args)`), `cauldron.ipc.ts:104` (firma `(channel, data)`) |
| `webContents.send` directo | `notifications.ipc.ts:87,146,159`; `main.ts:334,338` (quedan en electron); `updater.ts` (queda) |
| `require('../ipc/db')` | `backup.ipc.ts:92` |
| `NodeJS.Timeout` | `cauldron.ipc.ts:132,134`, `notifications.ipc.ts:17` |
| `Database.Database` (tipo better-sqlite3) | rpg-handlers ×30, finance.balance ×32, sync.ipc ×9, notification-engine ×7, quests.ipc ×5, syl.snapshot ×5, rpg-stats ×3, quests.habits ×2 |
| `HubtifyApi` / `preload.ts` | preload expone 253 métodos (237 `invoke`, 3 `send`, 13 `on`). `HubtifyApi` tiene **252** claves reales: `nutritionGetEventDays` (`shared/types.ts:458`) quedó atrapada DENTRO del tipo de retorno de `nutritionSearchHistory` (por eso `src/modules/nutrition/event-api.ts:15` castea). Se corrige en Task 15 → 253 |
| Root `tsconfig.json` | `include: ["src/**/*", "electron/**/*", "shared/**/*"]` — **los tests NO se typechequean** (esbuild los transpila); los errores en tests solo se ven al correrlos |

### Dos hechos que cambian el diseño respecto de la spec (verificados con `tsc`)

1. **`SqlDatabase.transaction`**: la firma de la spec `transaction<F extends (...a:any[])=>any>(fn: F): F` NO es satisfecha estructuralmente por better-sqlite3 (`Transaction<F>` no es asignable a `F`; error TS2322 reproducido). Se usa `transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R`, que sí es asignable (verificado: `const db: SqlDatabase = new Database(':memory:')` compila) y es equivalente en uso.
2. **`registerAllHandlers()`** vive en `shared-logic/register-all.ts`, no en `registry.ts`: los módulos importan `registerHandler` desde `registry.ts`, y `registry.ts` importando a los módulos sería un ciclo.

### Reglas transversales para el ejecutor

- **Siempre `git mv`** para mover archivos (preserva historia). Nunca copiar+borrar.
- **Reemplazos**: `perl -pi -e '…' archivo` (perl viene con Git for Windows). Para borrar bloques multilínea usá la herramienta Edit con el texto exacto.
- Después de cada task: `npx tsc --noEmit` (exit 0, sin salida), `npm run typecheck:shared-logic` (exit 0, sin salida), `npm test` (91+N files, 1247+N tests, 0 failed). Los números exactos esperados están en cada task.
- **No compilar Electron** (`npm start`/`make`): el usuario lo hace.
- Commits: `type(scope): descripción`, **sin ninguna línea de atribución de IA**.
- Rutas relativas dentro de `shared-logic/modules/`: `'../db'`, `'../registry'`, `'../ids'`, `'../events'`, `'../platform'`, `'../../shared/…'`, `'../../src/…'` (misma profundidad que `electron/modules/`, así que los imports a `shared/` y `src/` **no cambian**).
- **Números de línea**: los citados en cada task son los del archivo ANTES de las ediciones de esa misma task (los pasos anteriores de la task corren el archivo); ubicá siempre por el texto exacto.
- Rutas en tests: `tests/ipc/*.ts` usan `../../`; `tests/modules/**/*.ts` usan `../../../`. La profundidad no cambia al pasar de `electron/…` a `shared-logic/…`.

### Mapa de archivos

**Crear**
- `shared-logic/tsconfig.json`, `shared-logic/ids.ts`, `shared-logic/events.ts`, `shared-logic/platform.ts`, `shared-logic/registry.ts`, `shared-logic/register-all.ts`
- `shared-logic/db/sql-database.ts`, `shared-logic/db/provider.ts`, `shared-logic/db/all-migrations.ts`, `shared-logic/db/index.ts`
- `electron/platform.ts`
- `shared/api-channels.ts`, `shared/build-api.ts`
- Tests: `tests/shared-logic/{events,platform,registry,provider}.test.ts`, `tests/electron/platform.test.ts`, `tests/shared/{api-channels,build-api}.test.ts`, `tests/modules/cauldron/cauldron.lifecycle.test.ts`

**Mover (`git mv`) → `shared-logic/modules/`**: `electron/ipc/rpg-stats.ts`, `electron/ipc/rpg-handlers.ts`, y de `electron/modules/`: `quests.habits`, `finance.balance`, `notifications.schema`, `notification-engine`, `syl.snapshot`, `character.ipc`, `crypto.ipc`, `dollar.ipc`, `feedback.ipc`, `syl.ipc`, `quests.ipc`, `nutrition.ipc`, `finance.ipc`, `finance-import.ipc`, `notifications.ipc`, `cauldron.ipc`, `sync.ipc` (19 archivos). `electron/ipc/db.ts` → `shared-logic/db/migrate.ts` (y se recrea un `electron/ipc/db.ts` fino).

**Modificar**: `electron/main.ts`, `electron/preload.ts`, `electron/ipc/ipc-handle.ts`, `electron/ipc/registry.ts`, `electron/modules/backup.ipc.ts`, `shared/types.ts` (8 opcionales), `src/hub/SettingsPage.tsx`, `src/hub/Layout.tsx`, `src/modules/cauldron/components/{CauldronFloatingTimer,CauldronDashboardWidget,CauldronPage,CauldronFloatingWindow}.tsx`, `tsconfig.json`, `vitest.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `package.json`, `.github/workflows/ci.yml`, `CLAUDE.md`, ~61 tests (solo imports/mocks).

**No se tocan**: `electron/modules/updater.ts`, `electron/modules/pdf-parse.d.ts`, `src/shared/sync*.ts`, Firestore, `src/` salvo los 6 archivos listados.

---

## Chunk 1: Fundaciones de `shared-logic` — contexto, registry y DB (sin mover módulos)

### Task 1: Scaffolding — tsconfig aislado, script, `ids.ts`, `events.ts`, `platform.ts`

**Files:**
- Create: `shared-logic/tsconfig.json`, `shared-logic/ids.ts`, `shared-logic/events.ts`, `shared-logic/platform.ts`
- Modify: `package.json` (scripts)
- Test: `tests/shared-logic/events.test.ts`, `tests/shared-logic/platform.test.ts`

- [ ] **Step 1: Escribir los tests (fallan porque los módulos no existen)**

`tests/shared-logic/events.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { emit, setEventSink } from '../../shared-logic/events';

afterEach(() => setEventSink(null));

describe('events.emit', () => {
  it('is a no-op when no sink is installed', () => {
    expect(() => emit('rpg:pardonUsed')).not.toThrow();
  });

  it('forwards channel and payload to the sink', () => {
    const sink = vi.fn();
    setEventSink(sink);
    emit('cauldron:tick', { status: 'work' });
    expect(sink).toHaveBeenCalledWith('cauldron:tick', { status: 'work' });
  });

  it('passes payload as undefined when the caller sends none', () => {
    const sink = vi.fn();
    setEventSink(sink);
    emit('rpg:obolosChanged');
    expect(sink).toHaveBeenCalledWith('rpg:obolosChanged', undefined);
  });

  it('never lets a throwing sink break the caller', () => {
    setEventSink(() => { throw new Error('renderer gone'); });
    expect(() => emit('rpg:daySealed', { date: '2026-09-01' })).not.toThrow();
  });
});
```

`tests/shared-logic/platform.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { platform, setPlatform, type PlatformPort } from '../../shared-logic/platform';

const fake: PlatformPort = {
  appVersion: () => '9.9.9',
  osInfo: () => 'test 0',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => ({ unsupported: true }),
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
};

describe('platform()', () => {
  it('throws a clear error before setPlatform()', () => {
    expect(() => platform()).toThrow(/setPlatform/);
  });

  it('returns the injected port after setPlatform()', () => {
    setPlatform(fake);
    expect(platform().appVersion()).toBe('9.9.9');
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/shared-logic`
Expected: FAIL — `Failed to resolve import "../../shared-logic/events"` (y `platform`).

- [ ] **Step 3: Crear los cuatro archivos y el script**

`shared-logic/tsconfig.json` (gate de aislamiento: `lib` sin DOM ni Node, `types: []`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2020",
    "moduleResolution": "node",
    "lib": ["ES2022", "WebWorker"],
    "types": [],
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["./**/*", "../shared/**/*", "../src/modules/**/*.schema.ts"],
  "exclude": ["**/*.test.ts"]
}
```

`shared-logic/ids.ts`:
```ts
/**
 * Stable UUID v4 for every row we mint. `globalThis.crypto` exists in the
 * Electron main process, in Node ≥ 19 (vitest) and in Web Workers, so this is
 * the one id source for desktop, tests and the Android worker.
 */
export function genId(): string {
  return globalThis.crypto.randomUUID();
}
```

`shared-logic/events.ts`:
```ts
/**
 * main → renderer events. Handlers call `emit(channel, payload)`; the binding
 * installs a sink (`webContents.send` on Electron, `postMessage` in the worker).
 * Without a sink (unit tests) `emit` is a no-op, exactly like the old
 * `broadcast()` helpers under a mocked `BrowserWindow`.
 */
export type EventSink = (channel: string, payload?: unknown) => void;

let sink: EventSink | null = null;

export function setEventSink(next: EventSink | null): void {
  sink = next;
}

export function emit(channel: string, payload?: unknown): void {
  if (!sink) return;
  try {
    sink(channel, payload);
  } catch (err) {
    // An event is a nicety — it must never take a DB transaction down with it.
    console.error(`[emit ${channel}]`, err);
  }
}
```

`shared-logic/platform.ts`:
```ts
/**
 * Everything the business logic needs from the host OS that is NOT the
 * database. Electron implements it with `dialog`/`fs`/`Notification`
 * (electron/platform.ts); Android proxies it to the UI thread (Fase 2/5).
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

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

let current: PlatformPort | null = null;

export function setPlatform(port: PlatformPort): void {
  current = port;
}

export function platform(): PlatformPort {
  if (!current) {
    throw new Error('PlatformPort not installed: call setPlatform() at startup');
  }
  return current;
}
```

`package.json` — agregar en `scripts`, después de `"test:e2e"`:
```json
    "typecheck:shared-logic": "tsc -p shared-logic --noEmit",
```

- [ ] **Step 4: Verificar**

Run: `npm test -- tests/shared-logic`
Expected: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.

Run: `npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared-logic package.json tests/shared-logic
git commit -m "feat(shared-logic): scaffold with ids, events and PlatformPort"
```

---

### Task 2: `shared-logic/registry.ts` (handlers + lifecycle)

**Files:**
- Create: `shared-logic/registry.ts`
- Test: `tests/shared-logic/registry.test.ts`

- [ ] **Step 1: Escribir el test**

`tests/shared-logic/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerHandler, getHandler, listChannels, clearHandlers,
  registerLifecycle, runSuspend, runResume,
} from '../../shared-logic/registry';

beforeEach(() => clearHandlers());

describe('registry — handlers', () => {
  it('registers and retrieves a handler by channel', async () => {
    registerHandler('quests:getTasks', (_e, projectId: string | null) => ({ projectId }));
    const fn = getHandler('quests:getTasks')!;
    expect(await fn({}, 'p1')).toEqual({ projectId: 'p1' });
  });

  it('returns undefined for an unknown channel', () => {
    expect(getHandler('nope:nothing')).toBeUndefined();
  });

  it('throws on a duplicate channel', () => {
    registerHandler('rpg:getStats', () => 1);
    expect(() => registerHandler('rpg:getStats', () => 2)).toThrow(/already registered.*rpg:getStats/);
  });

  it('lists channels in registration order', () => {
    registerHandler('b:two', () => 2);
    registerHandler('a:one', () => 1);
    expect(listChannels()).toEqual(['b:two', 'a:one']);
  });

  it('clearHandlers empties handlers and lifecycles', () => {
    registerHandler('x:y', () => 0);
    registerLifecycle({ suspend: () => undefined, resume: () => undefined });
    clearHandlers();
    expect(listChannels()).toEqual([]);
    expect(() => runSuspend()).not.toThrow();
  });
});

describe('registry — lifecycle', () => {
  it('runs suspend/resume hooks in registration order', () => {
    const calls: string[] = [];
    registerLifecycle({ suspend: () => calls.push('s1'), resume: () => calls.push('r1') });
    registerLifecycle({ suspend: () => calls.push('s2'), resume: () => calls.push('r2') });
    runSuspend();
    runResume();
    expect(calls).toEqual(['s1', 's2', 'r1', 'r2']);
  });
});
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm test -- tests/shared-logic/registry`
Expected: FAIL — `Failed to resolve import "../../shared-logic/registry"`.

- [ ] **Step 3: Implementar**

`shared-logic/registry.ts`:
```ts
/**
 * Platform-neutral handler registry. Modules register `module:action`
 * handlers here (through the `ipcHandle` alias in electron/ipc/ipc-handle.ts);
 * the desktop binding then binds every channel to `ipcMain.handle`, and the
 * Android worker dispatches `postMessage` invokes to `getHandler(channel)`.
 *
 * The `(event, ...args)` signature is kept on purpose: 148 handlers already
 * read as `(_e, ...)` and the tests invoke them as `fn({}, ...args)`.
 * `HandlerEvent` is deliberately empty — nothing reads the Electron event.
 */
export type HandlerEvent = Record<string, never>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (event: HandlerEvent, ...args: any[]) => unknown;

export interface Lifecycle {
  /** App going to background: stop timers that would touch a closed DB. */
  suspend(): void;
  /** App back in foreground (DB reopened): re-arm what suspend() stopped. */
  resume(): void;
}

const handlers = new Map<string, Handler>();
const lifecycles: Lifecycle[] = [];

export function registerHandler(channel: string, fn: Handler): void {
  if (handlers.has(channel)) {
    throw new Error(`Handler already registered for channel "${channel}"`);
  }
  handlers.set(channel, fn);
}

export function getHandler(channel: string): Handler | undefined {
  return handlers.get(channel);
}

export function listChannels(): string[] {
  return [...handlers.keys()];
}

/** Tests only: each suite re-registers its module's handlers from scratch. */
export function clearHandlers(): void {
  handlers.clear();
  lifecycles.length = 0;
}

export function registerLifecycle(lifecycle: Lifecycle): void {
  lifecycles.push(lifecycle);
}

export function runSuspend(): void {
  for (const l of lifecycles) l.suspend();
}

export function runResume(): void {
  for (const l of lifecycles) l.resume();
}
```

- [ ] **Step 4: Verificar**

Run: `npm test -- tests/shared-logic/registry`
Expected: `Tests 6 passed (6)`.

Run: `npm run typecheck:shared-logic && npx tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared-logic/registry.ts tests/shared-logic/registry.test.ts
git commit -m "feat(shared-logic): handler registry with lifecycle hooks"
```

---

### Task 3: `shared-logic/db/*` — interfaz, migraciones, proveedor; `electron/ipc/db.ts` fino

Hoy `electron/ipc/db.ts` (379 líneas) mezcla la apertura de better-sqlite3 con `initCoreTables`/`coreMigrations`/`applyMigrations` (líneas 23–365). Se mueve el archivo entero con `git mv` a `shared-logic/db/migrate.ts` (preserva la historia de las 6 core migrations) y se recrea `electron/ipc/db.ts` con solo `openDesktopDb()`.

**Files:**
- Create: `shared-logic/db/sql-database.ts`, `shared-logic/db/provider.ts`, `shared-logic/db/index.ts`
- Move: `electron/ipc/db.ts` → `shared-logic/db/migrate.ts`
- Create (nuevo, fino): `electron/ipc/db.ts`
- Modify: `electron/main.ts:6,342-347`, `electron/modules/backup.ipc.ts:1-6,25-28,91-93`
- Modify (imports): 21 tests con `vi.mock('.../electron/ipc/db')` + 14 con `coreMigrations`
- Test: `tests/shared-logic/provider.test.ts`

- [ ] **Step 1: Escribir el test del proveedor**

`tests/shared-logic/provider.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  getDb, setDbFactory, closeDb, suspendDb, resumeDb, DbSuspended, runModuleMigrations,
} from '../../shared-logic/db';

beforeEach(() => {
  resumeDb();
  closeDb();
});

describe('db provider', () => {
  it('opens through the factory once and applies core tables + core migrations', () => {
    const factory = vi.fn(() => new Database(':memory:'));
    setDbFactory(factory);
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    const applied = a.prepare("SELECT version FROM migrations_applied WHERE namespace = 'core' ORDER BY version").all() as Array<{ version: number }>;
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((a.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1);
  });

  it('closeDb() discards the singleton; the next getDb() reopens through the factory', () => {
    const factory = vi.fn(() => new Database(':memory:'));
    setDbFactory(factory);
    getDb();
    closeDb();
    getDb();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('getDb() throws DbSuspended while suspended and works again after resumeDb()', () => {
    setDbFactory(() => new Database(':memory:'));
    getDb();
    suspendDb();
    expect(() => getDb()).toThrow(DbSuspended);
    resumeDb();
    expect(() => getDb()).not.toThrow();
  });

  it('runModuleMigrations() applies a namespaced migration once', () => {
    setDbFactory(() => new Database(':memory:'));
    const m = [{ namespace: 'probe', version: 1, up: 'CREATE TABLE probe (id TEXT PRIMARY KEY);' }];
    runModuleMigrations(m);
    runModuleMigrations(m); // idempotent: second call is a no-op, not a "table exists" error
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM migrations_applied WHERE namespace = 'probe'").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('throws a clear error when no factory was installed', () => {
    // Fresh module state is per test FILE, so emulate "no factory" explicitly.
    setDbFactory(undefined as never);
    expect(() => getDb()).toThrow(/setDbFactory/);
  });
});
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm test -- tests/shared-logic/provider`
Expected: FAIL — `Failed to resolve import "../../shared-logic/db"`.

- [ ] **Step 3: Crear `sql-database.ts`**

`shared-logic/db/sql-database.ts`:
```ts
/**
 * The exact subset of better-sqlite3 the handlers use (verified in the spec's
 * Anexo A: prepare/run/get/all/exec/pragma/transaction/close — nothing else).
 * better-sqlite3 satisfies it structurally; the Android WASM shim implements it.
 *
 * `transaction` is typed with explicit (args, return) generics instead of a
 * single `<F>(fn: F): F`: better-sqlite3 returns `Transaction<F>` (F plus
 * `.immediate/.deferred/…`), which TypeScript refuses to assign back to a bare
 * `F`, so the spec's literal signature does not compile against the real type.
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement<Row = unknown> {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface SqlDatabase {
  prepare<Row = unknown>(sql: string): SqlStatement<Row>;
  exec(sql: string): void;
  pragma(directive: string): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}
```

- [ ] **Step 4: Mover `db.ts` a `migrate.ts` y recortarlo**

```bash
mkdir -p shared-logic/db
git mv electron/ipc/db.ts shared-logic/db/migrate.ts
```

Reemplazar las líneas 1–21 de `shared-logic/db/migrate.ts` (los imports, `let db`, y toda la función `getDb`) por:
```ts
import type { Migration } from '../../shared/types';
import type { SqlDatabase } from './sql-database';
```

Luego:
```bash
perl -pi -e 's/\bDatabase\.Database\b/SqlDatabase/g' shared-logic/db/migrate.ts
```

Y borrar del final del archivo (con Edit, texto exacto) las dos funciones que dependen del singleton:
```ts
export function runModuleMigrations(migrations: Migration[]): void {
  applyMigrations(getDb(), migrations);
}

```
y
```ts

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

El archivo resultante empieza con los dos `import type`, sigue con `export function initCoreTables(db: SqlDatabase)`, `export const coreMigrations`, `isDuplicateColumnError`, `function applyMigrations(database: SqlDatabase, …)` y termina en `export { applyMigrations };`.

- [ ] **Step 5: Crear `provider.ts` e `index.ts`**

`shared-logic/db/provider.ts`:
```ts
import type { Migration } from '../../shared/types';
import type { SqlDatabase } from './sql-database';
import { applyMigrations, coreMigrations, initCoreTables } from './migrate';

/** Opens a raw connection. Desktop: better-sqlite3 (electron/ipc/db.ts). Android: WASM shim. */
export type DbFactory = () => SqlDatabase;

/** Thrown by getDb() while the app is in background and the DB is closed. */
export class DbSuspended extends Error {
  constructor() {
    super('Database is suspended (app in background)');
    this.name = 'DbSuspended';
  }
}

let factory: DbFactory | null = null;
let db: SqlDatabase | null = null;
let suspended = false;

export function setDbFactory(next: DbFactory): void {
  factory = next;
}

/**
 * Lazy singleton. First call opens through the factory, applies the pragmas
 * shared by every platform (WAL is desktop-only — see openDesktopDb), the core
 * tables and the core migrations. Module migrations run separately
 * (runAllModuleMigrations) because each binding decides when.
 */
export function getDb(): SqlDatabase {
  if (suspended) throw new DbSuspended();
  if (!db) {
    if (!factory) throw new Error('setDbFactory() must run before getDb()');
    const opened = factory();
    opened.pragma('foreign_keys = ON');
    opened.pragma('synchronous = NORMAL');
    opened.pragma('cache_size = 10000');
    opened.pragma('temp_store = MEMORY');
    initCoreTables(opened);
    applyMigrations(opened, coreMigrations);
    db = opened;
  }
  return db;
}

export function runModuleMigrations(migrations: Migration[]): void {
  applyMigrations(getDb(), migrations);
}

/** Closes and discards the singleton; the next getDb() reopens normally. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Worker lifecycle (Fase 2): closed AND refusing to reopen until resumeDb(). */
export function suspendDb(): void {
  closeDb();
  suspended = true;
}

export function resumeDb(): void {
  suspended = false;
}
```

`shared-logic/db/index.ts` (ÚNICO path de import para módulos y tests):
```ts
export type { SqlDatabase, SqlStatement, RunResult } from './sql-database';
export { initCoreTables, coreMigrations, applyMigrations } from './migrate';
export {
  getDb, setDbFactory, closeDb, suspendDb, resumeDb, runModuleMigrations,
  DbSuspended, type DbFactory,
} from './provider';
```
(`runAllModuleMigrations` se agrega en Task 14, cuando `notifications.schema.ts` ya esté en shared-logic.)

- [ ] **Step 6: Recrear `electron/ipc/db.ts` fino**

```ts
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { SqlDatabase } from '../../shared-logic/db';

/**
 * Desktop DB binding: better-sqlite3 over userData/hubtify.db.
 * `journal_mode = WAL` lives here and not in the shared provider because the
 * Android VFS (opfs-sahpool) does not support WAL.
 */
export function openDesktopDb(): SqlDatabase {
  const db = new Database(path.join(app.getPath('userData'), 'hubtify.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

// TRANSITIONAL (removed in Task 14): modules still living in electron/ keep
// importing getDb from '../ipc/db' until each one moves to shared-logic. Typed
// as better-sqlite3 on purpose: their helpers still take `Database.Database`
// params, and `SqlDatabase` is NOT assignable in that direction (the object
// really is a better-sqlite3 Database, so the cast is honest).
export function getDb(): Database.Database {
  return sharedGetDb() as unknown as Database.Database;
}
```
con este import extra en la cabecera del archivo:
```ts
import { getDb as sharedGetDb } from '../../shared-logic/db';
```

- [ ] **Step 7: Actualizar `main.ts` y `backup.ipc.ts`**

`electron/main.ts` línea 6:
```ts
import { closeDb, getDb, runModuleMigrations } from './ipc/db';
```
→
```ts
import { closeDb, runModuleMigrations, setDbFactory } from '../shared-logic/db';
import { openDesktopDb, getDb } from './ipc/db';
```
(`getDb` sigue viniendo de `./ipc/db` hasta Task 14: `main.ts:375` hace `generateRecurringForMonth(getDb(), …)` y ese helper todavía está tipado con better-sqlite3 hasta que se mueva en Task 6.)

`electron/main.ts` — en `app.whenReady().then(() => {` (línea 342), agregar como PRIMERA línea del callback, antes de `createWindow();`:
```ts
  setDbFactory(openDesktopDb);
```

`electron/modules/backup.ipc.ts` líneas 1–6:
```ts
import { dialog, app } from 'electron';
import { getDb } from '../ipc/db';
import { ipcHandle } from '../ipc/ipc-handle';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
```
→
```ts
import { dialog, app } from 'electron';
import type Database from 'better-sqlite3';
import { closeDb, getDb } from '../../shared-logic/db';
import { ipcHandle } from '../ipc/ipc-handle';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
```

Línea 26 (`db.backup()` no forma parte de `SqlDatabase`; este archivo es desktop-only y conoce el tipo real):
```ts
      const db = getDb();
```
→
```ts
      const db = getDb() as unknown as Database.Database;
```

Líneas 91–93:
```ts
      // Close current DB before replacing
      const { closeDb } = require('../ipc/db');
      closeDb();
```
→
```ts
      // Close current DB before replacing
      closeDb();
```

- [ ] **Step 8: Actualizar los tests (mocks e imports de `electron/ipc/db` → `shared-logic/db`)**

Un solo reemplazo sobre los 34 archivos que referencian `electron/ipc/db` (21 mocks + 14 imports de `coreMigrations` (13 estáticos + el `await import()` de `reopen-combo`) − 2 que tienen ambos (`reopen-combo`, `day-reopened-rpg`) + 1 comentario en `finance.fx-rate.test.ts:20` = 34):
```bash
perl -pi -e 's#electron/ipc/db\b#shared-logic/db#g' $(rg -l "electron/ipc/db" tests)
```
Archivos afectados (verificá con `rg -l "shared-logic/db" tests | wc -l` → **34**):
`tests/ipc/{clean-install,migrations,rpg-achievements,rpg-codex,rpg-economy-audit,rpg-events,rpg-mastery,rpg-movement-undo,rpg-obolos,rpg-shop,rpg-vigor}.test.ts`,
`tests/modules/sync/sync-integrity.test.ts`,
`tests/modules/cauldron/{cauldron.retro,cauldron.phase2,cauldron.autostart}.test.ts`,
`tests/modules/finance/{finance.accounts-inherit,finance-import.dedup,finance-import.tax,finance.fx-rate-source,finance.review-medium,finance.third-party,finance.seed-tombstone,finance-import.card,finance.usd-symmetry,finance.dashboard-period}.test.ts`,
`tests/modules/nutrition/{close-day-xp-hp,copy-day-event,day-reopened-rpg,event-day,history-ipc,sync-merge,reopen-combo,protein-flow}.test.ts`,
`tests/modules/finance/finance.fx-rate.test.ts` (solo un comentario, que el perl deja como `shared-logic/db.ts`; apuntarlo al archivo real):
```bash
perl -pi -e 's#\(shared-logic/db\.ts\)#(shared-logic/db/migrate.ts)#' tests/modules/finance/finance.fx-rate.test.ts
```

Por qué alcanza con mockear `shared-logic/db`: el `getDb()` transicional de `electron/ipc/db.ts` llama a `sharedGetDb()` del módulo `shared-logic/db` EN TIEMPO DE LLAMADA, y `vi.mock` reemplaza ese módulo en el grafo, así que los módulos que todavía importan `'../ipc/db'` reciben el `getDb` mockeado.

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit`
Expected: sin salida, exit 0.

Run: `npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 95 passed (95)`, `Tests 1264 passed (1264)` (91+4 archivos; 1247 + 6 de Task 1 + 6 de Task 2 + 5 de esta).

- [ ] **Step 10: Commit**

```bash
git add -A shared-logic electron/ipc/db.ts electron/main.ts electron/modules/backup.ipc.ts tests
git commit -m "refactor(db): shared-logic db provider with injectable factory; electron keeps openDesktopDb()"
```

---

## Chunk 2: Binding de Electron sobre el registry

### Task 4: `ipcHandle` → `registerHandler`; `registerAllIpcHandlers()` bindea a `ipcMain`; tests capturan con `getHandler`

A partir de acá `ipcHandle` YA NO llama a `ipcMain.handle`: registra en el registry neutral, y `electron/ipc/registry.ts` bindea todos los canales de una vez. Consecuencia: los 21 tests que capturaban handlers mockeando `ipcMain.handle` pasan a `getHandler(channel)`. Y todo lo que se registre con `ipcHandle` DESPUÉS de `registerAllIpcHandlers()` no se bindea — por eso `main.ts` registra el updater y las ventanas del Cauldron ANTES.

**Files:**
- Modify: `electron/ipc/ipc-handle.ts` (reemplazo completo), `electron/ipc/registry.ts` (reemplazo completo), `electron/main.ts:5,350-358` (numeración tras Task 3; en master son 348–356)
- Modify: 21 tests (lista abajo)

- [ ] **Step 1: `electron/ipc/ipc-handle.ts` — reemplazo completo**

```ts
/**
 * Alias kept so the 15 modules that call `ipcHandle(channel, fn)` need no body
 * changes. Registration is platform-neutral (shared-logic/registry.ts);
 * `registerAllIpcHandlers()` in ./registry.ts binds every channel to ipcMain.
 */
export { registerHandler as ipcHandle } from '../../shared-logic/registry';
```

- [ ] **Step 2: `electron/ipc/registry.ts` — reemplazo completo**

```ts
import { ipcMain } from 'electron';
import { getHandler, listChannels } from '../../shared-logic/registry';
import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from '../modules/finance.ipc';
import { registerFinanceImportIpcHandlers } from '../modules/finance-import.ipc';
import { registerCharacterIpcHandlers } from '../modules/character.ipc';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';
import { registerNotificationIpcHandlers } from '../modules/notifications.ipc';
import { registerDollarIpcHandlers } from '../modules/dollar.ipc';
import { registerCryptoIpcHandlers } from '../modules/crypto.ipc';
import { registerSyncIpcHandlers } from '../modules/sync.ipc';
import { registerCauldronIpcHandlers } from '../modules/cauldron.ipc';
import { registerFeedbackIpcHandlers } from '../modules/feedback.ipc';
import { registerSylIpcHandlers } from '../modules/syl.ipc';

/**
 * Registers every handler in the platform-neutral registry, then binds each
 * channel to ipcMain. Anything registered through `ipcHandle` AFTER this call
 * is never bound — desktop-only handlers (updater, cauldron windows) are
 * registered in main.ts BEFORE calling this.
 */
export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerFinanceImportIpcHandlers();
  registerCharacterIpcHandlers();
  registerBackupIpcHandlers();
  registerNotificationIpcHandlers();
  registerDollarIpcHandlers();
  registerCryptoIpcHandlers();
  registerSyncIpcHandlers();
  registerCauldronIpcHandlers();
  registerFeedbackIpcHandlers();
  registerSylIpcHandlers();
  bindToIpcMain();
}

/** Same labeled-error logging the old ipcHandle wrapper had. */
function bindToIpcMain(): void {
  for (const channel of listChannels()) {
    const fn = getHandler(channel)!;
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn({}, ...args);
      } catch (err) {
        console.error(`[${channel}]`, err);
        throw err;
      }
    });
  }
}
```

- [ ] **Step 3: `electron/main.ts` — orden de registro y ventanas del Cauldron vía `ipcHandle`**

Línea 5, agregar debajo de `import { registerAllIpcHandlers } from './ipc/registry';`:
```ts
import { ipcHandle } from './ipc/ipc-handle';
```

Líneas 350–358 (348–356 en master; el texto es el mismo):
```ts
  registerAllIpcHandlers();
  registerUpdaterIpcHandlers();

  ipcMain.handle('cauldron:openWindow', () => createCauldronWindow());
  ipcMain.handle('cauldron:closeWindow', () => {
    if (cauldronWindow && !cauldronWindow.isDestroyed()) {
      cauldronWindow.close();
    }
  });
```
→
```ts
  // Desktop-only handlers go through the same registry; they MUST be registered
  // before registerAllIpcHandlers(), which is what binds the registry to ipcMain.
  registerUpdaterIpcHandlers();
  ipcHandle('cauldron:openWindow', () => createCauldronWindow());
  ipcHandle('cauldron:closeWindow', () => {
    if (cauldronWindow && !cauldronWindow.isDestroyed()) {
      cauldronWindow.close();
    }
  });

  registerAllIpcHandlers();
```
`ipcMain` sigue usándose en `main.ts:238-243` (`ipcMain.on('window:*')`), así que el import de la línea 1 no cambia.

- [ ] **Step 4: Tests — patrón A (18 archivos con `harness.handlers.get(channel)`)**

Archivos (todos a profundidad `tests/modules/<x>/`):
`tests/modules/cauldron/{cauldron.autostart,cauldron.retro,cauldron.phase2}.test.ts`,
`tests/modules/finance/{finance-import.dedup,finance-import.card,finance-import.tax,finance.accounts-inherit,finance.dashboard-period,finance.fx-rate-source,finance.review-medium,finance.third-party,finance.usd-symmetry,finance.seed-tombstone}.test.ts`,
`tests/modules/nutrition/{copy-day-event,event-day,history-ipc,protein-flow,reopen-combo}.test.ts`.

```bash
FILES_A="tests/modules/cauldron/cauldron.autostart.test.ts tests/modules/cauldron/cauldron.retro.test.ts tests/modules/cauldron/cauldron.phase2.test.ts tests/modules/finance/finance-import.dedup.test.ts tests/modules/finance/finance-import.card.test.ts tests/modules/finance/finance-import.tax.test.ts tests/modules/finance/finance.accounts-inherit.test.ts tests/modules/finance/finance.dashboard-period.test.ts tests/modules/finance/finance.fx-rate-source.test.ts tests/modules/finance/finance.review-medium.test.ts tests/modules/finance/finance.third-party.test.ts tests/modules/finance/finance.usd-symmetry.test.ts tests/modules/finance/finance.seed-tombstone.test.ts tests/modules/nutrition/copy-day-event.test.ts tests/modules/nutrition/event-day.test.ts tests/modules/nutrition/history-ipc.test.ts tests/modules/nutrition/protein-flow.test.ts tests/modules/nutrition/reopen-combo.test.ts"
# 1) lookup por el registry
perl -pi -e 's/harness\.handlers\.get\(channel\)/getHandler(channel)/' $FILES_A
# 2) import, insertado justo antes del primer vi.mock('electron' (hoisting de ESM: la posición no importa)
perl -0pi -e 's/^(vi\.mock\(\x27electron\x27)/import { getHandler, clearHandlers } from \x27..\/..\/..\/shared-logic\/registry\x27;\n\n$1/m' $FILES_A
```
Verificá: `rg -c "getHandler\(channel\)" $FILES_A` → 1 por archivo; `rg -L "shared-logic/registry" $FILES_A` → vacío.

Dos de esos archivos vuelven a llamar `registerCauldronIpcHandlers()` dentro de un `it` para simular el próximo arranque; con el registry eso ahora lanza por canal duplicado. Agregar `clearHandlers();` justo antes en ambos:

`tests/modules/cauldron/cauldron.retro.test.ts:249`:
```ts
    registerCauldronIpcHandlers();
```
→
```ts
    clearHandlers();
    registerCauldronIpcHandlers();
```

`tests/modules/cauldron/cauldron.phase2.test.ts:431` — mismo cambio (el texto de la línea es idéntico; usá el contexto del comentario «Volver a registrar los handlers dispara `cleanupOrphanedSessions()`» para ubicarla).

- [ ] **Step 5: Tests — patrón B (3 archivos con `handlers.get('…')` y `handlers.clear()` en `beforeEach`)**

`tests/modules/nutrition/{close-day-xp-hp,day-reopened-rpg,sync-merge}.test.ts`:
```bash
FILES_B="tests/modules/nutrition/close-day-xp-hp.test.ts tests/modules/nutrition/day-reopened-rpg.test.ts tests/modules/nutrition/sync-merge.test.ts"
perl -pi -e 's/\bhandlers\.get\(/getHandler(/g; s/\bhandlers\.clear\(\)/clearHandlers()/g' $FILES_B
perl -0pi -e 's/^(vi\.mock\(\x27electron\x27)/import { getHandler, clearHandlers } from \x27..\/..\/..\/shared-logic\/registry\x27;\n\n$1/m' $FILES_B
```
Resultado esperado, p. ej. en `close-day-xp-hp.test.ts`: `return await getHandler('nutrition:closeDay')!({}, DATE);` y el `beforeEach` con `clearHandlers(); registerNutritionIpcHandlers();`.

Los `vi.mock('electron', …)` de los 21 archivos se dejan como están: todavía hacen falta mientras los módulos importan `BrowserWindow`/`Notification`/`dialog`; quedan inertes a medida que cada módulo se mueve (Chunk 2).

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 95 passed (95)`, `Tests 1264 passed (1264)`.

Si algún test falla con `Handler already registered for channel`, ese archivo registra handlers más de una vez: agregá `clearHandlers()` antes de la segunda llamada (patrón de Step 4).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/ipc-handle.ts electron/ipc/registry.ts electron/main.ts tests
git commit -m "refactor(ipc): route ipcHandle through shared-logic registry; bind to ipcMain once"
```

---

### Task 5: `electron/platform.ts` completo + sink de eventos; `main.ts` los instala

**Files:**
- Create: `electron/platform.ts`
- Modify: `electron/main.ts` (imports + 2 líneas en `whenReady`)
- Test: `tests/electron/platform.test.ts`

- [ ] **Step 1: Escribir el test (con `electron` y `fs` mockeados)**

`tests/electron/platform.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  shown: [] as Array<{ title: string; body: string }>,
  clickHandlers: [] as Array<() => void>,
  focused: 0,
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  written: [] as Array<{ path: string; data: unknown }>,
  sent: [] as Array<{ channel: string; args: unknown[] }>,
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.8.2' },
  shell: { openExternal: vi.fn(async () => undefined) },
  dialog: { showSaveDialog: h.saveDialog, showOpenDialog: h.openDialog },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [{
      isMinimized: () => false,
      restore: () => undefined,
      show: () => { h.focused++; },
      focus: () => undefined,
      webContents: { send: (channel: string, ...args: unknown[]) => h.sent.push({ channel, args }) },
    }],
  },
  Notification: Object.assign(
    class {
      constructor(private opts: { title: string; body: string }) {}
      on(_ev: string, cb: () => void) { h.clickHandlers.push(cb); }
      show() { h.shown.push(this.opts); }
    },
    { isSupported: () => true },
  ),
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: (path: string, data: unknown) => { h.written.push({ path, data }); },
    // Mirrors fs: a string encoding returns a string, no encoding returns a Buffer.
    readFileSync: (_p: string, enc?: string) => (enc ? 'hello' : Buffer.from('hello')),
  },
}));

const { electronPlatform, webContentsSink } = await import('../../electron/platform');

beforeEach(() => {
  h.shown.length = 0; h.clickHandlers.length = 0; h.focused = 0;
  h.written.length = 0; h.sent.length = 0;
  h.saveDialog.mockReset(); h.openDialog.mockReset();
});

describe('electronPlatform', () => {
  it('reports app version and OS', () => {
    expect(electronPlatform.appVersion()).toBe('0.8.2');
    expect(electronPlatform.osInfo()).toMatch(new RegExp(`^${process.platform} `));
  });

  it('notify shows a native notification whose click focuses the main window', async () => {
    await electronPlatform.notify({ title: 'T', body: 'B' });
    expect(h.shown).toEqual([{ title: 'T', body: 'B' }]);
    h.clickHandlers[0]();
    expect(h.focused).toBe(1);
  });

  it('saveTextFile writes when the user picks a path and returns false on cancel', async () => {
    h.saveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'C:/tmp/coinify-2026-09.csv' });
    expect(await electronPlatform.saveTextFile('coinify-2026-09.csv', 'a,b')).toBe(true);
    expect(h.written).toEqual([{ path: 'C:/tmp/coinify-2026-09.csv', data: 'a,b' }]);

    h.saveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    expect(await electronPlatform.saveTextFile('x.csv', '')).toBe(false);
  });

  it('pickPdfText returns null when the dialog is cancelled', async () => {
    h.openDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await electronPlatform.pickPdfText()).toBeNull();
  });

  it('pickTextFile returns name + content', async () => {
    h.openDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/tmp/notes.txt'] });
    expect(await electronPlatform.pickTextFile([{ name: 'Text', extensions: ['txt'] }]))
      .toEqual({ name: 'notes.txt', content: 'hello' });
  });
});

describe('webContentsSink', () => {
  it('sends to every window, omitting the payload argument when undefined', () => {
    webContentsSink('rpg:pardonUsed');
    webContentsSink('cauldron:tick', { status: 'work' });
    expect(h.sent).toEqual([
      { channel: 'rpg:pardonUsed', args: [] },
      { channel: 'cauldron:tick', args: [{ status: 'work' }] },
    ]);
  });
});
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm test -- tests/electron/platform`
Expected: FAIL — `Failed to resolve import "../../electron/platform"`.

- [ ] **Step 3: Crear `electron/platform.ts`**

```ts
import { app, BrowserWindow, dialog, Notification, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import type { FileFilter, PlatformPort } from '../shared-logic/platform';

/**
 * Desktop PlatformPort. Everything that used to be inlined in the handlers
 * (dialog + fs in finance.ipc/finance-import.ipc, Notification in
 * notifications.ipc/cauldron.ipc, app/os in feedback.ipc/syl.ipc) lives here.
 */

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Same `win!` the old handlers passed: Electron accepts a null parent. */
function ownerWindow(): BrowserWindow {
  return BrowserWindow.getFocusedWindow()!;
}

function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function filtersFor(defaultName: string): FileFilter[] {
  const ext = defaultName.includes('.') ? defaultName.split('.').pop()! : '';
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
}

export const electronPlatform: PlatformPort = {
  appVersion: () => app.getVersion(),

  osInfo: () => `${process.platform} ${os.release()}`,

  async notify({ title, body }) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', focusMainWindow);
    n.show();
  },

  async openExternal(url) {
    await shell.openExternal(url);
  },

  async pickTextFile(filters) {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), { filters, properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return null;
    return { name: baseName(filePaths[0]), content: fs.readFileSync(filePaths[0], 'utf-8') };
  },

  async pickPdfText() {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), {
      title: 'Seleccionar PDF de resumen',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const buffer = fs.readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    await parser.load();
    const data = await parser.getText();
    return { name: baseName(filePath) || 'unknown.pdf', text: data.text };
  },

  async pickBinaryFile(filters) {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), { filters, properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return null;
    return { name: baseName(filePaths[0]), bytes: new Uint8Array(fs.readFileSync(filePaths[0])) };
  },

  async saveTextFile(defaultName, content) {
    const { filePath, canceled } = await dialog.showSaveDialog(ownerWindow(), {
      defaultPath: defaultName,
      filters: filtersFor(defaultName),
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  },

  async saveBinaryFile(defaultName, bytes) {
    const { filePath, canceled } = await dialog.showSaveDialog(ownerWindow(), {
      defaultPath: defaultName,
      filters: filtersFor(defaultName),
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, bytes);
    return true;
  },
};

/**
 * Event sink: main → every renderer window. Replaces the `broadcast()` helpers
 * of rpg-handlers/cauldron.ipc and the `webContents.send` loops of
 * notifications.ipc. Sending with no payload keeps the exact old wire shape.
 */
export function webContentsSink(channel: string, payload?: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (payload === undefined) win.webContents.send(channel);
      else win.webContents.send(channel, payload);
    }
  } catch { /* headless, or a window mid-teardown */ }
}
```

- [ ] **Step 4: Instalar en `main.ts`**

Debajo de `import { openDesktopDb } from './ipc/db';` agregar:
```ts
import { setPlatform } from '../shared-logic/platform';
import { setEventSink } from '../shared-logic/events';
import { electronPlatform, webContentsSink } from './platform';
```

En `app.whenReady().then(() => {`, después de `setDbFactory(openDesktopDb);`:
```ts
  setPlatform(electronPlatform);
  setEventSink(webContentsSink);
```
El orden final del callback: `setDbFactory` → `setPlatform` → `setEventSink` → `createWindow()` → updater + cauldron windows → `registerAllIpcHandlers()` → `getDb()` → migraciones → resto.

- [ ] **Step 5: Verificar**

Run: `npm test -- tests/electron/platform`
Expected: `Tests 6 passed (6)`.

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

- [ ] **Step 6: Commit**

```bash
git add electron/platform.ts electron/main.ts tests/electron
git commit -m "feat(electron): PlatformPort and event sink for the desktop binding"
```


---

## Chunk 3: Mover los módulos (I) — hojas, rpg, chicos, quests, nutrition, finance

Grafo de imports entre módulos (verificado con rg): las hojas puras se mueven primero, así ningún archivo de `shared-logic` importa nunca desde `electron/`, y `npm run typecheck:shared-logic` se mantiene verde en cada commit.

```
rpg-stats ← rpg-handlers, syl.ipc, syl.snapshot
quests.habits ← quests.ipc, sync.ipc, syl.snapshot
finance.balance ← finance.ipc, finance-import.ipc, dollar.ipc, notification-engine, syl.snapshot, main.ts
notifications.schema ← main.ts (y tests)
notification-engine ← notifications.ipc
syl.snapshot ← syl.ipc
notifications.ipc ← cauldron.ipc, main.ts
nutrition.ipc ← sync.ipc
```

Orden: **6** hojas puras → **7** rpg-handlers → **8** character/crypto/dollar/feedback/syl → **9** quests → **10** nutrition → **11** finance + finance-import → **12** notifications + cauldron → **13** sync → **14** cierre (register-all, all-migrations, registry, db.ts final).

Receta común para cada archivo movido (se repite abajo con las líneas exactas):
1. `git mv electron/modules/X.ts shared-logic/modules/X.ts`
2. `import type Database from 'better-sqlite3'` → `import type { SqlDatabase } from '../db'` y `Database.Database` → `SqlDatabase`
3. `import { ipcHandle } from '../ipc/ipc-handle'` → `import { registerHandler as ipcHandle } from '../registry'`
4. `import { getDb } from '../ipc/db'` → `import { getDb } from '../db'`
5. `import crypto from 'crypto'` → `import { genId } from '../ids'`; `crypto.randomUUID()` → `genId()`; borrar el `genId` local
6. Lo que la tabla §6 de la spec dicte para `electron` (`BrowserWindow`/`Notification`/`dialog`/`fs`/`app`/`os`)
7. Imports de hermanos que ya están en `shared-logic/modules/` vuelven a `'./X'`
8. `electron/ipc/registry.ts` y los módulos que siguen en `electron/` apuntan al nuevo path
9. Tests: `perl -pi -e 's#electron/(modules|ipc)/X#shared-logic/modules/X#g' $(rg -l "electron/(modules|ipc)/X" tests)`

### Task 6: Hojas puras — `rpg-stats`, `quests.habits`, `finance.balance`, `notifications.schema`, `notification-engine`, `syl.snapshot`

Ninguno registra handlers ni importa `electron`; solo cambian tipos, `crypto` y rutas.

**Files:**
- Move: `electron/ipc/rpg-stats.ts`, `electron/modules/{quests.habits,finance.balance,notifications.schema,notification-engine,syl.snapshot}.ts` → `shared-logic/modules/`
- Modify (rutas temporales hacia shared-logic): `electron/ipc/rpg-handlers.ts:48`, `electron/modules/quests.ipc.ts:6`, `electron/modules/sync.ipc.ts:5`, `electron/modules/syl.ipc.ts:4,6`, `electron/modules/finance.ipc.ts:48`, `electron/modules/finance-import.ipc.ts:13`, `electron/modules/dollar.ipc.ts:11`, `electron/modules/notifications.ipc.ts:14`, `electron/main.ts:16,19` (11 y 14 en master; Task 3, 4 y 5 sumaron 5 imports), `electron/ipc/registry.ts` (sin cambios: no importa hojas)
- Tests: 26 archivos (solo rutas)

- [ ] **Step 1: Mover**

```bash
mkdir -p shared-logic/modules
git mv electron/ipc/rpg-stats.ts shared-logic/modules/rpg-stats.ts
git mv electron/modules/quests.habits.ts shared-logic/modules/quests.habits.ts
git mv electron/modules/finance.balance.ts shared-logic/modules/finance.balance.ts
git mv electron/modules/notifications.schema.ts shared-logic/modules/notifications.schema.ts
git mv electron/modules/notification-engine.ts shared-logic/modules/notification-engine.ts
git mv electron/modules/syl.snapshot.ts shared-logic/modules/syl.snapshot.ts
```

- [ ] **Step 2: Tipos y `genId` dentro de los movidos**

`notification-engine.ts:11` define `const genId = (): string => crypto.randomUUID();` — borrar esa línea PRIMERO (si no, el reemplazo la convierte en `genId = () => genId()`):
```bash
perl -ni -e 'print unless /^const genId = \(\): string => crypto\.randomUUID\(\);$/' shared-logic/modules/notification-engine.ts
```
Ahora los reemplazos:
```bash
perl -pi -e "s#^import type Database from 'better-sqlite3';#import type { SqlDatabase } from '../db';#; s/\bDatabase\.Database\b/SqlDatabase/g" shared-logic/modules/rpg-stats.ts shared-logic/modules/quests.habits.ts shared-logic/modules/finance.balance.ts shared-logic/modules/notification-engine.ts shared-logic/modules/syl.snapshot.ts
perl -pi -e "s#^import crypto from 'crypto';#import { genId } from '../ids';#; s/\bcrypto\.randomUUID\(\)/genId()/g" shared-logic/modules/quests.habits.ts shared-logic/modules/finance.balance.ts shared-logic/modules/notification-engine.ts
perl -pi -e "s#'../ipc/rpg-stats'#'./rpg-stats'#" shared-logic/modules/syl.snapshot.ts
perl -pi -e "s#^// Lives in electron/modules/ \(not inside a single module folder\) because#// Lives in shared-logic/modules/ (not inside a single module folder) because#" shared-logic/modules/notifications.schema.ts
```
Verificá: `rg -n "better-sqlite3|from 'crypto'|crypto\.randomUUID|\.\./ipc/" shared-logic/modules` → vacío. `rg -c "genId\(\)" shared-logic/modules/quests.habits.ts` → 1 (línea 439), `finance.balance.ts` → 4, `notification-engine.ts` → las llamadas que ya usaban `genId()`.

- [ ] **Step 3: Los que siguen en `electron/` apuntan a shared-logic (temporal, hasta que cada uno se mueva)**

```bash
perl -pi -e "s#'./rpg-stats'#'../../shared-logic/modules/rpg-stats'#" electron/ipc/rpg-handlers.ts
perl -pi -e "s#'./quests.habits'#'../../shared-logic/modules/quests.habits'#" electron/modules/quests.ipc.ts electron/modules/sync.ipc.ts
perl -pi -e "s#'../ipc/rpg-stats'#'../../shared-logic/modules/rpg-stats'#; s#'./syl.snapshot'#'../../shared-logic/modules/syl.snapshot'#" electron/modules/syl.ipc.ts
perl -pi -e "s#'./finance.balance'#'../../shared-logic/modules/finance.balance'#" electron/modules/finance.ipc.ts electron/modules/finance-import.ipc.ts electron/modules/dollar.ipc.ts
perl -pi -e "s#'./notification-engine'#'../../shared-logic/modules/notification-engine'#" electron/modules/notifications.ipc.ts
perl -pi -e "s#'./modules/finance.balance'#'../shared-logic/modules/finance.balance'#; s#'./modules/notifications.schema'#'../shared-logic/modules/notifications.schema'#" electron/main.ts
```

- [ ] **Step 4: Tests**

```bash
perl -pi -e 's#electron/ipc/rpg-stats#shared-logic/modules/rpg-stats#g; s#electron/modules/(quests\.habits|finance\.balance|notifications\.schema|notification-engine|syl\.snapshot)\b#shared-logic/modules/$1#g' $(rg -l "electron/" tests)
```
Verificá: `rg -l "electron/(ipc/rpg-stats|modules/(quests\.habits|finance\.balance|notifications\.schema|notification-engine|syl\.snapshot))" tests` → vacío. Esto también corrige el `vi.mock('../../../electron/modules/quests.habits', …)` de `finance.seed-tombstone.test.ts:35`, que ahora apunta al mismo archivo que importa `sync.ipc`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

- [ ] **Step 6: Commit**

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move pure helpers (rpg-stats, habits, balance, notifications schema/engine, syl snapshot)"
```

---

### Task 7: `rpg-handlers.ts` (broadcast → emit, crypto → genId)

**Files:**
- Move: `electron/ipc/rpg-handlers.ts` → `shared-logic/modules/rpg-handlers.ts`
- Modify: `electron/ipc/registry.ts:3`
- Tests: `tests/ipc/{rpg-achievements,rpg-codex,rpg-economy-audit,rpg-events,rpg-mastery,rpg-movement-undo,rpg-obolos,rpg-shop,rpg-vigor}.test.ts`, `tests/modules/sync/sync-integrity.test.ts`, `tests/modules/nutrition/{day-reopened-rpg,reopen-combo}.test.ts`

- [ ] **Step 1: Mover y borrar el `broadcast` local**

```bash
git mv electron/ipc/rpg-handlers.ts shared-logic/modules/rpg-handlers.ts
```

Con Edit, borrar este bloque (líneas 187–197, texto exacto):
```ts
/** Defensive broadcast to every renderer. Never allowed to break a transaction. */
function broadcast(channel: string, ...args: unknown[]): void {
  // Under vitest the electron mock has no BrowserWindow, and at real startup
  // there may be no windows yet. Notifications are a nicety — they must never
  // take the XP transaction down with them.
  try {
    for (const win of BrowserWindow?.getAllWindows?.() ?? []) {
      win.webContents.send(channel, ...args);
    }
  } catch { /* headless or test environment */ }
}

```

- [ ] **Step 2: Imports, tipos, `genId`, `emit`**

```bash
perl -pi -e "s#^import type Database from 'better-sqlite3';#import type { SqlDatabase } from '../db';#; s/\bDatabase\.Database\b/SqlDatabase/g; s#^import \{ getDb \} from './db';#import { getDb } from '../db';#; s#^import \{ ipcHandle \} from './ipc-handle';#import { registerHandler as ipcHandle } from '../registry';#; s#^import crypto from 'crypto';#import { genId } from '../ids';#; s/\bcrypto\.randomUUID\(\)/genId()/g; s#^import \{ BrowserWindow \} from 'electron';#import { emit } from '../events';#; s#'../../shared-logic/modules/rpg-stats'#'./rpg-stats'#; s/\bbroadcast\(/emit(/g" shared-logic/modules/rpg-handlers.ts
```
Las primeras 5 líneas quedan:
```ts
import type { SqlDatabase } from '../db';
import { getDb } from '../db';
import { registerHandler as ipcHandle } from '../registry';
import { genId } from '../ids';
import { emit } from '../events';
```
Verificá: `rg -n "broadcast\(|crypto\.|BrowserWindow|from 'better-sqlite3'" shared-logic/modules/rpg-handlers.ts` → vacío (los comentarios con la palabra «broadcast» sin paréntesis, y el de la línea 1306 que menciona better-sqlite3, pueden quedar). `rg -c "emit\('" shared-logic/modules/rpg-handlers.ts` → 10 (las 10 llamadas que eran `broadcast(`).

- [ ] **Step 3: `electron/ipc/registry.ts:3`**

```ts
import { registerRpgHandlers } from './rpg-handlers';
```
→
```ts
import { registerRpgHandlers } from '../../shared-logic/modules/rpg-handlers';
```

- [ ] **Step 4: Tests — rutas y el sink de `rpg-economy-audit`**

```bash
perl -pi -e 's#electron/ipc/rpg-handlers#shared-logic/modules/rpg-handlers#g' $(rg -l "electron/ipc/rpg-handlers" tests)
```

`tests/ipc/rpg-economy-audit.test.ts` líneas 20–28 capturaban el broadcast por `BrowserWindow`; ahora por el sink. Reemplazar:
```ts
/** Every broadcast the engine sends, so a test can count them. */
const broadcasts: Array<{ channel: string; data: unknown }> = [];
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: { send: (channel: string, data: unknown) => { broadcasts.push({ channel, data }); } },
    }],
  },
}));
```
→
```ts
/** Every event the engine emits, so a test can count them. */
const broadcasts: Array<{ channel: string; data: unknown }> = [];
setEventSink((channel, data) => { broadcasts.push({ channel, data }); });
```
y agregar junto a los otros imports del archivo:
```ts
import { setEventSink } from '../../shared-logic/events';
```
(`vi` sigue importado y usado por otros mocks/spies del archivo; si eslint marcara `vi` sin uso, no importa: los tests tienen `no-unused-vars` apagado.)

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

- [ ] **Step 6: Commit**

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move rpg-handlers; broadcast() becomes emit()"
```

---

### Task 8: `character`, `crypto`, `dollar`, `feedback`, `syl` (los cinco chicos)

**Files:**
- Move: `electron/modules/{character.ipc,crypto.ipc,dollar.ipc,feedback.ipc,syl.ipc}.ts` → `shared-logic/modules/`
- Modify: `electron/ipc/registry.ts` (5 imports)
- Tests: ninguno importa estos cinco.

- [ ] **Step 1: Mover**

```bash
git mv electron/modules/character.ipc.ts shared-logic/modules/character.ipc.ts
git mv electron/modules/crypto.ipc.ts shared-logic/modules/crypto.ipc.ts
git mv electron/modules/dollar.ipc.ts shared-logic/modules/dollar.ipc.ts
git mv electron/modules/feedback.ipc.ts shared-logic/modules/feedback.ipc.ts
git mv electron/modules/syl.ipc.ts shared-logic/modules/syl.ipc.ts
```

- [ ] **Step 2: `character`, `crypto`, `dollar` — solo rutas**

```bash
perl -pi -e "s#^import \{ getDb \} from '../ipc/db';#import { getDb } from '../db';#; s#^import \{ ipcHandle \} from '../ipc/ipc-handle';#import { registerHandler as ipcHandle } from '../registry';#; s#'../../shared-logic/modules/finance.balance'#'./finance.balance'#" shared-logic/modules/character.ipc.ts shared-logic/modules/crypto.ipc.ts shared-logic/modules/dollar.ipc.ts
```

- [ ] **Step 3: `feedback.ipc.ts` — líneas 1–3 y 19–20**

Líneas 1–3:
```ts
import { app } from 'electron';
import os from 'os';
import { ipcHandle } from '../ipc/ipc-handle';
```
→
```ts
import { registerHandler as ipcHandle } from '../registry';
import { platform } from '../platform';
```

Líneas 19–20 (dentro de `const body = {`):
```ts
      appVersion: app.getVersion(),
      os: `${process.platform} ${os.release()}`,
```
→
```ts
      appVersion: platform().appVersion(),
      os: platform().osInfo(),
```

- [ ] **Step 4: `syl.ipc.ts` — reemplazo completo (25 líneas)**

```ts
import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { platform } from '../platform';
import { rolloverVigor } from './rpg-stats';
import { todayDateString } from '../../shared/date-utils';
import { buildSylSnapshot } from './syl.snapshot';
import type { SylSnapshot } from '../../shared/types';

export function registerSylIpcHandlers(): void {
  // Computes the Syl read-projection snapshot from local SQLite.
  // Called by the renderer during syncPush to mirror a clean/derived view to
  // Firestore (hubtify_users/{uid}/syl/snapshot) for the Syl assistant.
  ipcHandle('syl:buildSnapshot', (): SylSnapshot => {
    const db = getDb();
    // getPlayerStats is deliberately side-effect-free (the snapshot builder must
    // not mutate state), so the daily Vigor reset happens here, at the handler
    // boundary — otherwise Syl would read yesterday's depleted HP all morning.
    rolloverVigor(db);
    return buildSylSnapshot(db, {
      now: new Date().toISOString(),      // ISO-8601 UTC
      computedForDate: todayDateString(), // YYYY-MM-DD, local day
      appVersion: platform().appVersion(),
    });
  });
}
```

- [ ] **Step 5: `electron/ipc/registry.ts`**

```bash
perl -pi -e "s#'../modules/(character|crypto|dollar|feedback|syl)\.ipc'#'../../shared-logic/modules/\$1.ipc'#" electron/ipc/registry.ts
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && rg -n "from 'electron'|from 'os'|\bprocess\.[a-zA-Z]" shared-logic`
Expected: sin salida (tsc) y rg sin resultados; exit 0 / 1 respectivamente.

Run: `npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

- [ ] **Step 7: Commit**

```bash
git add -A shared-logic electron
git commit -m "refactor(shared-logic): move character, crypto, dollar, feedback and syl handlers"
```

---

### Task 9: `quests.ipc.ts`

**Files:**
- Move: `electron/modules/quests.ipc.ts` → `shared-logic/modules/quests.ipc.ts`
- Modify: `electron/ipc/registry.ts`
- Tests: `tests/modules/quests/{quests-repeat,quests-repeat-xp,quests-fase1,habit-retro-undo}.test.ts`

- [ ] **Step 1: Mover y borrar el `genId` local (líneas 8–10 + línea en blanco)**

```bash
git mv electron/modules/quests.ipc.ts shared-logic/modules/quests.ipc.ts
```
Con Edit, borrar:
```ts
function genId(): string {
  return crypto.randomUUID();
}

```

- [ ] **Step 2: Imports**

```bash
perl -pi -e "s#^import type Database from 'better-sqlite3';#import type { SqlDatabase } from '../db';#; s/\bDatabase\.Database\b/SqlDatabase/g; s#^import \{ ipcHandle \} from '../ipc/ipc-handle';#import { registerHandler as ipcHandle } from '../registry';#; s#^import \{ getDb \} from '../ipc/db';#import { getDb } from '../db';#; s#^import crypto from 'crypto';#import { genId } from '../ids';#; s#'../../shared-logic/modules/quests.habits'#'./quests.habits'#" shared-logic/modules/quests.ipc.ts
perl -pi -e "s#'../modules/quests\.ipc'#'../../shared-logic/modules/quests.ipc'#" electron/ipc/registry.ts
perl -pi -e 's#electron/modules/quests\.ipc#shared-logic/modules/quests.ipc#g' $(rg -l "electron/modules/quests\.ipc" tests)
```
Verificá: `rg -n "crypto|better-sqlite3|\.\./ipc/" shared-logic/modules/quests.ipc.ts` → vacío.

- [ ] **Step 3: Verificar y commit**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move quests handlers"
```

---

### Task 10: `nutrition.ipc.ts`

`nutrition.ipc.ts` NO importa `crypto` (usa el global de Node); su `genId` local (líneas 17–19) se reemplaza por el de `../ids`.

**Files:**
- Move: `electron/modules/nutrition.ipc.ts` → `shared-logic/modules/nutrition.ipc.ts`
- Modify: `electron/ipc/registry.ts`, `electron/modules/sync.ipc.ts:4`
- Tests: `tests/modules/nutrition/{close-day-xp-hp,copy-day-event,event-day,history-ipc,protein-flow,reopen-combo,reopen-day,repeat-day,tdee-bmr}.test.ts`, `tests/modules/finance/finance.seed-tombstone.test.ts:34` (mock)

- [ ] **Step 1: Mover, borrar `genId` local, imports**

```bash
git mv electron/modules/nutrition.ipc.ts shared-logic/modules/nutrition.ipc.ts
```
Con Edit, borrar (líneas 17–19 + la línea en blanco siguiente):
```ts
function genId(): string {
  return crypto.randomUUID();
}

```
Líneas 1–2:
```ts
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
```
→
```ts
import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
```
Los imports de `'../../shared/…'` y `'../../src/modules/nutrition/…'` (líneas 4–15) no cambian.

```bash
perl -pi -e "s#'../modules/nutrition\.ipc'#'../../shared-logic/modules/nutrition.ipc'#" electron/ipc/registry.ts
perl -pi -e "s#'./nutrition.ipc'#'../../shared-logic/modules/nutrition.ipc'#" electron/modules/sync.ipc.ts
perl -pi -e 's#electron/modules/nutrition\.ipc#shared-logic/modules/nutrition.ipc#g' $(rg -l "electron/modules/nutrition\.ipc" tests)
```
Verificá: `rg -n "crypto\.randomUUID|\.\./ipc/" shared-logic/modules/nutrition.ipc.ts` → vacío; `rg -c "genId\(\)" shared-logic/modules/nutrition.ipc.ts` → ≥ 1.

- [ ] **Step 2: Verificar y commit**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move nutrition handlers"
```

---

### Task 11: `finance.ipc.ts` + `finance-import.ipc.ts` (dialog/fs/pdf-parse → `platform()`)

**Files:**
- Move: `electron/modules/{finance.ipc,finance-import.ipc}.ts` → `shared-logic/modules/`
- Modify: `electron/ipc/registry.ts`
- Tests: `tests/modules/finance/{finance-import.dedup,finance-import.card,finance-import.tax,finance-import.ipc,finance.accounts-inherit,finance.dashboard-period,finance.fx-rate-source,finance.review-medium,finance.third-party,finance.usd-symmetry}.test.ts`

- [ ] **Step 1: `finance.ipc.ts` — mover, imports, `genId`, export CSV**

```bash
git mv electron/modules/finance.ipc.ts shared-logic/modules/finance.ipc.ts
```
Líneas 1–5:
```ts
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { dialog, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
```
→
```ts
import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { platform } from '../platform';
```
Con Edit, borrar el `genId` local (líneas 50–52 + blanco):
```ts
function genId(): string {
  return crypto.randomUUID();
}

```
```bash
perl -pi -e "s#'../../shared-logic/modules/finance.balance'#'./finance.balance'#" shared-logic/modules/finance.ipc.ts
```

Handler `finance:exportCsv` (empieza en la línea 1767). Con Edit, borrar el bloque del diálogo (líneas 1792–1802):
```ts
    const win = BrowserWindow.getFocusedWindow();
    const { filePath, canceled } = await dialog.showSaveDialog(win!, {
      title: 'Export CSV',
      defaultPath: `coinify-${m}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

```
y reemplazar el cierre (líneas 1823–1826):
```ts
    const csv = [header, ...csvRows].join('\n');
    fs.writeFileSync(filePath, csv, 'utf-8');

    return { success: true, path: filePath, count: rows.length };
```
→
```ts
    const csv = [header, ...csvRows].join('\n');
    const saved = await platform().saveTextFile(`coinify-${m}.csv`, csv);
    if (!saved) return { success: false, canceled: true };

    return { success: true, count: rows.length };
```
(`path` era opcional en `HubtifyApi.financeExportCsv` y ningún consumidor en `src/` lo lee — verificado con `rg "result\.path" src/modules/finance`. Diferencia visible: el diálogo aparece después de armar el CSV en memoria, no antes; y su título pasa a ser el default del SO.)

Verificá: `rg -n "dialog|BrowserWindow|fs\.|crypto|\.\./ipc/" shared-logic/modules/finance.ipc.ts` → vacío.

- [ ] **Step 2: `finance-import.ipc.ts` — mover, imports, PDF vía `platform().pickPdfText()`**

```bash
git mv electron/modules/finance-import.ipc.ts shared-logic/modules/finance-import.ipc.ts
```
Líneas 1–5:
```ts
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { dialog, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
```
→
```ts
import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { platform } from '../platform';
```
```bash
perl -pi -e "s#'../../shared-logic/modules/finance.balance'#'./finance.balance'#; s/\bcrypto\.randomUUID\(\)/genId()/g" shared-logic/modules/finance-import.ipc.ts
```
(3 llamadas: líneas 342, 439, 524.)

Con Edit, reemplazar el arranque del handler (líneas 259–277):
```ts
  ipcHandle('finance:importSelectAndParsePDF', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePaths, canceled } = await dialog.showOpenDialog(win!, {
      title: 'Seleccionar PDF de resumen',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;

    const filePath = filePaths[0];
    const fileName = filePath.split(/[/\\]/).pop() || 'unknown.pdf';

    const buffer = fs.readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    await parser.load();
    const data = await parser.getText();

```
→
```ts
  ipcHandle('finance:importSelectAndParsePDF', async () => {
    const picked = await platform().pickPdfText();
    if (picked === null) return null;
    // Android has no pdf-parse: the renderer shows a toast for this reason (Fase 5).
    if ('unsupported' in picked) return { ok: false as const, reason: 'unsupported_platform' as const };
    const fileName = picked.name;
    const data = { text: picked.text };

```
El resto del handler sigue usando `data.text` (línea 300) y `fileName` (314) sin cambios. El tipo de `HubtifyApi.financeImportSelectAndParsePDF` NO cambia en esta fase (desktop nunca recibe `{ ok:false }`; el tipo y el toast entran en Fase 5 para no tocar `Import.tsx` ahora).

Verificá: `rg -n "dialog|BrowserWindow|fs\.|crypto|require\(|\.\./ipc/" shared-logic/modules/finance-import.ipc.ts` → vacío.

- [ ] **Step 3: registry y tests**

```bash
perl -pi -e "s#'../modules/(finance|finance-import)\.ipc'#'../../shared-logic/modules/\$1.ipc'#" electron/ipc/registry.ts
perl -pi -e 's#electron/modules/(finance|finance-import)\.ipc#shared-logic/modules/$1.ipc#g' $(rg -l "electron/modules/(finance|finance-import)\.ipc" tests)
```

- [ ] **Step 4: Verificar y commit**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 96 passed (96)`, `Tests 1270 passed (1270)`.

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move finance handlers; CSV export and PDF import go through PlatformPort"
```

---

## Chunk 4: Mover los módulos (II) — notifications, cauldron, sync y cierre

### Task 12: `notifications.ipc.ts` + `cauldron.ipc.ts` (Notification → notify, webContents → emit, lifecycle)

`cauldron.ipc` importa `isModuleNotificationEnabled` de `notifications.ipc`, así que van juntos. Ambos mantienen timers que tocan la DB: registran un `Lifecycle` (spec §3.2) que en Electron nunca se invoca.

**Files:**
- Move: `electron/modules/{notifications.ipc,cauldron.ipc}.ts` → `shared-logic/modules/`
- Modify: `electron/ipc/registry.ts`, `electron/main.ts:18` (13 en master)
- Tests: `tests/modules/cauldron/{cauldron.autostart,cauldron.retro,cauldron.phase2}.test.ts`
- Test nuevo: `tests/modules/cauldron/cauldron.lifecycle.test.ts`

- [ ] **Step 1: Escribir el test del lifecycle del Cauldron (falla: todavía no existe `registerLifecycle` en el módulo)**

`tests/modules/cauldron/cauldron.lifecycle.test.ts`:
```ts
/**
 * Fase 1 mobile: while the app is in background the worker closes the DB, so
 * the Cauldron must stop its 1 s tick on suspend() and re-arm it on resume().
 * The deadline (targetEndTime) is wall-clock, so nothing else needs saving.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { getHandler, runSuspend, runResume } from '../../../shared-logic/registry';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../shared-logic/modules/notifications.ipc', () => ({
  isModuleNotificationEnabled: () => false,
}));

const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');
registerCauldronIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const MIN = 60_000;

beforeEach(async () => {
  harness.db = new Database(':memory:');
  harness.db.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) harness.db.exec(m.up);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
  await invoke('cauldron:stop');
});

afterEach(async () => {
  await invoke('cauldron:stop');
  vi.useRealTimers();
});

describe('cauldron lifecycle', () => {
  it('suspend() stops the tick; resume() re-arms it and the segment still ends on its wall-clock deadline', async () => {
    const id = await invoke<string>('cauldron:upsertPreset', {
      name: 'L', workMinutes: 1, breakMinutes: 1, longBreakMinutes: 1,
      cyclesBeforeLong: 2, extensionMinutes: 5, autoStartBreak: false, autoStartWork: false,
    });
    await invoke('cauldron:start', id);
    expect(vi.getTimerCount()).toBe(1);

    runSuspend();
    expect(vi.getTimerCount()).toBe(0);

    runResume();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1 * MIN);
    const state = await invoke<{ status: string }>('cauldron:getState');
    expect(state.status).toBe('awaiting_next');
  });

  it('resume() with the timer idle arms nothing', async () => {
    runSuspend();
    runResume();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Mover ambos**

```bash
git mv electron/modules/notifications.ipc.ts shared-logic/modules/notifications.ipc.ts
git mv electron/modules/cauldron.ipc.ts shared-logic/modules/cauldron.ipc.ts
```

- [ ] **Step 3: `notifications.ipc.ts` — reemplazo completo de las líneas 1–121 (hasta el final del handler `notifications:send`)**

Todo lo que sigue a `notifications:send` (`notifications:getAll` … `notifications:setHabitReminder`) queda igual salvo dos bloques (Step 4). Reemplazar las líneas 1–121 por:
```ts
import { registerHandler as ipcHandle, registerLifecycle } from '../registry';
import { getDb } from '../db';
import { emit } from '../events';
import { platform } from '../platform';
import {
  evaluateQuestNotifications,
  evaluateHabitNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
  setEngineLocale,
  getEngineLocale,
} from './notification-engine';
import type { AppNotification } from '../../shared/types';

let pollingInterval: ReturnType<typeof setInterval> | null = null;
/** True between startNotificationEngine() and stopNotificationEngine(); resume() re-arms only if set. */
let engineWanted = false;
let lastNativeNotificationTime = 0;
let systemNotificationsEnabled = true;
const enabledModules: Record<string, boolean> = { quests: true, nutrition: true, finance: true, cauldron: true };

/**
 * El Caldero no pasa por el motor de notificaciones (dispara las suyas al terminar
 * un segmento), asi que necesita consultar el toggle a mano. Sin la clave
 * 'cauldron' arriba, `notifications:setModuleEnabled` la descartaba en silencio y
 * el switch de Ajustes no hacia absolutamente nada.
 */
export function isModuleNotificationEnabled(module: string): boolean {
  return enabledModules[module] !== false;
}

const POLLING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NATIVE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

let habitReminderEnabled = true;
let habitReminderTime = '21:00';

function runNotificationCheck(): number {
  const db = getDb();

  const resolvedCount = autoResolve(db);

  const candidates = [
    ...(enabledModules.quests ? evaluateQuestNotifications(db) : []),
    ...(enabledModules.quests && habitReminderEnabled ? evaluateHabitNotifications(db, habitReminderTime) : []),
    ...(enabledModules.nutrition ? evaluateNutritionNotifications(db) : []),
    ...(enabledModules.finance ? evaluateFinanceNotifications(db) : []),
  ];

  const newCount = deduplicateAndInsert(db, candidates);

  cleanupOldNotifications(db);

  if (newCount > 0) {
    const now = Date.now();
    if (systemNotificationsEnabled && now - lastNativeNotificationTime >= NATIVE_COOLDOWN_MS) {
      const totalActive = (db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE status = 'active' AND deleted_at IS NULL
      `).get() as { count: number }).count;

      if (totalActive > 0) {
        void platform().notify({
          title: 'Hubtify',
          body: getEngineLocale() === 'en'
            ? `You have ${totalActive} pending ${totalActive === 1 ? 'item' : 'items'}.`
            : `Tenés ${totalActive} ${totalActive === 1 ? 'cosa pendiente' : 'cosas pendientes'}.`,
        });
        lastNativeNotificationTime = now;
      }
    }
  }

  // Broadcast whenever count changed — new notifications OR resolved ones
  if (newCount > 0 || resolvedCount > 0) {
    emit('notifications:updated');
  }

  return newCount;
}

function pausePolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function startNotificationEngine(): void {
  engineWanted = true;
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

export function stopNotificationEngine(): void {
  engineWanted = false;
  pausePolling();
}

export function registerNotificationIpcHandlers(): void {
  // Background (Android): the polling timer would hit a closed DB. Electron never calls these.
  registerLifecycle({
    suspend: pausePolling,
    resume: () => { if (engineWanted) startNotificationEngine(); },
  });

  ipcHandle('notifications:send', async (_e, title: string, body: string) => {
    await platform().notify({ title, body });
    return true;
  });
```
(Cambio de comportamiento menor y documentado: `notifications:send` devolvía `false` cuando el SO no soportaba notificaciones; ahora `notify` decide internamente y el handler devuelve `true`. Ningún consumidor en `src/` lee ese booleano.)

- [ ] **Step 4: `notifications.ipc.ts` — los dos `webContents.send` que quedan (dismiss y snooze)**

Dos veces (dentro de `notifications:dismiss` y `notifications:snooze`), reemplazar:
```ts
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
```
→
```ts
    emit('notifications:updated');
```
Verificá: `rg -n "BrowserWindow|\bNotification\b|NodeJS|webContents" shared-logic/modules/notifications.ipc.ts` → vacío (`AppNotification` no matchea: no hay límite de palabra antes de la N).

- [ ] **Step 5: `cauldron.ipc.ts` — imports, `broadcast`, timers, notificación, lifecycle**

Líneas 1–15:
```ts
import { BrowserWindow, Notification } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import { getMondayOfWeek, formatDateString } from '../../shared/date-utils';
import { isModuleNotificationEnabled } from './notifications.ipc';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronSessionEndResult,
} from '../../shared/types';

function genId(): string {
  return crypto.randomUUID();
}
```
→
```ts
import { registerHandler as ipcHandle, registerLifecycle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { emit } from '../events';
import { platform } from '../platform';
import { getMondayOfWeek, formatDateString } from '../../shared/date-utils';
import { isModuleNotificationEnabled } from './notifications.ipc';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronSessionEndResult,
} from '../../shared/types';
```

Con Edit, borrar el `broadcast` local (líneas 104–108 + blanco):
```ts
function broadcast(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

```

Timers (líneas 132 y 134):
```bash
perl -pi -e 's/\bNodeJS\.Timeout\b/ReturnType<typeof setInterval>/g; s/\bbroadcast\(/emit(/g' shared-logic/modules/cauldron.ipc.ts
```
(`emit(` reemplaza las 17 llamadas; los comentarios que dicen «broadcast» sin paréntesis quedan.)

Notificación al terminar un segmento (líneas 311–329 en el original, comentario incluido), reemplazar:
```ts
  // OS Notification — texts come from the renderer (cauldron:setLabels); they used
  // to be hardcoded Spanish regardless of the user's language.
  if (Notification.isSupported() && isModuleNotificationEnabled('cauldron')) {
    const presetLabel = timerState.presetName ? ` (${timerState.presetName})` : '';
    const cycleInfo = `${labels.cycle} ${timerState.currentCycle}/${timerState.totalCycles}`;
    if (cycleComplete || nextSegment === null) {
      new Notification({
        title: labels.cycleComplete,
        body: `${labels.cycleCompleteBody}${presetLabel}`,
      }).show();
    } else {
      const nextLabel = nextSegment.type === 'work' ? labels.focus : nextSegment.type === 'long_break' ? labels.longBreak : labels.shortBreak;
      const nextMin = Math.round(nextSegment.durationMs / 60000);
      const title = wasWork ? labels.potionDone : labels.breakDone;
      const body = `${cycleInfo} — ${labels.next}: ${nextLabel} (${nextMin} ${labels.minutesShort})${presetLabel}`;
      new Notification({ title, body }).show();
    }
  }
```
→
```ts
  // Native notification via PlatformPort — texts come from the renderer
  // (cauldron:setLabels); they used to be hardcoded Spanish regardless of language.
  if (isModuleNotificationEnabled('cauldron')) {
    const presetLabel = timerState.presetName ? ` (${timerState.presetName})` : '';
    const cycleInfo = `${labels.cycle} ${timerState.currentCycle}/${timerState.totalCycles}`;
    if (cycleComplete || nextSegment === null) {
      void platform().notify({
        title: labels.cycleComplete,
        body: `${labels.cycleCompleteBody}${presetLabel}`,
      });
    } else {
      const nextLabel = nextSegment.type === 'work' ? labels.focus : nextSegment.type === 'long_break' ? labels.longBreak : labels.shortBreak;
      const nextMin = Math.round(nextSegment.durationMs / 60000);
      const title = wasWork ? labels.potionDone : labels.breakDone;
      const body = `${cycleInfo} — ${labels.next}: ${nextLabel} (${nextMin} ${labels.minutesShort})${presetLabel}`;
      void platform().notify({ title, body });
    }
  }
```

Lifecycle: en `registerCauldronIpcHandlers()` (línea 558), después de `cleanupOrphanedSessions();` agregar:
```ts
  // Background (Android): freeze the clocks WITHOUT touching state. targetEndTime
  // and autoStartAt are wall-clock, so the first tick after resume catches up on
  // its own (and fires onTimeUp if the deadline passed while suspended).
  registerLifecycle({
    suspend: () => {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      if (autoStartInterval) { clearInterval(autoStartInterval); autoStartInterval = null; }
    },
    resume: () => {
      if ((timerState.status === 'work' || timerState.status === 'on_break') && !timerInterval) {
        timerInterval = setInterval(tick, 1000);
      }
      if (timerState.status === 'awaiting_next' && timerState.autoStartAt !== null) armAutoStart();
    },
  });
```
Verificá: `rg -n "BrowserWindow|\bNotification\b|NodeJS|crypto|broadcast\(|\.\./ipc/" shared-logic/modules/cauldron.ipc.ts` → vacío.

- [ ] **Step 6: registry, main.ts, tests**

```bash
perl -pi -e "s#'../modules/(notifications|cauldron)\.ipc'#'../../shared-logic/modules/\$1.ipc'#" electron/ipc/registry.ts
perl -pi -e "s#'./modules/notifications.ipc'#'../shared-logic/modules/notifications.ipc'#" electron/main.ts
perl -pi -e 's#electron/modules/(notifications|cauldron)\.ipc#shared-logic/modules/$1.ipc#g' $(rg -l "electron/modules/(notifications|cauldron)\.ipc" tests)
```

Los tres tests del Cauldron ya no tienen nada de `electron` en su grafo de imports; su `vi.mock('electron', …)` queda inerte, y dos de ellos usaban ese mock para capturar broadcasts. Con Edit:

`tests/modules/cauldron/cauldron.retro.test.ts` y `tests/modules/cauldron/cauldron.phase2.test.ts`: reemplazar TODO el bloque `vi.mock('electron', () => ({ … }));` (desde `vi.mock('electron'` hasta su `}));`, incluye `ipcMain`, `BrowserWindow.getAllWindows` con `harness.broadcasts.push` y `Notification`) por:
```ts
setEventSink((channel, data) => { harness.broadcasts.push({ channel, data }); });
```
y cambiar el import de registry (que Task 4 dejó como `import { getHandler, clearHandlers } from '../../../shared-logic/registry';`) agregando debajo:
```ts
import { setEventSink } from '../../../shared-logic/events';
```

`tests/modules/cauldron/cauldron.autostart.test.ts`: borrar el bloque `vi.mock('electron', () => ({ … }));` completo (líneas 33–45 del original) — no captura nada.

- [ ] **Step 7: Verificar y commit**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 97 passed (97)`, `Tests 1272 passed (1272)` (+1 archivo, +2 tests).

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move notifications and cauldron; native notifications via PlatformPort, timers register a lifecycle"
```

---

### Task 13: `sync.ipc.ts`

**Files:**
- Move: `electron/modules/sync.ipc.ts` → `shared-logic/modules/sync.ipc.ts`
- Modify: `electron/ipc/registry.ts`
- Tests (imports): `tests/modules/sync/sync-integrity.test.ts`, `tests/modules/nutrition/{sync-merge,food-log-sync}.test.ts`, `tests/modules/finance/finance.seed-tombstone.test.ts`, `tests/modules/quests/{sync-habit-checks,quests-fase1,quest-merge-resilience,habit-delete-sync}.test.ts`
- Tests (leen el FUENTE de `sync.ipc.ts` desde disco — si no se actualizan fallan con ENOENT): `tests/modules/sync/sync-columns.test.ts:21`, `tests/modules/sync/finance-columns.test.ts:25` (`path.join(__dirname, '../../../electron/modules/sync.ipc.ts')`), `tests/modules/nutrition/history-normalize.test.ts:144` (`fs.readFileSync('electron/modules/sync.ipc.ts', …)`); y un comentario en `tests/ipc/clean-install.test.ts:79`. El perl de abajo cubre los 12.

- [ ] **Step 1: Mover e imports**

```bash
git mv electron/modules/sync.ipc.ts shared-logic/modules/sync.ipc.ts
perl -pi -e "s#^import type Database from 'better-sqlite3';#import type { SqlDatabase } from '../db';#; s/\bDatabase\.Database\b/SqlDatabase/g; s#^import \{ ipcHandle \} from '../ipc/ipc-handle';#import { registerHandler as ipcHandle } from '../registry';#; s#^import \{ getDb \} from '../ipc/db';#import { getDb } from '../db';#; s#'../../shared-logic/modules/nutrition.ipc'#'./nutrition.ipc'#; s#'../../shared-logic/modules/quests.habits'#'./quests.habits'#" shared-logic/modules/sync.ipc.ts
perl -pi -e "s#'../modules/sync\.ipc'#'../../shared-logic/modules/sync.ipc'#" electron/ipc/registry.ts
perl -pi -e 's#electron/modules/sync\.ipc#shared-logic/modules/sync.ipc#g' $(rg -l "electron/modules/sync\.ipc" tests)
# el comentario de sync.ipc.ts:928 apuntaba a un archivo que ya no existe
perl -pi -e 's#initCoreTables \(electron/ipc/db\.ts\)#initCoreTables (shared-logic/db/migrate.ts)#' shared-logic/modules/sync.ipc.ts
```
Verificá: `rg -l "electron/modules/sync" tests` → vacío (12 archivos tocados).
Las primeras 6 líneas quedan:
```ts
import type { SqlDatabase } from '../db';
import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { recalcSummary } from './nutrition.ipc';
import { weeklyTarget } from './quests.habits';
import { daysAgoDateString } from '../../shared/date-utils';
```

- [ ] **Step 2: Verificar y commit**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 97 passed (97)`, `Tests 1272 passed (1272)`.

Run: `rg -l "electron/(ipc|modules)/" tests`
Expected: vacío (ya no queda ningún test apuntando a código movido; los dos comentarios que citan `electron/main.ts` — `clean-install.test.ts:11`, `audit-quests-tasklist.browser.test.tsx:23` — siguen siendo válidos).

```bash
git add -A shared-logic electron tests
git commit -m "refactor(shared-logic): move sync handlers"
```

---

### Task 14: Cierre — `register-all.ts`, `all-migrations.ts`, `registry.ts` como binding, `main.ts`, `db.ts` final

**Files:**
- Create: `shared-logic/register-all.ts`, `shared-logic/db/all-migrations.ts`
- Modify: `shared-logic/db/index.ts`, `electron/ipc/registry.ts` (reemplazo completo), `electron/ipc/db.ts` (quitar el re-export), `electron/main.ts:6-13,358-365`
- Test: `tests/shared-logic/provider.test.ts` (+1 caso)

- [ ] **Step 1: Test de `runAllModuleMigrations()`**

Agregar al final del `describe('db provider', …)` en `tests/shared-logic/provider.test.ts`:
```ts
  it('runAllModuleMigrations() applies the six module namespaces', () => {
    setDbFactory(() => new Database(':memory:'));
    runAllModuleMigrations();
    const rows = getDb().prepare('SELECT DISTINCT namespace FROM migrations_applied ORDER BY namespace').all() as Array<{ namespace: string }>;
    expect(rows.map((r) => r.namespace)).toEqual(['cauldron', 'character', 'core', 'finance', 'notifications', 'nutrition', 'quests']);
  });
```
y sumar `runAllModuleMigrations` al import de `'../../shared-logic/db'` del archivo.

Run: `npm test -- tests/shared-logic/provider`
Expected: FAIL — `runAllModuleMigrations is not a function` (o import inexistente).

- [ ] **Step 2: `shared-logic/db/all-migrations.ts`**

```ts
import { runModuleMigrations } from './provider';
import { questsMigrations } from '../../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../../src/modules/finance/finance.schema';
import { characterMigrations } from '../../src/modules/character/character.schema';
import { notificationsMigrations } from '../modules/notifications.schema';
import { cauldronMigrations } from '../../src/modules/cauldron/cauldron.schema';

/**
 * Every module's migrations, in the order main.ts used to call them. Each
 * binding (Electron main, Android worker) calls this once after getDb().
 */
export function runAllModuleMigrations(): void {
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);
  runModuleMigrations(notificationsMigrations);
  runModuleMigrations(cauldronMigrations);
}
```

`shared-logic/db/index.ts` — agregar al final:
```ts
export { runAllModuleMigrations } from './all-migrations';
```

- [ ] **Step 3: `shared-logic/register-all.ts`**

```ts
import { registerRpgHandlers } from './modules/rpg-handlers';
import { registerQuestsIpcHandlers } from './modules/quests.ipc';
import { registerNutritionIpcHandlers } from './modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from './modules/finance.ipc';
import { registerFinanceImportIpcHandlers } from './modules/finance-import.ipc';
import { registerCharacterIpcHandlers } from './modules/character.ipc';
import { registerNotificationIpcHandlers } from './modules/notifications.ipc';
import { registerDollarIpcHandlers } from './modules/dollar.ipc';
import { registerCryptoIpcHandlers } from './modules/crypto.ipc';
import { registerSyncIpcHandlers } from './modules/sync.ipc';
import { registerCauldronIpcHandlers } from './modules/cauldron.ipc';
import { registerFeedbackIpcHandlers } from './modules/feedback.ipc';
import { registerSylIpcHandlers } from './modules/syl.ipc';

/**
 * Registers the 13 platform-neutral handler sets (they keep their historical
 * `register*IpcHandlers` names: zero churn). Lives outside registry.ts on
 * purpose — the modules import registry.ts, so registry.ts importing them
 * back would be a cycle. Desktop-only sets (backup, updater, cauldron
 * windows) are registered by the Electron binding before it binds to ipcMain.
 */
export function registerAllHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerFinanceImportIpcHandlers();
  registerCharacterIpcHandlers();
  registerNotificationIpcHandlers();
  registerDollarIpcHandlers();
  registerCryptoIpcHandlers();
  registerSyncIpcHandlers();
  registerCauldronIpcHandlers();
  registerFeedbackIpcHandlers();
  registerSylIpcHandlers();
}
```
(La spec habla de «14 register*»; el decimocuarto es `registerBackupIpcHandlers`, que es desktop-only y se queda en `electron/ipc/registry.ts`.)

- [ ] **Step 4: `electron/ipc/registry.ts` — reemplazo completo**

```ts
import { ipcMain } from 'electron';
import { getHandler, listChannels } from '../../shared-logic/registry';
import { registerAllHandlers } from '../../shared-logic/register-all';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';

/**
 * Desktop binding: shared handlers + desktop-only backup, then bind every
 * registered channel to ipcMain. Anything registered through `ipcHandle`
 * AFTER this call is never bound — updater and cauldron-window handlers are
 * registered in main.ts BEFORE calling this.
 */
export function registerAllIpcHandlers(): void {
  registerAllHandlers();
  registerBackupIpcHandlers();
  bindToIpcMain();
}

/** Same labeled-error logging the old ipcHandle wrapper had. */
function bindToIpcMain(): void {
  for (const channel of listChannels()) {
    const fn = getHandler(channel)!;
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn({}, ...args);
      } catch (err) {
        console.error(`[${channel}]`, err);
        throw err;
      }
    });
  }
}
```

- [ ] **Step 5: `electron/ipc/db.ts` — quitar el re-export transicional**

Borrar el import `import { getDb as sharedGetDb } from '../../shared-logic/db';` y el bloque final completo (comentario `// TRANSITIONAL …` + `export function getDb(): Database.Database { … }`). El archivo queda con los 4 imports originales, el docblock y `openDesktopDb()`.

Verificá: `rg -n "ipc/db'" electron shared-logic` → solo `electron/main.ts` (import de `openDesktopDb`); `rg -n "getDb" electron/ipc/db.ts` → vacío.

- [ ] **Step 6: `electron/main.ts` — migraciones**

Imports — dos edits (entre el import de `openDesktopDb` y los de los schemas están los tres imports que agregó Task 5, así que no son un bloque contiguo):

(a) Líneas 6–7 (`getDb` vuelve a shared-logic: `generateRecurringForMonth` ya recibe `SqlDatabase` desde Task 6):
```ts
import { closeDb, runModuleMigrations, setDbFactory } from '../shared-logic/db';
import { openDesktopDb, getDb } from './ipc/db';
```
→
```ts
import { closeDb, getDb, runAllModuleMigrations, setDbFactory } from '../shared-logic/db';
import { openDesktopDb } from './ipc/db';
```

(b) Borrar las seis líneas de schemas (líneas 12–17 tras Task 3–6; 7–12 en master):
```ts
import { questsMigrations } from '../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../src/modules/finance/finance.schema';
import { characterMigrations } from '../src/modules/character/character.schema';
import { notificationsMigrations } from '../shared-logic/modules/notifications.schema';
import { cauldronMigrations } from '../src/modules/cauldron/cauldron.schema';
```
(los imports `setPlatform`, `setEventSink`, `electronPlatform, webContentsSink` de Task 5 se mantienen.)

Bloque de migraciones:
```ts
  // Run module migrations
  getDb();
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);
  runModuleMigrations(notificationsMigrations);
  runModuleMigrations(cauldronMigrations);
```
→
```ts
  // Run module migrations
  getDb();
  runAllModuleMigrations();
```

- [ ] **Step 7: Gate de aislamiento y verificación**

Run: `rg -n "from 'electron'|from 'fs'|from 'path'|from 'os'|from 'crypto'|require\(|from 'better-sqlite3'|from '.*electron/" shared-logic`
Expected: sin resultados (exit 1). (Comentarios que mencionan better-sqlite3 o `electron/main.ts` — `rpg-handlers.ts:1306`, `finance.balance.ts:23` — son texto, no imports, y quedan.)

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 97 passed (97)`, `Tests 1273 passed (1273)`.

Run: `git ls-files electron`
Expected exactamente:
```
electron/ipc/db.ts
electron/ipc/ipc-handle.ts
electron/ipc/registry.ts
electron/main.ts
electron/modules/backup.ipc.ts
electron/modules/pdf-parse.d.ts
electron/modules/updater.ts
electron/platform.ts
electron/preload.ts
```

- [ ] **Step 8: Commit**

```bash
git add -A shared-logic electron tests
git commit -m "refactor(electron): main binds registerAllHandlers() and runAllModuleMigrations(); db.ts is openDesktopDb() only"
```


---

## Chunk 5: Tabla de canales, preload generado, configuración y docs

### Task 15: `shared/api-channels.ts` — la tabla única (253 entradas)

`satisfies Record<keyof HubtifyApi, ChannelSpec>` hace que olvidarse una clave (o inventar una que no está en `HubtifyApi`) sea error de `tsc`. La tabla de abajo fue generada mecánicamente desde `electron/preload.ts` (mismo orden y mismos comentarios de sección), así que el `git diff` de preload en Task 17 es trazable entrada por entrada.

**Files:**
- Create: `shared/api-channels.ts`
- Test: `tests/shared/api-channels.test.ts`

- [ ] **Step 1: Escribir el test**

`tests/shared/api-channels.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { API_CHANNELS, type ChannelSpec } from '../../shared/api-channels';

const entries = Object.entries(API_CHANNELS) as Array<[string, ChannelSpec]>;

const DESKTOP_ONLY = [
  'backupExport', 'backupPickImportFile', 'backupImport',
  'cauldronOpenWindow', 'cauldronCloseWindow',
  'updaterCheck', 'updaterDownload', 'updaterRestart',
].sort();

describe('API_CHANNELS', () => {
  it('covers the 253 methods of HubtifyApi (237 invoke, 3 send, 13 on)', () => {
    expect(entries).toHaveLength(253);
    const byKind = { invoke: 0, send: 0, on: 0 };
    for (const [, s] of entries) byKind[s.kind]++;
    expect(byKind).toEqual({ invoke: 237, send: 3, on: 13 });
  });

  it('never reuses a channel', () => {
    const channels = entries.map(([, s]) => s.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('every channel is module:action', () => {
    for (const [, s] of entries) expect(s.channel).toMatch(/^[a-z]+:[a-zA-Z-]+$/);
  });

  it('kind "on" is exactly the on* methods', () => {
    for (const [key, s] of entries) expect(key.startsWith('on')).toBe(s.kind === 'on');
  });

  it('kind "send" is exactly the three window controls', () => {
    expect(entries.filter(([, s]) => s.kind === 'send').map(([k]) => k))
      .toEqual(['windowMinimize', 'windowMaximize', 'windowClose']);
  });

  it('marks exactly the 8 desktop-only methods', () => {
    expect(entries.filter(([, s]) => s.platforms === 'desktop').map(([k]) => k).sort()).toEqual(DESKTOP_ONLY);
  });

  it('unwrap exists only on the 3 legacy "on" wrappers and reshapes as preload did', () => {
    const withUnwrap = entries.filter(([, s]) => s.unwrap);
    expect(withUnwrap.map(([k]) => k).sort())
      .toEqual(['onRpgAchievementUnlocked', 'onRpgAchievementsBackfilled', 'onUpdateDownloaded']);
    for (const [, s] of withUnwrap) expect(s.kind).toBe('on');
    expect(API_CHANNELS.onRpgAchievementUnlocked.unwrap({ id: 'a1' })).toBe('a1');
    expect(API_CHANNELS.onRpgAchievementsBackfilled.unwrap({ ids: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(API_CHANNELS.onRpgAchievementsBackfilled.unwrap(undefined)).toEqual([]);
    expect(API_CHANNELS.onUpdateDownloaded.unwrap({ anything: true })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm test -- tests/shared/api-channels`
Expected: FAIL — `Failed to resolve import "../../shared/api-channels"`.

- [ ] **Step 3: Crear `shared/api-channels.ts` (archivo completo)**

```ts
import type { HubtifyApi } from './types';

/**
 * The ONE table that defines `window.api`. preload.ts (Electron) and
 * src/mobile/install-api.ts (Android, Fase 2) both build the API from it via
 * shared/build-api.ts, so adding a method = one entry here + its type in
 * HubtifyApi. `satisfies` makes a missing or extra key a type error.
 */
export type ChannelKind = 'invoke' | 'send' | 'on';

export interface ChannelSpec {
  channel: string;
  kind: ChannelKind;
  /** Absent = available on every platform. */
  platforms?: 'desktop';
  /** kind 'on' only: reshape the payload before the renderer callback. */
  unwrap?: (payload: unknown) => unknown;
}

export const API_CHANNELS = {
@@CHANNELS@@
} as const satisfies Record<keyof HubtifyApi, ChannelSpec>;

export type ApiKey = keyof typeof API_CHANNELS;
```

Reemplazá `@@CHANNELS@@` por las 275 líneas de abajo (253 entradas + 22 comentarios de sección), tal cual:

```ts
  getRpgStats: { channel: 'rpg:getStats', kind: 'invoke' },
  processRpgEvent: { channel: 'rpg:processEvent', kind: 'invoke' },
  rpgSetInnMode: { channel: 'rpg:setInnMode', kind: 'invoke' },
  rpgGetAchievements: { channel: 'rpg:getAchievements', kind: 'invoke' },
  rpgBackfillAchievements: { channel: 'rpg:backfillAchievements', kind: 'invoke' },
  rpgGetDaySummary: { channel: 'rpg:getDaySummary', kind: 'invoke' },
  rpgSealDay: { channel: 'rpg:sealDay', kind: 'invoke' },
  rpgGetSeals: { channel: 'rpg:getSeals', kind: 'invoke' },
  rpgGetObolosBalance: { channel: 'rpg:getObolosBalance', kind: 'invoke' },
  rpgGetRewards: { channel: 'rpg:getRewards', kind: 'invoke' },
  rpgSaveReward: { channel: 'rpg:saveReward', kind: 'invoke' },
  rpgDeleteReward: { channel: 'rpg:deleteReward', kind: 'invoke' },
  rpgRedeemReward: { channel: 'rpg:redeemReward', kind: 'invoke' },
  rpgGetShopCatalog: { channel: 'rpg:getShopCatalog', kind: 'invoke' },
  rpgPurchaseShopItem: { channel: 'rpg:purchaseShopItem', kind: 'invoke' },
  rpgEquipShopItem: { channel: 'rpg:equipShopItem', kind: 'invoke' },
  rpgGetMasteries: { channel: 'rpg:getMasteries', kind: 'invoke' },
  getRpgHistory: { channel: 'rpg:getHistory', kind: 'invoke' },
  rpgGetDashboardStats: { channel: 'rpg:getDashboardStats', kind: 'invoke' },
  windowMinimize: { channel: 'window:minimize', kind: 'send' },
  windowMaximize: { channel: 'window:maximize', kind: 'send' },
  windowClose: { channel: 'window:close', kind: 'send' },
  // Quests
  questsGetTasks: { channel: 'quests:getTasks', kind: 'invoke' },
  questsUpsertTask: { channel: 'quests:upsertTask', kind: 'invoke' },
  questsDeleteTasks: { channel: 'quests:deleteTasks', kind: 'invoke' },
  questsSetTaskStatus: { channel: 'quests:setTaskStatus', kind: 'invoke' },
  questsSyncTaskOrders: { channel: 'quests:syncTaskOrders', kind: 'invoke' },
  questsPostponeTasks: { channel: 'quests:postponeTasks', kind: 'invoke' },
  questsGetSubtasks: { channel: 'quests:getSubtasks', kind: 'invoke' },
  questsAddSubtask: { channel: 'quests:addSubtask', kind: 'invoke' },
  questsUpdateSubtask: { channel: 'quests:updateSubtask', kind: 'invoke' },
  questsDeleteSubtask: { channel: 'quests:deleteSubtask', kind: 'invoke' },
  questsSetSubtaskStatus: { channel: 'quests:setSubtaskStatus', kind: 'invoke' },
  questsSyncSubtaskOrders: { channel: 'quests:syncSubtaskOrders', kind: 'invoke' },
  questsGetCategories: { channel: 'quests:getCategories', kind: 'invoke' },
  questsEnsureCategory: { channel: 'quests:ensureCategory', kind: 'invoke' },
  questsGetDrawings: { channel: 'quests:getDrawings', kind: 'invoke' },
  questsGetDrawingCount: { channel: 'quests:getDrawingCount', kind: 'invoke' },
  questsGetAllDrawingCounts: { channel: 'quests:getAllDrawingCounts', kind: 'invoke' },
  questsSaveDrawing: { channel: 'quests:saveDrawing', kind: 'invoke' },
  questsDeleteDrawing: { channel: 'quests:deleteDrawing', kind: 'invoke' },
  questsGetHabitHeatmap: { channel: 'quests:getHabitHeatmap', kind: 'invoke' },
  questsGetHabitHistory: { channel: 'quests:getHabitHistory', kind: 'invoke' },
  questsGetHabits: { channel: 'quests:getHabits', kind: 'invoke' },
  questsAddHabit: { channel: 'quests:addHabit', kind: 'invoke' },
  questsUpdateHabit: { channel: 'quests:updateHabit', kind: 'invoke' },
  questsDeleteHabit: { channel: 'quests:deleteHabit', kind: 'invoke' },
  questsCheckHabit: { channel: 'quests:checkHabit', kind: 'invoke' },
  questsSkipHabit: { channel: 'quests:skipHabit', kind: 'invoke' },
  questsCheckHabitForDate: { channel: 'quests:checkHabitForDate', kind: 'invoke' },
  questsGetProjects: { channel: 'quests:getProjects', kind: 'invoke' },
  questsUpsertProject: { channel: 'quests:upsertProject', kind: 'invoke' },
  questsDeleteProject: { channel: 'quests:deleteProject', kind: 'invoke' },
  questsSyncProjectOrders: { channel: 'quests:syncProjectOrders', kind: 'invoke' },
  questsCountCompletedToday: { channel: 'quests:countCompletedToday', kind: 'invoke' },
  questsGetPendingCount: { channel: 'quests:getPendingCount', kind: 'invoke' },
  questsGetCompletedTodayCount: { channel: 'quests:getCompletedTodayCount', kind: 'invoke' },
  questsGetOverdueCount: { channel: 'quests:getOverdueCount', kind: 'invoke' },
  // Nutrition
  nutritionGetProfile: { channel: 'nutrition:getProfile', kind: 'invoke' },
  nutritionSaveProfile: { channel: 'nutrition:saveProfile', kind: 'invoke' },
  nutritionLogFood: { channel: 'nutrition:logFood', kind: 'invoke' },
  nutritionGetFoodByDate: { channel: 'nutrition:getFoodByDate', kind: 'invoke' },
  nutritionCopyDay: { channel: 'nutrition:copyDay', kind: 'invoke' },
  nutritionSearchHistory: { channel: 'nutrition:searchHistory', kind: 'invoke' },
  nutritionGetEventDays: { channel: 'nutrition:getEventDays', kind: 'invoke' },
  nutritionGetCachedEstimate: { channel: 'nutrition:getCachedEstimate', kind: 'invoke' },
  nutritionCacheEstimate: { channel: 'nutrition:cacheEstimate', kind: 'invoke' },
  nutritionDeleteFood: { channel: 'nutrition:deleteFood', kind: 'invoke' },
  nutritionDeleteByDate: { channel: 'nutrition:deleteByDate', kind: 'invoke' },
  nutritionRepeatDay: { channel: 'nutrition:repeatDay', kind: 'invoke' },
  nutritionGetRecentLoggedDays: { channel: 'nutrition:getRecentLoggedDays', kind: 'invoke' },
  nutritionUpdateFood: { channel: 'nutrition:updateFood', kind: 'invoke' },
  nutritionGetFrequentFoods: { channel: 'nutrition:getFrequentFoods', kind: 'invoke' },
  nutritionCreateFrequentFood: { channel: 'nutrition:createFrequentFood', kind: 'invoke' },
  nutritionDeleteFrequentFood: { channel: 'nutrition:deleteFrequentFood', kind: 'invoke' },
  nutritionIncrementFrequentUsage: { channel: 'nutrition:incrementFrequentUsage', kind: 'invoke' },
  nutritionGetDailyMetrics: { channel: 'nutrition:getDailyMetrics', kind: 'invoke' },
  nutritionSaveDailyMetrics: { channel: 'nutrition:saveDailyMetrics', kind: 'invoke' },
  nutritionGetWeeklyMetrics: { channel: 'nutrition:getWeeklyMetrics', kind: 'invoke' },
  nutritionSaveWeeklyMetrics: { channel: 'nutrition:saveWeeklyMetrics', kind: 'invoke' },
  nutritionGetSummary: { channel: 'nutrition:getSummary', kind: 'invoke' },
  nutritionGetSummaryRange: { channel: 'nutrition:getSummaryRange', kind: 'invoke' },
  nutritionGetMacroTargets: { channel: 'nutrition:getMacroTargets', kind: 'invoke' },
  nutritionGetWeights: { channel: 'nutrition:getWeights', kind: 'invoke' },
  nutritionGetAdaptiveTdee: { channel: 'nutrition:getAdaptiveTdee', kind: 'invoke' },
  nutritionGetStreak: { channel: 'nutrition:getStreak', kind: 'invoke' },
  nutritionGetWeekCalories: { channel: 'nutrition:getWeekCalories', kind: 'invoke' },
  nutritionGetTodayCalories: { channel: 'nutrition:getTodayCalories', kind: 'invoke' },
  nutritionGetTodayMealsCount: { channel: 'nutrition:getTodayMealsCount', kind: 'invoke' },
  nutritionGetTodayTarget: { channel: 'nutrition:getTodayTarget', kind: 'invoke' },
  nutritionCloseDay: { channel: 'nutrition:closeDay', kind: 'invoke' },
  nutritionIsDayClosed: { channel: 'nutrition:isDayClosed', kind: 'invoke' },
  nutritionReopenDay: { channel: 'nutrition:reopenDay', kind: 'invoke' },
  nutritionShouldAskWeight: { channel: 'nutrition:shouldAskWeight', kind: 'invoke' },
  nutritionGetFavoriteFoods: { channel: 'nutrition:getFavoriteFoods', kind: 'invoke' },
  nutritionAddFavoriteFood: { channel: 'nutrition:addFavoriteFood', kind: 'invoke' },
  nutritionRemoveFavoriteFood: { channel: 'nutrition:removeFavoriteFood', kind: 'invoke' },
  nutritionGetPendingDays: { channel: 'nutrition:getPendingDays', kind: 'invoke' },
  nutritionGetMealSchedule: { channel: 'nutrition:getMealSchedule', kind: 'invoke' },
  // Character
  characterSave: { channel: 'character:save', kind: 'invoke' },
  characterLoad: { channel: 'character:load', kind: 'invoke' },
  characterGetName: { channel: 'character:getName', kind: 'invoke' },
  characterSetName: { channel: 'character:setName', kind: 'invoke' },
  characterGetUsername: { channel: 'character:getUsername', kind: 'invoke' },
  characterSetUsername: { channel: 'character:setUsername', kind: 'invoke' },
  // Sync
  syncRestoreStats: { channel: 'sync:restoreStats', kind: 'invoke' },
  syncGetAllQuestData: { channel: 'sync:getAllQuestData', kind: 'invoke' },
  syncMergeQuestData: { channel: 'sync:mergeQuestData', kind: 'invoke' },
  syncGetAllNutritionData: { channel: 'sync:getAllNutritionData', kind: 'invoke' },
  syncMergeNutritionData: { channel: 'sync:mergeNutritionData', kind: 'invoke' },
  syncGetAllFinanceData: { channel: 'sync:getAllFinanceData', kind: 'invoke' },
  syncMergeFinanceData: { channel: 'sync:mergeFinanceData', kind: 'invoke' },
  syncClearUserData: { channel: 'sync:clearUserData', kind: 'invoke' },
  syncSetCurrentUser: { channel: 'sync:setCurrentUser', kind: 'invoke' },
  syncGetCurrentUser: { channel: 'sync:getCurrentUser', kind: 'invoke' },
  syncGetAllNotificationData: { channel: 'sync:getAllNotificationData', kind: 'invoke' },
  syncMergeNotificationData: { channel: 'sync:mergeNotificationData', kind: 'invoke' },
  syncGetAllCauldronData: { channel: 'sync:getAllCauldronData', kind: 'invoke' },
  syncMergeCauldronData: { channel: 'sync:mergeCauldronData', kind: 'invoke' },
  // Backup
  backupExport: { channel: 'backup:export', kind: 'invoke', platforms: 'desktop' },
  backupPickImportFile: { channel: 'backup:pickImportFile', kind: 'invoke', platforms: 'desktop' },
  backupImport: { channel: 'backup:import', kind: 'invoke', platforms: 'desktop' },
  // Notifications
  notificationsSend: { channel: 'notifications:send', kind: 'invoke' },
  notificationsGetAll: { channel: 'notifications:getAll', kind: 'invoke' },
  notificationsDismiss: { channel: 'notifications:dismiss', kind: 'invoke' },
  notificationsSnooze: { channel: 'notifications:snooze', kind: 'invoke' },
  notificationsRunCheck: { channel: 'notifications:runCheck', kind: 'invoke' },
  notificationsGetCount: { channel: 'notifications:getCount', kind: 'invoke' },
  notificationsSetSystemEnabled: { channel: 'notifications:setSystemEnabled', kind: 'invoke' },
  notificationsSetLocale: { channel: 'notifications:setLocale', kind: 'invoke' },
  notificationsSetModuleEnabled: { channel: 'notifications:setModuleEnabled', kind: 'invoke' },
  notificationsSetHabitReminder: { channel: 'notifications:setHabitReminder', kind: 'invoke' },
  onRpgAchievementUnlocked: { channel: 'rpg:achievementUnlocked', kind: 'on', unwrap: (p: unknown) => (p as { id?: string } | undefined)?.id },
  onRpgAchievementsBackfilled: { channel: 'rpg:achievementsBackfilled', kind: 'on', unwrap: (p: unknown) => (p as { ids?: string[] } | undefined)?.ids ?? [] },
  onRpgDaySealed: { channel: 'rpg:daySealed', kind: 'on' },
  onRpgPardonUsed: { channel: 'rpg:pardonUsed', kind: 'on' },
  onNotificationsUpdated: { channel: 'notifications:updated', kind: 'on' },
  // Cauldron
  cauldronGetPresets: { channel: 'cauldron:getPresets', kind: 'invoke' },
  cauldronUpsertPreset: { channel: 'cauldron:upsertPreset', kind: 'invoke' },
  cauldronDeletePreset: { channel: 'cauldron:deletePreset', kind: 'invoke' },
  cauldronStart: { channel: 'cauldron:start', kind: 'invoke' },
  cauldronPause: { channel: 'cauldron:pause', kind: 'invoke' },
  cauldronResume: { channel: 'cauldron:resume', kind: 'invoke' },
  cauldronSkip: { channel: 'cauldron:skip', kind: 'invoke' },
  cauldronConfirmNext: { channel: 'cauldron:confirmNext', kind: 'invoke' },
  cauldronExtend: { channel: 'cauldron:extend', kind: 'invoke' },
  cauldronStop: { channel: 'cauldron:stop', kind: 'invoke' },
  cauldronGetState: { channel: 'cauldron:getState', kind: 'invoke' },
  cauldronGetStats: { channel: 'cauldron:getStats', kind: 'invoke' },
  cauldronGetSessions: { channel: 'cauldron:getSessions', kind: 'invoke' },
  cauldronGetWeeklyFocusTime: { channel: 'cauldron:getWeeklyFocusTime', kind: 'invoke' },
  cauldronGetInterruptedSession: { channel: 'cauldron:getInterruptedSession', kind: 'invoke' },
  cauldronResumeInterruptedSession: { channel: 'cauldron:resumeInterruptedSession', kind: 'invoke' },
  cauldronDiscardInterruptedSession: { channel: 'cauldron:discardInterruptedSession', kind: 'invoke' },
  cauldronCancelAutoStart: { channel: 'cauldron:cancelAutoStart', kind: 'invoke' },
  cauldronSetSessionTask: { channel: 'cauldron:setSessionTask', kind: 'invoke' },
  cauldronLogPastSession: { channel: 'cauldron:logPastSession', kind: 'invoke' },
  cauldronGetWeekByProject: { channel: 'cauldron:getWeekByProject', kind: 'invoke' },
  cauldronSetLabels: { channel: 'cauldron:setLabels', kind: 'invoke' },
  onCauldronTick: { channel: 'cauldron:tick', kind: 'on' },
  onCauldronSessionEnd: { channel: 'cauldron:sessionEnd', kind: 'on' },
  cauldronOpenWindow: { channel: 'cauldron:openWindow', kind: 'invoke', platforms: 'desktop' },
  cauldronCloseWindow: { channel: 'cauldron:closeWindow', kind: 'invoke', platforms: 'desktop' },
  onCauldronWindowOpened: { channel: 'cauldron:windowOpened', kind: 'on' },
  onCauldronWindowClosed: { channel: 'cauldron:windowClosed', kind: 'on' },
  // Dollar
  dollarGetRates: { channel: 'dollar:getRates', kind: 'invoke' },
  dollarGetFxHouse: { channel: 'dollar:getFxHouse', kind: 'invoke' },
  dollarSetFxHouse: { channel: 'dollar:setFxHouse', kind: 'invoke' },
  dollarGetCurrentRate: { channel: 'dollar:getCurrentRate', kind: 'invoke' },
  financeBackfillFxRates: { channel: 'finance:backfillFxRates', kind: 'invoke' },
  financeGetValuedView: { channel: 'finance:getValuedView', kind: 'invoke' },
  financeGetInflationSeries: { channel: 'finance:getInflationSeries', kind: 'invoke' },
  financeGetUpcoming: { channel: 'finance:getUpcoming', kind: 'invoke' },
  financeGetAccounts: { channel: 'finance:getAccounts', kind: 'invoke' },
  financeGetAccountsOverview: { channel: 'finance:getAccountsOverview', kind: 'invoke' },
  financeSaveAccount: { channel: 'finance:saveAccount', kind: 'invoke' },
  financeDeleteAccount: { channel: 'finance:deleteAccount', kind: 'invoke' },
  financeTransferBetweenAccounts: { channel: 'finance:transferBetweenAccounts', kind: 'invoke' },
  dollarGetVisibleTypes: { channel: 'dollar:getVisibleTypes', kind: 'invoke' },
  dollarSetVisibleTypes: { channel: 'dollar:setVisibleTypes', kind: 'invoke' },
  // Crypto
  cryptoGetRates: { channel: 'crypto:getRates', kind: 'invoke' },
  cryptoGetVisibleTypes: { channel: 'crypto:getVisibleTypes', kind: 'invoke' },
  cryptoSetVisibleTypes: { channel: 'crypto:setVisibleTypes', kind: 'invoke' },
  // Finance - Transactions
  financeGetTransactions: { channel: 'finance:getTransactions', kind: 'invoke' },
  financeAddTransaction: { channel: 'finance:addTransaction', kind: 'invoke' },
  financeUpdateTransaction: { channel: 'finance:updateTransaction', kind: 'invoke' },
  financeDeleteTransaction: { channel: 'finance:deleteTransaction', kind: 'invoke' },
  // Finance - Installments
  financeGetInstallmentGroups: { channel: 'finance:getInstallmentGroups', kind: 'invoke' },
  financeGetInstallmentsForMonth: { channel: 'finance:getInstallmentsForMonth', kind: 'invoke' },
  financeGetInstallmentProjection: { channel: 'finance:getInstallmentProjection', kind: 'invoke' },
  financeCreateInstallmentGroup: { channel: 'finance:createInstallmentGroup', kind: 'invoke' },
  financeDeleteInstallmentGroup: { channel: 'finance:deleteInstallmentGroup', kind: 'invoke' },
  financeUpdateInstallmentAmount: { channel: 'finance:updateInstallmentAmount', kind: 'invoke' },
  // Finance - Loans
  financeGetLoans: { channel: 'finance:getLoans', kind: 'invoke' },
  financeGetLoansByPerson: { channel: 'finance:getLoansByPerson', kind: 'invoke' },
  financeAddLoan: { channel: 'finance:addLoan', kind: 'invoke' },
  financeSettleLoan: { channel: 'finance:settleLoan', kind: 'invoke' },
  financeAddLoanPayment: { channel: 'finance:addLoanPayment', kind: 'invoke' },
  financeGetLoanPayments: { channel: 'finance:getLoanPayments', kind: 'invoke' },
  financeDeleteLoanPayment: { channel: 'finance:deleteLoanPayment', kind: 'invoke' },
  financeCreateThirdPartyPurchase: { channel: 'finance:createThirdPartyPurchase', kind: 'invoke' },
  financeGetActiveLoanSummary: { channel: 'finance:getActiveLoanSummary', kind: 'invoke' },
  // Finance - Recurring
  financeGetRecurring: { channel: 'finance:getRecurring', kind: 'invoke' },
  financeAddRecurring: { channel: 'finance:addRecurring', kind: 'invoke' },
  financeUpdateRecurringAmount: { channel: 'finance:updateRecurringAmount', kind: 'invoke' },
  financeUpdateRecurring: { channel: 'finance:updateRecurring', kind: 'invoke' },
  financeToggleRecurring: { channel: 'finance:toggleRecurring', kind: 'invoke' },
  financeDeleteRecurring: { channel: 'finance:deleteRecurring', kind: 'invoke' },
  financeGenerateRecurringForMonth: { channel: 'finance:generateRecurringForMonth', kind: 'invoke' },
  financeGetRecurringAmountHistory: { channel: 'finance:getRecurringAmountHistory', kind: 'invoke' },
  // Finance - Import
  financeImportSelectAndParsePDF: { channel: 'finance:importSelectAndParsePDF', kind: 'invoke' },
  financeImportConfirm: { channel: 'finance:importConfirm', kind: 'invoke' },
  financeUndoImportBatch: { channel: 'finance:undoImportBatch', kind: 'invoke' },
  financeGetImportBatches: { channel: 'finance:getImportBatches', kind: 'invoke' },
  financeGetCategoryMappings: { channel: 'finance:getCategoryMappings', kind: 'invoke' },
  financeGetBudgets: { channel: 'finance:getBudgets', kind: 'invoke' },
  financeSetBudget: { channel: 'finance:setBudget', kind: 'invoke' },
  financeGetBudgetStatus: { channel: 'finance:getBudgetStatus', kind: 'invoke' },
  financeUpdateCategoryMapping: { channel: 'finance:updateCategoryMapping', kind: 'invoke' },
  // Finance - Dashboard
  financeGetMonthlyBalance: { channel: 'finance:getMonthlyBalance', kind: 'invoke' },
  financeGetCategoryBreakdown: { channel: 'finance:getCategoryBreakdown', kind: 'invoke' },
  financeGetBalanceForRange: { channel: 'finance:getBalanceForRange', kind: 'invoke' },
  financeGetCategoryBreakdownForRange: { channel: 'finance:getCategoryBreakdownForRange', kind: 'invoke' },
  financeGetProjection: { channel: 'finance:getProjection', kind: 'invoke' },
  // Finance - Export
  financeExportCsv: { channel: 'finance:exportCsv', kind: 'invoke' },
  // Finance - Dashboard (new)
  financeGetMonthlyExpenses: { channel: 'finance:getMonthlyExpenses', kind: 'invoke' },
  financeGetCategoryAverages: { channel: 'finance:getCategoryAverages', kind: 'invoke' },
  financeGetPreviousMonthSummary: { channel: 'finance:getPreviousMonthSummary', kind: 'invoke' },
  // Finance - Backward compat
  financeGetMonthlyTotal: { channel: 'finance:getMonthlyTotal', kind: 'invoke' },
  financeGetActiveLoansCount: { channel: 'finance:getActiveLoansCount', kind: 'invoke' },
  financeGetTodayTransactionsCount: { channel: 'finance:getTodayTransactionsCount', kind: 'invoke' },
  financeGetCategories: { channel: 'finance:getCategories', kind: 'invoke' },
  financeAddCategory: { channel: 'finance:addCategory', kind: 'invoke' },
  financeDeleteCategory: { channel: 'finance:deleteCategory', kind: 'invoke' },
  // Finance - Credit Cards
  financeGetCreditCards: { channel: 'finance:getCreditCards', kind: 'invoke' },
  financeAddCreditCard: { channel: 'finance:addCreditCard', kind: 'invoke' },
  financeUpdateCreditCard: { channel: 'finance:updateCreditCard', kind: 'invoke' },
  financeDeleteCreditCard: { channel: 'finance:deleteCreditCard', kind: 'invoke' },
  financeGetCreditCardStatements: { channel: 'finance:getCreditCardStatements', kind: 'invoke' },
  financeGetStatementDetail: { channel: 'finance:getStatementDetail', kind: 'invoke' },
  financeGenerateStatement: { channel: 'finance:generateStatement', kind: 'invoke' },
  financePayStatement: { channel: 'finance:payStatement', kind: 'invoke' },
  financeGetExpenseBreakdown: { channel: 'finance:getExpenseBreakdown', kind: 'invoke' },
  financeGetExpenseBreakdownForRange: { channel: 'finance:getExpenseBreakdownForRange', kind: 'invoke' },
  // Feedback
  feedbackSend: { channel: 'feedback:send', kind: 'invoke' },
  // Syl (read-projection snapshot)
  sylBuildSnapshot: { channel: 'syl:buildSnapshot', kind: 'invoke' },
  // Updater
  updaterCheck: { channel: 'updater:check', kind: 'invoke', platforms: 'desktop' },
  updaterDownload: { channel: 'updater:download', kind: 'invoke', platforms: 'desktop' },
  updaterRestart: { channel: 'updater:restart', kind: 'invoke', platforms: 'desktop' },
  onUpdateAvailable: { channel: 'updater:update-available', kind: 'on' },
  onUpdateDownloaded: { channel: 'updater:update-downloaded', kind: 'on', unwrap: () => undefined },
  onDownloadProgress: { channel: 'updater:download-progress', kind: 'on' },
  onUpdateError: { channel: 'updater:error', kind: 'on' },
```

- [ ] **Step 3b: `shared/types.ts:457-461` — `nutritionGetEventDays` pasa a ser un miembro real de `HubtifyApi`**

Hoy la línea 458 está DENTRO del `Promise<Array<{ … }>>` de `nutritionSearchHistory`, así que `HubtifyApi` tiene 252 claves y `satisfies` marca `nutritionGetEventDays` como propiedad desconocida (`TS2561`). El handler `nutrition:getEventDays` y la entrada de preload existen; solo el tipo estaba mal ubicado. Reemplazar:
```ts
  nutritionSearchHistory: (query?: string, limit?: number) => Promise<Array<{
  nutritionGetEventDays: (start: string, end: string) => Promise<string[]>;
    description: string; calories: number; timesLogged: number;
    lastLogged: string | null; source: 'history' | 'favorite'; proteinG?: number;
  }>>;
```
→
```ts
  nutritionSearchHistory: (query?: string, limit?: number) => Promise<Array<{
    description: string; calories: number; timesLogged: number;
    lastLogged: string | null; source: 'history' | 'favorite'; proteinG?: number;
  }>>;
  nutritionGetEventDays: (start: string, end: string) => Promise<string[]>;
```
`src/modules/nutrition/event-api.ts` no se toca: su cast `window.api as unknown as Partial<NutritionEventApi>` sigue compilando, y así `src/` no suma un séptimo archivo al diff.

- [ ] **Step 4: Verificar**

Run: `npm test -- tests/shared/api-channels`
Expected: `Tests 7 passed (7)`.

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0. (Si `tsc` marca «Object literal may only specify known properties» o «Property 'x' is missing», la tabla y `HubtifyApi` divergen: arreglá la tabla, no el tipo.)

- [ ] **Step 5: Commit**

```bash
git add shared/api-channels.ts shared/types.ts tests/shared/api-channels.test.ts
git commit -m "feat(api): single channel table for window.api, checked against HubtifyApi"
```

---

### Task 16: `shared/build-api.ts` — generador de `window.api` sobre un `Transport`

**Files:**
- Create: `shared/build-api.ts`
- Test: `tests/shared/build-api.test.ts`

- [ ] **Step 1: Escribir el test**

`tests/shared/build-api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { buildApi, type Transport, type EventHandler } from '../../shared/build-api';
import { API_CHANNELS } from '../../shared/api-channels';

function fakeTransport() {
  const listeners = new Map<string, Set<EventHandler>>();
  const t: Transport & { fire(channel: string, payload?: unknown): void; invoke: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } = {
    invoke: vi.fn(async (_channel: string, ...args: unknown[]) => ({ echoed: args })),
    send: vi.fn(),
    on: (channel, h) => { (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(h); },
    off: (channel, h) => { listeners.get(channel)?.delete(h); },
    fire: (channel, payload) => { for (const h of listeners.get(channel) ?? []) h(payload); },
  };
  return t;
}

describe('buildApi', () => {
  it('desktop exposes every key of the table', () => {
    const api = buildApi(fakeTransport(), 'desktop') as unknown as Record<string, unknown>;
    for (const key of Object.keys(API_CHANNELS)) expect(typeof api[key]).toBe('function');
  });

  it('invoke forwards channel and args and resolves with the transport result', async () => {
    const t = fakeTransport();
    const api = buildApi(t, 'desktop');
    await expect(api.questsSetTaskStatus('t1', true)).resolves.toEqual({ echoed: ['t1', true] });
    expect(t.invoke).toHaveBeenCalledWith('quests:setTaskStatus', 't1', true);
  });

  it('send forwards on desktop and is a no-op on mobile', () => {
    const d = fakeTransport();
    buildApi(d, 'desktop').windowMinimize();
    expect(d.send).toHaveBeenCalledWith('window:minimize');

    const m = fakeTransport();
    buildApi(m, 'mobile').windowMinimize();
    expect(m.send).not.toHaveBeenCalled();
  });

  it('on subscribes, unwraps the legacy payloads, and the returned function unsubscribes', () => {
    const t = fakeTransport();
    const api = buildApi(t, 'desktop');

    const ids: string[] = [];
    const off = api.onRpgAchievementUnlocked((id) => ids.push(id));
    t.fire('rpg:achievementUnlocked', { id: 'first_seal' });
    expect(ids).toEqual(['first_seal']);
    off();
    t.fire('rpg:achievementUnlocked', { id: 'ignored' });
    expect(ids).toEqual(['first_seal']);

    const ticks: unknown[] = [];
    api.onCauldronTick((s) => ticks.push(s));
    t.fire('cauldron:tick', { status: 'work' });
    expect(ticks).toEqual([{ status: 'work' }]); // no unwrap: payload as-is

    const downloaded = vi.fn();
    api.onUpdateDownloaded(downloaded);
    t.fire('updater:update-downloaded', { raw: 'event' });
    expect(downloaded).toHaveBeenCalledWith(undefined);
  });

  it('mobile omits the 8 desktop-only methods and keeps everything else', () => {
    const api = buildApi(fakeTransport(), 'mobile') as unknown as Record<string, unknown>;
    for (const key of ['backupExport', 'backupPickImportFile', 'backupImport', 'cauldronOpenWindow', 'cauldronCloseWindow', 'updaterCheck', 'updaterDownload', 'updaterRestart']) {
      expect(api[key]).toBeUndefined();
    }
    expect(Object.keys(api)).toHaveLength(253 - 8);
    expect(typeof api.onUpdateAvailable).toBe('function'); // NOT desktop-only (spec §3.1)
  });
});
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm test -- tests/shared/build-api`
Expected: FAIL — `Failed to resolve import "../../shared/build-api"`.

- [ ] **Step 3: Crear `shared/build-api.ts`**

```ts
import type { HubtifyApi } from './types';
import { API_CHANNELS, type ChannelSpec } from './api-channels';

export type EventHandler = (payload: unknown) => void;

/** What a binding must provide: ipcRenderer on Electron, postMessage on Android. */
export interface Transport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, handler: EventHandler): void;
  off(channel: string, handler: EventHandler): void;
}

export type ApiTarget = 'desktop' | 'mobile';

/**
 * Builds `window.api` from API_CHANNELS. On 'mobile' the desktop-only entries
 * are omitted (their HubtifyApi members are optional) and `send` is a no-op
 * (`window:*` has no meaning without a frame).
 */
export function buildApi(transport: Transport, target: ApiTarget): HubtifyApi {
  const api: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(API_CHANNELS) as Array<[string, ChannelSpec]>) {
    if (spec.platforms === 'desktop' && target !== 'desktop') continue;
    api[key] = makeMethod(transport, spec, target);
  }
  return api as unknown as HubtifyApi;
}

function makeMethod(transport: Transport, spec: ChannelSpec, target: ApiTarget): unknown {
  switch (spec.kind) {
    case 'invoke':
      return (...args: unknown[]) => transport.invoke(spec.channel, ...args);
    case 'send':
      return target === 'desktop'
        ? (...args: unknown[]) => transport.send(spec.channel, ...args)
        : () => undefined;
    case 'on':
      return (callback: (payload: unknown) => void) => {
        const handler: EventHandler = (payload) => callback(spec.unwrap ? spec.unwrap(payload) : payload);
        transport.on(spec.channel, handler);
        return () => transport.off(spec.channel, handler);
      };
  }
}
```

- [ ] **Step 4: Verificar**

Run: `npm test -- tests/shared/build-api`
Expected: `Tests 5 passed (5)`.

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared/build-api.ts tests/shared/build-api.test.ts
git commit -m "feat(api): buildApi() generates window.api from the channel table over a Transport"
```

---

### Task 17: `preload.ts` generado; los 8 métodos desktop-only pasan a opcionales en `HubtifyApi`

**Files:**
- Modify: `electron/preload.ts` (reemplazo completo: 355 → 33 líneas), `shared/types.ts:529-531,691-692,703-705`
- Modify (guards `?.`): `src/hub/SettingsPage.tsx:451,460-461,469`, `src/hub/Layout.tsx:275`, `src/modules/cauldron/components/CauldronFloatingTimer.tsx:281`, `src/modules/cauldron/components/CauldronDashboardWidget.tsx:139,143`, `src/modules/cauldron/components/CauldronPage.tsx:379,554`, `src/modules/cauldron/components/CauldronFloatingWindow.tsx:89,167`

- [ ] **Step 1: `electron/preload.ts` — reemplazo completo**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { buildApi, type EventHandler, type Transport } from '../shared/build-api';

/**
 * window.api is generated from shared/api-channels.ts — add a method there
 * (and its type in HubtifyApi), never here. Listeners are wrapped so the
 * renderer callback receives the payload only (no IpcRendererEvent), which is
 * what every hand-written wrapper here used to do.
 */
const listeners = new WeakMap<EventHandler, (event: IpcRendererEvent, payload: unknown) => void>();

const transport: Transport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
    listeners.set(handler, listener);
    ipcRenderer.on(channel, listener);
  },
  off: (channel, handler) => {
    const listener = listeners.get(handler);
    if (!listener) return;
    ipcRenderer.removeListener(channel, listener);
    listeners.delete(handler);
  },
};

contextBridge.exposeInMainWorld('api', buildApi(transport, 'desktop'));
```
(`export type Api = typeof api;` desaparece: nadie lo importaba — verificado con `rg "preload'" src shared tests`.)

- [ ] **Step 2: `shared/types.ts` — 8 opcionales**

```bash
perl -pi -e 's/^  (backupExport|backupPickImportFile|backupImport|cauldronOpenWindow|cauldronCloseWindow|updaterCheck|updaterDownload|updaterRestart): /  $1?: /' shared/types.ts
```
Verificá: `rg -n "^  (backup\w+|cauldron(Open|Close)Window|updater\w+)\?: " shared/types.ts` → 8 líneas.

- [ ] **Step 3: Guards en `src/` (`npx tsc --noEmit` ahora marca «possibly undefined» en 11 sitios)**

```bash
perl -pi -e 's/window\.api\.cauldronOpenWindow\(\)/window.api.cauldronOpenWindow?.()/g; s/window\.api\.cauldronCloseWindow\(\)/window.api.cauldronCloseWindow?.()/g' src/modules/cauldron/components/CauldronFloatingTimer.tsx src/modules/cauldron/components/CauldronDashboardWidget.tsx src/modules/cauldron/components/CauldronPage.tsx src/modules/cauldron/components/CauldronFloatingWindow.tsx
perl -pi -e 's/await window\.api\.updaterDownload\(\)/await window.api.updaterDownload?.()/' src/hub/Layout.tsx
```
(`Layout.tsx:281,311` ya usaban `?.()`.)

`src/hub/SettingsPage.tsx`, con Edit:

Línea 451:
```ts
                const result = await window.api.backupExport();
```
→
```ts
                const result = await window.api.backupExport?.();
                if (!result) return;
```

Líneas 460–461:
```ts
                const picked = await window.api.backupPickImportFile();
                if (picked.canceled || !picked.path) return;
```
→
```ts
                const picked = await window.api.backupPickImportFile?.();
                if (!picked || picked.canceled || !picked.path) return;
```

Línea 469:
```ts
                const result = await window.api.backupImport(picked.path);
```
→
```ts
                const result = await window.api.backupImport?.(picked.path);
                if (!result) return;
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic`
Expected: sin salida, exit 0.

Run: `npm test`
Expected: `Test Files 99 passed (99)`, `Tests 1285 passed (1285)` (97 + api-channels + build-api; 1273 + 7 + 5).

Run: `git diff master --stat -- src/`
Expected: exactamente 6 archivos: `SettingsPage.tsx`, `Layout.tsx`, `CauldronFloatingTimer.tsx`, `CauldronDashboardWidget.tsx`, `CauldronPage.tsx`, `CauldronFloatingWindow.tsx`.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts shared/types.ts src
git commit -m "refactor(preload): generate window.api from the channel table; desktop-only methods become optional"
```

---

### Task 18: Aliases `@logic`, `tsconfig` raíz, CI gate, `CLAUDE.md`

**Files:**
- Modify: `tsconfig.json`, `vitest.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `.github/workflows/ci.yml`, `CLAUDE.md`

- [ ] **Step 1: `tsconfig.json`**

`paths` — agregar después de `"@modules/*": ["src/modules/*"]` (con la coma correspondiente):
```json
      "@logic/*": ["shared-logic/*"]
```
`include`:
```json
  "include": ["src/**/*", "electron/**/*", "shared/**/*", "shared-logic/**/*"]
```

- [ ] **Step 2: `vitest.config.ts`** — en el objeto `alias`, después de `'@modules': r('./src/modules'),`:
```ts
  '@logic': r('./shared-logic'),
```

- [ ] **Step 3: Los tres vite configs**

`vite.main.config.ts` — reemplazo completo:
```ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@logic': path.resolve(__dirname, 'shared-logic') } },
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'adm-zip', 'pdf-parse'],
    },
  },
});
```

`vite.preload.config.ts` — reemplazo completo:
```ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@logic': path.resolve(__dirname, 'shared-logic') } },
});
```

`vite.renderer.config.ts` — agregar `import path from 'path';` debajo de `import pkg from './package.json';` y, dentro de `defineConfig({`, antes de `define:`:
```ts
  resolve: { alias: { '@logic': path.resolve(__dirname, 'shared-logic') } },
```
(Vite inyecta `__dirname` en los archivos de config, y `forge.config.ts` ya lo usa. Ningún archivo importa `@logic/*` todavía — el alias existe para Fase 2; no rompe nada aunque no se use.)

- [ ] **Step 4: `.github/workflows/ci.yml`** — después del step `Typecheck`:
```yaml
      - name: Typecheck shared-logic (no electron/node/dom)
        run: npm run typecheck:shared-logic
```

- [ ] **Step 5: `CLAUDE.md`**

Bloque `## Architecture` (líneas 6–21) — reemplazar el árbol por:
````markdown
## Architecture

```
shared-logic/      Business logic shared by desktop and Android. Pure TS, sync, NO electron/node/dom
  registry.ts      registerHandler (alias `ipcHandle`) · getHandler · lifecycle hooks
  register-all.ts  registerAllHandlers() — the 13 platform-neutral register*IpcHandlers
  db/              SqlDatabase interface, getDb()/setDbFactory(), core + module migrations
  modules/         All IPC handlers (finance.ipc.ts, quests.ipc.ts, rpg-handlers.ts, …)
  platform.ts      PlatformPort (dialogs, files, notifications, app/os info) — injected
  events.ts        emit(channel, payload) main → renderer — sink injected
  ids.ts           genId()
electron/          Desktop binding only
  main.ts          Windows, tray, startup order: setDbFactory → setPlatform → setEventSink → registerAllIpcHandlers → getDb → runAllModuleMigrations
  platform.ts      PlatformPort with dialog/fs/Notification/pdf-parse
  ipc/db.ts        openDesktopDb() (better-sqlite3 + WAL)
  ipc/registry.ts  registerAllIpcHandlers(): shared handlers + backup, then bind to ipcMain
  modules/         backup.ipc.ts, updater.ts (desktop-only)
  preload.ts       Generated from shared/api-channels.ts via shared/build-api.ts
src/               Renderer: React + Vite
  modules/         Feature modules (finance/, quests/, nutrition/, character/)
  shared/          Shared components, hooks, animations
  hub/             Shell: Layout, Sidebar, PlayerCard, Auth
  i18n/            es.json, en.json
  core/            `ModuleDefinition` type only (module contract — no runtime registry)
shared/            Types + the window.api channel table (types.ts, api-channels.ts, build-api.ts)
```
````

Sección `### IPC Pattern` — reemplazar completa por:
```markdown
### IPC Pattern

- **Channels**: `module:action` (e.g., `finance:addTransaction`, `quests:getTasks`)
- **Handler**: `ipcHandle(channel, (_e, ...args) => …)` imported as `import { registerHandler as ipcHandle } from '../registry'` inside `shared-logic/modules/`. Handlers live in `shared-logic/modules/*.ipc.ts` and MUST NOT import `electron`, `fs`, `path`, `os`, `crypto` or `better-sqlite3` (`npm run typecheck:shared-logic` enforces it)
- **IDs**: `genId()` from `shared-logic/ids.ts`
- **DB**: `getDb()` from `shared-logic/db` (type `SqlDatabase`, never `better-sqlite3`'s `Database`)
- **OS access** (dialogs, files, native notifications, app version): `platform()` from `shared-logic/platform.ts`. Implement new methods in `electron/platform.ts` (and later `src/mobile/platform-host.ts`)
- **main → renderer events**: `emit(channel, payload)` from `shared-logic/events.ts`
- **DB naming**: snake_case in SQL, camelCase in JS via aliases (`created_at AS createdAt`)
- **Exposing to the renderer**: add ONE entry to `shared/api-channels.ts` + its type in `shared/types.ts` `HubtifyApi`. `preload.ts` is generated — never edit it by hand. Desktop-only methods get `platforms: 'desktop'` and are optional (`?:`) in `HubtifyApi`
- **Complex params**: Use `Record<string, unknown>` in `HubtifyApi`, typed in the handler
- **Tests**: register the module's handlers, then `getHandler(channel)!({}, ...args)` from `shared-logic/registry`; `clearHandlers()` in `beforeEach` if you re-register; mock the DB with `vi.mock('.../shared-logic/db', () => ({ getDb: () => db }))`
```

Sección `### Database` — cambiar la línea de migraciones:
```markdown
- Migrations: `{ namespace, version, up }` in `module.schema.ts`, wired in `shared-logic/db/all-migrations.ts` (`runAllModuleMigrations()`)
```

Sección `## Module Wiring` — la tabla queda:
```markdown
| Concern           | Real location                                                        |
| ----------------- | -------------------------------------------------------------------- |
| Migrations        | `shared-logic/db/all-migrations.ts` (`runAllModuleMigrations()`)      |
| IPC handlers      | `shared-logic/register-all.ts` (`registerAllHandlers()`)              |
| Dashboard widgets | imported directly in `src/hub/widgets/widget-registry.ts`             |
| Routes            | hardcoded JSX `<Route>` elements in `src/App.tsx`                     |
| RPG events        | `shared-logic/modules/rpg-handlers.ts`                                |
| `window.api`      | `shared/api-channels.ts` (+ `HubtifyApi` in `shared/types.ts`)        |
```

Sección `### Multi-Account Sync` — línea 1: `electron/modules/sync.ipc.ts` → `shared-logic/modules/sync.ipc.ts`.

Sección `## Don't` — agregar:
```markdown
- Don't import `electron`, `fs`, `path`, `os`, `crypto`, `better-sqlite3` or anything under `electron/` from `shared-logic/` — that code also runs inside the Android worker
- Don't edit `electron/preload.ts` by hand — add the entry to `shared/api-channels.ts`
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm test`
Expected: `Test Files 99 passed (99)`, `Tests 1285 passed (1285)`.

Run: `rg -n "electron/modules/(quests|nutrition|finance|sync|cauldron|notifications)|electron/ipc/(db|rpg-handlers)" CLAUDE.md`
Expected: sin resultados.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json vitest.config.ts vite.main.config.ts vite.preload.config.ts vite.renderer.config.ts .github/workflows/ci.yml CLAUDE.md
git commit -m "chore(mobile): @logic alias, shared-logic typecheck in CI, CLAUDE.md points at shared-logic"
```

---

### Task 19: Verificación final de la Fase 1

- [ ] **Step 1: Gates automáticos (todos desde la raíz del repo)**

| Comando | Esperado |
|---|---|
| `npx tsc --noEmit` | sin salida, exit 0 |
| `npm run typecheck:shared-logic` | sin salida, exit 0 |
| `npm test` | `Test Files 99 passed (99)`, `Tests 1285 passed (1285)` — los 1247 de master siguen ahí (ninguno borrado ni skipeado: `rg -n "\.skip\(|\.only\(" tests` → vacío) |
| `npm run lint` | mismo resultado que en master (0 errores; los warnings preexistentes no cambian) |
| `git ls-files electron` | 9 archivos (lista en Task 14) |
| Gates de aislamiento (bloque de abajo — fuera de la tabla porque los `\|` de Markdown NO son alternancia en rg) | ver bloque |
| `git diff master --stat -- src/` | solo los 6 archivos de Task 17 |
| `git diff master --stat -- src/shared/sync.ts src/shared/sync-merge.ts src/shared/habit-checks-sync.ts functions/` | vacío (sync y Firestore intactos) |

Gates de aislamiento (copiar tal cual; los tres `rg` deben terminar SIN resultados, exit 1; el `wc` da 30):
```bash
rg -n "from 'electron'" shared-logic
rg -n "from '(fs|path|os|crypto|child_process)'|require\(|from 'better-sqlite3'|NodeJS\.|\bprocess\.[a-zA-Z]" shared-logic
rg -l "electron/(ipc|modules)/" tests
git ls-files shared-logic | wc -l
```
(30 = tsconfig + 5 raíz: ids/events/platform/registry/register-all + 5 db + 19 modules; 27 en `electron/` − 19 movidos + `platform.ts` = los 9 de Task 14.)

- [ ] **Step 2: Smoke manual en desktop (lo corre el usuario con `npm start`; anotá el resultado en el PR)**

1. Arranca, login, Dashboard carga (handlers bindeados + migraciones).
2. Coinify → Dashboard → «Exportar CSV»: aparece el diálogo de guardado, el archivo se escribe, toast de éxito. Cancelar devuelve `canceled` sin toast de error.
3. Coinify → Importar resumen PDF: diálogo, parseo, filas en pantalla.
4. Ajustes → notificaciones: `notifications:send` muestra una notificación nativa; click en ella enfoca la ventana.
5. Cauldron: iniciar un preset de 1 minuto con «ventana flotante» activada — la ventana PiP abre (`cauldron:openWindow` vía `ipcHandle`), recibe `cauldron:tick`, y al terminar el segmento llega la notificación nativa y `cauldron:sessionEnd`.
6. Ajustes → backup: exportar ZIP e importar el mismo ZIP (usa `closeDb` de shared-logic) → la app recarga con los datos.
7. Cerrar la ventana a bandeja y volver a abrir desde el tray.
8. Códice: sellar el día → `rpg:daySealed` llega (el toast/animación de sello aparece).

- [ ] **Step 3: Cierre**

No hay commit en esta task. Si algún smoke falla, abrí un fix con su propio commit `fix(scope): …` y volvé a correr la tabla de Step 1.

---

## Desvíos respecto de la spec (todos deliberados; ver justificación en cada task)

| Spec | Plan | Por qué |
|---|---|---|
| `transaction<F>(fn: F): F` | `transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R` | better-sqlite3 no es asignable a la firma literal (TS2322 reproducido); esta sí, y es equivalente en uso |
| `registerAllHandlers()` en `registry.ts` | en `shared-logic/register-all.ts` | evita el ciclo registry ↔ modules |
| `HandlerEvent = {}` | `Record<string, never>` | `{}` dispara `@typescript-eslint/ban-types` en ts-eslint 5.62; semántica idéntica |
| «`closeDb()` … mientras el worker está suspendido `getDb()` lanza `DbSuspended`» | `suspendDb()` / `resumeDb()` explícitos además de `closeDb()` | la spec necesita dos estados (cerrado-reabrible vs suspendido); nombrarlos evita que backup.ipc dispare `DbSuspended` |
| `runModuleMigrations` en `migrate.ts` | en `provider.ts` (re-exportado igual desde `db/index.ts`) | necesita `getDb()`; en `migrate.ts` sería otro ciclo |
| Orden de arranque en `main.ts` | updater + ventanas del Cauldron se registran con `ipcHandle` ANTES de `registerAllIpcHandlers()` | el bind a `ipcMain` es único y ocurre dentro de `registerAllIpcHandlers()` |
| `notifications:send` devolvía `false` sin soporte nativo | devuelve `true` siempre (`notify` decide) | `PlatformPort.notify` es `Promise<void>` por spec; nadie lee el booleano |
| tipo de `financeImportSelectAndParsePDF` con `{ ok:false, reason }` | sin cambio de tipo en Fase 1 (solo runtime) | mantener `git diff master -- src/` limitado a los 6 archivos; el tipo + toast entran en Fase 5 |
| Título del diálogo «Export CSV» | default del SO | `saveTextFile(defaultName, content)` no lleva título por spec |
| `electron/ipc/db.ts` solo `openDesktopDb()` | re-exporta `getDb` de forma TRANSICIONAL entre Task 3 y Task 14 | permite mover módulo por módulo con tsc y tests verdes en cada commit |
| §11 Fase 1: `git diff master -- src/` puede tocar `global.d.ts` y `platform-detect.ts` | esta fase NO los crea; el diff de `src/` son solo los 6 archivos de los guards | `__HUBTIFY_PLATFORM__`/`isNativeMobile()` no tienen consumidor hasta el worker y el shell (§5, Fase 2/3); crearlos hoy sería código muerto |
| Solo la notificación del motor de polling enfocaba la ventana al click (`notifications.ipc.ts:69-76`); `notifications:send` y las dos del Cauldron hacían `.show()` pelado | `electronPlatform.notify` enfoca la ventana al click en TODAS | un solo `notify` por spec §6; enfocar es estrictamente mejor y evita tres variantes |
| — | `ci.yml` corre `typecheck:shared-logic` | spec §10 «Gate de aislamiento: tsc -p shared-logic en CI» (§8 lo ubica en Fase 4; es una línea y protege desde ya) |
