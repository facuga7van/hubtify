import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { registerAllIpcHandlers } from './ipc/registry';
import { closeDb, getDb, runModuleMigrations } from './ipc/db';
import { questsMigrations } from '../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../src/modules/finance/finance.schema';
import { characterMigrations } from '../src/modules/character/character.schema';
import { notificationsMigrations } from './modules/notifications.schema';
import { cauldronMigrations } from '../src/modules/cauldron/cauldron.schema';
import { startNotificationEngine, stopNotificationEngine } from './modules/notifications.ipc';
import { initAutoUpdater, registerUpdaterIpcHandlers } from './modules/updater';

// Set a stable AppUserModelID matching the one Squirrel assigns to shortcuts
// (com.squirrel.<PACKAGE>.<EXE>). Required so Windows keeps pinned taskbar items
// associated with the app across updates instead of breaking the pin.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.squirrel.Hubtify.Hubtify');
}

// Handle Squirrel events (Windows installer lifecycle). Custom handler instead of
// electron-squirrel-startup: on update we pass --updateOnly so Squirrel re-points
// shortcuts that still exist to the new version WITHOUT resurrecting ones the user
// deleted or breaking pinned taskbar items. On first install we create normally.
function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const squirrelEvent = process.argv[1];
  if (!squirrelEvent || !squirrelEvent.startsWith('--squirrel')) return false;

  const exeName = path.basename(process.execPath); // Hubtify.exe
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  // spawnSync (not detached) so the shortcut op fully completes BEFORE we quit.
  // Squirrel allows ~15s; we cap at 12s so we never hang the install.
  const runUpdate = (args: string[]) => {
    try {
      spawnSync(updateExe, args, { timeout: 12000 });
    } catch {
      // Update.exe unavailable — app quits regardless, nothing to recover
    }
  };

  switch (squirrelEvent) {
    case '--squirrel-install':
      runUpdate([`--createShortcut=${exeName}`]);
      return true;
    case '--squirrel-updated':
      runUpdate([`--createShortcut=${exeName}`, '--updateOnly']);
      return true;
    case '--squirrel-uninstall':
      runUpdate([`--removeShortcut=${exeName}`]);
      return true;
    case '--squirrel-obsolete':
      return true;
    default:
      return false;
  }
}

if (handleSquirrelEvent()) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let cauldronWindow: BrowserWindow | null = null;
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

// ─── Cauldron Window Position Memory ────────────────────────
const CAULDRON_BOUNDS_FILE = 'cauldron-window-bounds.json';

function getCauldronBoundsPath(): string {
  return path.join(app.getPath('userData'), CAULDRON_BOUNDS_FILE);
}

function saveCauldronBounds(bounds: Electron.Rectangle): void {
  try {
    fs.writeFileSync(getCauldronBoundsPath(), JSON.stringify(bounds));
  } catch {
    // Silently fail — non-critical
  }
}

function loadCauldronBounds(): Electron.Rectangle | null {
  try {
    const data = fs.readFileSync(getCauldronBoundsPath(), 'utf-8');
    const bounds = JSON.parse(data) as Electron.Rectangle;
    // Validate bounds are on a visible display
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const { x, y, width, height } = d.workArea;
      return (
        bounds.x >= x - 50 &&
        bounds.y >= y - 50 &&
        bounds.x < x + width - 50 &&
        bounds.y < y + height - 50
      );
    });
    return visible ? bounds : null;
  } catch {
    return null;
  }
}

function createCauldronWindow(): void {
  if (cauldronWindow && !cauldronWindow.isDestroyed()) {
    cauldronWindow.focus();
    return;
  }

  const saved = loadCauldronBounds();

  cauldronWindow = new BrowserWindow({
    width: 320,
    height: 56,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#2a1d0e',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save position when moved
  cauldronWindow.on('moved', () => {
    if (cauldronWindow && !cauldronWindow.isDestroyed()) {
      saveCauldronBounds(cauldronWindow.getBounds());
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    cauldronWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '?view=floating-timer');
  } else {
    cauldronWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { search: 'view=floating-timer' },
    );
  }

  // Notify main window that floating was opened
  mainWindow?.webContents.send('cauldron:windowOpened');

  cauldronWindow.on('closed', () => {
    cauldronWindow = null;
    mainWindow?.webContents.send('cauldron:windowClosed');
  });
}

app.whenReady().then(() => {
  registerAllIpcHandlers();
  registerUpdaterIpcHandlers();

  ipcMain.handle('cauldron:openWindow', () => createCauldronWindow());
  ipcMain.handle('cauldron:closeWindow', () => {
    if (cauldronWindow && !cauldronWindow.isDestroyed()) {
      cauldronWindow.close();
    }
  });

  // Run module migrations
  getDb();
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);
  runModuleMigrations(notificationsMigrations);
  runModuleMigrations(cauldronMigrations);

  // Auto-generate recurring transactions for current month
  try {
    const db = getDb();
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const activeRecurrings = db.prepare('SELECT * FROM finance_recurring WHERE active = 1').all() as Array<Record<string, unknown>>;
    for (const rec of activeRecurrings) {
      const existing = db.prepare(
        "SELECT COUNT(*) as count FROM finance_transactions WHERE source = 'recurring' AND recurring_id = ? AND date LIKE ?"
      ).get(rec.id, `${currentMonth}%`) as { count: number };

      if (existing.count === 0) {
        const id = require('crypto').randomUUID();
        db.prepare(`INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method, source, recurring_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'recurring', ?, datetime('now'), datetime('now'))`)
          .run(id, rec.type, rec.amount, rec.currency ?? 'ARS', rec.category ?? 'Otros', rec.name, `${currentMonth}-01`, rec.id);
      }
    }
  } catch (e) {
    console.error('Failed to generate recurring transactions:', e);
  }

  createTray();
  createWindow();

  if (mainWindow) initAutoUpdater(mainWindow);

  startNotificationEngine();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopNotificationEngine();
  closeDb();
});

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows close — app lives in tray
  if (process.platform === 'darwin') app.quit();
});
