import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import {
  processRpgEvent,
  getObolosBalance,
  grantObolos,
  getShopCatalog,
  getShopEquipped,
  purchaseShopItem,
  equipShopItem,
} from '../../shared-logic/modules/rpg-handlers';
import { purchasedPardonExtras } from '../../shared-logic/modules/rpg-stats';
import { monthKey, pardonsRemaining, PARDONS_PER_MONTH } from '../../shared/rpg-engine';
import { SHOP_CATALOG, SHOP_CATALOG_BY_ID, PARDON_ITEM_ID } from '../../shared/shop-catalog';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  return db;
}

function dateAgo(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
}

const TODAY = dateAgo(0);
const MONTH = monthKey(TODAY);

function fund(db: Database.Database, amount: number): void {
  grantObolos(db, 'day_sealed', `funding-${Math.random()}`, amount);
}

function spendRows(db: Database.Database) {
  return db.prepare(
    "SELECT id, delta, ref_id AS refId FROM obolos_ledger WHERE reason = 'shop_purchase' ORDER BY created_at ASC"
  ).all() as Array<{ id: string; delta: number; refId: string | null }>;
}

describe('shop catalogue invariants', () => {
  it('sells nothing that exists in the avatar picker — only the four new kinds', () => {
    // Rule 1 of the brief: existing avatar combos stay free forever. The
    // catalogue can only carry the NEW surfaces.
    for (const item of SHOP_CATALOG) {
      expect(['seal_style', 'pardon', 'frame', 'background']).toContain(item.kind);
      expect(item.cost).toBeGreaterThan(0);
      expect(item.i18nKey).toBe(`rpg.shop.items.${item.id}`);
    }
    // Exactly one consumable, and ids are unique.
    expect(SHOP_CATALOG.filter((i) => i.kind === 'pardon').map((i) => i.id)).toEqual([PARDON_ITEM_ID]);
    expect(new Set(SHOP_CATALOG.map((i) => i.id)).size).toBe(SHOP_CATALOG.length);
  });
});

