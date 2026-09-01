/**
 * La Tienda — the DECLARATIVE catalogue of what óbolos can buy.
 *
 * Design rules (phase 4 brief; Riot 2026 / Habitica / Duolingo research):
 *
 *  1. EVERYTHING THE AVATAR ALREADY HAD STAYS FREE, FOREVER. The 237.600
 *     existing picker combos are untouched and untouchable: nothing in this
 *     file may reference an item that exists today in the character picker.
 *     The shop sells only NEW things — seal-matrix variants for the Códice,
 *     one extra streak pardon per month, and frames/backgrounds for the
 *     hero card. Zero exceptions.
 *  2. NOTHING VALUABLE HIDES BEHIND THE STREAK. Every item is bought with
 *     óbolos (earned by sealing days and unlocking achievements), never
 *     gated by streak length.
 *  3. ART IS THE BOTTLENECK, NOT CODE. Cosmetics are SVG/CSS drawn in the
 *     project's own visual language (24×24 grid, 1.2 stroke, wax-and-
 *     parchment vocabulary) — never PixiJS avatar sprites, which would need
 *     art that does not exist. The catalogue stores IDs; the art lives in
 *     the renderer (SealStyleIcons, codex-seal.css). No blobs in the DB.
 *
 * Ownership is data (`shop_purchases`, a pure union for sync); the catalogue
 * itself is code, so a new item ships as one line here plus its art.
 */

export type ShopItemKind = 'seal_style' | 'pardon' | 'frame' | 'background';

export interface ShopItem {
  /** Stable id. Also the primary key material in `shop_purchases` and the i18n leaf. */
  id: string;
  kind: ShopItemKind;
  /** Price in óbolos. */
  cost: number;
  /** `rpg.shop.items.<id>` — `.name` and `.desc` live underneath. */
  i18nKey: string;
}

/** Builds an entry, deriving `i18nKey` so the two can never drift apart. */
function item(id: string, kind: ShopItemKind, cost: number): ShopItem {
  return { id, kind, cost, i18nKey: `rpg.shop.items.${id}` };
}

/** The one consumable: +1 streak pardon for the CURRENT month. */
export const PARDON_ITEM_ID = 'pardon_extra';

/** How many extra pardons may be bought per calendar month. */
export const PARDON_PURCHASES_PER_MONTH = 1;

/**
 * Catalogue order IS display order: seals first (cheap, collectible), the
 * pardon next (useful), cosmetics last (expensive, aspirational).
 *
 * Price calibration against the faucet (see rpg-handlers): an ordinary sealed
 * day mints ~11-17 óbolos, an achievement 15. A seal variant is ~1 week of
 * sealing; a frame or background is ~3-5 weeks. Deliberately slower than the
 * player's own rewards (the primary drain) so the shop never outcompetes them.
 */
export const SHOP_CATALOG: readonly ShopItem[] = [
  // ── Sellos coleccionables — variants of the Códice's wax matrix ──────────
  item('seal_stag', 'seal_style', 80),
  item('seal_tower', 'seal_style', 90),
  item('seal_crescent', 'seal_style', 100),
  item('seal_serpent', 'seal_style', 110),
  item('seal_oak', 'seal_style', 130),
  item('seal_sun', 'seal_style', 150),

  // ── Indulto extra — consumable, once per calendar month ──────────────────
  item(PARDON_ITEM_ID, 'pardon', 200),

  // ── Cosmética nueva — frames + backgrounds for the hero card ─────────────
  item('frame_laurel', 'frame', 300),
  item('frame_iron', 'frame', 350),
  item('frame_gilded', 'frame', 450),
  item('bg_burgundy', 'background', 300),
  item('bg_forest', 'background', 350),
  item('bg_night', 'background', 500),
];

export const SHOP_CATALOG_BY_ID: ReadonlyMap<string, ShopItem> =
  new Map(SHOP_CATALOG.map((i) => [i.id, i]));

/** Kinds that can be equipped (exactly one at a time, per kind, per device). */
export const EQUIPPABLE_KINDS: readonly ShopItemKind[] = ['seal_style', 'frame', 'background'];

/** app_state key holding the equipped item id for a kind. Equipment is per-device. */
export const EQUIP_STATE_KEYS: Readonly<Record<string, string>> = {
  seal_style: 'equipped_seal_style',
  frame: 'equipped_frame',
  background: 'equipped_background',
};

/**
 * The row id a purchase gets in `shop_purchases`.
 *
 * DETERMINISTIC on purpose: two devices buying the same non-consumable before
 * syncing produce the SAME row, so the cross-device union dedupes the double
 * purchase instead of storing it twice. The pardon is keyed by month, which
 * makes the once-per-month cap converge across devices too.
 */
export function purchaseRowId(itemId: string, kind: ShopItemKind, month: string): string {
  return kind === 'pardon' ? `${itemId}:${month}` : itemId;
}
