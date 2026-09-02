import { getDb } from '../db';
import { registerHandler as ipcHandle } from '../registry';

const COINGECKO_API =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1';

const DEFAULT_VISIBLE = [
  'bitcoin',
  'ethereum',
  'tether',
  'binancecoin',
  'solana',
  'ripple',
  'dogecoin',
  'cardano',
  'avalanche-2',
  'polkadot',
];

export function registerCryptoIpcHandlers(): void {
  ipcHandle('crypto:getRates', async () => {
    try {
      const response = await fetch(COINGECKO_API);
      if (response.ok) {
        const data = await response.json();
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO crypto_cache (id, data, updated_at)
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
      const row = db.prepare('SELECT data, updated_at FROM crypto_cache WHERE id = ?').get('rates') as
        | { data: string; updated_at: string }
        | undefined;
      if (row) {
        return { success: true, rates: JSON.parse(row.data), cached: true, cachedAt: row.updated_at };
      }
    } catch {
      /* no cache */
    }

    return { success: false, error: 'No crypto rates available' };
  });

  ipcHandle('crypto:getVisibleTypes', () => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM app_state WHERE key = 'crypto_visible_types'")
      .get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as string[]) : DEFAULT_VISIBLE;
  });

  ipcHandle('crypto:setVisibleTypes', (_e, types: string[]) => {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('crypto_visible_types', ?)").run(
      JSON.stringify(types),
    );
  });
}
