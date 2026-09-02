/**
 * Backup `.db` crudo en Android (spec §6): exportar = pedir los bytes al worker
 * (mobile:exportDb) y compartirlos con el share sheet; importar = elegir un
 * archivo, validar la cabecera, mandarlo al worker (mobile:importDb) y recargar.
 * Sustituye al backup ZIP de Electron (backup.ipc.ts), que no viaja a mobile.
 *
 * La lógica está en `createMobileBackup(deps)` (testeable); `mobileBackup()`
 * la cablea con el worker real y el platform-host.
 */
import { todayDateString } from '../../shared/date-utils';
import type { FileFilter } from '@logic/platform';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from './backup-channels';
import { isSqliteFile } from './host-utils';
import { getWorkerClient } from './install-api';
import { createPlatformHost } from './platform-host';
import type { WorkerClient } from './worker-client';

export interface BackupDeps {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  saveBinaryFile: (name: string, bytes: Uint8Array) => Promise<boolean>;
  pickBinaryFile: (filters: FileFilter[]) => Promise<{ name: string; bytes: Uint8Array } | null>;
  /** YYYY-MM-DD para el nombre del archivo. */
  today: () => string;
}

export type ExportResult =
  | { success: true }
  | { success: false; canceled: true }
  | { success: false; canceled?: false; error: string };

export type ImportResult = { success: true; bytes: number } | { success: false; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createMobileBackup(deps: BackupDeps) {
  return {
    async exportDb(): Promise<ExportResult> {
      try {
        const bytes = (await deps.invoke(EXPORT_DB_CHANNEL)) as Uint8Array;
        const shared = await deps.saveBinaryFile(`hubtify-${deps.today()}.db`, bytes);
        return shared ? { success: true } : { success: false, canceled: true };
      } catch (err) {
        return { success: false, error: message(err) };
      }
    },

    /** Sin filtro de extensión: el chooser de Android filtra por MIME y `.db` no tiene uno fiable. */
    pickDbFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
      return deps.pickBinaryFile([{ name: 'SQLite', extensions: ['*'] }]);
    },

    async importDb(bytes: Uint8Array): Promise<ImportResult> {
      if (!isSqliteFile(bytes)) return { success: false, error: 'not_sqlite' };
      try {
        const r = (await deps.invoke(IMPORT_DB_CHANNEL, bytes)) as { ok: true; bytes: number };
        return { success: true, bytes: r.bytes };
      } catch (err) {
        return { success: false, error: message(err) };
      }
    },
  };
}

export type MobileBackup = ReturnType<typeof createMobileBackup>;

/** Hay worker y no murió: se puede pedir el .db (también tras un fatal de migración). */
export function canExportDb(client: WorkerClient | null = getWorkerClient()): boolean {
  return client !== null && !client.isCrashed();
}

let instance: MobileBackup | null = null;

/**
 * El singleton captura el `WorkerClient` de la primera llamada y no lo vuelve a
 * leer; es correcto porque el worker nunca se recrea dentro de una misma sesión
 * (tras importar se hace `location.reload()`, y un crash lleva a FatalScreen).
 */
export function mobileBackup(): MobileBackup {
  if (!instance) {
    const client = getWorkerClient();
    if (!client) throw new Error('mobileBackup(): el worker todavía no fue creado');
    const host = createPlatformHost();
    instance = createMobileBackup({
      invoke: (channel, ...args) => client.transport.invoke(channel, ...args),
      saveBinaryFile: (name, bytes) => host.saveBinaryFile(name, bytes) as Promise<boolean>,
      pickBinaryFile: (filters) => host.pickBinaryFile(filters) as Promise<{ name: string; bytes: Uint8Array } | null>,
      today: todayDateString,
    });
  }
  return instance;
}
