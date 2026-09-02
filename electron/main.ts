import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { registerAllIpcHandlers } from './ipc/registry';
import { ipcHandle } from './ipc/ipc-handle';
import { closeDb, runModuleMigrations, setDbFactory } from '../shared-logic/db';
import { openDesktopDb, getDb } from './ipc/db';
import { setPlatform } from '../shared-logic/platform';
import { setEventSink } from '../shared-logic/events';
import { electronPlatform, webContentsSink } from './platform';
import { questsMigrations } from '../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../src/modules/finance/finance.schema';
import { characterMigrations } from '../src/modules/character/character.schema';
import { notificationsMigrations } from '../shared-logic/modules/notifications.schema';
import { cauldronMigrations } from '../src/modules/cauldron/cauldron.schema';
import { startNotificationEngine, stopNotificationEngine } from '../shared-logic/modules/notifications.ipc';
import { generateRecurringForMonth } from '../shared-logic/modules/finance.balance';
import { initAutoUpdater, registerUpdaterIpcHandlers } from './modules/updater';
import { todayDateString } from '../shared/date-utils';

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

/**
 * Without these, an exception thrown outside a request/response cycle — a
 * `setInterval` in the notification engine, a stray promise rejection in the
 * updater — takes the whole main process down and the window with it.
 * Log it and keep running; the renderer stays alive and the user keeps working.
 */
process.on('uncaughtException', (err, origin) => {
  console.error(`[main] uncaughtException (${origin}):`, err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

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

/**
 * True only for URLs the app itself serves: the Vite dev server in development,
 * or a file:// path inside the packaged renderer output.
 */
function isInternalUrl(target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      if (url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin) return true;
    } catch { /* malformed dev server URL — fall through */ }
  }

  if (url.protocol === 'file:') {
    const appRoot = path.resolve(__dirname, '..');
    const filePath = path.resolve(decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:)/, '$1'));
    return filePath.toLowerCase().startsWith(appRoot.toLowerCase());
  }

  return false;
}

/**
 * Every window ships the preload bridge, so letting it navigate anywhere would
 * hand `window.api` (SQLite, filesystem, sync credentials) to a third-party page.
 * Deny `window.open` outright and refuse any navigation off our own origin;
 * genuine external links open in the user's browser instead.
 */
function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !isInternalUrl(url)) {
      shell.openExternal(url).catch((err) => console.error('[security] openExternal failed:', err));
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    console.warn('[security] blocked navigation to', url);
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch((err) => console.error('[security] openExternal failed:', err));
    }
  });

  win.webContents.on('will-redirect', (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    console.warn('[security] blocked redirect to', url);
  });
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

  hardenWindow(mainWindow);

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

  hardenWindow(cauldronWindow);

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
  setDbFactory(openDesktopDb);
  setPlatform(electronPlatform);
  setEventSink(webContentsSink);

  // Create the window FIRST so the renderer starts loading while the main
  // process is still busy. Everything below runs in the same synchronous tick,
  // so no IPC call can be serviced before its handler is registered.
  createWindow();

  // Desktop-only handlers go through the same registry; they MUST be registered
  // before registerAllIpcHandlers(), which is what binds the registry to ipcMain.
  registerUpdaterIpcHandlers();
  ipcHandle('cauldron:openWindow', () => createCauldronWindow());
  ipcHandle('cauldron:closeWindow', () => {
    if (cauldronWindow && !cauldronWindow.isDestroyed()) {
      cauldronWindow.close();
    }
  });

  registerAllIpcHandlers();

  // Run module migrations
  getDb();
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);
  runModuleMigrations(notificationsMigrations);
  runModuleMigrations(cauldronMigrations);

  // Auto-generate recurring transactions for current month.
  // Shares the exact implementation used by `finance:generateRecurringForMonth`,
  // so billing_day, deterministic ids and soft-delete awareness cannot drift.
  try {
    // Local month, not UTC: on the last day of the month after 21:00 ART this
    // wrote NEXT month's rent and subscriptions a day early, and never generated
    // the month the user was actually looking at.
    const currentMonth = todayDateString().slice(0, 7); // YYYY-MM
    const generated = generateRecurringForMonth(getDb(), currentMonth);
    if (generated > 0) {
      console.log(`[bootstrap] generated ${generated} recurring transaction(s) for ${currentMonth}`);
    }
  } catch (e) {
    console.error(`[bootstrap] failed to generate recurring transactions for ${new Date().toISOString().slice(0, 7)}:`, e);
  }

  createTray();

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
