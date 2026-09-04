import type { SqlDatabase } from '../db';
import { registerHandler as ipcHandle } from '../registry';
import { getDb, RPG_EVENTS_TWIN_IDS_SQL } from '../db';
import { recalcSummary } from './nutrition.ipc';
import { weeklyTarget } from './quests.habits';
import { daysAgoDateString } from '../../shared/date-utils';
import { FOOD_LOG_TWIN_IDS_SQL } from '../../src/modules/nutrition/nutrition.schema';

/**
 * Guards a remote row before it reaches SQLite: rejects non-objects and any row
 * missing a column the schema declares NOT NULL. Without this a single bad record
 * (a task with no `name`, a null entry in the array) raised a constraint error
 * that rolled back the entire pull.
 */
function isUsableRow(row: unknown, table: string, required: string[]): boolean {
  if (!row || typeof row !== 'object') {
    console.warn(`[Sync] ${table}: skipping non-object row`);
    return false;
  }
  const r = row as Record<string, unknown>;
  for (const field of required) {
    const v = r[field];
    if (v === undefined || v === null || v === '') {
      console.warn(`[Sync] ${table}: skipping row missing "${field}"`, r.id ?? '(no id)');
      return false;
    }
  }
  return true;
}

/**
 * Normalises a stamp written by SQLite's datetime('now') ("2026-09-01 12:00:00")
 * to the ISO form every current writer uses ("2026-09-01T12:00:00.000Z").
 * Last-write-wins compares stamps as plain strings and ' ' (0x20) < 'T' (0x54),
 * so without this a NEWER space-separated write from an older client always
 * lost against an OLDER ISO write — and a deleted loan payment came back.
 * Anything that is not exactly that shape passes through untouched.
 */
export function normStamp<T>(s: T): T {
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return (s.replace(' ', 'T') + '.000Z') as unknown as T;
  }
  return s;
}

/** Strict "remote is newer" on normalised stamps; a missing side never wins. */
export function isNewerStamp(remote: unknown, local: unknown): boolean {
  const r = typeof remote === 'string' ? normStamp(remote) : '';
  const l = typeof local === 'string' ? normStamp(local) : '';
  return r !== '' && r > l;
}

const STAMP_KEYS = ['updatedAt', 'updated_at', 'deletedAt', 'deleted_at', 'createdAt', 'created_at'] as const;

/** Shallow copy of an incoming row with every stamp column normalised (see normStamp). */
function withNormStamps<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const k of STAMP_KEYS) {
    if (k in out) out[k] = normStamp(out[k]);
  }
  return out as T;
}

/**
 * Runs one table's merge inside its OWN savepoint. One corrupt record used to
 * abort the ENTIRE pull — a subtask whose task doesn't exist locally, a
 * transaction with no `type` — and everything else in the payload (accounts,
 * budgets, cards, loans…) was rolled back and lost, on every pull, forever,
 * because the bad row lives in the cloud. Now the bad table's work is
 * discarded (logged) and the rest of the pull still lands.
 */
function step(db: SqlDatabase, label: string, fn: () => void): void {
  const sp = db.transaction(fn);
  try {
    sp();
  } catch (err) {
    console.error(`[Sync] "${label}" failed, skipping that table:`, err);
  }
}

/**
 * The deterministic «Efectivo» account (finance v17 seed). The stamp is the
 * epoch ON PURPOSE: migrations and clearUserData both run before the first
 * pull, and a seed stamped 'now' beat a real tombstone from another device by
 * last-write-wins — the deleted account came back everywhere.
 */
const EPOCH_STAMP = '1970-01-01T00:00:00.000Z';
const SEED_CASH_ACCOUNT_SQL = `
  INSERT OR IGNORE INTO finance_accounts
    (id, name, kind, currency, initial_balance, account_order, created_at, updated_at)
  VALUES ('account-cash-default', 'Efectivo', 'cash', 'ARS', 0, 0, '${EPOCH_STAMP}', '${EPOCH_STAMP}')
`;

