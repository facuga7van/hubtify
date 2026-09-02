import { ipcMain } from 'electron';
import { getHandler, listChannels } from '../../shared-logic/registry';
import { registerAllHandlers } from '../../shared-logic/register-all';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';

/**
 * Desktop binding: shared handlers + desktop-only backup, then bind every
 * registered channel to ipcMain. Anything registered through `ipcHandle`
 * AFTER this call is never bound — updater and cauldron-window handlers are
 * registered in main.ts BEFORE calling this.
 */
export function registerAllIpcHandlers(): void {
  registerAllHandlers();
  registerBackupIpcHandlers();
  bindToIpcMain();
}

/** Same labeled-error logging the old ipcHandle wrapper had. */
function bindToIpcMain(): void {
  for (const channel of listChannels()) {
    const fn = getHandler(channel)!;
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn({}, ...args);
      } catch (err) {
        console.error(`[${channel}]`, err);
        throw err;
      }
    });
  }
}
