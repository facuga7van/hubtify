import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { registerAllIpcHandlers } from './ipc/registry';
import { closeDb, getDb, runModuleMigrations } from './ipc/db';
import { questsMigrations } from '../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../src/modules/finance/finance.schema';
import { characterMigrations } from '../src/modules/character/character.schema';
import { stopOllama } from './modules/nutrition/ollama';
import { clearReminderInterval } from './modules/notifications.ipc';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Prevent multiple instances — second instance focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Fallback: create a tiny 16x16 placeholder if icon.png doesn't exist
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4y2NgGAWDEwAAAhAAATp23FAAAAAASUVORK5CYII=') : icon);
  tray.setToolTip('Hubtify');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Hubtify', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 650,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Hubtify',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

app.whenReady().then(() => {
  registerAllIpcHandlers();

  // Run module migrations
  getDb();
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);

  createTray();
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopOllama();
  clearReminderInterval();
  closeDb();
});

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows close — app lives in tray
  if (process.platform === 'darwin') app.quit();
});
