import { ipcMain } from 'electron';

/**
 * Wrapper around ipcMain.handle that adds labeled error logging.
 * Errors are logged with the channel name and re-thrown so the
 * renderer still receives the rejection.
 */
export function ipcHandle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      console.error(`[${channel}]`, err);
      throw err;
    }
  });
}
