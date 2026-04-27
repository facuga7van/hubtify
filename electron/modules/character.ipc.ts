import { getDb } from '../ipc/db';
import { ipcHandle } from '../ipc/ipc-handle';

export interface CharacterData {
  backHairIndex: number;
  frontColorIndex: number;
  backColorIndex: number;
  frontHairIndex: number;
}

export function registerCharacterIpcHandlers(): void {
  // Save character data locally (SQLite)
  ipcHandle('character:save', (_e, data: CharacterData) => {
    const db = getDb();
    const json = JSON.stringify(data);
    db.prepare(`
      INSERT OR REPLACE INTO character_data (id, data, updated_at)
      VALUES ('default', ?, datetime('now'))
    `).run(json);
  });

  // Load character data locally
  ipcHandle('character:load', () => {
    const db = getDb();
    const row = db.prepare('SELECT data FROM character_data WHERE id = ?').get('default') as { data: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
  });

  // Character name
  ipcHandle('character:getName', () => {
    const db = getDb();
    const row = db.prepare('SELECT character_name FROM user_profile LIMIT 1').get() as { character_name: string | null } | undefined;
    return row?.character_name ?? null;
  });

  ipcHandle('character:setName', (_e, name: string) => {
    const db = getDb();
    db.prepare('UPDATE user_profile SET character_name = ?').run(name);
  });

  // Username
  ipcHandle('character:getUsername', () => {
    const db = getDb();
    const row = db.prepare('SELECT username FROM user_profile LIMIT 1').get() as { username: string | null } | undefined;
    return row?.username ?? null;
  });

  ipcHandle('character:setUsername', (_e, username: string) => {
    const db = getDb();
    db.prepare('UPDATE user_profile SET username = ?').run(username);
  });
}
