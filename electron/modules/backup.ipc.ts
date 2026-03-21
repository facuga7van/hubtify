import { ipcMain, dialog, app } from 'electron';
import { getDb } from '../ipc/db';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export function registerBackupIpcHandlers(): void {
  ipcMain.handle('backup:export', async () => {
    try {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export Backup',
        defaultPath: `hubtify-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'Zip Files', extensions: ['zip'] }],
      });

      if (canceled || !filePath) return { success: false, canceled: true };

      const dbPath = path.join(app.getPath('userData'), 'hubtify.db');
      if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' };

      const zip = new AdmZip();
      zip.addLocalFile(dbPath);

      // Also export character data from localStorage via a temp file
      const charData = getDb().prepare('SELECT data FROM character_data WHERE id = ?').get('default');
      if (charData) {
        zip.addFile('character.json', Buffer.from(JSON.stringify(charData)));
      }

      zip.writeZip(filePath);
      return { success: true, path: filePath };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Export failed' };
    }
  });

  ipcMain.handle('backup:import', async () => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Import Backup',
        filters: [{ name: 'Zip Files', extensions: ['zip'] }],
        properties: ['openFile'],
      });

      if (canceled || filePaths.length === 0) return { success: false, canceled: true };

      const zipPath = filePaths[0];
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      const dbEntry = entries.find((e) => e.entryName === 'hubtify.db');
      if (!dbEntry) return { success: false, error: 'Invalid backup: hubtify.db not found' };

      // Close current DB before replacing
      const { closeDb } = require('../ipc/db');
      closeDb();

      const dbPath = path.join(app.getPath('userData'), 'hubtify.db');

      // Backup current DB first
      const backupPath = dbPath + '.bak';
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
      }

      // Extract new DB
      zip.extractEntryTo(dbEntry, path.dirname(dbPath), false, true);

      return { success: true };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Import failed' };
    }
  });
}
