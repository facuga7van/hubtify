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
  | 'saveBinaryFile'
  | 'applyNotificationPlan'
  | 'exactAlarmState'
  | 'requestExactAlarms';

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
 *
 * El resultado va deduplicado: dos vistas del mismo `ArrayBuffer` (o el mismo
 * `Uint8Array` referenciado dos veces) lo repetirían en la transfer list y
 * `postMessage` tira `DataCloneError`.
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
  return [...new Set(out)];
}

/** `collectTransferables` sobre una lista de args, deduplicando entre ellos. */
export function collectTransferablesFrom(values: unknown[]): Transferable[] {
  return [...new Set(values.flatMap((v) => collectTransferables(v)))];
}
