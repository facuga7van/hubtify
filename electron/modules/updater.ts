import { BrowserWindow, app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const REPO = 'facuga7van/hubtify';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

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
    getLatestRelease().then(release => {
      if (release && isNewer(release.version, app.getVersion())) {
        mainWindow?.webContents.send('updater:update-available', {
          version: release.version,
        });
      }
    }).catch((err) => console.error('[Updater] Failed to check for updates:', err.message));
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

    // Download the setup exe
    const res = await fetch(release.setupUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const msg = `Download failed (HTTP ${res.status})`;
      sendError(msg);
      throw new Error(msg);
    }

    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const msg = 'No response body';
      sendError(msg);
      throw new Error(msg);
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.length;
      if (total > 0) {
        const percent = Math.round((downloaded / total) * 100);
        mainWindow?.webContents.send('updater:download-progress', { percent });
      }
    }

    fs.writeFileSync(installerPath, Buffer.concat(chunks));

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
