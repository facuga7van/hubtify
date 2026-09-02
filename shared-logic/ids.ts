/**
 * Stable UUID v4 for every row we mint. `globalThis.crypto` exists in the
 * Electron main process, in Node ≥ 19 (vitest) and in Web Workers, so this is
 * the one id source for desktop, tests and the Android worker.
 */
export function genId(): string {
  return globalThis.crypto.randomUUID();
}
