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
