import { ipcMain } from 'electron';
import { getDb } from '../ipc/db';

export interface CharacterData {
  backHairIndex: number;
  frontColorIndex: number;
  backColorIndex: number;
  frontHairIndex: number;
}

export function registerCharacterIpcHandlers(): void {
  // Save character data locally (SQLite)
  ipcMain.handle('character:save', (_e, data: CharacterData) => {
    const db = getDb();
    const json = JSON.stringify(data);
    db.prepare(`
      INSERT OR REPLACE INTO character_data (id, data, updated_at)
      VALUES ('default', ?, datetime('now'))
    `).run(json);
  });

  // Load character data locally
  ipcMain.handle('character:load', () => {
    const db = getDb();
    const row = db.prepare('SELECT data FROM character_data WHERE id = ?').get('default') as { data: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
  });
}
