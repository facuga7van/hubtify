import { getDb } from '../ipc/db';
import { ipcHandle } from '../ipc/ipc-handle';
import {
  DOLLAR_API_URL,
  getCurrentRate,
  getFxHouse,
  readDollarRatesCache,
  setFxHouse,
  writeDollarRatesCache,
  type DollarApiRate,
} from './finance.balance';

export function registerDollarIpcHandlers(): void {
  ipcHandle('dollar:getRates', async () => {
    try {
      // Try to fetch fresh rates
      const response = await fetch(DOLLAR_API_URL);
      if (response.ok) {
        const data = await response.json() as DollarApiRate[];
        // Cache in SQLite (same row getCurrentRate reads — one cache, two readers)
        writeDollarRatesCache(getDb(), data);
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

  const DEFAULT_VISIBLE = ['oficial', 'blue', 'bolsa', 'cripto', 'tarjeta'];

  ipcHandle('dollar:getVisibleTypes', () => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'dollar_visible_types'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as string[] : DEFAULT_VISIBLE;
  });

  ipcHandle('dollar:setVisibleTypes', (_e, types: string[]) => {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('dollar_visible_types', ?)").run(JSON.stringify(types));
  });

  // ── Frozen-rate support (cotización congelada) ─────────────

  /** Casa whose venta rate gets frozen on every new transaction. */
  ipcHandle('dollar:getFxHouse', () => getFxHouse(getDb()));

  ipcHandle('dollar:setFxHouse', (_e, house: string) => setFxHouse(getDb(), house));

  /**
   * Best venta rate available right now for a house (default: the preferred
   * one): cache if younger than 1h, otherwise fetch-and-cache, otherwise the
   * stale cache. `rate: null` = offline with an empty cache.
   */
  ipcHandle('dollar:getCurrentRate', async (_e, house?: string) => {
    const db = getDb();
    const casa = typeof house === 'string' && house.trim() !== '' ? house.trim() : getFxHouse(db);
    const rate = await getCurrentRate(db, casa);
    const cached = readDollarRatesCache(db);
    return { rate, house: casa, cachedAt: cached?.updatedAt ?? null };
  });
}
