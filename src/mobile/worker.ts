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
import { getHandler, runResume, runSuspend } from '@logic/registry';
import { registerAllHandlers } from '@logic/register-all';
import { getDb, resumeDb, runAllModuleMigrations, setDbFactory, suspendDb } from '@logic/db';
import { setPlatform, type PlatformPort } from '@logic/platform';
import { setEventSink } from '@logic/events';
import { startNotificationEngine } from '@logic/modules/notifications.ipc';
import { generateRecurringForMonth } from '@logic/modules/finance.balance';
import { todayDateString } from '../../shared/date-utils';
import { WasmDatabase } from './db/wasm-database';
import { registerMobileDbHandlers, type DbPool } from './db-backup-handlers';
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

let sqlite3: Sqlite3Static | null = null;
let poolUtil: SAHPoolUtil | null = null;
let booted = false;
let initInfo = { appVersion: APP_VERSION, osInfo: 'android' };

/**
 * Orden obligatorio (spec §3.5): primero los lifecycles (cauldron y
 * notifications limpian sus intervals), después la DB, después el VFS —
 * `pauseVfs()` exige que no haya archivos abiertos.
 */
function teardownForSuspend(): void {
  runSuspend();
  // `suspendDb()` (shared-logic/db/provider.ts) cierra el singleton Y hace
  // que el siguiente `getDb()` lance `DbSuspended` hasta `resumeDb()`.
  suspendDb();
  poolUtil?.pauseVfs();
  console.log('[worker] suspended');
}

const protocol = createWorkerProtocol({
  post,
  getHandler,
  onInit(info) {
    initInfo = info;
  },
  suspend() {
    // Un suspend durante el arranque no tiene nada que cerrar todavía; el gate
    // del protocolo ya frena los invokes, y el final de `boot()` aplica el
    // teardown sobre la DB/VFS que para entonces sí existen.
    if (!booted) return;
    teardownForSuspend();
  },
  async resume() {
    if (poolUtil?.isPaused()) await poolUtil.unpauseVfs();
    resumeDb();
    if (!booted) return;
    // Reabre vía la factory (suspendDb descartó el singleton). El provider
    // vuelve a aplicar pragmas + initCoreTables + coreMigrations (spec §3.3):
    // todo idempotente y barato (IF NOT EXISTS / migrations_applied).
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
  pickBinaryFile: (filters) =>
    protocol.callPlatform('pickBinaryFile', [filters]) as ReturnType<PlatformPort['pickBinaryFile']>,
  saveTextFile: (name, content) => protocol.callPlatform('saveTextFile', [name, content]) as Promise<boolean>,
  saveBinaryFile: (name, bytes) => protocol.callPlatform('saveBinaryFile', [name, bytes]) as Promise<boolean>,
  // Avisos con la app cerrada (spec §12 Fase 6): el plan se calcula acá, con la
  // DB y el estado del Caldero a mano, y lo ejecuta el hilo UI, que es el único
  // que puede hablar con @capacitor/local-notifications.
  applyNotificationPlan: (plan) => protocol.callPlatform('applyNotificationPlan', [plan]) as Promise<void>,
  exactAlarmState: () => protocol.callPlatform('exactAlarmState', []) as Promise<string>,
  requestExactAlarms: () => protocol.callPlatform('requestExactAlarms', []) as Promise<string>,
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
  setDbFactory(() => new WasmDatabase(sq, new pool.OpfsSAHPoolDb(DB_FILE)));
  setPlatform(proxyPlatform);
  setEventSink((channel, payload) => post({ type: 'event', channel, payload }));

  // 4. Handlers, DB y migraciones (espejo de electron/main.ts).
  // Backup .db crudo (Fase 5): canales mobile:exportDb / mobile:importDb.
  // El .d.mts 3.53 tipa `exportFile`/`importDb` como `Promise<…>`, pero sus
  // propios docblocks dicen que con un Uint8Array son SÍNCRONOS ("Synchronously
  // reads … and returns it" / "On success, the number of bytes written is
  // returned"; solo el overload con callback es async). Se adapta acá.
  const dbPool: DbPool = {
    exportFile: (name) => pool.exportFile(name) as unknown as Uint8Array,
    importDb: (name, bytes) => pool.importDb(name, bytes) as unknown as number,
  };
  registerMobileDbHandlers({ pool: dbPool, dbFile: DB_FILE, isBooted: () => booted });
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

  // Si la app se fue a segundo plano DURANTE el arranque, el `suspend` salió
  // por el early-return de arriba y dejó la DB abierta y el VFS activo con la
  // app ya oculta. El gate del protocolo sigue cerrado (ningún invoke pasa),
  // así que el teardown va acá — sin `await` en el medio, no hay ventana para
  // que llegue un `resume` entre el chequeo y el cierre.
  if (protocol.isSuspended()) teardownForSuspend();
}

void boot();
