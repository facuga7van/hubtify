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
  fellowship: 'rhythm',
  dawn_to_dusk: 'rhythm',
  long_night: 'rhythm',
  unlucky_thirteen: 'rhythm',
  suns_edge: 'rhythm',
  // Maestría y variación
  combo_master: 'mastery',
  lucky_strike: 'mastery',
  polymath: 'mastery',
  golden_day: 'mastery',
  critical_hit: 'mastery',
  million_to_one: 'mastery',
  medallion_night: 'mastery',
  last_ember: 'mastery',
  // Coinify
  debt_free: 'finance',
  ledger_closed: 'finance',
  scribe_of_accounts: 'finance',
  iron_bank_i: 'finance',
  iron_bank_ii: 'finance',
  iron_bank_iii: 'finance',
  lannister_i: 'finance',
  lannister_ii: 'finance',
  lannister_iii: 'finance',
  winter_i: 'finance',
  winter_ii: 'finance',
  winter_iii: 'finance',
  bestiary_i: 'finance',
  bestiary_ii: 'finance',
  bestiary_iii: 'finance',
  path_i: 'finance',
  path_ii: 'finance',
  path_iii: 'finance',
  master_of_coin: 'finance',
  heavy_tome: 'finance',
  contract_collected: 'finance',
  sealed_with_gold: 'finance',
  drawn_ward: 'finance',
  coin_from_overseas: 'finance',
  statement_settled: 'finance',
  twelve_moons: 'finance',
  // Questify
  ritualist: 'quests',
  epic_quest: 'quests',
  fighters_guild_i: 'quests',
  fighters_guild_ii: 'quests',
  fighters_guild_iii: 'quests',
  endless_stair_i: 'quests',
  endless_stair_ii: 'quests',
  endless_stair_iii: 'quests',
  nine_divines_i: 'quests',
  nine_divines_ii: 'quests',
  nine_divines_iii: 'quests',
  the_company: 'quests',
  great_undertaking: 'quests',
  dawn_ride: 'quests',
  turning_wheel: 'quests',
  rewritten: 'quests',
  marginalia: 'quests',
  raised_shield: 'quests',
  cleared_board: 'quests',
  in_its_own_hour: 'quests',
  cold_trail: 'quests',
  day_off: 'quests',
  // Caldero
  deep_work: 'cauldron',
  cauldron_master: 'cauldron',
  isengard_i: 'cauldron',
  isengard_ii: 'cauldron',
  isengard_iii: 'cauldron',
  beacons_i: 'cauldron',
  beacons_ii: 'cauldron',
  beacons_iii: 'cauldron',
  midnight_oil: 'cauldron',
  perfect_boil: 'cauldron',
  anvil_and_edge: 'cauldron',
  broken_flask: 'cauldron',
  labelled_potion: 'cauldron',
  embers: 'cauldron',
  full_circle: 'cauldron',
  one_more_log: 'cauldron',
  sun_to_sun: 'cauldron',
  // Nutrify
  table_guardian: 'nutrition',
  thirty_nights_at_table: 'nutrition',
  tome_of_clear_thought: 'nutrition',
  first_scroll: 'nutrition',
  scroll_keeper: 'nutrition',
  library_unending: 'nutrition',
  seven_nights_written: 'nutrition',
  the_pact_kept: 'nutrition',
  yesterdays_pantry: 'nutrition',
  the_feast: 'nutrition',
  honest_scales: 'nutrition',
  archive_caught_up: 'nutrition',
  second_breakfast: 'nutrition',
  second_chance: 'nutrition',
  // El Códice
  sealed_week: 'codex',
  steady_hand: 'codex',
  bound_volume: 'codex',
  oghma_infinium: 'codex',
  late_memory: 'codex',
  radiant_seal: 'codex',
  seal_of_four_hands: 'codex',
  overflowing_page: 'codex',
  ashless_flame: 'codex',
  ferrymans_coin: 'codex',
  bag_of_tricks: 'codex',
  horn_of_valhalla: 'codex',
  the_pardon: 'other',
  saving_throw: 'other',
  deserved_rest: 'other',
  long_rest: 'other',
  well_rested: 'other',
  // Cronista
  chronicler_i: 'chronicle',
  chronicler_ii: 'chronicle',
  chronicler_iii: 'chronicle',
  // Progresión
  squire: 'progress',
  knight_errant: 'progress',
  dragonborn: 'progress',
  steadfast: 'progress',
  monthly_vow: 'progress',
  centenary_vow: 'progress',
  lord_of_cinder: 'progress',
  // Huevos · El regreso
  gate_guard: 'rhythm',
  knee_healed: 'quests',
  no_haste: 'rhythm',
  seat_kept: 'rhythm',
  cold_hearth: 'cauldron',
  hundred_days_gone: 'finance',
  the_answer: 'rhythm',
  the_same_bell: 'rhythm',
  back_through_the_forge: 'cauldron',
  like_nothing_happened: 'rhythm',
  // Huevos · Números
  capicua: 'finance',
  perfect_figure: 'finance',
  the_mirror: 'finance',
  lead_into_gold: 'finance',
  a_single_coin: 'finance',
  the_blessed_penny: 'finance',
  the_date_in_the_sum: 'finance',
  the_ledgers_name_day: 'finance',
  the_number: 'mastery',
  the_thousandth: 'chronicle',
  // Huevos · Calendario y reloj
  day_that_isnt: 'rhythm',
  eleventy_one: 'rhythm',
  three_sevens: 'rhythm',
  palindrome_day: 'rhythm',
  long_expected: 'chronicle',
  still_standing: 'rhythm',
  last_two_hours: 'quests',
  omens_and_portents: 'finance',
  dice_did_notice: 'mastery',
  hour_of_the_wolf: 'finance',
  night_watch: 'cauldron',
  blood_moon: 'rhythm',
  // Huevos · Los dados
  full_word: 'quests',
  loaded_dice: 'mastery',
  witching_hour: 'mastery',
  // Huevos · El estado contradictorio
  enemies_nearby: 'cauldron',
  working_holiday: 'other',
  shall_we_rest: 'other',
  always_the_same_trick: 'mastery',
  no_name_on_the_door: 'starts',
  takes_no_notes: 'codex',
  just_in_case: 'codex',
  door_never_opened: 'chronicle',
  // Huevos · Coincidencias del juego
  solvent_crown: 'finance',
  a_hundred_lines: 'finance',
  buzzer_pardon: 'other',
  // Huevos · Papeles y tinta
  a_single_line: 'codex',
  session_notes: 'codex',
  three_keys: 'codex',
  hole_in_the_sheet: 'nutrition',
  long_table: 'nutrition',
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

/** The denominator of the "N / TOTAL" counter. */
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
