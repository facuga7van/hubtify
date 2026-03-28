import { BrowserWindow, app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

const REPO = 'facuga7van/hubtify';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

let mainWindow: BrowserWindow | null = null;

interface ReleaseInfo {
  version: string;
  setupUrl: string;
}

async function getLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { 'User-Agent': 'Hubtify' },
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

  if (app.isPackaged) {
    getLatestRelease().then(release => {
      if (release && isNewer(release.version, app.getVersion())) {
        mainWindow?.webContents.send('updater:update-available', {
          version: release.version,
        });
      }
    }).catch(() => {});
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
    const res = await fetch(release.setupUrl);
    if (!res.ok) throw new Error('Download failed');

    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

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
    mainWindow?.webContents.send('updater:update-downloaded');

    return installerPath;
  });

  ipcHandle('updater:install', (_e, installerPath: string) => {
    // Run the installer and quit
    execFile(installerPath, { detached: true, stdio: 'ignore' } as any);
    app.quit();
  });
}
