import { ipcMain, net } from 'electron';
import { getDb } from '../ipc/db';

const DOLLAR_API = 'https://dolarapi.com/v1/dolares';

interface DollarRate {
  nombre: string;
  compra: number;
  venta: number;
  fechaActualizacion: string;
}

export function registerDollarIpcHandlers(): void {
  ipcMain.handle('dollar:getRates', async () => {
    try {
      // Try to fetch fresh rates
      const response = await fetch(DOLLAR_API);
      if (response.ok) {
        const data = await response.json() as DollarRate[];
        // Cache in SQLite
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO dollar_cache (id, data, updated_at)
          VALUES ('rates', ?, datetime('now'))
        `).run(JSON.stringify(data));
        return { success: true, rates: data, cached: false };
      }
    } catch {
      // Offline — try cache
    }

    // Fallback to cache
    try {
      const db = getDb();
      const row = db.prepare('SELECT data, updated_at FROM dollar_cache WHERE id = ?').get('rates') as { data: string; updated_at: string } | undefined;
      if (row) {
        return { success: true, rates: JSON.parse(row.data), cached: true, cachedAt: row.updated_at };
      }
    } catch { /* no cache */ }

    return { success: false, error: 'No rates available' };
  });
}