interface SyncTask {
  id: string;
  name: string;
  description: string;
  status: number;
  tier: number;
  category: string;
  projectId: string | null;
  dueDate: string | null;
  order: number;
  completedAt: string | null;
  repeatRule?: string | null;
  repeatOf?: string | null;
  /** quests v14: NULL/absent = the fixed-due-date cadence, 'completion' = from the tick. */
  repeatAnchor?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncSubtask {
  id: string;
  taskId: string;
  name: string;
  description: string;
  tier: number;
  status: number;
  order: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncProject {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncCategory {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncHabit {
  id: string;
  name: string;
  frequency: string;
  timesPerWeek: number;
  /** Comma list '1,3,5' (ISO weekdays) or null = count-based. */
  specificDays?: string | null;
  shieldCount?: number;
  lastShieldStreak?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncHabitCheck {
  id: string;
  habitId: string;
  date: string;
  /** 'check' | 'skip' | 'shield'; absent on pre-Fase-1 rows/docs = 'check'. */
  kind?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncDrawing {
  id: string;
  taskId: string;
  data: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface SyncRpgEvent {
  /** Cross-device identity. `id` (AUTOINCREMENT) is local-only and no longer sent. */
  syncId?: string;
  id?: number;
  refId?: string | null;
  moduleId: string;
  eventType: string;
  xpGained: number;
  hpChange: number;
  comboMultiplier: number;
  bonusMultiplier: number;
  payload: string;
  createdAt: string;
}

interface SyncQuestData {
  tasks: SyncTask[];
  subtasks: SyncSubtask[];
  projects: SyncProject[];
  categories: SyncCategory[];
  habits: SyncHabit[];
  habitChecks: SyncHabitCheck[];
  drawings: SyncDrawing[];
  rpgEvents?: SyncRpgEvent[];
  /** Fase 2: union pura entre dispositivos — un logro desbloqueado en cualquiera queda en todos. */
  achievements?: Array<{ id: string; unlockedAt: string; updatedAt: string }>;
  /** Fase 2: PK = date; el primer sello gana, re-sellar no existe. */
  daySeals?: Array<{ date: string; sealedAt: string; xpAwarded: number; vigor: number;
                     eventsCount: number; modules: string; updatedAt: string }>;
  /** Fase 3: append-only ledger. Union por id; ganancias con guard (reason, ref_id). */
  obolosLedger?: Array<{ id: string; delta: number; reason: string; refId: string | null;
                         createdAt: string; updatedAt: string }>;
  /** Fase 3: recompensas propias — LWW por updatedAt, soft-delete. */
  rewards?: Array<{ id: string; name: string; cost: number; icon: string | null;
                    createdAt: string; updatedAt: string; deletedAt: string | null }>;
  /** Fase 4: ids deterministas — unión pura colapsa la doble compra entre devices. */
  shopPurchases?: Array<{ id: string; itemId: string; purchasedAt: string; updatedAt: string }>;
  /** Fase 4: acumulador monotónico — converge por MAX(xp) por módulo. */
  masteryXp?: Array<{ moduleId: string; xp: number; updatedAt: string }>;
}

const USER_DATA_TABLES = [
  'player_stats',
  'rpg_events',
  'achievements_unlocked',
  'day_seals',
  'obolos_ledger',
  'rewards',
  'shop_purchases',
  'mastery_xp',
  'finance_budgets',
  'finance_accounts',
  'user_profile',
  'character_data',
  'tasks',
  'subtasks',
  'task_categories',
  'projects',
  'task_drawings',
  'habits',
  'habit_checks',
  'finance_transactions',
  'finance_loans',
  'finance_categories',
  'nutrition_profile',
  'food_log',
  'frequent_foods',
  'nutrition_daily_metrics',
  'nutrition_weekly_metrics',
  'nutrition_daily_summary',
  'nutrition_daily_closed',
  'nutrition_weekly_closed',
  'favorite_foods',
  // Only its source = 'user' rows are exported/merged (they are the user's
  // corrections); listing it here also clears it on an account switch, so
  // one account's cache never answers for another.
  'nutrition_ai_cache',
  'dollar_cache',
  'crypto_cache',
  'finance_recurring',
  'finance_recurring_amount_history',
  'finance_installment_groups',
  'finance_loan_payments',
  'finance_category_mappings',
  'finance_credit_cards',
  'finance_credit_card_statements',
  'notifications',
  'cauldron_presets',
  'cauldron_sessions',
  // Holds the real imported-statement metadata, and finance_transactions.import_batch_id
  // points at it — leaving it out leaked one account's imports into the next.
  'finance_import_batches',
  // Legacy but still carries user rows on older installs.
  'finance_income_sources',
];

/**
 * app_state is NOT in USER_DATA_TABLES: it also stores `last_uid`, which must
 * survive an account switch. These keys are per-user preferences and must not.
 */
const USER_PREFERENCE_STATE_KEYS = [
  'dollar_visible_types',
  'crypto_visible_types',
  // Shop equipment is per-device and never syncs — but it IS per-account: the
  // frame account A bought must not stay dressed on account B after a switch.
  'equipped_seal_style',
  'equipped_frame',
  'equipped_background',
];

/**
 * How much rpg_events history is pushed to Firestore. The whole log used to go
 * into the `questify` field of the main user document — one event per task,
 * habit, meal and expense, never pruned — so an active account eventually
 * crossed Firestore's 1 MB per-document cap and EVERY push started failing.
 */
const RPG_EVENTS_PUSH_DAYS = 90;

/** Local rpg_events older than this are deleted on startup. */
const RPG_EVENTS_RETENTION_DAYS = 365;

// Both windows cut on the LOCAL day (daysAgoDateString), like every other
// "today" in the app: rpg_events.created_at is written by localTimestamp(), so
// a UTC cutoff was off by one day for anyone west of Greenwich.

/** Drops rpg_events older than the retention window so the log stops growing forever. */
export function pruneRpgEvents(db: SqlDatabase): number {
  try {
    const info = db.prepare('DELETE FROM rpg_events WHERE created_at < ?')
      .run(daysAgoDateString(RPG_EVENTS_RETENTION_DAYS));
    return info.changes;
  } catch (err) {
    console.error('[Sync] rpg_events prune failed (non-fatal):', err);
    return 0;
  }
}

// Merges remote habit checks into local with last-write-wins.
// The natural key is (habit_id, date) — enforced by UNIQUE in the schema — NOT the
// surrogate `id`. The same logical check can arrive under a different id from another
// device/account; a plain INSERT would then violate UNIQUE(habit_id, date), throw, and
// roll back the ENTIRE questify merge transaction.
// Defense-in-depth: an UPSERT makes that conflict structurally harmless — instead of
// throwing, it reconciles in place. The WHERE on DO UPDATE preserves last-write-wins so
// a stale remote never clobbers a newer local row.
export function mergeHabitChecks(db: SqlDatabase, checks: SyncHabitCheck[]): boolean {
  let changed = false;
  // `kind` semantics: a remote that never heard of `kind` (old device, Syl before
  // the field existed) carries NO opinion about it — clobbering a local 'skip'
  // with an implicit default would destroy intent the remote never expressed.
  // So: an EXPLICIT remote kind wins by LWW like everything else; an absent one
  // preserves whatever the local row says (COALESCE with the current value).
  // The local stamp may still be a datetime('now') backfill (quests v6), so it
  // is normalised inline the same way normStamp() treats the incoming one.
  const upsert = db.prepare(`
    INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET
      kind = COALESCE(?, habit_checks.kind),
      deleted_at = excluded.deleted_at,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > CASE
      WHEN habit_checks.updated_at LIKE '____-__-__ __:__:__'
        THEN replace(habit_checks.updated_at, ' ', 'T') || '.000Z'
      ELSE habit_checks.updated_at END
  `);

  const VALID_KINDS = new Set(['check', 'skip', 'shield']);
  for (const raw of checks) {
    const rc = withNormStamps(raw);
    const explicitKind = VALID_KINDS.has(rc.kind as string) ? (rc.kind as string) : null;
    const info = upsert.run(
      rc.id, rc.habitId, rc.date,
      explicitKind ?? 'check', // a brand-new row without kind is a plain check
      rc.createdAt, rc.updatedAt, rc.deletedAt,
      explicitKind,            // the DO UPDATE only overrides when stated
    );
    if (info.changes > 0) changed = true;
  }
  return changed;
}

/**
 * Merges the two AUTOINCREMENT-keyed nutrition tables (frequent_foods, then
 * food_log, which references them) and recalculates every affected day's summary.
 *
 * Exported — like mergeHabitChecks — so the cross-device identity rules can be
 * tested directly against an in-memory database.
 */
export function mergeNutritionFoods(
  db: SqlDatabase,
  d: { frequentFoods?: Array<Record<string, any>>; foodLog?: Array<Record<string, any>> },
): { changed: boolean; affectedDates: Set<string> } {
  const affectedDates = new Set<string>();
  let changed = false;

  // ── Frequent foods ──
  // Merged BEFORE food_log, which references them, and keyed by sync_id rather
  // than the AUTOINCREMENT id (two devices mint the same numbers for different
  // foods, so the old id-keyed merge dropped rows and cross-applied deletes).
  if (Array.isArray(d.frequentFoods)) step(db, 'frequentFoods', () => {
    const getFreqBySync = db.prepare('SELECT id, updated_at FROM frequent_foods WHERE sync_id = ?');
    const getFreqByName = db.prepare('SELECT id, updated_at FROM frequent_foods WHERE name = ? COLLATE NOCASE');
    const insertFreq = db.prepare('INSERT INTO frequent_foods (sync_id, name, calories, ai_breakdown, protein_g, carbs_g, fat_g, times_used, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const updateFreq = db.prepare('UPDATE frequent_foods SET calories = ?, ai_breakdown = ?, protein_g = ?, carbs_g = ?, fat_g = ?, times_used = ?, updated_at = ?, deleted_at = ? WHERE id = ?');
    const adoptFreqSync = db.prepare('UPDATE frequent_foods SET sync_id = ? WHERE id = ? AND sync_id IS NULL AND NOT EXISTS (SELECT 1 FROM frequent_foods WHERE sync_id = ?)');

    for (const raw of d.frequentFoods!) {
      if (!isUsableRow(raw, 'frequentFoods', ['name', 'calories'])) continue;
      const f = withNormStamps(raw);
      // Same deterministic shape the nutrition v10 backfill used, so a payload
      // from a device that has not upgraded yet still lines up.
      const syncId: string = (typeof f.sync_id === 'string' && f.sync_id)
        ? f.sync_id
        : `legacy-${String(f.name).toLowerCase()}`;

      let local = getFreqBySync.get(syncId) as { id: number; updated_at: string | null } | undefined;
      if (!local) {
        // name is UNIQUE COLLATE NOCASE — adopt the existing row instead of
        // colliding with it.
        const byName = getFreqByName.get(f.name) as { id: number; updated_at: string | null } | undefined;
        if (byName) {
          adoptFreqSync.run(syncId, byName.id, syncId);
          local = byName;
        }
      }

      if (!local) {
        insertFreq.run(syncId, f.name, f.calories, f.ai_breakdown ?? null,
          f.protein_g ?? null, f.carbs_g ?? null, f.fat_g ?? null,
          f.times_used ?? 0, f.created_at ?? f.updated_at ?? null, f.updated_at ?? null, f.deleted_at ?? null);
        changed = true;
      } else if (isNewerStamp(f.updated_at, local.updated_at)) {
        updateFreq.run(f.calories, f.ai_breakdown ?? null,
          f.protein_g ?? null, f.carbs_g ?? null, f.fat_g ?? null,
          f.times_used ?? 0, f.updated_at, f.deleted_at ?? null, local.id);
        changed = true;
      }
    }
  });

  // ── Food log ──
  // Keyed by sync_id. Verified failure of the old id-keyed merge: 2 own meals on
  // each device merged to 2 rows instead of 4, and the LWW pass then wrote the
  // remote's deleted_at onto whichever unrelated local row shared the number.
  if (Array.isArray(d.foodLog)) step(db, 'foodLog', () => {
    type LocalFood = {
      id: number; sync_id: string | null; date: string; updated_at: string | null; source: string;
      frequent_food_id: number | null; ai_breakdown: string | null; meal: string | null;
      is_event: number; event_kcal_min: number | null; event_kcal_max: number | null;
      protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    };
    const LOCAL_COLS = 'id, sync_id, date, updated_at, source, frequent_food_id, ai_breakdown, meal, is_event, event_kcal_min, event_kcal_max, protein_g, carbs_g, fat_g';
    const getFoodBySync = db.prepare(`SELECT ${LOCAL_COLS} FROM food_log WHERE sync_id = ?`);
    // Prefer the row that already has an identity: when an anonymous twin sits
    // next to the real row, a sync_id-less payload must land on the real one.
    const getFoodByNatural = db.prepare(`SELECT ${LOCAL_COLS} FROM food_log WHERE date = ? AND time = ? AND description = ? AND calories = ? ORDER BY (sync_id IS NULL), id LIMIT 1`);
    const deleteFood = db.prepare('DELETE FROM food_log WHERE id = ?');
    const insertFood = db.prepare('INSERT INTO food_log (sync_id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, is_event, event_kcal_min, event_kcal_max, protein_g, carbs_g, fat_g, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    // Full last-write-wins, same shape as the INSERT. This used to write ONLY
    // deleted_at + updated_at: an edit (800 → 1200 kcal, +protein, event → meal)
    // never crossed, but the row still ADOPTED the newer stamp — so the stale
    // values were pushed back to the cloud as the "newest" version, for good.
    const updateFood = db.prepare('UPDATE food_log SET date = ?, time = ?, description = ?, calories = ?, source = ?, frequent_food_id = ?, ai_breakdown = ?, meal = ?, is_event = ?, event_kcal_min = ?, event_kcal_max = ?, protein_g = ?, carbs_g = ?, fat_g = ?, updated_at = ?, deleted_at = ? WHERE id = ?');
    const adoptFoodSync = db.prepare('UPDATE food_log SET sync_id = ? WHERE id = ? AND sync_id IS NULL AND NOT EXISTS (SELECT 1 FROM food_log WHERE sync_id = ?)');
    const freqBySync = db.prepare('SELECT id FROM frequent_foods WHERE sync_id = ?');

    // Sweep the twins an id-keyed client (v0.7.5, still installed on the
    // owner's desktop) leaves next to the rows this codebase identifies. The v16
    // repair runs once at boot; this runs on every pull, so a twin never
    // outlives the next sync. BEFORE the payload lands: a tombstone that reaches
    // the real row must not leave an anonymous copy behind as the only live one.
    // The loop below never creates a twin (it neither inserts without sync_id
    // nor inserts a legacy- row next to a natural-key match), so once is enough.
    // Hard delete — see FOOD_LOG_TWIN_IDS_SQL.
    for (const twin of db.prepare(FOOD_LOG_TWIN_IDS_SQL).all() as Array<{ id: number; date: string }>) {
      deleteFood.run(twin.id);
      affectedDates.add(twin.date);
      changed = true;
    }

    for (const raw of d.foodLog!) {
      if (!isUsableRow(raw, 'foodLog', ['date', 'time', 'description', 'calories'])) continue;
      const f = withNormStamps(raw);

      // food_log.frequent_food_id points at the LOCAL frequent_foods.id, which
      // identifies a different food on every device — re-resolve it by sync_id.
      let frequentFoodId: number | null = null;
      if (f.frequent_food_sync_id) {
        const ff = freqBySync.get(f.frequent_food_sync_id) as { id: number } | undefined;
        frequentFoodId = ff?.id ?? null;
      }

      const hasRemoteId = typeof f.sync_id === 'string' && !!f.sync_id;
      const syncId: string = hasRemoteId
        ? f.sync_id
        : `legacy-${f.date}|${f.time}|${f.calories}|${String(f.description).slice(0, 60)}`;

      let local = getFoodBySync.get(syncId) as LocalFood | undefined;
      if (!local) {
        const byNatural = getFoodByNatural.get(f.date, f.time, f.description, f.calories) as LocalFood | undefined;
        if (byNatural) {
          // Same meal, but the payload names it by ANOTHER identity than the one
          // this device already holds: that is a foreign copy (an id-keyed
          // client's twin), not an edit. Inserting it would duplicate the meal;
          // applying its stamps would let a twin's tombstone delete the real row.
          // A payload with no identity at all (pre-0.8 client) still speaks for
          // the meal through its natural key, as before.
          if (hasRemoteId && byNatural.sync_id && byNatural.sync_id !== syncId) continue;
          adoptFoodSync.run(syncId, byNatural.id, syncId);
          local = byNatural;
        }
      }

      if (!local) {
        insertFood.run(syncId, f.date, f.time, f.description, f.calories, f.source ?? 'manual', frequentFoodId, f.ai_breakdown ?? null, f.meal ?? null,
          f.is_event ?? 0, f.event_kcal_min ?? null, f.event_kcal_max ?? null,
          f.protein_g ?? null, f.carbs_g ?? null, f.fat_g ?? null,
          f.updated_at ?? null, f.deleted_at ?? null);
        affectedDates.add(f.date);
        changed = true;
      } else if (isNewerStamp(f.updated_at, local.updated_at)) {
        // Columns added after the first sync clients shipped (meal v6, the
        // event/protein set v13, frequent_food_sync_id v10): a payload without
        // the key carries no opinion — keep the local value. An explicit null
        // from a current client does win.
        const pick = <K extends keyof LocalFood>(key: string, localKey: K, dflt: LocalFood[K]): LocalFood[K] =>
          key in f ? ((f[key] as LocalFood[K] | null | undefined) ?? dflt) : local![localKey];
        updateFood.run(
          f.date, f.time, f.description, f.calories, f.source ?? local.source,
          'frequent_food_sync_id' in f ? frequentFoodId : local.frequent_food_id,
          f.ai_breakdown ?? null,
          pick('meal', 'meal', null),
          pick('is_event', 'is_event', 0),
          pick('event_kcal_min', 'event_kcal_min', null),
          pick('event_kcal_max', 'event_kcal_max', null),
          pick('protein_g', 'protein_g', null),
          pick('carbs_g', 'carbs_g', null),
          pick('fat_g', 'fat_g', null),
          f.updated_at ?? null, f.deleted_at ?? null, local.id,
        );
        // A row that merely flipped deleted_at changes that day's totals too.
        // Only freshly INSERTED rows used to trigger a recalc, so a delete synced
        // from another device left the two devices showing different daily totals.
        affectedDates.add(local.date);
        if (f.date) affectedDates.add(f.date);
        changed = true;
      }
    }
  });

  for (const date of affectedDates) {
    recalcSummary(db, date);
  }

  return { changed, affectedDates };

}

/**
 * Merges a remote questify payload into the local database with last-write-wins.
 *
 * Exported so the failure modes that used to abort an entire pull — an orphan
 * subtask or habit check, a null payload, a task with no name — can be tested
 * directly against an in-memory database.
 */
export function mergeQuestDataInto(db: SqlDatabase, remote: SyncQuestData): { changed: boolean } {
  let changed = false;

  // A null payload, or one missing the expected arrays, used to throw
  // "Cannot read properties of null" and abort the whole pull.
  if (!remote || typeof remote !== 'object') {
    console.warn('[Sync] mergeQuestData: ignoring non-object payload');
    return { changed: false };
  }
  // Every incoming row gets its stamps normalised (see normStamp) before any
  // last-write-wins comparison.
  const rows = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).map(withNormStamps) : []);

  // tasks.completed_at / subtasks.completed_at are LOCAL naive stamps since
  // quests v11 ('YYYY-MM-DD HH:MM:SS', or a bare 'YYYY-MM-DD'). An older client
  // (or Syl) still sends UTC ISO with a 'T'; stored verbatim it lands in the
  // wrong "today" range (a 23:00 ART completion sorts into tomorrow). Convert it
  // exactly the way the v11 backfill did: datetime(x, 'localtime').
  const toLocalNaive = db.prepare("SELECT datetime(?, 'localtime') AS v");
  const normCompletedAt = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null;
    if (!v.includes('T')) return v;
    const r = toLocalNaive.get(v) as { v: string | null } | undefined;
    return r?.v ?? v;
  };

  const tx = db.transaction(() => {
    // Every table runs inside its OWN savepoint (see step()).

    // ── Merge projects first (tasks reference them) ──
    step(db, 'projects', () => {
      const getProject = db.prepare('SELECT id, updated_at FROM projects WHERE id = ?');
      const insertProject = db.prepare(`
        INSERT INTO projects (id, name, color, project_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateProject = db.prepare(`
        UPDATE projects SET name = ?, color = ?, project_order = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);

      for (const rp of rows<SyncProject>(remote.projects)) {
        if (!isUsableRow(rp, 'projects', ['id', 'name'])) continue;
        const local = getProject.get(rp.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertProject.run(rp.id, rp.name, rp.color ?? '#8b7355', rp.order ?? 0, rp.createdAt, rp.updatedAt, rp.deletedAt);
          changed = true;
        } else if (isNewerStamp(rp.updatedAt, local.updated_at)) {
          updateProject.run(rp.name, rp.color ?? '#8b7355', rp.order ?? 0, rp.updatedAt, rp.deletedAt, rp.id);
          changed = true;
        }
      }
    });

    // ── Merge tasks ──
    step(db, 'tasks', () => {
      const getTask = db.prepare('SELECT id, updated_at, repeat_rule, repeat_of, repeat_anchor FROM tasks WHERE id = ?');
      const insertTask = db.prepare(`
        INSERT INTO tasks (id, name, description, status, tier, category, project_id, due_date, task_order, completed_at, repeat_rule, repeat_of, repeat_anchor, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateTask = db.prepare(`
        UPDATE tasks SET name = ?, description = ?, status = ?, tier = ?, category = ?,
               project_id = ?, due_date = ?, task_order = ?, completed_at = ?,
               repeat_rule = ?, repeat_of = ?, repeat_anchor = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      // tasks.project_id REFERENCES projects(id): a task pointing at a project this
      // device has never seen would fail the FK. Keep the task, drop the dangling link.
      const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');

      for (const rt of rows<SyncTask>(remote.tasks)) {
        // name is NOT NULL — a nameless task raised NOT NULL constraint failed and
        // took the whole pull down with it.
        if (!isUsableRow(rt, 'tasks', ['id', 'name'])) continue;
        const projectId = rt.projectId && projectExists.get(rt.projectId) ? rt.projectId : null;
        const local = getTask.get(rt.id) as { id: string; updated_at: string; repeat_rule: string | null; repeat_of: string | null; repeat_anchor: string | null } | undefined;
        // Only 'completion' is a real anchor; anything else stores as NULL so a
        // corrupt remote cannot invent a third mode nobody knows how to read.
        const remoteAnchor = rt.repeatAnchor === 'completion' ? 'completion' : null;
        if (!local) {
          insertTask.run(rt.id, rt.name, rt.description ?? '', rt.status ?? 0, rt.tier ?? 2, rt.category ?? '',
            projectId, rt.dueDate ?? null, rt.order ?? 0, normCompletedAt(rt.completedAt),
            rt.repeatRule ?? null, rt.repeatOf ?? null, remoteAnchor, rt.createdAt, rt.updatedAt, rt.deletedAt);
          changed = true;
        } else if (isNewerStamp(rt.updatedAt, local.updated_at)) {
          // A remote written by a client that predates repeat rules carries no
          // opinion on them (property absent) — LWW must not wipe the local
          // rule. An explicit null ("never") from a new client DOES win.
          const repeatRule = 'repeatRule' in rt ? rt.repeatRule ?? null : local.repeat_rule;
          const repeatOf = 'repeatOf' in rt ? rt.repeatOf ?? null : local.repeat_of;
          // Same rule for quests v14: a client that never heard of the anchor
          // sends no key at all, and that is silence, not "back to fixed".
          const repeatAnchor = 'repeatAnchor' in rt ? remoteAnchor : local.repeat_anchor;
          updateTask.run(rt.name, rt.description ?? '', rt.status ?? 0, rt.tier ?? 2, rt.category ?? '',
            projectId, rt.dueDate ?? null, rt.order ?? 0, normCompletedAt(rt.completedAt),
            repeatRule, repeatOf, repeatAnchor, rt.updatedAt, rt.deletedAt, rt.id);
          changed = true;
        }
      }
    });

    // ── Merge subtasks ──
    step(db, 'subtasks', () => {
      const getSubtask = db.prepare('SELECT id, updated_at FROM subtasks WHERE id = ?');
      const insertSubtask = db.prepare(`
        INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, completed_at, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateSubtask = db.prepare(`
        UPDATE subtasks SET name = ?, description = ?, tier = ?, status = ?,
               subtask_order = ?, completed_at = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      // subtasks.task_id is a NOT NULL foreign key: there is no way to keep an
      // orphan, so it is dropped (logged) instead of aborting the pull.
      const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');

      for (const rs of rows<SyncSubtask>(remote.subtasks)) {
        if (!isUsableRow(rs, 'subtasks', ['id', 'taskId', 'name'])) continue;
        const local = getSubtask.get(rs.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          if (!taskExists.get(rs.taskId)) {
            console.warn(`[Sync] mergeQuestData: dropping orphan subtask ${rs.id} (task ${rs.taskId} not found)`);
            continue;
          }
          insertSubtask.run(rs.id, rs.taskId, rs.name, rs.description ?? '', rs.tier ?? 2, rs.status ?? 0,
            rs.order ?? 0, normCompletedAt(rs.completedAt), rs.createdAt, rs.updatedAt, rs.deletedAt);
          changed = true;
        } else if (isNewerStamp(rs.updatedAt, local.updated_at)) {
          updateSubtask.run(rs.name, rs.description ?? '', rs.tier ?? 2, rs.status ?? 0,
            rs.order ?? 0, normCompletedAt(rs.completedAt), rs.updatedAt, rs.deletedAt, rs.id);
          changed = true;
        }
      }
    });

    // ── Merge categories (keyed by id) ──
    step(db, 'categories', () => {
      const getCategory = db.prepare('SELECT id, updated_at FROM task_categories WHERE id = ?');
      const insertCategory = db.prepare(`
        INSERT OR IGNORE INTO task_categories (id, name, project_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateCategory = db.prepare(`
        UPDATE task_categories SET name = ?, project_id = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      const projectExists = db.prepare('SELECT 1 FROM projects WHERE id = ?');

      for (const rc of rows<SyncCategory>(remote.categories)) {
        if (!isUsableRow(rc, 'categories', ['id', 'name'])) continue;
        const projectId = rc.projectId && projectExists.get(rc.projectId) ? rc.projectId : null;
        const local = getCategory.get(rc.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          insertCategory.run(rc.id, rc.name, projectId, rc.createdAt, rc.updatedAt, rc.deletedAt);
          changed = true;
        } else if (isNewerStamp(rc.updatedAt, local.updated_at)) {
          updateCategory.run(rc.name, projectId, rc.updatedAt, rc.deletedAt, rc.id);
          changed = true;
        }
      }
    });

    // ── Merge habits ──
    step(db, 'habits', () => {
      const getHabit = db.prepare('SELECT id, updated_at, specific_days, shield_count, last_shield_streak FROM habits WHERE id = ?');
      const insertHabit = db.prepare(`
        INSERT INTO habits (id, name, frequency, times_per_week, specific_days, shield_count, last_shield_streak, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateHabit = db.prepare(`
        UPDATE habits SET name = ?, frequency = ?, times_per_week = ?, specific_days = ?, shield_count = ?, last_shield_streak = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);

      for (const rh of rows<SyncHabit>(remote.habits)) {
        if (!isUsableRow(rh, 'habits', ['id', 'name'])) continue;
        // times_per_week is clamped to 1..7 here, NOT trusted: a 0 arriving from
        // sync (or from Syl via firebase-admin) makes computeHabits' weekly-streak
        // loop non-terminating and hangs the whole main process.
        const timesPerWeek = weeklyTarget(rh.timesPerWeek);
        const frequency = rh.frequency === 'weekly' || rh.frequency === 'monthly' ? rh.frequency : 'daily';
        const local = getHabit.get(rh.id) as { id: string; updated_at: string; specific_days: string | null; shield_count: number; last_shield_streak: number } | undefined;
        // specific_days is a comma list of 1..7 or NULL; shields are clamped so a
        // corrupt remote cannot mint infinite forgiveness.
        const specificDays = typeof rh.specificDays === 'string' && /^[1-7](,[1-7])*$/.test(rh.specificDays) ? rh.specificDays : null;
        const shieldCount = Math.max(0, Math.min(3, Number(rh.shieldCount) || 0));
        const lastShieldStreak = Math.max(0, Number(rh.lastShieldStreak) || 0);
        if (!local) {
          insertHabit.run(rh.id, rh.name, frequency, timesPerWeek, specificDays, shieldCount, lastShieldStreak, rh.createdAt, rh.updatedAt ?? rh.createdAt, rh.deletedAt);
          changed = true;
        } else if (isNewerStamp(rh.updatedAt ?? rh.createdAt, local.updated_at)) {
          // Same rule as tasks.repeatRule: a client that predates quests v12
          // (or Syl via firebase-admin) sends no shield/specific-day keys at
          // all — that is no opinion, not "0 / 0 / NULL". Renaming a habit on
          // an old phone used to wipe two earned shields and turn Mon/Wed/Fri
          // back into "3 times a week".
          updateHabit.run(rh.name, frequency, timesPerWeek,
            'specificDays' in rh ? specificDays : local.specific_days,
            'shieldCount' in rh ? shieldCount : local.shield_count,
            'lastShieldStreak' in rh ? lastShieldStreak : local.last_shield_streak,
            rh.updatedAt ?? rh.createdAt, rh.deletedAt, rh.id);
          changed = true;
        }
      }
    });

    // ── Merge drawings ──
    step(db, 'drawings', () => {
      const getDrawing = db.prepare('SELECT id, updated_at FROM task_drawings WHERE id = ?');
      const insertDrawing = db.prepare(`
        INSERT INTO task_drawings (id, task_id, data, draw_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateDrawing = db.prepare(`
        UPDATE task_drawings SET data = ?, draw_order = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');

      for (const rd of rows<SyncDrawing>(remote.drawings)) {
        if (!isUsableRow(rd, 'drawings', ['id', 'taskId', 'data'])) continue;
        const local = getDrawing.get(rd.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          if (!taskExists.get(rd.taskId)) {
            console.warn(`[Sync] mergeQuestData: dropping orphan drawing ${rd.id} (task ${rd.taskId} not found)`);
            continue;
          }
          insertDrawing.run(rd.id, rd.taskId, rd.data, rd.order ?? 0, rd.createdAt, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null);
          changed = true;
        } else if (isNewerStamp(rd.updatedAt ?? rd.createdAt, local.updated_at)) {
          updateDrawing.run(rd.data, rd.order ?? 0, rd.updatedAt ?? rd.createdAt, rd.deletedAt ?? null, rd.id);
          changed = true;
        }
      }
    });

    // ── Merge habit checks (keyed by natural key habit_id+date, see mergeHabitChecks) ──
    step(db, 'habitChecks', () => {
      // habit_checks.habit_id is a NOT NULL foreign key — same orphan class of
      // failure as subtasks (see commit a4a408a).
      const habitExists = db.prepare('SELECT 1 FROM habits WHERE id = ?');
      const usable = rows<SyncHabitCheck>(remote.habitChecks).filter((rc) => {
        if (!isUsableRow(rc, 'habitChecks', ['id', 'habitId', 'date'])) return false;
        if (!habitExists.get(rc.habitId)) {
          console.warn(`[Sync] mergeQuestData: dropping orphan habit check ${rc.id} (habit ${rc.habitId} not found)`);
          return false;
        }
        return true;
      });
      if (usable.length && mergeHabitChecks(db, usable)) changed = true;
    });

    // ── Merge RPG events (deduplicated by sync_id) ──
    step(db, 'rpgEvents', () => {
      // NOT by `id`: rpg_events.id is AUTOINCREMENT, so both devices mint 1, 2, 3…
      // for different events and the old `WHERE id = ?` check silently dropped
      // half of them. `id` is now left to the local sequence entirely.
      const getEvent = db.prepare('SELECT 1 FROM rpg_events WHERE sync_id = ?');
      // The same event under ANOTHER identity: same content, same second (the
      // stamp folded to 'YYYY-MM-DD HH:MM:SS', since an id-keyed client stored
      // the ISO form normStamp() gave it). ref_id is not part of the key — that
      // client never wrote it. Prefers the identified row over an anonymous one
      // so a payload lands on the real row when both are still around.
      const getEventByNatural = db.prepare(`
        SELECT id, sync_id FROM rpg_events
        WHERE module_id = ? AND event_type = ? AND xp_gained = ? AND hp_change = ?
          AND combo_multiplier = ? AND bonus_multiplier = ? AND COALESCE(payload, '') = ?
          AND substr(replace(created_at, 'T', ' '), 1, 19) = ?
        ORDER BY (sync_id IS NULL), (sync_id LIKE 'legacy-%'), id LIMIT 1
      `);
      const adoptEventSync = db.prepare('UPDATE rpg_events SET sync_id = ? WHERE id = ?');
      const deleteEvent = db.prepare('DELETE FROM rpg_events WHERE id = ?');
      const insertEvent = db.prepare(`
        INSERT OR IGNORE INTO rpg_events (sync_id, module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Sweep the twins an id-keyed client (v0.7.5, still installed on the
      // owner's desktop) leaves next to the rows this codebase identifies. The
      // core v7 repair runs once at boot; this runs on every pull, so a twin
      // never outlives the next sync. BEFORE the payload lands, so the natural
      // key below meets one row per event. Hard delete — see
      // RPG_EVENTS_TWIN_IDS_SQL.
      for (const twin of db.prepare(RPG_EVENTS_TWIN_IDS_SQL).all() as Array<{ id: number }>) {
        deleteEvent.run(twin.id);
        changed = true;
      }

      for (const re of rows<SyncRpgEvent>(remote.rpgEvents)) {
        // Pre-sync_id payloads carried only the numeric id; there is no way to
        // identify them across devices, so they are skipped rather than duplicated.
        if (!re || typeof re.syncId !== 'string' || !re.syncId) continue;
        // module_id / event_type / created_at are NOT NULL: one malformed event
        // used to discard the whole 90-day batch, not the row.
        if (!isUsableRow(re, 'rpgEvents', ['syncId', 'moduleId', 'eventType', 'createdAt'])) continue;
        if (getEvent.get(re.syncId)) continue;

        const byNatural = getEventByNatural.get(
          re.moduleId, re.eventType, re.xpGained ?? 0, re.hpChange ?? 0,
          re.comboMultiplier ?? 1, re.bonusMultiplier ?? 1, re.payload ?? '',
          String(re.createdAt).replace('T', ' ').slice(0, 19),
        ) as { id: number; sync_id: string | null } | undefined;
        if (byNatural) {
          // We already hold this event. If ours is the weaker identity (none,
          // or a legacy- backfill of a twin) it adopts the remote one, so both
          // devices converge on a single sync_id; otherwise the payload row is
          // a foreign copy and inserting it would duplicate the event. Two
          // distinct events never meet here: a different task changes the
          // payload, a different second changes the stamp.
          const remoteIsUuid = !re.syncId.startsWith('legacy-');
          if (byNatural.sync_id === null || (remoteIsUuid && byNatural.sync_id.startsWith('legacy-'))) {
            adoptEventSync.run(re.syncId, byNatural.id);
            changed = true;
          }
          continue;
        }

        const result = insertEvent.run(
          re.syncId, re.moduleId, re.eventType, re.xpGained ?? 0, re.hpChange ?? 0,
          re.comboMultiplier ?? 1, re.bonusMultiplier ?? 1, re.payload ?? null,
          re.refId ?? null, re.createdAt,
        );
        if (result.changes > 0) changed = true;
      }
    });

    step(db, 'achievements', () => {
      // Pure union: PK is the catalog id, INSERT OR IGNORE, never deleted.
      const ins = db.prepare(
        'INSERT OR IGNORE INTO achievements_unlocked (id, unlocked_at, updated_at) VALUES (?, ?, ?)',
      );
      for (const a of rows<{ id: string; unlockedAt: string; updatedAt: string }>(remote.achievements)) {
        if (!a || typeof a.id !== 'string' || !a.id) continue;
        const r = ins.run(a.id, a.unlockedAt ?? a.updatedAt, a.updatedAt ?? a.unlockedAt);
        if (r.changes > 0) changed = true;
      }
    });

    step(db, 'daySeals', () => {
      // First seal wins (PK = date); a day cannot be re-sealed, so LWW is moot.
      const ins = db.prepare(`
        INSERT OR IGNORE INTO day_seals (date, sealed_at, xp_awarded, vigor, events_count, modules, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of rows<{ date: string; sealedAt: string; xpAwarded: number; vigor: number;
                             eventsCount: number; modules: string; updatedAt: string }>(remote.daySeals)) {
        if (!d || typeof d.date !== 'string' || !d.date) continue;
        const r = ins.run(
          d.date, d.sealedAt ?? d.updatedAt, d.xpAwarded ?? 0, d.vigor ?? 100,
          d.eventsCount ?? 0, typeof d.modules === 'string' ? d.modules : '[]', d.updatedAt ?? d.sealedAt,
        );
        if (r.changes > 0) changed = true;
      }
    });

    step(db, 'obolosLedger', () => {
      // Append-only ledger: pure union by id. Earnings (delta > 0) carry one
      // extra guard — the same (reason, ref_id) earned on two devices before
      // they synced has two different uuids, and paying it twice would mint
      // money. Spends have no guard: two legitimate redeems must both survive.
      //
      // DOCUMENTED TRADE-OFF: the merge does NOT re-validate the balance. Two
      // devices that each spent against the same pre-sync balance (A redeems
      // 300, B buys for 200, both from a 400 balance) converge on -100 here —
      // the ledger never lies about what was spent. The engine is what holds
      // the line: redeemReward / purchaseShopItem check SUM(delta) at spend
      // time and answer `insufficient` until the balance climbs back. Pinned
      // by tests/modules/sync/sync-integrity.test.ts.
      const existsEarning = db.prepare(
        'SELECT 1 FROM obolos_ledger WHERE reason = ? AND ref_id = ? AND delta > 0',
      );
      const ins = db.prepare(`
        INSERT OR IGNORE INTO obolos_ledger (id, delta, reason, ref_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const o of rows<{ id: string; delta: number; reason: string; refId: string | null;
                             createdAt: string; updatedAt: string }>(remote.obolosLedger)) {
        if (!o || typeof o.id !== 'string' || !o.id || typeof o.delta !== 'number') continue;
        if (o.delta > 0 && o.refId && existsEarning.get(o.reason, o.refId)) continue;
        const r = ins.run(o.id, o.delta, o.reason ?? 'day_sealed', o.refId ?? null,
          o.createdAt ?? o.updatedAt, o.updatedAt ?? o.createdAt);
        if (r.changes > 0) changed = true;
      }
    });

    step(db, 'rewards', () => {
      // LWW by updated_at; a soft-delete travels as one more column and wins
      // like any other newer write.
      const getReward = db.prepare('SELECT id, updated_at FROM rewards WHERE id = ?');
      const ins = db.prepare(`
        INSERT OR IGNORE INTO rewards (id, name, cost, icon, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const upd = db.prepare(`
        UPDATE rewards SET name = ?, cost = ?, icon = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      for (const rw of rows<{ id: string; name: string; cost: number; icon: string | null;
                              createdAt: string; updatedAt: string; deletedAt: string | null }>(remote.rewards)) {
        if (!rw || typeof rw.id !== 'string' || !rw.id || typeof rw.name !== 'string') continue;
        const local = getReward.get(rw.id) as { id: string; updated_at: string } | undefined;
        const remoteUpdated = rw.updatedAt ?? rw.createdAt;
        if (!local) {
          const r = ins.run(rw.id, rw.name, rw.cost ?? 0, rw.icon ?? null,
            rw.createdAt ?? remoteUpdated, remoteUpdated, rw.deletedAt ?? null);
          if (r.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdated, local.updated_at)) {
          upd.run(rw.name, rw.cost ?? 0, rw.icon ?? null, remoteUpdated, rw.deletedAt ?? null, rw.id);
          changed = true;
        }
      }
    });

    step(db, 'shopPurchases', () => {
      // Pure union: purchase ids are deterministic (item id, or pardon:YYYY-MM),
      // so the same purchase made on two devices collapses to one row here —
      // and its obolos_ledger entry (also deterministic) collapses with it.
      const ins = db.prepare(
        'INSERT OR IGNORE INTO shop_purchases (id, item_id, purchased_at, updated_at) VALUES (?, ?, ?, ?)',
      );
      for (const sp of rows<{ id: string; itemId: string; purchasedAt: string; updatedAt: string }>(remote.shopPurchases)) {
        if (!sp || typeof sp.id !== 'string' || !sp.id || typeof sp.itemId !== 'string') continue;
        const r = ins.run(sp.id, sp.itemId, sp.purchasedAt ?? sp.updatedAt, sp.updatedAt ?? sp.purchasedAt);
        if (r.changes > 0) changed = true;
      }
    });

    step(db, 'masteryXp', () => {
      // Monotonic accumulator: converge on MAX(xp) per module. Two devices
      // accumulating in parallel can lose the smaller delta between syncs —
      // accepted trade-off, mastery is cosmetic and only ever climbs.
      const ins = db.prepare(
        'INSERT OR IGNORE INTO mastery_xp (module_id, xp, updated_at) VALUES (?, ?, ?)',
      );
      const upd = db.prepare(
        'UPDATE mastery_xp SET xp = MAX(xp, ?), updated_at = ? WHERE module_id = ? AND xp < ?',
      );
      for (const mx of rows<{ moduleId: string; xp: number; updatedAt: string }>(remote.masteryXp)) {
        if (!mx || typeof mx.moduleId !== 'string' || !mx.moduleId || typeof mx.xp !== 'number') continue;
        const r = ins.run(mx.moduleId, Math.max(0, mx.xp), mx.updatedAt ?? null);
        if (r.changes === 0) {
          const u = upd.run(mx.xp, mx.updatedAt ?? null, mx.moduleId, mx.xp);
          if (u.changes > 0) changed = true;
        } else {
          changed = true;
        }
      }
    });
  });

  tx();
  return { changed };
}

export function registerSyncIpcHandlers(): void {
  pruneRpgEvents(getDb());

  ipcHandle('sync:clearUserData', () => {
    clearUserDataInto(getDb());
    return { success: true };
  });

  // app_state is created by initCoreTables (shared-logic/db/migrate.ts), not ad-hoc here:
  // dollar:getVisibleTypes reads it without creating it, so on a clean install
  // where neither of these handlers had run yet it threw "no such table".
  ipcHandle('sync:setCurrentUser', (_e, uid: string) => {
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_uid', ?)`).run(uid);
  });

  ipcHandle('sync:getCurrentUser', () => {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_state WHERE key = 'last_uid'`).get() as { value: string } | undefined;
    return row?.value ?? null;
  });

  // Returns ALL quest data including soft-deleted, for push to Firebase
  ipcHandle('sync:getAllQuestData', () => {
    const db = getDb();

    const tasks = db.prepare(`
      SELECT id, name, description, status, tier, category,
             project_id AS projectId, due_date AS dueDate, task_order AS "order",
             completed_at AS completedAt,
             repeat_rule AS repeatRule, repeat_of AS repeatOf, repeat_anchor AS repeatAnchor,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM tasks
    `).all();

    const subtasks = db.prepare(`
      SELECT id, task_id AS taskId, name, description, tier, status,
             subtask_order AS "order", completed_at AS completedAt,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM subtasks
    `).all();

    const projects = db.prepare(`
      SELECT id, name, color, project_order AS "order",
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM projects
    `).all();

    const categories = db.prepare(`
      SELECT id, name, project_id AS projectId,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM task_categories
    `).all();

    const habits = db.prepare(`
      SELECT id, name, frequency, times_per_week AS timesPerWeek,
             specific_days AS specificDays,
             shield_count AS shieldCount,
             last_shield_streak AS lastShieldStreak,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM habits
    `).all();

    const habitChecks = db.prepare(`
      SELECT id, habit_id AS habitId, date, kind,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM habit_checks
    `).all();

    const drawings = db.prepare(`
      SELECT id, task_id AS taskId, data, draw_order AS "order",
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM task_drawings
    `).all();

    // Only the recent window is pushed — see RPG_EVENTS_PUSH_DAYS. sync_id (not the
    // local AUTOINCREMENT id) is the cross-device identity.
    const rpgEvents = db.prepare(`
      SELECT sync_id AS syncId, module_id AS moduleId, event_type AS eventType,
             xp_gained AS xpGained, hp_change AS hpChange,
             combo_multiplier AS comboMultiplier, bonus_multiplier AS bonusMultiplier,
             payload, ref_id AS refId, created_at AS createdAt
      FROM rpg_events WHERE created_at >= ? ORDER BY id ASC
    `).all(daysAgoDateString(RPG_EVENTS_PUSH_DAYS));

    const achievements = db.prepare(`
      SELECT id, unlocked_at AS unlockedAt, updated_at AS updatedAt FROM achievements_unlocked
    `).all();

    const daySeals = db.prepare(`
      SELECT date, sealed_at AS sealedAt, xp_awarded AS xpAwarded, vigor,
             events_count AS eventsCount, modules, updated_at AS updatedAt
      FROM day_seals
    `).all();

    const obolosLedger = db.prepare(`
      SELECT id, delta, reason, ref_id AS refId, created_at AS createdAt, updated_at AS updatedAt
      FROM obolos_ledger
    `).all();

    const rewards = db.prepare(`
      SELECT id, name, cost, icon, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM rewards
    `).all();

    const shopPurchases = db.prepare(`
      SELECT id, item_id AS itemId, purchased_at AS purchasedAt, updated_at AS updatedAt
      FROM shop_purchases
    `).all();

    const masteryXp = db.prepare(`
      SELECT module_id AS moduleId, xp, updated_at AS updatedAt FROM mastery_xp
    `).all();

    return { tasks, subtasks, projects, categories, habits, habitChecks, drawings, rpgEvents, achievements, daySeals, obolosLedger, rewards, shopPurchases, masteryXp };
  });

  // Merges remote quest data with local using last-write-wins
  ipcHandle('sync:mergeQuestData', (_e, remote: SyncQuestData) => mergeQuestDataInto(getDb(), remote));


  // ── Nutrition bulk export ──
  ipcHandle('sync:getAllNutritionData', () => {
    const db = getDb();

    const profile = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() || null;
    // sync_id is the cross-device identity for these two AUTOINCREMENT tables.
    // The device-local `id` is deliberately NOT exported. It used to travel "for
    // backward compatibility with older clients" — and that is exactly what
    // hurt them: a v0.7.5 client keys its merge on `id`, so a payload carrying
    // ANOTHER device's ids made it insert every meal it "did not have" as a new
    // row (16 twins, doubled totals, 2026-09-02). Without `id` that client falls
    // back to its natural-key path and duplicates nothing.
    // frequent_food_sync_id resolves food_log.frequent_food_id, which points at the
    // LOCAL frequent_foods.id and means something different on every device.
    const foodLog = db.prepare(`
      SELECT f.sync_id, f.date, f.time, f.description, f.calories, f.source,
             f.frequent_food_id, ff.sync_id AS frequent_food_sync_id,
             f.ai_breakdown, f.meal, f.is_event, f.event_kcal_min, f.event_kcal_max,
             f.protein_g, f.carbs_g, f.fat_g, f.updated_at, f.deleted_at
      FROM food_log f
      LEFT JOIN frequent_foods ff ON ff.id = f.frequent_food_id
      ORDER BY f.date DESC, f.time DESC
    `).all();
    const frequentFoods = db.prepare('SELECT sync_id, name, calories, ai_breakdown, protein_g, carbs_g, fat_g, times_used, created_at, updated_at, deleted_at FROM frequent_foods ORDER BY times_used DESC').all();
    const dailyMetrics = db.prepare('SELECT date, steps, gym, updated_at FROM nutrition_daily_metrics ORDER BY date DESC').all();
    const weeklyMetrics = db.prepare('SELECT date, weight_kg, waist_cm, updated_at FROM nutrition_weekly_metrics ORDER BY date DESC').all();
    const dailySummary = db.prepare('SELECT date, total_calories_in, bmr, tdee, balance, updated_at FROM nutrition_daily_summary ORDER BY date DESC').all();
    const dailyClosed = db.prepare('SELECT * FROM nutrition_daily_closed ORDER BY date DESC').all();
    const weeklyClosed = db.prepare('SELECT * FROM nutrition_weekly_closed ORDER BY week_start DESC').all();
    const favoriteFoods = db.prepare('SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM favorite_foods ORDER BY created_at DESC').all();
    // The user's corrections ONLY. Model rows are a per-device network cache,
    // reconstructible for free, and stay local (nutrition migration v17).
    const aiCorrections = db.prepare(`
      SELECT description_norm AS descriptionNorm, calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG,
             created_at AS createdAt, updated_at AS updatedAt
      FROM nutrition_ai_cache WHERE source = 'user' ORDER BY updated_at DESC
    `).all();

    return { profile, foodLog, frequentFoods, dailyMetrics, weeklyMetrics, dailySummary, dailyClosed, weeklyClosed, favoriteFoods, aiCorrections };
  });

  // ── Nutrition bulk import (merge from Firestore) ──
  ipcHandle('sync:mergeNutritionData', (_e, data: Record<string, unknown>) => mergeNutritionDataInto(getDb(), data));

  // ── Finance Sync ──────────────────────────────────────

  ipcHandle('sync:getAllFinanceData', () => {
    const db = getDb();

    const transactions = db.prepare(`
      SELECT id, type, amount, currency, category, description, date,
             payment_method AS paymentMethod, source, installments,
             installment_group_id AS installmentGroupId,
             for_third_party AS forThirdParty,
             recurring_id AS recurringId,
             import_batch_id AS importBatchId,
             credit_card_id AS creditCardId,
             impacts_balance AS impactsBalance,
             installment_number AS installmentNumber,
             billed_amount_ars AS billedAmountArs,
             fx_rate AS fxRate,
             fx_rate_source AS fxRateSource,
             account_id AS accountId,
             transfer_group_id AS transferGroupId,
             statement_period AS statementPeriod,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_transactions ORDER BY date DESC
    `).all();

    const loans = db.prepare(`
      SELECT id, person_name AS personName, direction, type, amount, currency,
             date, description, settled, installment_group_id AS installmentGroupId,
             settled_date AS settledDate, created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_loans ORDER BY date DESC
    `).all();

    const loanPayments = db.prepare(`
      SELECT id, loan_id AS loanId, amount, currency, date, note,
             created_at AS createdAt, deleted_at AS deletedAt, updated_at AS updatedAt
      FROM finance_loan_payments ORDER BY date ASC
    `).all();

    const recurring = db.prepare(`
      SELECT id, name, type, amount, currency, category, active,
             billing_day AS billingDay, frequency,
             account_id AS accountId, anchor_month AS anchorMonth,
             payment_method AS paymentMethod,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_recurring ORDER BY created_at ASC
    `).all();

    // previous_amount was neither selected here nor inserted on merge, so the
    // "was X, now Y" history collapsed to NULL on every replicated device.
    const recurringHistory = db.prepare(`
      SELECT id, recurring_id AS recurringId, amount, previous_amount AS previousAmount,
             currency, effective_date AS effectiveDate, created_at AS createdAt
      FROM finance_recurring_amount_history ORDER BY effective_date ASC
    `).all();

    const installmentGroups = db.prepare(`
      SELECT id, description, total_amount AS totalAmount, currency,
             total_installments AS totalInstallments, category, date,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_installment_groups ORDER BY date DESC
    `).all();

    const categoryMappings = db.prepare(`
      SELECT id, keyword, category, created_at AS createdAt
      FROM finance_category_mappings
    `).all();

    const categories = db.prepare(`SELECT name, updated_at AS updatedAt, deleted_at AS deletedAt FROM finance_categories`).all();

    const accounts = db.prepare(`
      SELECT id, name, kind, currency, initial_balance AS initialBalance,
             account_order AS accountOrder,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM finance_accounts
    `).all();

    const creditCards = db.prepare(`
      SELECT id, name, closing_day AS closingDay, due_day AS dueDay,
             last4, issuer,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_credit_cards
    `).all();

    const creditCardStatements = db.prepare(`
      SELECT id, credit_card_id AS creditCardId, period_month AS periodMonth,
             calculated_amount AS calculatedAmount, paid_amount AS paidAmount,
             status, paid_date AS paidDate, transaction_id AS transactionId,
             calculated_amount_usd AS calculatedAmountUsd,
             paid_amount_usd AS paidAmountUsd,
             transaction_id_usd AS transactionIdUsd,
             closing_date AS closingDate, due_date AS dueDate,
             statement_total_ars AS statementTotalArs,
             statement_total_usd AS statementTotalUsd,
             minimum_payment_ars AS minimumPaymentArs,
             previous_balance_ars AS previousBalanceArs,
             previous_balance_usd AS previousBalanceUsd,
             prior_payment_ars AS priorPaymentArs,
             prior_payment_usd AS priorPaymentUsd,
             reconciled, forecast_json AS forecastJson,
             created_at AS createdAt, updated_at AS updatedAt,
             deleted_at AS deletedAt
      FROM finance_credit_card_statements
    `).all();

    // finance_transactions.import_batch_id references this table, and it holds real
    // user data. It was in neither USER_DATA_TABLES nor this export, so it leaked
    // across account switches and never replicated.
    const importBatches = db.prepare(`
      SELECT id, source, filename, row_count AS rowCount, created_at AS createdAt
      FROM finance_import_batches
    `).all();

    // Legacy table, superseded by finance_recurring, but older installs still hold
    // rows in it — same leak.
    const incomeSources = db.prepare(`
      SELECT id, name, estimated_amount AS estimatedAmount, frequency,
             is_variable AS isVariable, active, created_at AS createdAt
      FROM finance_income_sources
    `).all();

    const budgets = db.prepare(`
      SELECT category, monthly_limit AS monthlyLimit,
             created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM finance_budgets
    `).all();

    return {
      transactions, loans, loanPayments, recurring, recurringHistory,
      installmentGroups, categoryMappings, categories, creditCards,
      creditCardStatements, importBatches, incomeSources, budgets, accounts,
    };
  });

  ipcHandle('sync:mergeFinanceData', (_e, data: Record<string, unknown[]>) => mergeFinanceDataInto(getDb(), data));

  ipcHandle('sync:getAllNotificationData', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, module, title, body,
             action_route, status, snoozed_until,
             created_at, updated_at, resolved_at,
             deleted_at, ref_id
      FROM notifications
    `).all();
  });

  ipcHandle('sync:mergeNotificationData', (_e, remote: Record<string, unknown>[]) => {
    const db = getDb();
    let changed = false;

    const tx = db.transaction(() => {
      for (const r of remote) {
        const local = db.prepare('SELECT updated_at FROM notifications WHERE id = ?')
          .get(r.id as string) as { updated_at: string } | undefined;

        if (!local) {
          db.prepare(`
            INSERT OR IGNORE INTO notifications
              (id, type, module, title, body, action_route, status,
               snoozed_until, created_at, updated_at, resolved_at, deleted_at, ref_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            r.id, r.type, r.module, r.title, r.body,
            r.action_route, r.status, r.snoozed_until,
            r.created_at, r.updated_at, r.resolved_at,
            r.deleted_at, r.ref_id
          );
          changed = true;
        } else if (r.updated_at && new Date(r.updated_at as string) > new Date(local.updated_at)) {
          db.prepare(`
            UPDATE notifications SET
              status = ?, snoozed_until = ?, updated_at = ?,
              resolved_at = ?, deleted_at = ?
            WHERE id = ?
          `).run(r.status, r.snoozed_until, r.updated_at, r.resolved_at, r.deleted_at, r.id);
          changed = true;
        }
      }
    });
    tx();

    return { changed };
  });

  // ── Cauldron Sync ──────────────────────────────────────

  ipcHandle('sync:getAllCauldronData', () => {
    const db = getDb();
    return {
      cauldron_presets: db.prepare('SELECT * FROM cauldron_presets').all(),
      cauldron_sessions: db.prepare('SELECT * FROM cauldron_sessions').all(),
    };
  });

  ipcHandle('sync:mergeCauldronData', (_e, data: Record<string, unknown>) => mergeCauldronDataInto(getDb(), data));
}

// ═══════════════════════════════════════════════════════════════════════════
// Module merges — exported so every failure mode can be replayed against an
// in-memory database (tests/modules/sync/sync-integrity.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

/** Clears every user-scoped row for an account switch / logout. */
export function clearUserDataInto(db: SqlDatabase): void {
  db.pragma('foreign_keys = OFF');
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const tx = db.transaction(() => {
      for (const table of USER_DATA_TABLES) {
        // A table listed here may not exist yet on a very old install.
        if (!tableExists.get(table)) continue;
        db.prepare(`DELETE FROM ${table}`).run();
      }
      // app_state is keyed, not wholesale: `last_uid` must survive the switch,
      // the user's dollar/crypto visibility preferences and shop equipment must not.
      const clearPref = db.prepare('DELETE FROM app_state WHERE key = ?');
      for (const key of USER_PREFERENCE_STATE_KEYS) clearPref.run(key);
      db.prepare(`INSERT OR IGNORE INTO player_stats (user_id) VALUES ('default')`).run();
      db.prepare(`INSERT OR IGNORE INTO user_profile (id) VALUES ('default')`).run();
      // Re-seed default cauldron presets after clearing
      db.prepare(
        `INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, extension_minutes, is_default)
         VALUES
           ('preset-classic', 'Classic', 25, 5, 15, 4, 5, 1),
           ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 5, 1),
           ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 5, 1)`,
      ).run();
      // Re-seed «Efectivo» (finance v17 only seeds when the table is created):
      // without it finance:addTransaction found no default account on a fresh
      // account and every cash expense landed with account_id = NULL.
      if (tableExists.get('finance_accounts')) db.prepare(SEED_CASH_ACCOUNT_SQL).run();
    });
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Merges a remote nutrify payload with last-write-wins, one savepoint per table. */
export function mergeNutritionDataInto(db: SqlDatabase, data: Record<string, unknown>): { changed: boolean } {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, any>;
  let changed = false;

  const tx = db.transaction(() => {
    // Profile — only overwrite if remote is newer (Issue #8)
    if (d.profile && typeof d.profile === 'object') step(db, 'profile', () => {
      const p = withNormStamps(d.profile as Record<string, unknown>);
      const local = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
      const remoteUpdatedAt = (p.updated_at as string | null) ?? '';
      if (local && !isNewerStamp(remoteUpdatedAt, local.updated_at)) return;

      // INSERT OR REPLACE rewrites the whole row, so every column follows the
      // same rule: a key the payload does not carry is NO opinion (a client
      // that predates that column) and keeps the local value; a key that is
      // present wins, null included. Only protein_target_g used to get this;
      // day_cutoff_hour, meal_schedule, gym_calories… were reset to defaults
      // by any older client editing the weight.
      const pick = (key: string, dflt: unknown = null): unknown =>
        key in p ? p[key] : (local ? local[key] : dflt);
      const required = ['age', 'sex', 'height_cm', 'initial_weight_kg', 'activity_level'];
      const values = required.map(k => pick(k));
      if (values.some(v => v === undefined || v === null || v === '')) {
        console.warn('[Sync] profile: skipping, missing a NOT NULL column', required.filter((_, i) => values[i] == null || values[i] === ''));
        return;
      }
      db.prepare(`INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, date_of_birth, weight_check_day, weight_popup_enabled, meal_schedule, day_cutoff_hour, protein_target_g, carbs_target_g, fat_target_g, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ...values,
        pick('deficit_target_kcal', 500) ?? 500,
        pick('gym_calories', 300) ?? 300,
        pick('step_calories_factor', 0.04) ?? 0.04,
        pick('date_of_birth'),
        pick('weight_check_day', 1) ?? 1,
        pick('weight_popup_enabled', 1) ?? 1,
        pick('meal_schedule'),
        pick('day_cutoff_hour', 4) ?? 4,
        pick('protein_target_g'),
        pick('carbs_target_g'),
        pick('fat_target_g'),
        remoteUpdatedAt || null,
      );
      changed = true;
    });

    // frequent_foods + food_log (each in its own savepoint inside)
    const foodsResult = mergeNutritionFoods(db, d);
    if (foodsResult.changed) changed = true;

    // Daily metrics — check timestamp before replacing (Issue #6)
    if (Array.isArray(d.dailyMetrics)) step(db, 'dailyMetrics', () => {
      const getDM = db.prepare('SELECT date, updated_at FROM nutrition_daily_metrics WHERE date = ?');
      const insertDM = db.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym, updated_at) VALUES (?, ?, ?, ?)');
      const updateDM = db.prepare('UPDATE nutrition_daily_metrics SET steps = ?, gym = ?, updated_at = ? WHERE date = ?');
      for (const raw of d.dailyMetrics) {
        if (!isUsableRow(raw, 'dailyMetrics', ['date'])) continue;
        const m = withNormStamps(raw);
        const local = getDM.get(m.date) as { date: string; updated_at: string | null } | undefined;
        if (!local) {
          insertDM.run(m.date, m.steps ?? null, m.gym ?? 0, m.updated_at ?? null);
          changed = true;
        } else if (isNewerStamp(m.updated_at, local.updated_at)) {
          updateDM.run(m.steps ?? null, m.gym ?? 0, m.updated_at, m.date);
          changed = true;
        }
      }
    });

    // Weekly metrics — check timestamp before replacing (Issue #7)
    if (Array.isArray(d.weeklyMetrics)) step(db, 'weeklyMetrics', () => {
      const getWM = db.prepare('SELECT date, updated_at FROM nutrition_weekly_metrics WHERE date = ?');
      const insertWM = db.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg, waist_cm, updated_at) VALUES (?, ?, ?, ?)');
      const updateWM = db.prepare('UPDATE nutrition_weekly_metrics SET weight_kg = ?, waist_cm = ?, updated_at = ? WHERE date = ?');
      for (const raw of d.weeklyMetrics) {
        if (!isUsableRow(raw, 'weeklyMetrics', ['date'])) continue;
        const m = withNormStamps(raw);
        const local = getWM.get(m.date) as { date: string; updated_at: string | null } | undefined;
        if (!local) {
          insertWM.run(m.date, m.weight_kg ?? null, m.waist_cm ?? null, m.updated_at ?? null);
          changed = true;
        } else if (isNewerStamp(m.updated_at, local.updated_at)) {
          updateWM.run(m.weight_kg ?? null, m.waist_cm ?? null, m.updated_at, m.date);
          changed = true;
        }
      }
    });

    // Daily summary — check timestamp before replacing
    if (Array.isArray(d.dailySummary)) step(db, 'dailySummary', () => {
      const getDS = db.prepare('SELECT date, updated_at FROM nutrition_daily_summary WHERE date = ?');
      const insertDS = db.prepare('INSERT INTO nutrition_daily_summary (date, bmr, tdee, total_calories_in, balance, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      const updateDS = db.prepare('UPDATE nutrition_daily_summary SET bmr = ?, tdee = ?, total_calories_in = ?, balance = ?, updated_at = ? WHERE date = ?');
      for (const raw of d.dailySummary) {
        if (!isUsableRow(raw, 'dailySummary', ['date', 'bmr', 'tdee', 'total_calories_in', 'balance'])) continue;
        const s = withNormStamps(raw);
        const local = getDS.get(s.date) as { date: string; updated_at: string | null } | undefined;
        if (!local) {
          insertDS.run(s.date, s.bmr, s.tdee, s.total_calories_in, s.balance, s.updated_at ?? null);
          changed = true;
        } else if (isNewerStamp(s.updated_at, local.updated_at)) {
          updateDS.run(s.bmr, s.tdee, s.total_calories_in, s.balance, s.updated_at, s.date);
          changed = true;
        }
      }
    });

    // Daily closed — merge by date, last-write-wins on updated_at.
    // nutrition:reopenDay soft-deletes; an insert-if-missing merge would have
    // resurrected the closure on the next pull and re-locked the day.
    if (Array.isArray(d.dailyClosed)) step(db, 'dailyClosed', () => {
      const getDC = db.prepare('SELECT date, updated_at FROM nutrition_daily_closed WHERE date = ?');
      const insertDC = db.prepare('INSERT INTO nutrition_daily_closed (date, xp_precision, xp_steps, xp_gym, xp_weight, xp_bonus, xp_total, hp_change, consumed, target, closed_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const updateDC = db.prepare('UPDATE nutrition_daily_closed SET xp_precision = ?, xp_steps = ?, xp_gym = ?, xp_weight = ?, xp_bonus = ?, xp_total = ?, hp_change = ?, consumed = ?, target = ?, closed_at = ?, updated_at = ?, deleted_at = ? WHERE date = ?');
      for (const raw of d.dailyClosed) {
        if (!isUsableRow(raw, 'dailyClosed', ['date'])) continue;
        const c = withNormStamps(raw);
        const local = getDC.get(c.date) as { date: string; updated_at: string | null } | undefined;
        if (!local) {
          insertDC.run(
            c.date, c.xp_precision ?? 0, c.xp_steps ?? 0, c.xp_gym ?? 0, c.xp_weight ?? 0, c.xp_bonus ?? 0,
            c.xp_total ?? 0, c.hp_change ?? 0, c.consumed ?? 0, c.target ?? 0,
            c.closed_at ?? null, c.updated_at ?? null, c.deleted_at ?? null,
          );
          changed = true;
        } else if (isNewerStamp(c.updated_at, local.updated_at)) {
          updateDC.run(
            c.xp_precision ?? 0, c.xp_steps ?? 0, c.xp_gym ?? 0, c.xp_weight ?? 0, c.xp_bonus ?? 0,
            c.xp_total ?? 0, c.hp_change ?? 0, c.consumed ?? 0, c.target ?? 0,
            c.closed_at ?? null, c.updated_at ?? null, c.deleted_at ?? null, c.date,
          );
          changed = true;
        }
      }
    });

    // Sin `deleted_at`: nada en la app puede producir una lápida semanal
    // (no hay reopenWeek, clearUserData borra duro).
    if (Array.isArray(d.weeklyClosed)) step(db, 'weeklyClosed', () => {
      const getWC = db.prepare('SELECT week_start, updated_at FROM nutrition_weekly_closed WHERE week_start = ?');
      const insertWC = db.prepare(`INSERT INTO nutrition_weekly_closed
        (week_start, days_closed, days_compliant, avg_consumed, avg_target, weight_start,
         weight_end, days_steps, days_gym, streak_end, xp_total, closed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const updateWC = db.prepare(`UPDATE nutrition_weekly_closed SET
        days_closed = ?, days_compliant = ?, avg_consumed = ?, avg_target = ?, weight_start = ?,
        weight_end = ?, days_steps = ?, days_gym = ?, streak_end = ?, xp_total = ?,
        closed_at = ?, updated_at = ? WHERE week_start = ?`);

      for (const raw of d.weeklyClosed) {
        // La clave es snake_case: el payload viene de un SELECT *, no de WeekReport.
        if (!isUsableRow(raw, 'weeklyClosed', ['week_start'])) continue;
        const c = withNormStamps(raw);
        const local = getWC.get(c.week_start) as { week_start: string; updated_at: string | null } | undefined;
        const vals = [
          c.days_closed ?? 0, c.days_compliant ?? 0, c.avg_consumed ?? 0, c.avg_target ?? 0,
          c.weight_start ?? null, c.weight_end ?? null, c.days_steps ?? 0, c.days_gym ?? 0,
          c.streak_end ?? 0, c.xp_total ?? 0, c.closed_at ?? null, c.updated_at ?? null,
        ];
        if (!local) { insertWC.run(c.week_start, ...vals); changed = true; }
        else if (isNewerStamp(c.updated_at, local.updated_at)) { updateWC.run(...vals, c.week_start); changed = true; }
      }
    });

    // AI cache corrections — keyed by description_norm. A remote USER row beats
    // a local MODEL row outright (a human number over a guess), and beats a
    // local user row only when newer. Model rows never travel (v17).
    if (Array.isArray(d.aiCorrections)) step(db, 'aiCorrections', () => {
      const getCorr = db.prepare('SELECT source, updated_at FROM nutrition_ai_cache WHERE description_norm = ?');
      const insertCorr = db.prepare(`
        INSERT INTO nutrition_ai_cache (description_norm, calories, ai_breakdown, protein_g, carbs_g, fat_g, hits, created_at, updated_at, source, prompt_version)
        VALUES (?, ?, NULL, ?, ?, ?, 1, ?, ?, 'user', NULL)`);
      const updateCorr = db.prepare(`
        UPDATE nutrition_ai_cache SET calories = ?, ai_breakdown = NULL, protein_g = ?, carbs_g = ?, fat_g = ?,
          updated_at = ?, source = 'user', prompt_version = NULL WHERE description_norm = ?`);
      const macro = (row: Record<string, unknown>, camel: string, snake: string): number | null => {
        const v = row[camel] ?? row[snake];
        return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
      };
      for (const raw of d.aiCorrections) {
        if (!isUsableRow(raw, 'aiCorrections', ['calories'])) continue;
        const c = withNormStamps(raw as Record<string, unknown>) as Record<string, unknown>;
        const norm = String(c.descriptionNorm ?? c.description_norm ?? '').trim();
        const calories = Number(c.calories);
        if (!norm || !Number.isFinite(calories) || calories <= 0) continue;
        const remoteUpdated = (c.updatedAt ?? c.updated_at ?? null) as string | null;
        const local = getCorr.get(norm) as { source: string; updated_at: string | null } | undefined;
        if (!local) {
          insertCorr.run(norm, Math.round(calories), macro(c, 'proteinG', 'protein_g'), macro(c, 'carbsG', 'carbs_g'), macro(c, 'fatG', 'fat_g'),
            (c.createdAt ?? c.created_at ?? remoteUpdated ?? new Date().toISOString()) as string, remoteUpdated);
          changed = true;
        } else if (local.source !== 'user' || isNewerStamp(remoteUpdated, local.updated_at)) {
          updateCorr.run(Math.round(calories), macro(c, 'proteinG', 'protein_g'), macro(c, 'carbsG', 'carbs_g'), macro(c, 'fatG', 'fat_g'),
            remoteUpdated, norm);
          changed = true;
        }
      }
    });

    // Favorite foods — dedup by description (UNIQUE), LWW on the tombstone
    if (Array.isArray(d.favoriteFoods)) step(db, 'favoriteFoods', () => {
      const getFav = db.prepare('SELECT id, description, calories, source, ai_breakdown, protein_g, carbs_g, fat_g, updated_at FROM favorite_foods WHERE id = ?');
      const insertFav = db.prepare('INSERT OR IGNORE INTO favorite_foods (id, description, calories, source, ai_breakdown, protein_g, carbs_g, fat_g, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      // Full last-write-wins, same shape as the INSERT. Writing only the stamps
      // was the food_log bug all over again: an edit never crossed, but the row
      // adopted the newer timestamp and pushed the stale values back as 'newest'.
      const updateFav = db.prepare('UPDATE favorite_foods SET description = ?, calories = ?, source = ?, ai_breakdown = ?, protein_g = ?, carbs_g = ?, fat_g = ?, updated_at = ?, deleted_at = ? WHERE id = ?');
      for (const raw of d.favoriteFoods) {
        if (!isUsableRow(raw, 'favoriteFoods', ['id', 'description', 'calories'])) continue;
        const f = withNormStamps(raw);
        const remoteUpdated = f.updatedAt ?? f.updated_at ?? null;
        const remoteDeleted = f.deletedAt ?? f.deleted_at ?? null;
        type LocalFav = {
          id: string; description: string; calories: number; source: string;
          ai_breakdown: string | null; protein_g: number | null; carbs_g: number | null;
          fat_g: number | null; updated_at: string | null;
        };
        const macro = (camel: string, snake: string): number | null =>
          (f[camel] ?? f[snake] ?? null) as number | null;
        const local = getFav.get(f.id) as LocalFav | undefined;
        if (!local) {
          const r = insertFav.run(f.id, f.description, f.calories, f.source ?? 'manual',
            f.aiBreakdown ?? f.ai_breakdown ?? null,
            macro('proteinG', 'protein_g'), macro('carbsG', 'carbs_g'), macro('fatG', 'fat_g'),
            f.createdAt ?? f.created_at ?? remoteUpdated ?? new Date().toISOString(), remoteUpdated, remoteDeleted);
          if (r.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdated, local.updated_at)) {
          // Macro columns arrived in nutrition v10: a payload from a client that
          // predates them carries no opinion, so keep the local value.
          const keep = (camel: string, snake: string, localValue: number | null): number | null =>
            (camel in f || snake in f) ? macro(camel, snake) : localValue;
          updateFav.run(
            f.description ?? local.description, f.calories ?? local.calories,
            f.source ?? local.source, f.aiBreakdown ?? f.ai_breakdown ?? local.ai_breakdown,
            keep('proteinG', 'protein_g', local.protein_g),
            keep('carbsG', 'carbs_g', local.carbs_g),
            keep('fatG', 'fat_g', local.fat_g),
            remoteUpdated, remoteDeleted, f.id,
          );
          changed = true;
        }
      }
    });
  });

  tx();
  return { changed };
}

/** Merges a remote finance payload with last-write-wins, one savepoint per table. */
export function mergeFinanceDataInto(db: SqlDatabase, data: Record<string, unknown>): { success: boolean; changed: boolean } {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  let changed = false;
  const now = new Date().toISOString();
  const list = (key: string): Array<Record<string, any>> =>
    Array.isArray(d[key]) ? (d[key] as unknown[]).map(withNormStamps) as Array<Record<string, any>> : [];

  const tx = db.transaction(() => {
    if (Array.isArray(d.categories)) step(db, 'categories', () => {
      const getCat = db.prepare('SELECT name, updated_at FROM finance_categories WHERE name = ?');
      const insertCat = db.prepare(`INSERT OR IGNORE INTO finance_categories (name, updated_at, deleted_at) VALUES (?, ?, ?)`);
      const updateCat = db.prepare(`UPDATE finance_categories SET updated_at = ?, deleted_at = ? WHERE name = ?`);
      for (const c of list('categories')) {
        if (!isUsableRow(c, 'categories', ['name'])) continue;
        const remoteUpdatedAt = (c.updatedAt as string) ?? now;
        const remoteDeletedAt = (c.deletedAt as string) ?? null;
        const local = getCat.get(c.name) as { name: string; updated_at: string } | undefined;
        if (!local) {
          insertCat.run(c.name, remoteUpdatedAt, remoteDeletedAt);
          changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updateCat.run(remoteUpdatedAt, remoteDeletedAt, c.name);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.recurring)) step(db, 'recurring', () => {
      const getRec = db.prepare('SELECT id, updated_at FROM finance_recurring WHERE id = ?');
      const insertRec = db.prepare(`
        INSERT OR IGNORE INTO finance_recurring
          (id, name, type, amount, currency, category, active, billing_day, frequency, account_id, anchor_month, payment_method, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // frequency (the cadence — monthly / bimonthly / annual…) never travelled:
      // a bimonthly template arrived as 'monthly' on every other device.
      // frequency / account_id / anchor_month: absent from an old client's
      // payload = no opinion (keep local); an explicit null = clear/default.
      const updateRec = db.prepare(`
        UPDATE finance_recurring SET name = ?, type = ?, amount = ?, currency = ?, category = ?,
               active = ?, billing_day = ?,
               frequency = CASE WHEN ? THEN ? ELSE frequency END,
               account_id = CASE WHEN ? THEN ? ELSE account_id END,
               anchor_month = CASE WHEN ? THEN ? ELSE anchor_month END,
               payment_method = CASE WHEN ? THEN ? ELSE payment_method END,
               updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      for (const r of list('recurring')) {
        if (!isUsableRow(r, 'recurring', ['id', 'name', 'amount'])) continue;
        const remoteUpdatedAt = (r.updatedAt as string) ?? (r.createdAt as string) ?? now;
        const remoteDeletedAt = (r.deletedAt as string) ?? null;
        const local = getRec.get(r.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          const result = insertRec.run(r.id, r.name, r.type ?? 'income', r.amount, r.currency ?? 'ARS', r.category ?? 'Otros', r.active ?? 1, r.billingDay ?? 1,
            r.frequency ?? 'monthly',
            r.accountId ?? r.account_id ?? null, r.anchorMonth ?? r.anchor_month ?? null,
            r.paymentMethod ?? r.payment_method ?? null,
            r.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt);
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          const hasAccount = 'accountId' in r || 'account_id' in r;
          const hasAnchor = 'anchorMonth' in r || 'anchor_month' in r;
          updateRec.run(r.name, r.type ?? 'income', r.amount, r.currency ?? 'ARS', r.category ?? 'Otros', r.active ?? 1, r.billingDay ?? 1,
            'frequency' in r ? 1 : 0, r.frequency ?? 'monthly',
            hasAccount ? 1 : 0, r.accountId ?? r.account_id ?? null,
            hasAnchor ? 1 : 0, r.anchorMonth ?? r.anchor_month ?? null,
            ('paymentMethod' in r || 'payment_method' in r) ? 1 : 0, r.paymentMethod ?? r.payment_method ?? null,
            remoteUpdatedAt, remoteDeletedAt, r.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.recurringHistory)) step(db, 'recurringHistory', () => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_recurring_amount_history
          (id, recurring_id, amount, previous_amount, currency, effective_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      // Backfills previous_amount on rows that were replicated before it was
      // carried over — those all have it NULL today.
      const backfill = db.prepare(`
        UPDATE finance_recurring_amount_history SET previous_amount = ?
        WHERE id = ? AND previous_amount IS NULL
      `);
      // recurring_id is a NOT NULL foreign key: an orphan cannot be kept.
      const recExists = db.prepare('SELECT 1 FROM finance_recurring WHERE id = ?');
      for (const h of list('recurringHistory')) {
        if (!isUsableRow(h, 'recurringHistory', ['id', 'recurringId', 'amount', 'effectiveDate'])) continue;
        if (!recExists.get(h.recurringId)) {
          console.warn(`[Sync] recurringHistory: dropping orphan ${h.id} (recurring ${h.recurringId} not found)`);
          continue;
        }
        const previousAmount = (h.previousAmount ?? h.previous_amount ?? null) as number | null;
        const result = stmt.run(h.id, h.recurringId, h.amount, previousAmount, h.currency ?? 'ARS', h.effectiveDate, h.createdAt ?? now);
        if (result.changes > 0) changed = true;
        else if (previousAmount != null && backfill.run(previousAmount, h.id).changes > 0) changed = true;
      }
    });

    // Installment groups must come before transactions that reference them
    if (Array.isArray(d.installmentGroups)) step(db, 'installmentGroups', () => {
      const getIG = db.prepare('SELECT id, updated_at FROM finance_installment_groups WHERE id = ?');
      const insertIG = db.prepare(`
        INSERT OR IGNORE INTO finance_installment_groups
          (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateIG = db.prepare(`
        UPDATE finance_installment_groups SET description = ?, total_amount = ?, currency = ?,
               total_installments = ?, category = ?, date = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      for (const g of list('installmentGroups')) {
        if (!isUsableRow(g, 'installmentGroups', ['id', 'totalAmount', 'totalInstallments', 'date'])) continue;
        const remoteUpdatedAt = (g.updatedAt as string) ?? (g.createdAt as string) ?? now;
        const remoteDeletedAt = (g.deletedAt as string) ?? null;
        const local = getIG.get(g.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          const result = insertIG.run(g.id, g.description ?? '', g.totalAmount, g.currency ?? 'ARS', g.totalInstallments, g.category ?? 'Otros', g.date, g.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt);
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updateIG.run(g.description ?? '', g.totalAmount, g.currency ?? 'ARS', g.totalInstallments, g.category ?? 'Otros', g.date, remoteUpdatedAt, remoteDeletedAt, g.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.transactions)) step(db, 'transactions', () => {
      const getTx = db.prepare('SELECT id, updated_at FROM finance_transactions WHERE id = ?');
      const insertTx = db.prepare(`
        INSERT OR IGNORE INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party,
           recurring_id, import_batch_id, credit_card_id, impacts_balance,
           installment_number, billed_amount_ars, fx_rate, fx_rate_source,
           account_id, transfer_group_id, statement_period,
           created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // fx_rate_source follows fx_rate: a remote that brings no rate keeps the
      // local rate AND its provenance. statement_period (v18) uses the same
      // "absent = no opinion" rule as account_id.
      const updateTx = db.prepare(`
        UPDATE finance_transactions SET type = ?, amount = ?, currency = ?, category = ?,
          description = ?, date = ?, payment_method = ?, source = ?, installments = ?,
          installment_group_id = ?, for_third_party = ?, recurring_id = ?,
          import_batch_id = ?, credit_card_id = ?, impacts_balance = ?,
          installment_number = ?, billed_amount_ars = ?,
          fx_rate = COALESCE(?, fx_rate),
          fx_rate_source = CASE WHEN ? IS NOT NULL THEN ? ELSE fx_rate_source END,
          account_id = CASE WHEN ? THEN ? ELSE account_id END,
          transfer_group_id = COALESCE(?, transfer_group_id),
          statement_period = CASE WHEN ? THEN ? ELSE statement_period END,
          updated_at = ?,
          deleted_at = ?
        WHERE id = ?
      `);
      for (const t of list('transactions')) {
        // type / amount / date are NOT NULL (type also has a CHECK): one bad
        // row used to roll back every account, budget, card and loan in the pull.
        if (!isUsableRow(t, 'transactions', ['id', 'type', 'amount', 'date'])) continue;
        if (t.type !== 'expense' && t.type !== 'income') {
          console.warn(`[Sync] transactions: skipping ${t.id}, unknown type "${t.type}"`);
          continue;
        }
        const local = getTx.get(t.id) as { id: string; updated_at: string } | undefined;
        const remoteUpdatedAt = (t.updatedAt as string) ?? now;
        const remoteDeletedAt = (t.deletedAt as string) ?? null;
        const fxRate = t.fxRate ?? null;
        const fxRateSource = t.fxRateSource ?? t.fx_rate_source ?? null;
        const statementPeriod = t.statementPeriod ?? t.statement_period ?? null;
        if (!local) {
          const result = insertTx.run(
            t.id, t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
            t.description ?? '', t.date, t.paymentMethod ?? 'cash',
            t.source ?? 'manual', t.installments ?? 1, t.installmentGroupId ?? null,
            t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
            t.creditCardId ?? null, t.impactsBalance ?? 1,
            t.installmentNumber ?? null, t.billedAmountArs ?? null, fxRate, fxRateSource,
            t.accountId ?? null, t.transferGroupId ?? null, statementPeriod,
            t.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt,
          );
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updateTx.run(
            t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
            t.description ?? '', t.date, t.paymentMethod ?? 'cash',
            t.source ?? 'manual', t.installments ?? 1, t.installmentGroupId ?? null,
            t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
            t.creditCardId ?? null, t.impactsBalance ?? 1,
            t.installmentNumber ?? null, t.billedAmountArs ?? null,
            fxRate,
            fxRate, fxRateSource,
            ('accountId' in t) ? 1 : 0, t.accountId ?? null,
            t.transferGroupId ?? null,
            ('statementPeriod' in t || 'statement_period' in t) ? 1 : 0, statementPeriod,
            remoteUpdatedAt,
            remoteDeletedAt, t.id,
          );
          changed = true;
        }
      }
    });

    if (Array.isArray(d.loans)) step(db, 'loans', () => {
      const getLoan = db.prepare('SELECT id, settled, updated_at, deleted_at FROM finance_loans WHERE id = ?');
      const insertLoan = db.prepare(`
        INSERT OR IGNORE INTO finance_loans
          (id, person_name, direction, type, amount, currency, date, description,
           settled, installment_group_id, settled_date, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Full last-write-wins. The merge used to propagate ONLY the settled 0→1
      // transition, so editing a loan's amount, person, date or description never
      // reached the other device — and a soft delete never did either.
      const updateLoan = db.prepare(`
        UPDATE finance_loans SET person_name = ?, direction = ?, type = ?, amount = ?,
          currency = ?, date = ?, description = ?, settled = ?, installment_group_id = ?,
          settled_date = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      const settleLoan = db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ?, updated_at = ? WHERE id = ?`);
      for (const l of list('loans')) {
        if (!isUsableRow(l, 'loans', ['id', 'personName', 'direction', 'amount', 'date'])) continue;
        const local = getLoan.get(l.id) as { id: string; settled: number; updated_at: string | null; deleted_at: string | null } | undefined;
        const remoteUpdatedAt = (l.updatedAt as string) ?? (l.createdAt as string) ?? now;
        // A payload written by a client that predates deletedAt in the loans export
        // simply omits the key. Treating that as "not deleted" would resurrect a
        // local tombstone, so an absent key preserves whatever is already local.
        const remoteDeletedAt = 'deletedAt' in l
          ? ((l.deletedAt as string) ?? null)
          : (local?.deleted_at ?? null);
        if (!local) {
          const result = insertLoan.run(
            l.id, l.personName, l.direction, l.type ?? 'single', l.amount, l.currency ?? 'ARS',
            l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
            l.settledDate ?? null, l.createdAt ?? now, remoteUpdatedAt, remoteDeletedAt,
          );
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updateLoan.run(
            l.personName, l.direction, l.type ?? 'single', l.amount, l.currency ?? 'ARS',
            l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
            l.settledDate ?? null, remoteUpdatedAt, remoteDeletedAt, l.id,
          );
          changed = true;
        } else if (l.settled === 1 && local.settled === 0) {
          // Settling stays a one-way transition even against a stale timestamp:
          // older clients settle without bumping updated_at.
          settleLoan.run(l.settledDate ?? now, remoteUpdatedAt, l.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.loanPayments)) step(db, 'loanPayments', () => {
      const getPay = db.prepare('SELECT id, updated_at FROM finance_loan_payments WHERE id = ?');
      const insertPay = db.prepare(`
        INSERT OR IGNORE INTO finance_loan_payments
          (id, loan_id, amount, currency, date, note, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Full LWW (the stamps are normalised first — see normStamp — so a
      // delete written by a client still on datetime('now') wins when newer).
      const updatePay = db.prepare(
        'UPDATE finance_loan_payments SET amount = ?, currency = ?, date = ?, note = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
      );
      // loan_id is a NOT NULL foreign key: an orphan cannot be kept.
      const loanExists = db.prepare('SELECT 1 FROM finance_loans WHERE id = ?');
      for (const p of list('loanPayments')) {
        if (!isUsableRow(p, 'loanPayments', ['id', 'loanId', 'amount', 'date'])) continue;
        const local = getPay.get(p.id) as { id: string; updated_at: string | null } | undefined;
        if (!local) {
          if (!loanExists.get(p.loanId)) {
            console.warn(`[Sync] loanPayments: dropping orphan ${p.id} (loan ${p.loanId} not found)`);
            continue;
          }
          const result = insertPay.run(
            p.id, p.loanId, p.amount, p.currency ?? 'ARS', p.date, p.note ?? '',
            p.createdAt ?? now, p.updatedAt ?? null, p.deletedAt ?? null,
          );
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(p.updatedAt, local.updated_at)) {
          updatePay.run(p.amount, p.currency ?? 'ARS', p.date, p.note ?? '', p.updatedAt, p.deletedAt ?? null, p.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.categoryMappings)) step(db, 'categoryMappings', () => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_category_mappings (id, keyword, category, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const m of list('categoryMappings')) {
        if (!isUsableRow(m, 'categoryMappings', ['id', 'keyword', 'category'])) continue;
        const result = stmt.run(m.id, m.keyword, m.category, m.createdAt ?? now);
        if (result.changes > 0) changed = true;
      }
    });

    // Import batches — referenced by finance_transactions.import_batch_id (no
    // FK), but they do have to be merged at all: they were previously dropped.
    if (Array.isArray(d.importBatches)) step(db, 'importBatches', () => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_import_batches (id, source, filename, row_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const b of list('importBatches')) {
        if (!isUsableRow(b, 'importBatches', ['id', 'source'])) continue;
        const result = stmt.run(b.id, b.source, b.filename ?? '', b.rowCount ?? b.row_count ?? 0, b.createdAt ?? now);
        if (result.changes > 0) changed = true;
      }
    });

    if (Array.isArray(d.budgets)) step(db, 'budgets', () => {
      const getB = db.prepare('SELECT updated_at FROM finance_budgets WHERE category = ?');
      const insB = db.prepare(`
        INSERT INTO finance_budgets (category, monthly_limit, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const updB = db.prepare(`
        UPDATE finance_budgets SET monthly_limit = ?, updated_at = ?, deleted_at = ? WHERE category = ?
      `);
      for (const b of list('budgets')) {
        if (!isUsableRow(b, 'budgets', ['category'])) continue;
        const remoteUpdated = (b.updatedAt as string) ?? (b.createdAt as string) ?? now;
        const local = getB.get(b.category) as { updated_at: string } | undefined;
        if (!local) {
          const r = insB.run(b.category, b.monthlyLimit ?? b.monthly_limit ?? 0,
            b.createdAt ?? now, remoteUpdated, b.deletedAt ?? null);
          if (r.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdated, local.updated_at)) {
          updB.run(b.monthlyLimit ?? b.monthly_limit ?? 0, remoteUpdated, b.deletedAt ?? null, b.category);
          changed = true;
        }
      }
    });

    // Legacy income sources — no longer written by the UI, but older installs
    // still hold rows and they were leaking between accounts.
    if (Array.isArray(d.incomeSources)) step(db, 'incomeSources', () => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_income_sources
          (id, name, estimated_amount, frequency, is_variable, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of list('incomeSources')) {
        if (!isUsableRow(s, 'incomeSources', ['id', 'name'])) continue;
        const result = stmt.run(
          s.id, s.name, s.estimatedAmount ?? s.estimated_amount ?? 0,
          s.frequency ?? 'monthly', s.isVariable ?? s.is_variable ?? 0,
          s.active ?? 1, s.createdAt ?? now,
        );
        if (result.changes > 0) changed = true;
      }
    });

    if (Array.isArray(d.accounts)) step(db, 'accounts', () => {
      // LWW by updated_at with soft-delete. The deterministic seed
      // ('account-cash-default') collapses across devices on its own id.
      const getAcc = db.prepare('SELECT id, updated_at FROM finance_accounts WHERE id = ?');
      const insAcc = db.prepare(`
        INSERT OR IGNORE INTO finance_accounts
          (id, name, kind, currency, initial_balance, account_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updAcc = db.prepare(`
        UPDATE finance_accounts SET name = ?, kind = ?, currency = ?, initial_balance = ?,
               account_order = ?, updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      for (const a of list('accounts')) {
        if (!isUsableRow(a, 'accounts', ['id', 'name'])) continue;
        const remoteUpdated = (a.updatedAt as string) ?? (a.createdAt as string) ?? now;
        const remoteDeleted = (a.deletedAt as string) ?? null;
        const local = getAcc.get(a.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          const r = insAcc.run(a.id, a.name, a.kind ?? 'cash', a.currency ?? 'ARS',
            a.initialBalance ?? a.initial_balance ?? 0, a.accountOrder ?? a.account_order ?? 0,
            a.createdAt ?? now, remoteUpdated, remoteDeleted);
          if (r.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdated, local.updated_at)) {
          updAcc.run(a.name, a.kind ?? 'cash', a.currency ?? 'ARS',
            a.initialBalance ?? a.initial_balance ?? 0, a.accountOrder ?? a.account_order ?? 0,
            remoteUpdated, remoteDeleted, a.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.creditCards)) step(db, 'creditCards', () => {
      const getCC = db.prepare('SELECT id, updated_at FROM finance_credit_cards WHERE id = ?');
      const insertCC = db.prepare(`
        INSERT OR IGNORE INTO finance_credit_cards
          (id, name, closing_day, due_day, last4, issuer, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateCC = db.prepare(`
        UPDATE finance_credit_cards SET name = ?, closing_day = ?,
               due_day = CASE WHEN ? THEN ? ELSE due_day END,
               last4  = CASE WHEN ? THEN ? ELSE last4  END,
               issuer = CASE WHEN ? THEN ? ELSE issuer END,
               updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      for (const card of list('creditCards')) {
        if (!isUsableRow(card, 'creditCards', ['id', 'name'])) continue;
        const closingDay = card.closingDay ?? card.closing_day ?? null;
        if (closingDay == null) {
          console.warn(`[Sync] creditCards: skipping ${card.id}, missing closing_day`);
          continue;
        }
        const remoteUpdatedAt = (card.updatedAt as string) ?? (card.createdAt as string) ?? (card.created_at as string) ?? now;
        const remoteDeletedAt = (card.deletedAt as string) ?? (card.deleted_at as string) ?? null;
        const local = getCC.get(card.id) as { id: string; updated_at: string } | undefined;
        const last4 = (card.last4 as string | null) ?? null;
        const issuer = (card.issuer as string | null) ?? null;
        if (!local) {
          insertCC.run(card.id, card.name, closingDay,
            (card.dueDay as number | null) ?? (card.due_day as number | null) ?? null,
            last4, issuer,
            card.createdAt ?? card.created_at ?? now, remoteUpdatedAt, remoteDeletedAt);
          changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          // due_day / last4 / issuer: absent from an old client's payload = no
          // opinion (keep local); present and null = cleared on purpose.
          const hasDueDay = 'dueDay' in card || 'due_day' in card;
          updateCC.run(card.name, closingDay,
            hasDueDay ? 1 : 0, (card.dueDay as number | null) ?? (card.due_day as number | null) ?? null,
            'last4' in card ? 1 : 0, last4,
            'issuer' in card ? 1 : 0, issuer,
            remoteUpdatedAt, remoteDeletedAt, card.id);
          changed = true;
        }
      }
    });

    if (Array.isArray(d.creditCardStatements)) step(db, 'creditCardStatements', () => {
      const getCCS = db.prepare('SELECT id, updated_at FROM finance_credit_card_statements WHERE id = ?');
      const insertCCS = db.prepare(`
        INSERT OR IGNORE INTO finance_credit_card_statements
          (id, credit_card_id, period_month, calculated_amount, paid_amount,
           status, paid_date, transaction_id,
           calculated_amount_usd, paid_amount_usd, transaction_id_usd,
           closing_date, due_date, statement_total_ars, statement_total_usd,
           minimum_payment_ars, previous_balance_ars, previous_balance_usd,
           prior_payment_ars, prior_payment_usd, reconciled, forecast_json,
           created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      /**
       * Los 11 campos del PAPEL no se pisan con NULL cuando el payload viene de
       * un cliente viejo que ni los conoce: `CASE WHEN <presente> THEN ? ELSE
       * <columna> END`, igual que `due_day`. Ausente = sin opinión; presente y
       * null = borrado a propósito. Sin esto, un teléfono con la versión
       * anterior borraba la conciliación de cada resumen en cada sync.
       */
      const updateCCS = db.prepare(`
        UPDATE finance_credit_card_statements SET calculated_amount = ?, paid_amount = ?,
               status = ?, paid_date = ?, transaction_id = ?,
               calculated_amount_usd = ?, paid_amount_usd = ?, transaction_id_usd = ?,
               closing_date          = CASE WHEN ? THEN ? ELSE closing_date          END,
               due_date              = CASE WHEN ? THEN ? ELSE due_date              END,
               statement_total_ars   = CASE WHEN ? THEN ? ELSE statement_total_ars   END,
               statement_total_usd   = CASE WHEN ? THEN ? ELSE statement_total_usd   END,
               minimum_payment_ars   = CASE WHEN ? THEN ? ELSE minimum_payment_ars   END,
               previous_balance_ars  = CASE WHEN ? THEN ? ELSE previous_balance_ars  END,
               previous_balance_usd  = CASE WHEN ? THEN ? ELSE previous_balance_usd  END,
               prior_payment_ars     = CASE WHEN ? THEN ? ELSE prior_payment_ars     END,
               prior_payment_usd     = CASE WHEN ? THEN ? ELSE prior_payment_usd     END,
               reconciled            = CASE WHEN ? THEN ? ELSE reconciled            END,
               forecast_json         = CASE WHEN ? THEN ? ELSE forecast_json         END,
               updated_at = ?, deleted_at = ?
        WHERE id = ?
      `);
      /** Las 11 columnas del papel, en el orden de los dos statements. */
      const PAPER_FIELDS = [
        'closingDate', 'dueDate', 'statementTotalArs', 'statementTotalUsd',
        'minimumPaymentArs', 'previousBalanceArs', 'previousBalanceUsd',
        'priorPaymentArs', 'priorPaymentUsd', 'reconciled', 'forecastJson',
      ] as const;
      const paperValues = (s: Record<string, unknown>) => PAPER_FIELDS.map((f) => s[f] ?? null);
      const paperPairs = (s: Record<string, unknown>) =>
        PAPER_FIELDS.flatMap((f) => [f in s ? 1 : 0, s[f] ?? null]);
      // credit_card_id is a NOT NULL foreign key: an orphan cannot be kept.
      const cardExists = db.prepare('SELECT 1 FROM finance_credit_cards WHERE id = ?');
      for (const s of list('creditCardStatements')) {
        if (!isUsableRow(s, 'creditCardStatements', ['id'])) continue;
        const cardId = s.creditCardId ?? s.credit_card_id ?? null;
        const periodMonth = s.periodMonth ?? s.period_month ?? null;
        if (cardId == null || periodMonth == null) {
          console.warn(`[Sync] creditCardStatements: skipping ${s.id}, missing credit_card_id / period_month`);
          continue;
        }
        const remoteUpdatedAt = (s.updatedAt as string) ?? (s.createdAt as string) ?? (s.created_at as string) ?? now;
        const remoteDeletedAt = (s.deletedAt as string) ?? (s.deleted_at as string) ?? null;
        const local = getCCS.get(s.id) as { id: string; updated_at: string } | undefined;
        if (!local) {
          if (!cardExists.get(cardId)) {
            console.warn(`[Sync] creditCardStatements: dropping orphan ${s.id} (card ${cardId} not found)`);
            continue;
          }
          insertCCS.run(
            s.id, cardId, periodMonth,
            s.calculatedAmount ?? s.calculated_amount ?? 0, s.paidAmount ?? s.paid_amount ?? null,
            s.status ?? 'pending', s.paidDate ?? s.paid_date ?? null,
            s.transactionId ?? s.transaction_id ?? null,
            s.calculatedAmountUsd ?? s.calculated_amount_usd ?? 0,
            s.paidAmountUsd ?? s.paid_amount_usd ?? null,
            s.transactionIdUsd ?? s.transaction_id_usd ?? null,
            ...paperValues(s),
            s.createdAt ?? s.created_at ?? now, remoteUpdatedAt, remoteDeletedAt,
          );
          changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updateCCS.run(
            s.calculatedAmount ?? s.calculated_amount ?? 0, s.paidAmount ?? s.paid_amount ?? null,
            s.status ?? 'pending', s.paidDate ?? s.paid_date ?? null,
            s.transactionId ?? s.transaction_id ?? null,
            s.calculatedAmountUsd ?? s.calculated_amount_usd ?? 0,
            s.paidAmountUsd ?? s.paid_amount_usd ?? null,
            s.transactionIdUsd ?? s.transaction_id_usd ?? null,
            ...paperPairs(s),
            remoteUpdatedAt, remoteDeletedAt, s.id,
          );
          changed = true;
        }
      }
    });
  });

  tx();
  return { success: true, changed };
}

/** Merges a remote cauldron payload with last-write-wins, one savepoint per table. */
export function mergeCauldronDataInto(db: SqlDatabase, data: Record<string, unknown>): { changed: boolean } {
  let changed = false;
  if (!data || typeof data !== 'object') return { changed: false };
  const now = new Date().toISOString();

  // This was the only merge running its loops OUTSIDE a transaction: a failure
  // partway through left presets applied and sessions not, with no rollback.
  const tx = db.transaction(() => {
    const presets = data.cauldron_presets as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(presets) && presets.length) step(db, 'cauldronPresets', () => {
      const getPreset = db.prepare('SELECT id, updated_at FROM cauldron_presets WHERE id = ?');
      const insertPreset = db.prepare(`INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, extension_minutes, auto_start_break, auto_start_work, is_default, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const updatePreset = db.prepare(`UPDATE cauldron_presets SET name = ?, work_minutes = ?, break_minutes = ?, long_break_minutes = ?, cycles_before_long = ?, extension_minutes = ?, auto_start_break = ?, auto_start_work = ?, is_default = ?, updated_at = ?, deleted_at = ? WHERE id = ?`);
      for (const raw of presets) {
        if (!isUsableRow(raw, 'cauldronPresets', ['id', 'name'])) continue;
        const p = withNormStamps(raw) as Record<string, any>;
        const local = getPreset.get(p.id) as { id: string; updated_at: string } | undefined;
        const remoteUpdatedAt = p.updated_at ?? p.created_at ?? now;
        if (!local) {
          insertPreset.run(p.id, p.name, p.work_minutes ?? 25, p.break_minutes ?? 5, p.long_break_minutes ?? 15, p.cycles_before_long ?? 4, p.extension_minutes ?? 5, p.auto_start_break ?? 1, p.auto_start_work ?? 0, p.is_default ?? 0, p.created_at ?? remoteUpdatedAt, remoteUpdatedAt, p.deleted_at ?? null);
          changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          updatePreset.run(p.name, p.work_minutes ?? 25, p.break_minutes ?? 5, p.long_break_minutes ?? 15, p.cycles_before_long ?? 4, p.extension_minutes ?? 5, p.auto_start_break ?? 1, p.auto_start_work ?? 0, p.is_default ?? 0, remoteUpdatedAt, p.deleted_at ?? null, p.id);
          changed = true;
        }
      }
    });

    const sessions = data.cauldron_sessions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(sessions) && sessions.length) step(db, 'cauldronSessions', () => {
      type LocalSession = { id: string; completed: number; updated_at: string | null; abandoned: number; task_id: string | null; retroactive: number; deleted_at: string | null };
      const getSession = db.prepare('SELECT id, completed, updated_at, abandoned, task_id, retroactive, deleted_at FROM cauldron_sessions WHERE id = ?');
      // is_extension travels too: without it, a +5min extension synced from
      // another device landed as is_extension = 0 and counted as a full pomodoro
      // in every stat (+1 today, +minutes on the weekly chart, +XP eligibility).
      // task_id and abandoned travel too: without them, mission links and broken
      // flasks (the shelf's scars) never crossed devices.
      // target_end_time and paused_at_ms deliberately DO NOT travel: they are
      // this device's clock. Importing them would boot the laptop into a stopped
      // (or ticking) timer for a session it never ran. See LOCAL_ONLY in
      // tests/modules/sync/sync-columns.test.ts, which is what enforces it.
      const insertSession = db.prepare(`INSERT OR IGNORE INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, completed_at, created_at, updated_at, deleted_at, is_extension, task_id, abandoned, retroactive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // LWW on the state that changes AFTER the row was first synced: abandoned
      // is set 5+ minutes in, task_id post-hoc, deleted_at by the orphan sweep.
      // The old merge only ever learned completed 0→1, so a flask A broke was a
      // running session on B, which B's cleanup then soft-deleted — and pushed.
      const lwwSession = db.prepare(`UPDATE cauldron_sessions SET completed = ?, completed_at = ?, abandoned = ?, task_id = ?, retroactive = ?, updated_at = ?, deleted_at = ? WHERE id = ?`);
      const completeSession = db.prepare(`UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ? WHERE id = ?`);
      // preset_id is a FOREIGN KEY: a session whose preset this device has never
      // seen would fail the constraint and roll the whole cauldron merge back.
      // Drop the dangling link, keep the session.
      const presetExists = db.prepare('SELECT 1 FROM cauldron_presets WHERE id = ?');
      for (const raw of sessions) {
        if (!isUsableRow(raw, 'cauldronSessions', ['id', 'type', 'started_at'])) continue;
        const s = withNormStamps(raw) as Record<string, any>;
        const local = getSession.get(s.id) as LocalSession | undefined;
        const remoteUpdatedAt = s.updated_at ?? s.created_at ?? s.started_at;
        if (!local) {
          const presetId = s.preset_id && presetExists.get(s.preset_id) ? s.preset_id : null;
          const result = insertSession.run(s.id, presetId, s.type, s.duration_minutes ?? 0, s.completed ?? 0, s.started_at, s.completed_at ?? null, s.created_at ?? s.started_at, remoteUpdatedAt, s.deleted_at ?? null, s.is_extension ?? 0, s.task_id ?? null, s.abandoned ?? 0, s.retroactive ?? 0);
          if (result.changes > 0) changed = true;
        } else if (isNewerStamp(remoteUpdatedAt, local.updated_at)) {
          // Columns added after the first sync clients shipped: absent = no
          // opinion, keep the local scar / link.
          lwwSession.run(
            s.completed ?? local.completed, s.completed_at ?? null,
            'abandoned' in s ? s.abandoned ?? 0 : local.abandoned,
            'task_id' in s ? s.task_id ?? null : local.task_id,
            'retroactive' in s ? s.retroactive ?? 0 : local.retroactive,
            remoteUpdatedAt,
            'deleted_at' in s ? s.deleted_at ?? null : local.deleted_at,
            s.id,
          );
          changed = true;
        } else if (s.completed === 1 && local.completed === 0) {
          completeSession.run(s.completed_at ?? null, remoteUpdatedAt, s.id);
          changed = true;
        }
      }
    });
  });

  tx();
  return { changed };
}
