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
