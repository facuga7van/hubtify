import { app, BrowserWindow, dialog, Notification, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import type { FileFilter, PlatformPort } from '../shared-logic/platform';

/**
 * Desktop PlatformPort. Everything that used to be inlined in the handlers
 * (dialog + fs in finance.ipc/finance-import.ipc, Notification in
 * notifications.ipc/cauldron.ipc, app/os in feedback.ipc/syl.ipc) lives here.
 */

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Same `win!` the old handlers passed: Electron accepts a null parent. */
function ownerWindow(): BrowserWindow {
  return BrowserWindow.getFocusedWindow()!;
}

function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function filtersFor(defaultName: string): FileFilter[] {
  const ext = defaultName.includes('.') ? defaultName.split('.').pop()! : '';
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
}

export const electronPlatform: PlatformPort = {
  appVersion: () => app.getVersion(),

  osInfo: () => `${process.platform} ${os.release()}`,

  async notify({ title, body }) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', focusMainWindow);
    n.show();
  },

  async openExternal(url) {
    await shell.openExternal(url);
  },

  async pickTextFile(filters) {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), { filters, properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return null;
    return { name: baseName(filePaths[0]), content: fs.readFileSync(filePaths[0], 'utf-8') };
  },

  async pickPdfText() {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), {
      title: 'Seleccionar PDF de resumen',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const buffer = fs.readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    await parser.load();
    const data = await parser.getText();
    return { name: baseName(filePath) || 'unknown.pdf', text: data.text };
  },

  async pickBinaryFile(filters) {
    const { filePaths, canceled } = await dialog.showOpenDialog(ownerWindow(), { filters, properties: ['openFile'] });
    if (canceled || filePaths.length === 0) return null;
    return { name: baseName(filePaths[0]), bytes: new Uint8Array(fs.readFileSync(filePaths[0])) };
  },

  async saveTextFile(defaultName, content) {
    const { filePath, canceled } = await dialog.showSaveDialog(ownerWindow(), {
      defaultPath: defaultName,
      filters: filtersFor(defaultName),
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  },

  async saveBinaryFile(defaultName, bytes) {
    const { filePath, canceled } = await dialog.showSaveDialog(ownerWindow(), {
      defaultPath: defaultName,
      filters: filtersFor(defaultName),
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, bytes);
    return true;
  },
};

/**
 * Event sink: main → every renderer window. Replaces the `broadcast()` helpers
 * of rpg-handlers/cauldron.ipc and the `webContents.send` loops of
 * notifications.ipc. Sending with no payload keeps the exact old wire shape.
 */
export function webContentsSink(channel: string, payload?: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (payload === undefined) win.webContents.send(channel);
      else win.webContents.send(channel, payload);
    }
  } catch { /* headless, or a window mid-teardown */ }
}
