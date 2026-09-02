/**
 * Alias kept so the 15 modules that call `ipcHandle(channel, fn)` need no body
 * changes. Registration is platform-neutral (shared-logic/registry.ts);
 * `registerAllIpcHandlers()` in ./registry.ts binds every channel to ipcMain.
 */
export { registerHandler as ipcHandle } from '../../shared-logic/registry';
