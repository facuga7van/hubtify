// Per-record merge for the questify push payload.
// Mirrors the pull semantics in electron/modules/sync.ipc.ts (sync:mergeQuestData):
// last-write-wins by (updatedAt ?? createdAt), the other side only wins if STRICTLY newer.
// Without this, setDoc(merge:true) replaces each questify array wholesale and any
// remote record the local SQLite doesn't know yet is destroyed by the push.

interface SyncRecordLike {
  id: string | number;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

type QuestCollections = Record<string, unknown>;

// rpg_events rows are append-only (the pull inserts by id and never updates)
const APPEND_ONLY = new Set(['rpgEvents']);

const stamp = (r: SyncRecordLike): string => r.updatedAt ?? r.createdAt ?? '';

function mergeCollection(key: string, local: SyncRecordLike[], remote: SyncRecordLike[]): SyncRecordLike[] {
  const merged = new Map<string | number, SyncRecordLike>();
  for (const r of remote) merged.set(r.id, r);
  for (const l of local) {
    const r = merged.get(l.id);
    // local wins on tie — mirror of pull, where remote needs a strictly newer stamp
    if (!r || APPEND_ONLY.has(key) || stamp(r) <= stamp(l)) merged.set(l.id, l);
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
