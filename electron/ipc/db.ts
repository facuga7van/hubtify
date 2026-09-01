import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { Migration } from '../../shared/types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'hubtify.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 10000');
    db.pragma('temp_store = MEMORY');
    initCoreTables(db);
    applyMigrations(db, coreMigrations);
  }
  return db;
}

export function initCoreTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_applied (
      namespace TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, version)
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY DEFAULT 'default',
      email TEXT,
      username TEXT,
      firebase_uid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      user_id TEXT PRIMARY KEY DEFAULT 'default',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      hp INTEGER NOT NULL DEFAULT 100,
      max_hp INTEGER NOT NULL DEFAULT 100,
      title TEXT NOT NULL DEFAULT 'Campesino',
      streak INTEGER NOT NULL DEFAULT 0,
      daily_combo INTEGER NOT NULL DEFAULT 0,
      combo_date TEXT,
      streak_last_date TEXT,
      total_tasks INTEGER NOT NULL DEFAULT 0,
      total_meals INTEGER NOT NULL DEFAULT 0,
      total_expenses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rpg_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      xp_gained REAL NOT NULL DEFAULT 0,
      hp_change REAL NOT NULL DEFAULT 0,
      combo_multiplier REAL NOT NULL DEFAULT 1.0,
      bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rpg_events_created_at ON rpg_events(created_at);

    -- Key/value store for app-level state and user preferences.
    -- Created here (not ad-hoc in sync.ipc.ts) so every reader — including
    -- dollar:getVisibleTypes on a clean install — finds the table already there.
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- sync_log was never read nor written by any code path. Dropped so it stops
    -- showing up in schema dumps and account-clearing sweeps.
    DROP TABLE IF EXISTS sync_log;

    INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default');
    INSERT OR IGNORE INTO user_profile (id) VALUES ('default');
  `);
}

/**
 * Core (namespace-less module) migrations. These touch the tables created in
 * initCoreTables, which predate the per-module migration system.
 */
export const coreMigrations: Migration[] = [
  {
    namespace: 'core',
    version: 1,
    up: `
      -- ref_id: the entity this event refers to, extracted from the JSON payload.
      -- Undo used to locate the original event with payload LIKE '%"<id>"%', which
      -- matched ANY field holding that UUID (projectId, subtaskId, …) and was a
      -- full table scan. ref_id + the index below make the lookup exact and cheap.
      ALTER TABLE rpg_events ADD COLUMN ref_id TEXT;

      -- sync_id: client-generated stable identity for cross-device sync.
      -- rpg_events.id is AUTOINCREMENT, so two devices mint 1,2,3… for different
      -- rows; deduplicating on it silently drops and cross-applies data.
      ALTER TABLE rpg_events ADD COLUMN sync_id TEXT;

      UPDATE rpg_events SET ref_id = COALESCE(
        json_extract(payload, '$.taskId'),
        json_extract(payload, '$.subtaskId'),
        json_extract(payload, '$.habitId')
      ) WHERE payload IS NOT NULL AND json_valid(payload);

      -- Backfill DETERMINISTICALLY, not with a random UUID: the same logical event
      -- already exists on every synced device (the old merge copied id + payload
      -- verbatim), so a random id per device would make them all look distinct and
      -- duplicate the whole history on the first merge after this migration.
      UPDATE rpg_events
        SET sync_id = 'legacy-' || created_at || '-' || event_type || '-'
                      || COALESCE(ref_id, '') || '-' || xp_gained
        WHERE sync_id IS NULL;

      -- Disambiguate the rare genuine collision (two identical events in the same
      -- second) so the UNIQUE index below can be created.
      --
      -- The tiebreaker MUST be deterministic across devices. Using the local
      -- AUTOINCREMENT id produced '...#2' here and '...#7' there for the same
      -- logical event, and the merge keys on sync_id alone: both rows survived and
      -- the XP-per-day chart double-counted. ROW_NUMBER over the row's own content
      -- gives every device the same answer.
      UPDATE rpg_events SET sync_id = sync_id || '#' || (
        SELECT rn FROM (
          SELECT id AS rid,
                 ROW_NUMBER() OVER (
                   PARTITION BY sync_id
                   ORDER BY COALESCE(payload, ''), COALESCE(module_id, ''),
                            hp_change, combo_multiplier, bonus_multiplier
                 ) AS rn
          FROM rpg_events
        ) WHERE rid = rpg_events.id
      )
      WHERE id NOT IN (SELECT MIN(id) FROM rpg_events GROUP BY sync_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_rpg_events_sync_id ON rpg_events(sync_id);
      CREATE INDEX IF NOT EXISTS idx_rpg_events_type_ref ON rpg_events(event_type, ref_id, id DESC);
    `,
  },
  {
    namespace: 'core',
    version: 2,
    up: `
      -- Streak milestones (3/7/14/30/60/100 days → 25..1000 XP) must be paid once.
      -- Tracks the highest milestone streak already rewarded so neither a second
      -- action on the same day nor an undo/redo cycle can re-award it.
      ALTER TABLE player_stats ADD COLUMN last_milestone_streak INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    namespace: 'core',
    version: 3,
    up: `
      -- ── RPG phase 1: stop the bleeding ──────────────────────────────────────
      -- hp_date: the local day the current HP belongs to. HP is no longer a debt
      -- carried across days ("Vigor"): the first read or event of a new day resets
      -- it to 100. Without this column HP only ever went down (nothing in the app
      -- healed it) while XP was halved at 0.
      ALTER TABLE player_stats ADD COLUMN hp_date TEXT;

      -- pardons_month / pardons_used: 2 automatic streak pardons per calendar
      -- month. One missed day no longer wipes the global streak.
      ALTER TABLE player_stats ADD COLUMN pardons_month TEXT;
      ALTER TABLE player_stats ADD COLUMN pardons_used INTEGER NOT NULL DEFAULT 0;

      -- best_streak: the record. Never reset, not by a break, not by a restore.
      ALTER TABLE player_stats ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0;

      -- inn_since: local date the player checked into the Inn (holiday mode).
      -- NULL = not resting. While set, the streak neither advances nor breaks.
      ALTER TABLE player_stats ADD COLUMN inn_since TEXT;

      -- Seed the record from whatever streak this device already had.
      UPDATE player_stats SET best_streak = streak WHERE best_streak < streak;
    `,
  },
  {
    namespace: 'core',
    version: 4,
    up: `
      -- ── RPG phase 2: the shelf and the Códice ───────────────────────────────
      -- achievements_unlocked: one row per EARNED achievement. The catalogue
      -- itself lives in code (shared/achievements.ts); only the unlock is data.
      -- An unlocked achievement is never re-checked and never revoked, so this
      -- table is append-only in practice and merges across devices by union.
      CREATE TABLE IF NOT EXISTS achievements_unlocked (
        id TEXT PRIMARY KEY,
        unlocked_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- day_seals: the Cierre del Códice ledger. One row per sealed local day.
      -- The modules column is a JSON array of module ids with an event that day.
      -- Sealing is optional and never punitive: a missing row means nothing.
      CREATE TABLE IF NOT EXISTS day_seals (
        date TEXT PRIMARY KEY,
        sealed_at TEXT NOT NULL,
        xp_awarded INTEGER NOT NULL,
        vigor INTEGER NOT NULL,
        events_count INTEGER NOT NULL,
        modules TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The day summary groups the day's events by module; the existing
      -- idx_rpg_events_created_at already covers the date range scan.
      CREATE INDEX IF NOT EXISTS idx_rpg_events_module_created
        ON rpg_events(module_id, created_at);
    `,
  },
  {
    namespace: 'core',
    version: 5,
    up: `
      -- ── RPG phase 3: óbolos + recompensas propias ───────────────────────────
      -- obolos_ledger: the spendable currency, as an APPEND-ONLY ledger.
      -- delta > 0 earns (reason 'day_sealed' | 'achievement'), delta < 0 spends
      -- (reason 'reward_redeemed'). Rows are never UPDATEd nor DELETEd — a
      -- correction is a counter-entry — so the balance is always SUM(delta),
      -- and cross-device sync is a pure union by id.
      CREATE TABLE IF NOT EXISTS obolos_ledger (
        id TEXT PRIMARY KEY,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- One probe answers both idempotency guards ('was this seal/achievement
      -- already paid?') and the per-reward redeem count.
      CREATE INDEX IF NOT EXISTS idx_obolos_ledger_reason_ref
        ON obolos_ledger(reason, ref_id);

      -- rewards: the player's OWN counter of treats ("2 h de jueguito").
      -- Soft-deleted (deleted_at) so a retired reward keeps its ledger history
      -- and merges across devices by LWW on updated_at.
      CREATE TABLE IF NOT EXISTS rewards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cost INTEGER NOT NULL,
        icon TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT DEFAULT NULL
      );
    `,
  },
  {
    namespace: 'core',
    version: 6,
    up: `
      -- ── RPG phase 4: la tienda + maestrías ──────────────────────────────────
      -- shop_purchases: one row per bought catalogue item. The catalogue lives
      -- in code (shared/shop-catalog.ts); only the purchase is data. Row ids are
      -- DETERMINISTIC (item id; item id + month for the monthly pardon), so the
      -- cross-device merge is a pure union that dedupes a double purchase
      -- instead of charging it twice. Append-only in practice, like
      -- achievements_unlocked. Equipment is NOT here: it is per-device state in
      -- app_state (equipped_seal_style / equipped_frame / equipped_background),
      -- which deliberately does not sync.
      CREATE TABLE IF NOT EXISTS shop_purchases (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shop_purchases_item ON shop_purchases(item_id);

      -- mastery_xp: per-module XP ACCUMULATOR. rpg_events is pruned at 365
      -- days, so a mastery can never be recomputed from it — it is summed
      -- forward: backfilled once here from whatever history exists, then
      -- incremented by every processRpgEvent in the same transaction.
      -- Sync semantics: merge by MAX(xp) per module_id (a converging counter;
      -- two devices accumulating in parallel may lose the smaller device's
      -- delta between syncs — accepted, the number is cosmetic).
      CREATE TABLE IF NOT EXISTS mastery_xp (
        module_id TEXT PRIMARY KEY,
        xp INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      -- One-time backfill from the surviving event log. Only POSITIVE XP feeds
      -- a mastery (undo rows log 0; nutrition can log negative closes) so the
      -- accumulator is monotonic. INSERT OR IGNORE keeps the statement
      -- idempotent for handles where a partial run left rows behind.
      INSERT OR IGNORE INTO mastery_xp (module_id, xp, updated_at)
        SELECT module_id,
               CAST(ROUND(SUM(MAX(xp_gained, 0))) AS INTEGER),
               datetime('now')
        FROM rpg_events
        GROUP BY module_id;
    `,
  },
];

