import { BrowserWindow, app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Updates go through Squirrel's own Update.exe against a feed served by
// update.electronjs.org (free for public repos). This applies delta packages
// and fires --squirrel-updated, so our shortcut handler (main.ts) runs with
// --updateOnly — existing shortcuts are re-pointed, deleted/pinned ones left
// untouched. Update.exe also prints download progress to stdout, which we parse
// to keep the renderer's progress bar working.
const REPO = 'facuga7van/hubtify-releases';

let mainWindow: BrowserWindow | null = null;

function sendError(message: string): void {
  mainWindow?.webContents.send('updater:error', { message });
}

// Squirrel installs Update.exe one level above the app executable.
function updateExePath(): string {
  return path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
}

function feedUrl(): string {
  return `https://update.electronjs.org/${REPO}/win32/${app.getVersion()}`;
}

// Squirrel updates only exist in the packaged Windows app.
function canUpdate(): boolean {
  return app.isPackaged && process.platform === 'win32';
}

// Spawn Update.exe, accumulate stdout, and forward any plain "0-100" progress
// lines (Squirrel prints these during download) to onProgress.
function runUpdate(args: string[], onProgress?: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(updateExePath(), args);
    } catch (err) {
      reject(err as Error);
      return;
    }

    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (!onProgress) return;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        // Treat a line that is exactly an integer 0-100 as a progress tick
        if (/^\d{1,3}$/.test(trimmed)) {
          const pct = Number(trimmed);
          if (pct >= 0 && pct <= 100) onProgress(pct);
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Update.exe exited with code ${code ?? 'null'}`));
    });
  });
}

// Update.exe prints its JSON result as the last line of stdout (same parsing as
// Electron's own autoUpdater). The newest release is the last entry of
// releasesToApply, and its `version` field holds the target version string.
function parseReleasesToApply(stdout: string): Array<{ version?: string }> {
  const lastLine = stdout.trim().split('\n').pop()?.trim();
  if (!lastLine) return [];
  try {
    const json = JSON.parse(lastLine) as { releasesToApply?: Array<{ version?: string }> };
    return Array.isArray(json?.releasesToApply) ? json.releasesToApply : [];
  } catch {
    return [];
  }
}

async function checkForUpdate(): Promise<{ available: boolean; version?: string }> {
  if (!canUpdate()) return { available: false };
  try {
    const stdout = await runUpdate([`--checkForUpdate=${feedUrl()}`]);
    const releases = parseReleasesToApply(stdout);
    if (releases.length > 0) {
      return { available: true, version: releases[releases.length - 1]?.version };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;
  if (!canUpdate()) return;

  // Delay so the renderer registers its update listeners before we notify.
  // did-finish-load fires before React mounts; 3s ensures useEffect ran.
  setTimeout(() => {
    checkForUpdate()
      .then((res) => {
        if (res.available) {
          mainWindow?.webContents.send('updater:update-available', { version: res.version ?? '' });
        }
      })
      .catch(() => { /* silent — update check is non-critical */ });
  }, 3000);
}


/**
 * Versions up to 0.7.5 downloaded the installer by hand into temp; the native
 * Squirrel flow no longer does, but those files are still sitting there on any
 * machine that updated the old way. One-time hygiene sweep, never blocking.
 */
function cleanupOldInstallers(): void {
  try {
    const tempDir = app.getPath('temp');
    for (const entry of fs.readdirSync(tempDir)) {
      if (/^Hubtify-.*-Setup\.exe$/i.test(entry)) {
        try {
          fs.unlinkSync(path.join(tempDir, entry));
        } catch {
          // File may be in use — ignore
        }
      }
    }
  } catch {
    // Never block startup
  }
}

export function registerUpdaterIpcHandlers(): void {
  cleanupOldInstallers();
  ipcHandle('updater:check', async () => checkForUpdate());

  ipcHandle('updater:download', async () => {
    if (!canUpdate()) {
      throw new Error('Updates are only available in the packaged Windows app');
    }

    try {
      // --update downloads (reporting progress on stdout) AND stages the new
      // version, firing --squirrel-updated so the shortcut handler runs.
      await runUpdate([`--update=${feedUrl()}`], (percent) => {
        mainWindow?.webContents.send('updater:download-progress', { percent });
      });
    } catch (err) {
      const msg = `Update failed: ${(err as Error).message}`;
      sendError(msg);
      throw new Error(msg);
    }

    // Update staged into a new app-x.y.z folder. Tell the renderer it's ready
    // and let the user choose when to restart (updater:restart) — otherwise the
    // new version simply takes effect on the next manual launch.
    mainWindow?.webContents.send('updater:update-downloaded');
    return 'downloaded';
  });

  ipcHandle('updater:restart', async () => {
    if (!canUpdate()) return;
    // Relaunch the freshly-staged version. --processStartAndWait makes Update.exe
    // WAIT for this (old) instance to exit — and release the single-instance lock —
    // before starting the new one, so the new instance isn't killed by the lock.
    try {
      const exeName = path.basename(process.execPath);
      spawn(updateExePath(), [`--processStartAndWait=${exeName}`], { detached: true }).unref();
    } catch {
      // Relaunch failed — the update is applied; user can reopen manually.
    }
    setTimeout(() => app.quit(), 500);
  });
}
