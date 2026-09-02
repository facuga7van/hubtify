/**
 * Backup `.db` crudo en Android (spec §6, fila backup; Fase 5). El worker
 * registra dos canales en el registry de shared-logic; la UI (backup.ts) los
 * invoca por el transporte normal y comparte / elige el archivo con el host.
 *
 * Doc sqlite-wasm (persistence.md): `importDb` es indefinido sobre una DB
 * abierta y `exportFile` no lo aclara → se cierra siempre antes de tocar el
 * archivo. Tras importar, la DB queda suspendida (getDb lanza DbSuspended)
 * hasta que la UI recarga el WebView.
 */
import { registerHandler, runResume, runSuspend } from '@logic/registry';
import { closeDb, getDb, resumeDb, suspendDb } from '@logic/db';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from './backup-channels';
import { isSqliteFile } from './host-utils';

/** Subconjunto de `SAHPoolUtil` que se usa (inyectable en tests). */
export interface DbPool {
  exportFile(name: string): Uint8Array;
  importDb(name: string, bytes: Uint8Array | ArrayBuffer): number;
}

export interface MobileDbHandlerDeps {
  pool: DbPool;
  dbFile: string;
  /** `true` después de `ready`: ahí hay lifecycles que suspender y una DB que reabrir. */
  isBooted(): boolean;
}

export function registerMobileDbHandlers(deps: MobileDbHandlerDeps): void {
  registerHandler(EXPORT_DB_CHANNEL, () => {
    const booted = deps.isBooted();
    if (booted) runSuspend();
    closeDb();
    try {
      // Copia propia: el buffer viaja con transfer list y no debe ser una vista del heap WASM.
      return new Uint8Array(deps.pool.exportFile(deps.dbFile));
    } finally {
      if (booted) {
        getDb();
        runResume();
      }
    }
  });

  registerHandler(IMPORT_DB_CHANNEL, (_e, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array) || !isSqliteFile(bytes)) throw new Error('not_sqlite');
    const booted = deps.isBooted();
    if (booted) runSuspend();
    suspendDb();
    let written: number;
    try {
      written = deps.pool.importDb(deps.dbFile, bytes);
    } catch (err) {
      // `isSqliteFile` solo mira los 16 bytes de cabecera: un archivo truncado
      // o con otro page-size la pasa y muere acá. Sin este rescate la DB
      // quedaba suspendida y los lifecycles parados, y la UI (que ante un
      // error solo muestra un toast, sin recargar) dejaba todo `getDb()`
      // lanzando `DbSuspended` hasta que el usuario mataba la app.
      resumeDb();
      if (booted) runResume();
      throw err;
    }
    // Camino feliz: la DB queda suspendida a propósito hasta el `location.reload()`.
    return { ok: true as const, bytes: written };
  });
}