describe('rpg:purchaseShopItem', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('buys an item: purchase row + ledger spend in one go', () => {
    fund(db, 500);
    const res = purchaseShopItem(db, 'seal_stag', TODAY);
    expect(res).toEqual({ ok: true, balance: 500 - SHOP_CATALOG_BY_ID.get('seal_stag')!.cost });

    // Deterministic row ids, so cross-device unions dedupe double purchases.
    const purchase = db.prepare('SELECT id, item_id AS itemId FROM shop_purchases').get() as
      { id: string; itemId: string };
    expect(purchase).toEqual({ id: 'seal_stag', itemId: 'seal_stag' });

    const spends = spendRows(db);
    expect(spends).toHaveLength(1);
    expect(spends[0]).toMatchObject({ id: 'shop:seal_stag', delta: -80, refId: 'seal_stag' });
    expect(getObolosBalance(db).spent).toBe(80);
  });

  it('a non-consumable is bought ONCE — the second attempt writes nothing', () => {
    fund(db, 1000);
    expect(purchaseShopItem(db, 'frame_gilded', TODAY).ok).toBe(true);
    expect(purchaseShopItem(db, 'frame_gilded', TODAY)).toEqual({ ok: false, reason: 'already_owned' });

    expect(db.prepare('SELECT COUNT(*) AS c FROM shop_purchases').get()).toEqual({ c: 1 });
    expect(spendRows(db)).toHaveLength(1);
  });

  it('refuses to spend beyond the balance, without writing anything', () => {
    fund(db, 50);
    expect(purchaseShopItem(db, 'seal_sun', TODAY)).toEqual({ ok: false, reason: 'insufficient' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM shop_purchases').get()).toEqual({ c: 0 });
    expect(spendRows(db)).toHaveLength(0);
    expect(getObolosBalance(db).balance).toBe(50);
  });

  it('returns not_found for ids the catalogue does not carry', () => {
    fund(db, 1000);
    expect(purchaseShopItem(db, 'seal_of_doom', TODAY)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('caps the pardon at one purchase per calendar month', () => {
    fund(db, 1000);
    expect(purchaseShopItem(db, PARDON_ITEM_ID, TODAY).ok).toBe(true);
    expect(purchaseShopItem(db, PARDON_ITEM_ID, TODAY)).toEqual({ ok: false, reason: 'monthly_cap' });

    // One row, keyed by month, one charge.
    const purchase = db.prepare('SELECT id FROM shop_purchases').get() as { id: string };
    expect(purchase.id).toBe(`${PARDON_ITEM_ID}:${MONTH}`);
    expect(spendRows(db)).toHaveLength(1);
    expect(purchasedPardonExtras(db, MONTH)).toBe(1);
  });
});

describe('the bought pardon extends the month, without breaking the counter', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('pardonsRemaining folds the extra into the same arithmetic', () => {
    expect(pardonsRemaining(MONTH, PARDONS_PER_MONTH, MONTH)).toBe(0);
    expect(pardonsRemaining(MONTH, PARDONS_PER_MONTH, MONTH, 1)).toBe(1);
    expect(pardonsRemaining(MONTH, PARDONS_PER_MONTH + 1, MONTH, 1)).toBe(0);
    // Other months roll fresh; the extra applies to the month asked about.
    expect(pardonsRemaining('2020-01', 5, MONTH, 1)).toBe(PARDONS_PER_MONTH + 1);
  });

  it('saves a streak the two automatic pardons could no longer save', () => {
    const run = (withPurchase: boolean) => {
      const d = setupDb();
      // Streak of 5, last acted two days ago, both automatic pardons burnt.
      d.prepare(`
        UPDATE player_stats SET streak = 5, streak_last_date = ?, pardons_month = ?, pardons_used = ?
        WHERE user_id = 'default'
      `).run(dateAgo(2), MONTH, PARDONS_PER_MONTH);
      if (withPurchase) {
        fund(d, 500);
        expect(purchaseShopItem(d, PARDON_ITEM_ID, TODAY).ok).toBe(true);
      }
      const result = processRpgEvent(d, {
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now(),
      });
      const stats = d.prepare("SELECT streak, pardons_used AS used FROM player_stats WHERE user_id = 'default'").get() as
        { streak: number; used: number };
      return { result, stats };
    };

    // Without the bought pardon: the gap breaks the streak.
    const bare = run(false);
    expect(bare.result.pardonUsed).toBe(false);
    expect(bare.stats.streak).toBe(1);

    // With it: the streak continues, and the SAME used-counter ticks to 3.
    const bought = run(true);
    expect(bought.result.pardonUsed).toBe(true);
    expect(bought.stats.streak).toBe(6);
    expect(bought.stats.used).toBe(PARDONS_PER_MONTH + 1);
  });
});

describe('rpg:equipShopItem + rpg:getShopCatalog', () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it('refuses to equip what was never bought', () => {
    expect(equipShopItem(db, 'seal_oak')).toEqual({ ok: false, reason: 'not_owned' });
    expect(equipShopItem(db, 'nope')).toEqual({ ok: false, reason: 'not_found' });
    expect(getShopEquipped(db)).toEqual({ sealStyle: null, frame: null, background: null });
  });

  it('the pardon is a consumable, not an outfit', () => {
    fund(db, 500);
    purchaseShopItem(db, PARDON_ITEM_ID, TODAY);
    expect(equipShopItem(db, PARDON_ITEM_ID)).toEqual({ ok: false, reason: 'not_equippable' });
  });

  it('equips per kind, one at a time, and unequips back to the default', () => {
    fund(db, 1000);
    purchaseShopItem(db, 'seal_oak', TODAY);
    purchaseShopItem(db, 'seal_sun', TODAY);
    purchaseShopItem(db, 'frame_laurel', TODAY);

    expect(equipShopItem(db, 'seal_oak')).toMatchObject({ ok: true });
    expect(equipShopItem(db, 'frame_laurel')).toMatchObject({ ok: true });
    expect(getShopEquipped(db)).toEqual({ sealStyle: 'seal_oak', frame: 'frame_laurel', background: null });

    // A second seal replaces the first — one matrix per kind.
    equipShopItem(db, 'seal_sun');
    expect(getShopEquipped(db).sealStyle).toBe('seal_sun');

    // null + kind = back to the default look; other kinds untouched.
    expect(equipShopItem(db, null, 'seal_style')).toMatchObject({ ok: true });
    expect(getShopEquipped(db)).toEqual({ sealStyle: null, frame: 'frame_laurel', background: null });
    // Unequipping with no kind cannot guess.
    expect(equipShopItem(db, null)).toEqual({ ok: false, reason: 'not_equippable' });
  });

  it('the catalogue read reports owned / equipped / balance in one pass', () => {
    fund(db, 300);
    purchaseShopItem(db, 'seal_stag', TODAY);
    equipShopItem(db, 'seal_stag');

    const cat = getShopCatalog(db, TODAY);
    expect(cat.balance).toBe(300 - 80);
    expect(cat.equipped.sealStyle).toBe('seal_stag');
    expect(cat.items).toHaveLength(SHOP_CATALOG.length);

    const stag = cat.items.find((i) => i.id === 'seal_stag')!;
    expect(stag).toMatchObject({ owned: true, equipped: true });
    const tower = cat.items.find((i) => i.id === 'seal_tower')!;
    expect(tower).toMatchObject({ owned: false, equipped: false, purchasedAt: null });
    // The pardon reads as not owned while this month has no purchase.
    expect(cat.items.find((i) => i.id === PARDON_ITEM_ID)).toMatchObject({ owned: false });
  });
});
