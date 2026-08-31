import { dialog, app } from 'electron';
import { getDb } from '../ipc/db';
import { ipcHandle } from '../ipc/ipc-handle';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export function registerBackupIpcHandlers(): void {
  ipcHandle('backup:export', async () => {
    try {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export Backup',
        defaultPath: `hubtify-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'Zip Files', extensions: ['zip'] }],
      });

      if (canceled || !filePath) return { success: false, canceled: true };

      const dbPath = path.join(app.getPath('userData'), 'hubtify.db');
      if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' };

      // The connection is open with journal_mode = WAL, so everything written since
      // the last checkpoint lives in hubtify.db-wal — which is NOT part of the zip.
      // Copying hubtify.db directly produced a silently stale backup.
      // db.backup() writes a consistent, fully-checkpointed single-file snapshot.
      const db = getDb();
      const snapshotPath = path.join(app.getPath('temp'), `hubtify-backup-${Date.now()}.db`);
      await db.backup(snapshotPath);

      try {
        const zip = new AdmZip();
        // Keep the entry named hubtify.db — backup:import looks it up by that name.
        zip.addLocalFile(snapshotPath, '', 'hubtify.db');

        // Also export character data from localStorage via a temp file
        const charData = db.prepare('SELECT data FROM character_data WHERE id = ?').get('default');
        if (charData) {
          zip.addFile('character.json', Buffer.from(JSON.stringify(charData)));
        }

        zip.writeZip(filePath);
      } finally {
        try { fs.unlinkSync(snapshotPath); } catch { /* temp file cleanup is best effort */ }
      }
      return { success: true, path: filePath };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Export failed' };
    }
  });

  /**
   * Solo abre el selector y devuelve la ruta.
   *
   * Antes `backup:import` elegia el archivo Y lo importaba en una sola llamada, asi
   * que la confirmacion tenia que ir ANTES de elegir: la app te preguntaba si
   * querias pisar tus datos y recien despues te mostraba el selector. Separado en
   * dos pasos, el renderer puede confirmar con el nombre del archivo ya a la vista.
   */
  ipcHandle('backup:pickImportFile', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Backup',
      filters: [{ name: 'Zip Files', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: filePaths[0], name: path.basename(filePaths[0]) };
  });

  ipcHandle('backup:import', async (_e, providedPath?: string) => {
    try {
      let zipPath = providedPath;
      if (!zipPath) {
        // Compatibilidad: sin ruta, se comporta como antes.
        const { filePaths, canceled } = await dialog.showOpenDialog({
          title: 'Import Backup',
          filters: [{ name: 'Zip Files', extensions: ['zip'] }],
          properties: ['openFile'],
        });
        if (canceled || filePaths.length === 0) return { success: false, canceled: true };
        zipPath = filePaths[0];
      }
      if (!fs.existsSync(zipPath)) return { success: false, error: 'Backup file not found' };

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
