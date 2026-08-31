// Pure, testable helpers for the habitChecks subcollection sync (Fase 2a.1).
//
// These map between the local SQLite `habit_checks` row shape and the Firestore
// subcollection doc shape `hubtify_users/{uid}/habitChecks/{habitId}_{date}`.
//
// INVARIANT (additive-first): the legacy `questify.habitChecks[]` array keeps
// being written/read exactly as before. This subcollection is ADDITIVE. Nothing
// here imports firebase/electron so it stays unit-testable without an emulator.
//
// See docs/syl-integration-fase2a-spec.md §3 and syl-integration-xp-spike.md §3.

/** A local SQLite habit_check row (camelCase, as `sync:getAllQuestData` returns it). */
export interface HabitCheckRow {
  id: string;
  habitId: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The Firestore subcollection doc shape for a habit check. */
export interface HabitCheckDoc {
  habitId: string;
  date: string;
  /** false === soft-deleted (equivalent to deleted_at set). */
  checked: boolean;
  createdAt: string;
  updatedAt: string;
  /** Who wrote it. 'desktop' for writes from this app. */
  origin: 'desktop' | 'syl';
  /** 2b: transactional XP claim. Always null in 2a; consumed by 2b. */
  rpgClaimedAt: string | null;
}

/**
 * Deterministic subcollection doc ID from the natural key. Two writers
 * (desktop + Syl) targeting the same logical check hit the SAME doc, so
 * setDoc is an idempotent UPSERT — this is what kills the array race.
 */
export function habitCheckDocId(habitId: string, date: string): string {
  return `${habitId}_${date}`;
}

/**
 * Map a SQLite habit_check row to the subcollection doc shape.
 * `deleted_at == null` becomes `checked: true`; a set `deleted_at` becomes
 * `checked: false`. origin is always 'desktop' here; rpgClaimedAt always null.
 */
export function checkToDoc(row: HabitCheckRow): HabitCheckDoc {
  return {
    habitId: row.habitId,
    date: row.date,
    checked: row.deletedAt == null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    origin: 'desktop',
    rpgClaimedAt: null,
  };
}

/**
 * Inverse of checkToDoc: map a subcollection doc back to a SQLite row shape
 * for `mergeHabitChecks` (UPSERT by natural key). `checked: false` maps to
 * `deleted_at` = its updatedAt (soft-delete); `checked: true` maps to null.
 * The surrogate `id` is the deterministic docId — stable and unique per
 * natural key, so it collapses duplicates through mergeHabitChecks.
 */
export function docToCheck(doc: HabitCheckDoc): HabitCheckRow {
  const createdAt = doc.createdAt ?? doc.updatedAt;
  const updatedAt = doc.updatedAt ?? doc.createdAt;
  return {
    id: habitCheckDocId(doc.habitId, doc.date),
    habitId: doc.habitId,
    date: doc.date,
    createdAt,
    updatedAt,
    deletedAt: doc.checked ? null : updatedAt,
  };
}

/**
 * LWW guard: true iff `local` is STRICTLY newer than `remote`. A missing/empty
 * remote counts as "local is newer" (nothing to clobber → write). A missing
 * local is never newer. Ties are NOT newer (do not clobber a concurrent write).
 * ISO-8601 timestamps compare correctly as strings.
 */
export function isNewer(
  localUpdatedAt: string | null | undefined,
  remoteUpdatedAt: string | null | undefined,
): boolean {
  if (!remoteUpdatedAt) return !!localUpdatedAt;
  if (!localUpdatedAt) return false;
  return localUpdatedAt > remoteUpdatedAt;
}

/** A subcollection doc paired with its deterministic doc ID (for batch writes). */
export interface HabitCheckDocEntry {
  docId: string;
  doc: HabitCheckDoc;
}

/**
 * Transform the legacy `questify.habitChecks[]` array into the list of
 * subcollection docs for the one-time backfill. Collapses duplicates by
 * natural key (habitId, date) — the pre-migration array could hold the same
 * logical check twice under different surrogate ids — keeping the newest by
 * updatedAt (LWW, ties keep the incumbent). Idempotent by construction: the
 * doc IDs are deterministic, so re-running never duplicates.
 */
export function migrateArrayToDocs(legacyArray: HabitCheckRow[]): HabitCheckDocEntry[] {
  const byKey = new Map<string, HabitCheckRow>();
  for (const row of legacyArray) {
    const docId = habitCheckDocId(row.habitId, row.date);
    const existing = byKey.get(docId);
    if (!existing || isNewer(row.updatedAt ?? row.createdAt, existing.updatedAt ?? existing.createdAt)) {
      byKey.set(docId, row);
    }
  }
  return [...byKey.entries()].map(([docId, row]) => ({ docId, doc: checkToDoc(row) }));
}
