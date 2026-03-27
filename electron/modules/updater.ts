import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';

let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:download-progress', {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err);
  });

  // Check for updates silently on startup (only in production)
  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
}

export function registerUpdaterIpcHandlers(): void {
  ipcHandle('updater:check', async () => {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo ? { available: true, version: result.updateInfo.version } : { available: false };
  });

  ipcHandle('updater:download', async () => {
    await autoUpdater.downloadUpdate();
  });

  ipcHandle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
