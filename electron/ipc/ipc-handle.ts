/**
 * Alias kept for the three desktop-only callers left in electron/ (`main.ts`,
 * `modules/backup.ipc.ts`, `modules/updater.ts`) so their bodies need no
 * changes; everything else moved to shared-logic and imports `registerHandler`
 * straight from the registry. Registration is platform-neutral
 * (shared-logic/registry.ts); `registerAllIpcHandlers()` in ./registry.ts binds
 * every channel to ipcMain.
 */
export { registerHandler as ipcHandle } from '../../shared-logic/registry';