const DUPLICATE_COLUMN = 'duplicate column name';

function isDuplicateColumnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return msg.includes(DUPLICATE_COLUMN);
}

/**
 * Applies pending migrations. Each migration runs inside ONE transaction that
 * also writes its `migrations_applied` row, so a failure halfway through leaves
 * the database exactly as it was — nothing partially applied, nothing re-run
 * against a half-migrated schema on the next boot. (SQLite DDL is transactional,
 * so even `DROP TABLE` + `RENAME` pairs are safe.)
 *
 * Preferred path executes `migration.up` whole, which keeps triggers and string
 * literals containing `;` intact.
 *
 * Fallback path (statement-by-statement) exists only for databases whose schema
 * was already partially advanced by the OLD non-transactional runner: there an
 * `ALTER TABLE … ADD COLUMN` re-runs and raises "duplicate column name". Those
 * specific errors are skipped so the remaining statements still apply. Its split
 * on `;` cannot handle a `;` inside a trigger body or literal — no current
 * migration has one, and new migrations should not rely on this path.
 */
function applyMigrations(database: Database.Database, migrations: Migration[]): void {
  const markApplied = database.prepare(
    'INSERT OR IGNORE INTO migrations_applied (namespace, version) VALUES (?, ?)'
  );

  for (const migration of migrations) {
    const applied = database.prepare(
      'SELECT 1 FROM migrations_applied WHERE namespace = ? AND version = ?'
    ).get(migration.namespace, migration.version);
    if (applied) continue;

    const whole = database.transaction(() => {
      database.exec(migration.up);
      markApplied.run(migration.namespace, migration.version);
    });

    try {
      whole();
    } catch (err) {
      if (!isDuplicateColumnError(err)) throw err;

      const statements = migration.up
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      const perStatement = database.transaction(() => {
        for (const stmt of statements) {
          try {
            database.exec(stmt);
          } catch (stmtErr: unknown) {
            if (!isDuplicateColumnError(stmtErr)) throw stmtErr;
          }
        }
        markApplied.run(migration.namespace, migration.version);
      });
      perStatement();
    }
  }
}

export function runModuleMigrations(migrations: Migration[]): void {
  applyMigrations(getDb(), migrations);
}

/** Test/seam helper: apply migrations to an arbitrary database handle. */
export { applyMigrations };

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
