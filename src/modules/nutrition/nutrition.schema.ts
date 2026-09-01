import type { Migration } from '../../../shared/types';
import { sqlNormalizeExpr } from './normalize';

export const nutritionMigrations: Migration[] = [
  {
    namespace: 'nutrition',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS nutrition_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        age INTEGER NOT NULL,
        sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
        height_cm REAL NOT NULL,
        initial_weight_kg REAL NOT NULL,
        activity_level TEXT NOT NULL CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active')),
        deficit_target_kcal INTEGER NOT NULL DEFAULT 500,
        gym_calories INTEGER NOT NULL DEFAULT 300,
        step_calories_factor REAL NOT NULL DEFAULT 0.04
      );

      CREATE TABLE IF NOT EXISTS food_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        description TEXT NOT NULL,
        calories INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ai_estimate', 'frequent', 'manual')),
        frequent_food_id INTEGER,
        ai_breakdown TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date);

      CREATE TABLE IF NOT EXISTS frequent_foods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        calories INTEGER NOT NULL,
        ai_breakdown TEXT,
        times_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS nutrition_daily_metrics (
        date TEXT PRIMARY KEY,
        steps INTEGER,
        gym INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS nutrition_weekly_metrics (
        date TEXT PRIMARY KEY,
        weight_kg REAL,
        waist_cm REAL
      );

      CREATE TABLE IF NOT EXISTS nutrition_daily_summary (
        date TEXT PRIMARY KEY,
        total_calories_in INTEGER NOT NULL,
        bmr INTEGER NOT NULL,
        tdee INTEGER NOT NULL,
        balance INTEGER NOT NULL
      );

    `,
  },
  {
    namespace: 'nutrition',
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS nutrition_daily_closed (
        date TEXT PRIMARY KEY,
        xp_precision INTEGER NOT NULL DEFAULT 0,
        xp_steps INTEGER NOT NULL DEFAULT 0,
        xp_gym INTEGER NOT NULL DEFAULT 0,
        xp_weight INTEGER NOT NULL DEFAULT 0,
        xp_total INTEGER NOT NULL DEFAULT 0,
        hp_change INTEGER NOT NULL DEFAULT 0,
        consumed INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    namespace: 'nutrition',
    version: 3,
    up: `
      ALTER TABLE nutrition_profile ADD COLUMN date_of_birth TEXT DEFAULT NULL;
      ALTER TABLE nutrition_profile ADD COLUMN weight_check_day INTEGER NOT NULL DEFAULT 1;

      UPDATE nutrition_profile SET date_of_birth = (
        CAST(strftime('%Y', 'now') AS INTEGER) - age
      ) || '-01-01' WHERE date_of_birth IS NULL;
    `,
  },
  {
    namespace: 'nutrition',
    version: 4,
    up: `
      ALTER TABLE nutrition_daily_closed ADD COLUMN xp_bonus INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    namespace: 'nutrition',
    version: 5,
    up: `
      ALTER TABLE nutrition_profile ADD COLUMN weight_popup_enabled INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    namespace: 'nutrition',
    version: 6,
    up: `
      ALTER TABLE food_log ADD COLUMN meal TEXT DEFAULT NULL;
      ALTER TABLE nutrition_profile ADD COLUMN meal_schedule TEXT DEFAULT NULL;
    `,
  },
  {
    namespace: 'nutrition',
    version: 7,
    up: `
      ALTER TABLE nutrition_daily_metrics ADD COLUMN updated_at TEXT;
      ALTER TABLE nutrition_daily_summary ADD COLUMN updated_at TEXT;
      ALTER TABLE nutrition_weekly_metrics ADD COLUMN updated_at TEXT;
      ALTER TABLE nutrition_profile ADD COLUMN updated_at TEXT;
      ALTER TABLE frequent_foods ADD COLUMN updated_at TEXT;
    `,
  },
  {
    namespace: 'nutrition',
    version: 8,
    up: `
      CREATE TABLE IF NOT EXISTS favorite_foods (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL UNIQUE,
        calories INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        ai_breakdown TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      UPDATE food_log SET source = 'manual' WHERE source NOT IN ('ai_estimate', 'frequent', 'manual');

      CREATE TABLE food_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        description TEXT NOT NULL,
        calories INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('ai_estimate', 'frequent', 'manual', 'favorite')),
        frequent_food_id INTEGER,
        ai_breakdown TEXT,
        meal TEXT DEFAULT NULL
      );
      INSERT INTO food_log_new SELECT id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal FROM food_log;
      DROP TABLE food_log;
      ALTER TABLE food_log_new RENAME TO food_log;
      CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date);
    `,
  },
  {
    namespace: 'nutrition',
    version: 9,
    up: `
      ALTER TABLE food_log ADD COLUMN updated_at TEXT DEFAULT NULL;
      ALTER TABLE food_log ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE favorite_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE frequent_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
      DELETE FROM frequent_foods WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM frequent_foods GROUP BY name COLLATE NOCASE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_frequent_foods_name ON frequent_foods(name COLLATE NOCASE);
    `,
  },
  // ── v10 / v11 come from upstream (nutrify-deep-improvements) ────────────────
  // They already occupied these two version numbers on origin/master, so the
  // four migrations this branch wrote as v10-v13 were renumbered to v12-v15
  // below. The runner skips by (namespace, version) and tolerates duplicate
  // columns, so a device that already ran the old numbering is unaffected in
  // practice: every statement that moved is either an idempotent ALTER or a
  // backfill guarded by `WHERE ... IS NULL`.
  {
    namespace: 'nutrition',
    version: 10,
    up: `
      ALTER TABLE food_log ADD COLUMN protein_g REAL DEFAULT NULL;
      ALTER TABLE food_log ADD COLUMN carbs_g REAL DEFAULT NULL;
      ALTER TABLE food_log ADD COLUMN fat_g REAL DEFAULT NULL;

      ALTER TABLE favorite_foods ADD COLUMN protein_g REAL DEFAULT NULL;
      ALTER TABLE favorite_foods ADD COLUMN carbs_g REAL DEFAULT NULL;
      ALTER TABLE favorite_foods ADD COLUMN fat_g REAL DEFAULT NULL;

      ALTER TABLE frequent_foods ADD COLUMN protein_g REAL DEFAULT NULL;
      ALTER TABLE frequent_foods ADD COLUMN carbs_g REAL DEFAULT NULL;
      ALTER TABLE frequent_foods ADD COLUMN fat_g REAL DEFAULT NULL;

      ALTER TABLE nutrition_daily_summary ADD COLUMN protein_g REAL DEFAULT NULL;
      ALTER TABLE nutrition_daily_summary ADD COLUMN carbs_g REAL DEFAULT NULL;
      ALTER TABLE nutrition_daily_summary ADD COLUMN fat_g REAL DEFAULT NULL;

      ALTER TABLE nutrition_profile ADD COLUMN protein_target_g REAL DEFAULT NULL;
      ALTER TABLE nutrition_profile ADD COLUMN carbs_target_g REAL DEFAULT NULL;
      ALTER TABLE nutrition_profile ADD COLUMN fat_target_g REAL DEFAULT NULL;
    `,
  },
  {
    // Soft-delete support for closed days so "reopen day" replicates across accounts.
    // A row with deleted_at set is treated as reopened (no longer a closed day).
    namespace: 'nutrition',
    version: 11,
    up: `
      ALTER TABLE nutrition_daily_closed ADD COLUMN updated_at TEXT DEFAULT NULL;
      ALTER TABLE nutrition_daily_closed ADD COLUMN deleted_at TEXT DEFAULT NULL;
    `,
  },
  {
    // Was v10 on this branch before the merge with upstream's v10/v11.
    namespace: 'nutrition',
    version: 12,
    up: `
      -- ── sync_id: cross-device identity for AUTOINCREMENT tables ─────────────
      -- food_log.id and frequent_foods.id are INTEGER PRIMARY KEY AUTOINCREMENT,
      -- so two devices independently mint 1, 2, 3… for DIFFERENT rows. The merge
      -- deduplicated on that id: with 2 meals on each device you ended up with 2
      -- instead of 4, and the LWW pass then applied the remote's deleted_at to
      -- whichever unrelated local row happened to share the number.
      -- sync_id is the real identity; the integer id stays a purely local surrogate.
      ALTER TABLE food_log ADD COLUMN sync_id TEXT;
      ALTER TABLE frequent_foods ADD COLUMN sync_id TEXT;

      -- Backfill is DETERMINISTIC (derived from the natural key), never random:
      -- rows already replicated across devices must land on the SAME sync_id or
      -- this migration would duplicate the entire history on the next merge.
      UPDATE food_log
        SET sync_id = 'legacy-' || date || '|' || time || '|' || calories || '|' || substr(description, 1, 60)
        WHERE sync_id IS NULL;
      UPDATE food_log SET sync_id = sync_id || '#' || id
        WHERE id NOT IN (SELECT MIN(id) FROM food_log GROUP BY sync_id);

      UPDATE frequent_foods SET sync_id = 'legacy-' || lower(name) WHERE sync_id IS NULL;
      UPDATE frequent_foods SET sync_id = sync_id || '#' || id
        WHERE id NOT IN (SELECT MIN(id) FROM frequent_foods GROUP BY sync_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_food_log_sync_id ON food_log(sync_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_frequent_foods_sync_id ON frequent_foods(sync_id);

      CREATE INDEX IF NOT EXISTS idx_food_log_live_date ON food_log(deleted_at, date, time);

      -- ── One timestamp format ────────────────────────────────────────────────
      -- Inserts wrote ISO ('2026-08-31T14:00:00.000Z') while deletes wrote
      -- datetime('now') ('2026-08-31 14:00:00'). Both are UTC, but as STRINGS the
      -- ISO form always sorts higher ('T' > ' '), so a soft-delete could never win
      -- last-write-wins against the row's own insert. Normalise the legacy values
      -- to ISO — the format every writer uses from now on.
      UPDATE food_log SET updated_at = replace(updated_at, ' ', 'T') || '.000Z'
        WHERE updated_at LIKE '____-__-__ __:__:__';
      UPDATE food_log SET deleted_at = replace(deleted_at, ' ', 'T') || '.000Z'
        WHERE deleted_at LIKE '____-__-__ __:__:__';
      UPDATE frequent_foods SET updated_at = replace(updated_at, ' ', 'T') || '.000Z'
        WHERE updated_at LIKE '____-__-__ __:__:__';
      UPDATE frequent_foods SET deleted_at = replace(deleted_at, ' ', 'T') || '.000Z'
        WHERE deleted_at LIKE '____-__-__ __:__:__';
      UPDATE favorite_foods SET updated_at = replace(updated_at, ' ', 'T') || '.000Z'
        WHERE updated_at LIKE '____-__-__ __:__:__';
      UPDATE favorite_foods SET deleted_at = replace(deleted_at, ' ', 'T') || '.000Z'
        WHERE deleted_at LIKE '____-__-__ __:__:__';

      -- ── Reopening a closed day ──────────────────────────────────────────────
      -- closed_at narrows the search for the DAY_SUMMARY rpg_event whose XP/HP the
      -- reopen has to reverse.
      -- nutrition_daily_closed.updated_at / .deleted_at used to be added here as
      -- well (same intent: make the reopen a soft delete a pull cannot resurrect).
      -- Upstream's v11 already adds both, so only closed_at is left.
      ALTER TABLE nutrition_daily_closed ADD COLUMN closed_at TEXT;
    `,
  },
  {
    // Was v11 on this branch before the merge with upstream's v10/v11.
    namespace: 'nutrition',
    version: 13,
    up: `
      -- ── The nutritional day has a cutoff hour ───────────────────────────────
      -- The 00:30 dessert used to count for TOMORROW: it ruined the day that was
      -- still running AND opened the next one with a debt. day_cutoff_hour is the
      -- hour the nutritional day flips (default 4 AM). 0 = strict midnight, i.e.
      -- exactly the old behaviour, for anyone who wants it back.
      ALTER TABLE nutrition_profile ADD COLUMN day_cutoff_hour INTEGER DEFAULT 4;
      UPDATE nutrition_profile SET day_cutoff_hour = 4 WHERE day_cutoff_hour IS NULL;

      -- ── Merienda ────────────────────────────────────────────────────────────
      -- New defaults: desayuno 6-10, almuerzo 11-15, MERIENDA 16-19, cena
      -- 20:30-23:59, snack catch-all. Only schedules that are NULL or still the
      -- untouched v6 default (6-10 / 11-15 / 18-22, no merienda key) are rewritten.
      -- A schedule the user edited is left exactly as it is: merienda is grafted
      -- onto it lazily by ensureMerienda() in shared/meal-utils.ts, which adds it
      -- disabled when 16-19 would collide with a window they chose by hand.
      UPDATE nutrition_profile
      SET meal_schedule = '{"breakfast":{"enabled":true,"startHour":6,"startMinute":0,"endHour":10,"endMinute":0},"lunch":{"enabled":true,"startHour":11,"startMinute":0,"endHour":15,"endMinute":0},"merienda":{"enabled":true,"startHour":16,"startMinute":0,"endHour":19,"endMinute":0},"dinner":{"enabled":true,"startHour":20,"startMinute":30,"endHour":23,"endMinute":59},"snack":{"enabled":true,"startHour":0,"startMinute":0,"endHour":0,"endMinute":0}}'
      WHERE meal_schedule IS NULL
         OR (
           json_valid(meal_schedule)
           AND json_extract(meal_schedule, '$.merienda') IS NULL
           AND json_extract(meal_schedule, '$.breakfast.startHour') = 6
           AND json_extract(meal_schedule, '$.breakfast.endHour') = 10
           AND json_extract(meal_schedule, '$.lunch.startHour') = 11
           AND json_extract(meal_schedule, '$.lunch.endHour') = 15
           AND json_extract(meal_schedule, '$.dinner.startHour') = 18
           AND json_extract(meal_schedule, '$.dinner.endHour') = 22
         );
    `,
  },
  {
    // Was v12 on this branch before the merge with upstream's v10/v11.
    namespace: 'nutrition',
    version: 14,
    up: `
      -- ── description_norm: the history IS the database ────────────────────────
      -- Phase 2 answers "what did you eat?" from your own log instead of from
      -- Gemini, which means grouping by a normalised description ("Milanesa con
      -- Puré" == "milanesa con pure") and searching it on every keystroke. Both
      -- need an indexed column.
      --
      -- GENERATED ... VIRTUAL, not a plain column, for one decisive reason:
      -- NOTHING has to maintain it. food_log and favorite_foods are written by
      -- the IPC handlers, by copyDay/repeatDay, AND by sync.ipc.ts's merge —
      -- which inserts with an explicit column list this migration must not have
      -- to edit. A plain column would arrive NULL on every synced row and the
      -- autocomplete would go blind on exactly the meals that came from the
      -- user's phone. SQLite computes a generated column for every writer, forever.
      --
      -- VIRTUAL rather than STORED because ALTER TABLE ADD COLUMN cannot add a
      -- STORED generated column. It costs nothing here: the INDEX below persists
      -- the computed value, so lookups read the index, never the expression.
      --
      -- The expression is emitted by sqlNormalizeExpr() from the same fold table
      -- normalizeDescription() uses in JS — see normalize.ts for why that parity
      -- is load-bearing.
      ALTER TABLE food_log
        ADD COLUMN description_norm TEXT
        GENERATED ALWAYS AS (${sqlNormalizeExpr('description')}) VIRTUAL;

      ALTER TABLE favorite_foods
        ADD COLUMN description_norm TEXT
        GENERATED ALWAYS AS (${sqlNormalizeExpr('description')}) VIRTUAL;

      -- deleted_at FIRST, description_norm second — the order the search
      -- actually uses it: an equality on the tombstone (every query filters
      -- \`deleted_at IS NULL\`) followed by a range on the description. Put the
      -- description first and the planner prefers idx_food_log_live_date, which
      -- can at least seek the tombstone, and the prefix search degrades to a
      -- scan.
      --
      -- With this order a prefix search compiles to a SEEK ("mila" <= x <
      -- "milb"). A contains search still has to walk, but it walks the index —
      -- a few bytes per description — not every food_log row and its breakdown.
      CREATE INDEX IF NOT EXISTS idx_food_log_desc_norm
        ON food_log(deleted_at, description_norm);
      CREATE INDEX IF NOT EXISTS idx_favorite_foods_desc_norm
        ON favorite_foods(deleted_at, description_norm);

      -- ── nutrition_ai_cache: the AI does not repeat work ──────────────────────
      -- Keyed by the SAME description_norm. Second time you type "milanesa con
      -- puré" there is no network call, no spinner and no cost.
      --
      -- This is the ONE estimate cache in the app. Upstream shipped a second one
      -- (a localStorage map in estimate-cache.ts); it lost the merge because this
      -- one is per-account, shares its key with the history autocomplete, counts
      -- hits, and stores the number the user CONFIRMED rather than the one the
      -- model guessed.
      --
      -- LOCAL-ONLY ON PURPOSE — deliberately absent from USER_DATA_TABLES and
      -- from sync:getAll/mergeNutritionData. This is a network cache, not user
      -- data: every row is reconstructible for free by asking the model again,
      -- it holds nothing the user typed that is not already in food_log, and
      -- syncing it would push a per-device performance artefact through
      -- Firestore on every pull for zero user-visible gain. Losing it costs one
      -- API call. The rows the user actually owns (the meals) are in food_log,
      -- which IS synced.
      --
      -- protein_g / carbs_g / fat_g mirror what the estimate Cloud Function now
      -- returns, so a cache hit is exactly as complete as a fresh call.
      CREATE TABLE IF NOT EXISTS nutrition_ai_cache (
        description_norm TEXT PRIMARY KEY,
        calories INTEGER NOT NULL,
        ai_breakdown TEXT,
        protein_g REAL,
        hits INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
      -- carbs_g / fat_g arrive as ALTERs rather than columns of the CREATE so
      -- that BOTH paths land on the same shape: a fresh database (table created
      -- here, then altered) and a database that already created this table under
      -- the OLD numbering, when this migration was v12 and the cache held
      -- protein only. Neither path raises "duplicate column".
      ALTER TABLE nutrition_ai_cache ADD COLUMN carbs_g REAL;
      ALTER TABLE nutrition_ai_cache ADD COLUMN fat_g REAL;
    `,
  },
  {
    // Was v13 on this branch before the merge with upstream's v10/v11.
    namespace: 'nutrition',
    version: 15,
    up: `
      -- ── Modo evento: el asado del domingo ────────────────────────────────────
      -- La causa documentada #2 y #3 de abandono es el evento social que "rompe"
      -- el registro. Un evento se guarda como UNA entrada de food_log marcada,
      -- con una banda honesta (min-max) de la que calories lleva el punto medio.
      -- La regla de oro: la racha mide PRESENTARSE; registrar el asado ES
      -- presentarse, y el dia con evento nunca DANA el vigor por pasarse.
      ALTER TABLE food_log ADD COLUMN is_event INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE food_log ADD COLUMN event_kcal_min REAL DEFAULT NULL;
      ALTER TABLE food_log ADD COLUMN event_kcal_max REAL DEFAULT NULL;

      -- food_log.protein_g y nutrition_profile.protein_target_g VIVIAN aca antes
      -- del merge. Upstream los agrega en v10 junto con carbohidratos y grasas, y
      -- con targets configurables para los tres: gana la version completa.
    `,
  },
];
