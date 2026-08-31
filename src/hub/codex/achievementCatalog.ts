import { ACHIEVEMENTS, ACHIEVEMENTS_TOTAL, ACHIEVEMENTS_BY_ID } from '../../../shared/achievements';

/**
 * The shelf's view of `shared/achievements.ts`.
 *
 * The catalog owns the ids, the `hidden` flags, the i18n keys and — crucially —
 * the ORDER. This module adds only what the catalog does not carry: which shelf
 * each medallion sits on. The catalog groups its entries with section comments
 * ("Primeros pasos", "Familias por módulo", "El Códice"…) that no runtime can
 * read, so the same partition is restated here as data, in the same order the
 * catalog declares it.
 *
 * An id this table does not know still renders: it falls through a keyword
 * heuristic and, failing that, lands on the general shelf. Adding an entry to
 * the catalog can therefore never break this page — at worst the new medallion
 * shows up under "Del héroe" until someone files it.
 */

export type AchievementGroup =
  | 'starts'
  | 'rhythm'
  | 'mastery'
  | 'quests'
  | 'nutrition'
  | 'finance'
  | 'cauldron'
  | 'codex'
  | 'chronicle'
  | 'progress'
  | 'other'
  | 'hidden';

/** The order the shelves are stacked in. */
export const GROUP_ORDER: AchievementGroup[] = [
  'starts',
  'rhythm',
  'mastery',
  'quests',
  'nutrition',
  'finance',
  'cauldron',
  'codex',
  'chronicle',
  'progress',
  'other',
  'hidden',
];

/** Mirrors the section comments in `shared/achievements.ts`, in catalog order. */
const ID_GROUPS: Record<string, AchievementGroup> = {
  // Primeros pasos
  first_step: 'starts',
  awakening: 'starts',
  first_quest: 'quests',
  first_habit: 'quests',
  first_meal: 'nutrition',
  first_coin: 'finance',
  first_brew: 'cauldron',
  first_seal: 'codex',
  // Ritmo y tiempo
  early_bird: 'rhythm',
  night_owl: 'rhythm',
  perfect_day: 'rhythm',
  three_epics: 'rhythm',
  hero_return: 'rhythm',
  sunday_guardian: 'rhythm',
  // Maestría y variación
  combo_master: 'mastery',
  lucky_strike: 'mastery',
  polymath: 'mastery',
  golden_day: 'mastery',
  epic_quest: 'quests',
  deep_work: 'cauldron',
  // Familias por módulo
  ritualist: 'quests',
  table_guardian: 'nutrition',
  debt_free: 'finance',
  ledger_closed: 'finance',
  scribe_of_accounts: 'finance',
  cauldron_master: 'cauldron',
  // El Códice
  sealed_week: 'codex',
  steady_hand: 'codex',
  late_memory: 'codex',
  radiant_seal: 'codex',
  // Cronista
  chronicler_i: 'chronicle',
  chronicler_ii: 'chronicle',
  chronicler_iii: 'chronicle',
  // Progresión
  squire: 'progress',
  steadfast: 'progress',
  monthly_vow: 'progress',
  // Rarezas de descubrimiento
  the_pardon: 'other',
  deserved_rest: 'other',
  day_off: 'quests',
  second_chance: 'nutrition',
};

/** Last resort for an id the table above has never seen. */
function guessGroup(id: string): AchievementGroup {
  if (/quest|task|habit/.test(id)) return 'quests';
  if (/meal|food|nutri/.test(id)) return 'nutrition';
  if (/coin|ledger|debt|account|budget/.test(id)) return 'finance';
  if (/brew|cauldron|pomodoro|focus/.test(id)) return 'cauldron';
  if (/seal|codex/.test(id)) return 'codex';
  if (/chronicl/.test(id)) return 'chronicle';
  return 'other';
}

export interface CatalogEntry {
  id: string;
  group: AchievementGroup;
  hidden: boolean;
  /** Index in the catalog — the order the shelf sorts by. */
  order: number;
}

const ENTRIES: Map<string, CatalogEntry> = new Map(
  ACHIEVEMENTS.map((def, index) => [
    def.id,
    {
      id: def.id,
      group: ID_GROUPS[def.id] ?? guessGroup(def.id),
      hidden: def.hidden,
      order: index,
    },
  ]),
);

/** The denominator of the "N / 40" counter. */
export function catalogSize(): number {
  return ACHIEVEMENTS_TOTAL;
}

/** Catalog data for one id; synthesised for an id the catalog does not carry. */
export function catalogEntry(id: string): CatalogEntry {
  return ENTRIES.get(id) ?? { id, group: guessGroup(id), hidden: false, order: 1_000 };
}

/* ── i18n keys ────────────────────────────────────────
   Taken from the catalog's own `i18nKey` so the two can never drift; the
   fallback rebuilds the agreed `rpg.achievements.<id>` shape for an id that
   somehow reaches the UI without a catalog entry. */

function base(id: string): string {
  return ACHIEVEMENTS_BY_ID.get(id)?.i18nKey ?? `rpg.achievements.${id}`;
}

export function titleKey(id: string): string {
  return `${base(id)}.title`;
}

export function descKey(id: string): string {
  return `${base(id)}.desc`;
}

/**
 * Readable stand-in while `rpg.achievements.<id>.title` is not in the locale
 * files yet (the catalog owner adds the forty title/desc pairs). Renders
 * "Late memory" rather than a raw `late_memory`, and disappears the moment the
 * real strings land, since it is only ever the i18n fallback.
 */
export function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
