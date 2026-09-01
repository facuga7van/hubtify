// Per-record merge for the questify push payload.
// Mirrors the pull semantics in electron/modules/sync.ipc.ts (sync:mergeQuestData):
// last-write-wins by (updatedAt ?? createdAt), the other side only wins if STRICTLY newer.
// Without this, setDoc(merge:true) replaces each questify array wholesale and any
// remote record the local SQLite doesn't know yet is destroyed by the push.

interface SyncRecordLike {
  id?: string | number;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

type QuestCollections = Record<string, unknown>;

// Collections the pull treats as a pure union (INSERT OR IGNORE, never updated):
// whatever the local side already has wins outright.
const UNION_ONLY = new Set(['rpgEvents', 'achievements', 'daySeals', 'obolosLedger', 'shopPurchases']);

/**
 * Identity of a record inside each collection. Everything is keyed by `id`
 * EXCEPT the tables whose primary key is something else and whose export
 * carries no `id` at all: day_seals (PK date), mastery_xp (PK module_id) and
 * rpg_events (sync_id; the AUTOINCREMENT id is device-local). Keyed by `r.id`
 * those all landed on Map key `undefined` and the second push collapsed 30
 * sealed days — or 4 masteries — into ONE row.
 */
const RECORD_KEY: Record<string, (r: SyncRecordLike) => unknown> = {
  daySeals: r => r.date,
  masteryXp: r => r.moduleId,
  rpgEvents: r => r.syncId ?? r.id,
};

/** Exported for the test that pins every export collection to a real key. */
export function questRecordKey(collection: string, r: SyncRecordLike): unknown {
  const k = (RECORD_KEY[collection] ?? (x => x.id))(r);
  // A record with no identity at all still must not collapse with the others:
  // fall back to its content so only true duplicates merge.
  return k ?? JSON.stringify(r);
}

const stamp = (r: SyncRecordLike): string => r.updatedAt ?? r.createdAt ?? '';

/** Whether the local record should replace the remote one under the same key. */
function localWins(key: string, l: SyncRecordLike, r: SyncRecordLike): boolean {
  if (UNION_ONLY.has(key)) return true;
  // masteryXp is a monotonic accumulator: the pull converges on MAX(xp), so
  // the push must too — a stale-but-higher local counter is not "older".
  if (key === 'masteryXp') return Number(l.xp ?? 0) >= Number(r.xp ?? 0);
  // local wins on tie — mirror of pull, where remote needs a strictly newer stamp
  return stamp(r) <= stamp(l);
}

function mergeCollection(key: string, local: SyncRecordLike[], remote: SyncRecordLike[]): SyncRecordLike[] {
  const merged = new Map<unknown, SyncRecordLike>();
  for (const r of remote) merged.set(questRecordKey(key, r), r);
  for (const l of local) {
    const k = questRecordKey(key, l);
    const r = merged.get(k);
    if (!r || localWins(key, l, r)) merged.set(k, l);
  }
  return [...merged.values()];
}

export function mergeQuestData(
  local: QuestCollections,
  remote: QuestCollections | null | undefined,
): QuestCollections {
  if (!remote) return local;

  const merged: QuestCollections = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key];
    const r = remote[key];
    if (Array.isArray(l) && Array.isArray(r)) {
      merged[key] = mergeCollection(key, l as SyncRecordLike[], r as SyncRecordLike[]);
    } else {
      merged[key] = l ?? r;
    }
  }
  return merged;
}
