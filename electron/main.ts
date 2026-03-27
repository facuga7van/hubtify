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
import { initAutoUpdater, registerUpdaterIpcHandlers } from './modules/updater';

// Handle Squirrel events (Windows installer lifecycle)
if (require('electron-squirrel-startup')) app.quit();

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let minimizeToTray = true;
let alwaysOnTop = false;

function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.ico');
  }
  return path.join(__dirname, '../../assets/icon.ico');
}

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

function rebuildTrayMenu(): void {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Hubtify', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    {
      label: 'Siempre visible', type: 'checkbox', checked: alwaysOnTop,
      click: () => { alwaysOnTop = !alwaysOnTop; mainWindow?.setAlwaysOnTop(alwaysOnTop); rebuildTrayMenu(); },
    },
    {
      label: 'Minimizar a bandeja', type: 'checkbox', checked: minimizeToTray,
      click: () => { minimizeToTray = !minimizeToTray; rebuildTrayMenu(); },
    },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  let icon = nativeImage.createFromPath(getIconPath());
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4y2NgGAWDEwAAAhAAATp23FAAAAAASUVORK5CYII=');
  }
  // Resize for tray (16x16 looks best on Windows)
  icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Hubtify');
  rebuildTrayMenu();
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
    icon: getIconPath(),
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

  // Minimize to tray or quit based on user preference
  mainWindow.on('close', (e) => {
    if (!isQuitting && minimizeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    } else if (!isQuitting) {
      isQuitting = true;
      app.quit();
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
  registerUpdaterIpcHandlers();

  // Run module migrations
  getDb();
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);

  createTray();
  createWindow();

  if (mainWindow) initAutoUpdater(mainWindow);
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
