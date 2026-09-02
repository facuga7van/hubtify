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
