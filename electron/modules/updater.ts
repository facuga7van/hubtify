import { BrowserWindow, app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const REPO = 'facuga7van/hubtify-releases';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Abort the installer download if no bytes arrive for this long. */
const STALL_TIMEOUT_MS = 60_000;

let mainWindow: BrowserWindow | null = null;

interface ReleaseInfo {
  version: string;
  setupUrl: string;
}

function sendError(message: string): void {
  mainWindow?.webContents.send('updater:error', { message });
}

function cleanupOldInstallers(): void {
  try {
    const tempDir = app.getPath('temp');
    const entries = fs.readdirSync(tempDir);
    for (const entry of entries) {
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

async function getLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { 'User-Agent': 'Hubtify' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    const version = data.tag_name.replace(/^v/, '');
    const setupAsset = data.assets.find(a => a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe'));
    if (!setupAsset) return null;
    return { version, setupUrl: setupAsset.browser_download_url };
  } catch {
    return null;
  }
}

function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;

  cleanupOldInstallers();

  if (app.isPackaged) {
    // Wait for React to mount and register IPC listeners before sending.
    // did-finish-load fires when HTML is parsed but BEFORE React mounts.
    // A 3s delay ensures useEffect listeners are registered.
    const check = () => {
      getLatestRelease().then(release => {
        if (release && isNewer(release.version, app.getVersion())) {
          mainWindow?.webContents.send('updater:update-available', {
            version: release.version,
          });
        }
      }).catch(() => { /* silent */ });
    };

    setTimeout(check, 3000);
  }
}

export function registerUpdaterIpcHandlers(): void {
  ipcHandle('updater:check', async () => {
    const release = await getLatestRelease();
    if (release && isNewer(release.version, app.getVersion())) {
      return { available: true, version: release.version };
    }
    return { available: false };
  });

  ipcHandle('updater:download', async () => {
    const release = await getLatestRelease();
    if (!release) throw new Error('No release found');

    const installerPath = path.join(app.getPath('temp'), `Hubtify-${release.version}-Setup.exe`);

    // AbortSignal.timeout() only covers the response HEADERS. The body was then read
    // in an unbounded `while (true) { await reader.read() }`: a socket that stalled
    // mid-download left that promise pending forever, so the catch that resets the
    // UI to idle never ran and the user was stuck on a modal with no buttons.
    // This controller aborts on INACTIVITY — no bytes for STALL_TIMEOUT_MS.
    const controller = new AbortController();
    let stallTimer: NodeJS.Timeout | null = null;
    let stalled = false;
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STALL_TIMEOUT_MS);
    };
    const disarmStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };

    armStallTimer();
    let res: Response;
    try {
      res = await fetch(release.setupUrl, { signal: controller.signal });
    } catch (err) {
      disarmStallTimer();
      const msg = stalled ? 'Download timed out' : `Download failed: ${(err as Error).message}`;
      sendError(msg);
      throw new Error(msg);
    }

    if (!res.ok) {
      disarmStallTimer();
      const msg = `Download failed (HTTP ${res.status})`;
      sendError(msg);
      throw new Error(msg);
    }

    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      disarmStallTimer();
      const msg = 'No response body';
      sendError(msg);
      throw new Error(msg);
    }

    // Stream to disk instead of accumulating the whole installer in memory
    // (`chunks: Uint8Array[]` + Buffer.concat held ~2x the .exe in RAM).
    const out = fs.createWriteStream(installerPath);
    let downloaded = 0;
    let lastPercent = -1;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armStallTimer();
        if (!out.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => out.once('drain', resolve));
        }
        downloaded += value.length;
        if (total > 0) {
          const percent = Math.round((downloaded / total) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            mainWindow?.webContents.send('updater:download-progress', { percent });
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on('error', reject);
      });
    } catch (err) {
      out.destroy();
      try { fs.unlinkSync(installerPath); } catch { /* nothing to clean */ }
      const msg = stalled
        ? `Download stalled (no data for ${STALL_TIMEOUT_MS / 1000}s)`
        : `Download failed: ${(err as Error).message}`;
      sendError(msg);
      throw new Error(msg);
    } finally {
      disarmStallTimer();
    }

    // Validate downloaded file
    if (!fs.existsSync(installerPath)) {
      const msg = 'Installer file was not written';
      sendError(msg);
      throw new Error(msg);
    }
    const fileSize = fs.statSync(installerPath).size;
    if (fileSize === 0) {
      fs.unlinkSync(installerPath);
      const msg = 'Downloaded installer is empty';
      sendError(msg);
      throw new Error(msg);
    }
    if (total > 0 && fileSize !== total) {
      fs.unlinkSync(installerPath);
      const msg = `Installer size mismatch (expected ${total}, got ${fileSize})`;
      sendError(msg);
      throw new Error(msg);
    }

    // Auto-install: launch installer then quit
    try {
      const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
      child.on('error', (err) => {
        sendError(`Failed to launch installer: ${err.message}`);
      });
      setTimeout(() => app.quit(), 1000);
    } catch (err) {
      const msg = `Failed to launch installer: ${(err as Error).message}`;
      sendError(msg);
      throw new Error(msg);
    }

    return installerPath;
  });
}
