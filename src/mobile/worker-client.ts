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
