import { doc, setDoc, getDoc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { getActiveFirestore } from './firebase';
import { mergeQuestData } from './sync-merge';
import { daysAgoDateString } from '../../shared/date-utils';
import {
  habitCheckDocId,
  checkToDoc,
  docToCheck,
  migrateArrayToDocs,
  isNewer,
  type HabitCheckRow,
  type HabitCheckDoc,
} from './habit-checks-sync';

// Additive-first rollout flag (spec §5.3). While true, the legacy
// `questify.habitChecks[]` array keeps being written as the authoritative path
// (safety net) and the subcollection is purely additive. Flip to false in a
// LATER release — once telemetry shows all active clients write the
// subcollection — to stop writing the legacy array. Do NOT flip yet.
const HABITCHECKS_DUALWRITE_LEGACY = true;

// Firestore hard-caps a batch at 500 writes; habit checks grow unbounded
// (one per habit per day), so chunk to stay well under the limit.
const HABITCHECKS_BATCH_SIZE = 450;

// Push habit checks to the subcollection with an LWW guard. Reads the current
// remote docs once and only writes the checks where the local row is strictly
// newer than the remote (or the remote doc doesn't exist) — this avoids
// clobbering a newer write from Syl. Fully isolated/non-fatal: a subcollection
// failure must never break the main push (legacy array is the safety net).
async function pushHabitChecks(
  db: ReturnType<typeof getActiveFirestore>,
  uid: string,
  checks: HabitCheckRow[],
): Promise<void> {
  if (!checks.length) return;
  try {
    const col = collection(db, 'hubtify_users', uid, 'habitChecks');
    const remoteSnap = await getDocs(col);
    const remoteStamp = new Map<string, string | null>();
    remoteSnap.forEach(d => {
      const data = d.data() as Partial<HabitCheckDoc>;
      remoteStamp.set(d.id, data.updatedAt ?? null);
    });

    // Collect only the checks whose local row wins LWW.
    const toWrite = checks.filter(row => {
      const id = habitCheckDocId(row.habitId, row.date);
      return isNewer(row.updatedAt ?? row.createdAt, remoteStamp.get(id) ?? null);
    });
    if (!toWrite.length) return;

    for (let i = 0; i < toWrite.length; i += HABITCHECKS_BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const row of toWrite.slice(i, i + HABITCHECKS_BATCH_SIZE)) {
        const id = habitCheckDocId(row.habitId, row.date);
        batch.set(doc(col, id), checkToDoc(row), { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    console.error('[Sync] habitChecks subcollection push failed (non-fatal):', err);
  }
}

export interface RpgEventLike {
  syncId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/** Only this much rpg_events history travels in the main document. */
const RPG_EVENTS_PUSH_DAYS = 90;
/** Hard cap, in case a single day produced an absurd number of events. */
const RPG_EVENTS_PUSH_MAX = 3000;

/**
 * Unions local and remote rpg_events on `syncId` (never on the device-local
 * AUTOINCREMENT `id`) and trims the result to a bounded, recent window so the main
 * user document cannot grow past Firestore's 1 MB cap.
 */
export function mergeRpgEvents(
  local: RpgEventLike[] | undefined,
  remote: RpgEventLike[] | undefined,
): RpgEventLike[] {
  // Local-day cutoff, same as the main process: created_at is a local stamp.
  const cutoffStr = daysAgoDateString(RPG_EVENTS_PUSH_DAYS);

  const bySyncId = new Map<string, RpgEventLike>();
  for (const e of [...(remote ?? []), ...(local ?? [])]) {
    // Pre-sync_id rows can't be identified across devices; drop rather than duplicate.
    if (!e || typeof e.syncId !== 'string' || !e.syncId) continue;
    if ((e.createdAt ?? '') < cutoffStr) continue;
    bySyncId.set(e.syncId, e);
  }

  const all = [...bySyncId.values()].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return all.length > RPG_EVENTS_PUSH_MAX ? all.slice(all.length - RPG_EVENTS_PUSH_MAX) : all;
}

/**
 * Fired on the window when a push fails. The push used to swallow every error into
 * a console.error, so a user whose document had grown past 1 MB (or who was simply
 * offline) had no way of knowing they had stopped syncing.
 *
 * detail: { uid, error }
 */
export const SYNC_PUSH_FAILED_EVENT = 'sync:pushFailed';

interface SyncSettings {
  language?: string;
  sound?: boolean;
  reminders?: boolean;
  sidebarCollapsed?: boolean;
  onboarded?: boolean;
}

export async function syncPush(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [stats, questData, charData, characterName, username, nutritionData, financeData, cauldronData, notificationData] = await Promise.all([
      window.api.getRpgStats(),
      window.api.syncGetAllQuestData(),
      window.api.characterLoad(),
      window.api.characterGetName(),
      window.api.characterGetUsername(),
      window.api.syncGetAllNutritionData(),
      window.api.syncGetAllFinanceData(),
      window.api.syncGetAllCauldronData(),
      window.api.syncGetAllNotificationData(),
    ]);

    const db = getActiveFirestore();
    const userRef = doc(db, 'hubtify_users', uid);

    // Build main doc payload conditionally — never overwrite Firestore with empty data
    const mainPayload: Record<string, unknown> = {
      characterName: characterName ?? null,
      username: username ?? null,
      settings: {
        language: localStorage.getItem('hubtify_lang') || 'es',
        sound: localStorage.getItem('hubtify_sound') !== 'false',
        reminders: localStorage.getItem('hubtify_reminders') === 'true',
        sidebarCollapsed: localStorage.getItem('hubtify_sidebar_collapsed') === 'true',
        onboarded: localStorage.getItem('hubtify_onboarded') === 'true',
      },
      lastSyncAt: new Date().toISOString(),
    };

    // Only include questify if it has real data
    const questValues = Object.values(questData as Record<string, unknown[]>);
    const hasQuestData = questValues.some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasQuestData) {
      // setDoc(merge:true) replaces each questify array wholesale, so merge
      // per-record against the remote doc first — a record the local SQLite
      // doesn't know yet (external writer, other device) must survive the push
      const remoteSnap = await getDoc(userRef);
      const remoteQuestify = remoteSnap.exists()
        ? (remoteSnap.data().questify as Record<string, unknown> | undefined)
        : undefined;
      const merged = mergeQuestData(questData as Record<string, unknown>, remoteQuestify) as Record<string, unknown>;

      // task_drawings hold base64 image data. Inside the main document they are the
      // fastest route to Firestore's 1 MB per-document cap — and once a document is
      // over it EVERY syncPush fails, so the user silently stops syncing entirely.
      // They move to their own subcollection document below.
      delete merged.drawings;

      // rpg_events cannot go through mergeQuestData: that merges on `id`, and
      // rpg_events.id is a device-local AUTOINCREMENT. They are unioned on sync_id
      // and bounded, for the same 1 MB reason (one row per task, habit, meal and
      // expense, previously never pruned).
      merged.rpgEvents = mergeRpgEvents(
        (questData as { rpgEvents?: RpgEventLike[] }).rpgEvents,
        remoteQuestify?.rpgEvents as RpgEventLike[] | undefined,
      );

      // Additive-first: while HABITCHECKS_DUALWRITE_LEGACY the legacy array stays
      // in the payload untouched. When flipped false (later release), strip it —
      // the subcollection becomes the sole source of truth for habit checks.
      if (!HABITCHECKS_DUALWRITE_LEGACY) {
        delete merged.habitChecks;
      }

      mainPayload.questify = merged;
    }

    // Only include nutrify if profile exists or any array has data
    const nd = nutritionData as Record<string, unknown>;
    const hasNutritionData = nd.profile != null ||
      Object.values(nd).some(v => Array.isArray(v) && v.length > 0);
    if (hasNutritionData) {
      mainPayload.nutrify = nutritionData;
    }

    // Only include notifications if non-empty
    if (Array.isArray(notificationData) && notificationData.length > 0) {
      mainPayload.notifications = notificationData;
    }

    // Only include playerStats if not default (level > 1 or xp > 0 or hp !== maxHp)
    const s = stats as unknown as Record<string, number>;
    if (s && (s.level > 1 || s.xp > 0 || s.hp !== s.maxHp)) {
      mainPayload.playerStats = stats;
    }

    // Only include characterData if non-null/non-empty
    if (charData != null && Object.keys(charData as Record<string, unknown>).length > 0) {
      mainPayload.characterData = charData;
    }

    await setDoc(userRef, mainPayload, { merge: true });

    // habitChecks subcollection (Fase 2a.1) — ADDITIVE. The legacy array above
    // stays authoritative; this is the idempotent, race-free path for Syl.
    const questHabitChecks = (questData as { habitChecks?: HabitCheckRow[] }).habitChecks;
    if (questHabitChecks?.length) {
      await pushHabitChecks(db, uid, questHabitChecks);
    }

    // Finance subcollection document — avoids 1MB Firestore limit
    // Guard: never overwrite Firestore with empty data (prevents data loss on cleared SQLite)
    const hasFinanceData = Object.values(financeData as Record<string, unknown[]>)
      .some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasFinanceData) {
      const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
      await setDoc(financeRef, financeData, { merge: true });
    }

    // Drawings subcollection document — base64 payloads kept OUT of the main doc
    // (see the delete above). Isolated try/catch: a drawings failure must never
    // take the rest of the push down with it.
    const questDrawings = (questData as { drawings?: unknown[] }).drawings;
    if (Array.isArray(questDrawings) && questDrawings.length > 0) {
      try {
        const drawingsRef = doc(db, 'hubtify_users', uid, 'questify', 'drawings');
        await setDoc(drawingsRef, { drawings: questDrawings });
      } catch (err) {
        console.error('[Sync] drawings subcollection push failed (non-fatal):', err);
      }
    }

    // Cauldron subcollection document
    const hasCauldronData = Object.values(cauldronData as Record<string, unknown[]>)
      .some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasCauldronData) {
      const cauldronRef = doc(db, 'hubtify_users', uid, 'cauldron', 'data');
      await setDoc(cauldronRef, cauldronData, { merge: true });
    }

    // Syl read-projection snapshot — dedicated, isolated doc the Syl assistant
    // reads via firebase-admin. Full recompute, no merge: total replacement,
    // idempotent by construction. Isolated try/catch so a snapshot failure never
    // breaks the main push. Guard: never write when there's no real data.
    const statsNonDefault = !!(s && (s.level > 1 || s.xp > 0 || s.hp !== s.maxHp));
    if (hasQuestData || hasNutritionData || hasFinanceData || statsNonDefault) {
      try {
        const snapshot = await window.api.sylBuildSnapshot();
        const sylRef = doc(db, 'hubtify_users', uid, 'syl', 'snapshot');
        await setDoc(sylRef, snapshot);
      } catch (snapErr) {
        console.error('[Sync] Syl snapshot write failed (non-fatal):', snapErr);
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const error = err as { message?: string };
    const message = error.message ?? 'Sync push failed';
    console.error('[Sync] Push failed:', err);
    // Tell the UI. A silent failure here means the user keeps working believing
    // their data is in the cloud — and logout/switchAccount then wipe it.
    try {
      window.dispatchEvent(new CustomEvent(SYNC_PUSH_FAILED_EVENT, { detail: { uid, error: message } }));
    } catch { /* non-DOM host (tests) */ }
    return { success: false, error: message };
  }
}

export async function syncPull(uid: string): Promise<{ success: boolean; hasData?: boolean; changed?: boolean; error?: string }> {
  try {
    const db = getActiveFirestore();
    const userRef = doc(db, 'hubtify_users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return { success: true, hasData: false };

    const data = snap.data();
    let changed = false;

    // Only restore stats/character if remote is newer than last pull (Issue #5)
    const localLastPull = localStorage.getItem('hubtify_last_pull_at');
    const remoteLastSync = data.lastSyncAt as string | undefined;
    const shouldRestoreScalars = !localLastPull || !remoteLastSync || remoteLastSync > localLastPull;

    if (data.playerStats && shouldRestoreScalars) {
      await window.api.syncRestoreStats(data.playerStats);
    }

    if (data.characterData && shouldRestoreScalars) {
      await window.api.characterSave(data.characterData);
    }

    if (data.characterName) {
      await window.api.characterSetName(data.characterName as string);
    }

    if (data.username) {
      await window.api.characterSetUsername(data.username as string);
    }

    if (data.questify) {
      const result = await window.api.syncMergeQuestData(data.questify);
      if (result.changed) changed = true;
    }

    // habitChecks subcollection (Fase 2a.1) — ADDITIVE read alongside the legacy
    // array above. mergeHabitChecks UPSERTs by natural key (habit_id, date), so
    // any check present in both the legacy array and the subcollection collapses
    // to a single row (last-write-wins by updated_at). Isolated/non-fatal.
    try {
      const checksCol = collection(db, 'hubtify_users', uid, 'habitChecks');
      const checksSnap = await getDocs(checksCol);
      if (!checksSnap.empty) {
        const habitChecks = checksSnap.docs.map(d => docToCheck(d.data() as HabitCheckDoc));
        const checksResult = await window.api.syncMergeQuestData({ habitChecks });
        if (checksResult.changed) changed = true;
      }
    } catch (err) {
      console.error('[Sync] habitChecks subcollection pull failed (non-fatal):', err);
    }

    // One-time backfill: migrate the legacy `questify.habitChecks[]` array into
    // the subcollection, then flag the account as migrated. Idempotent (doc IDs
    // are deterministic → re-running never duplicates). Runs once. Non-fatal.
    try {
      const sylMigrations = data.sylMigrations as { habitChecks?: boolean } | undefined;
      if (sylMigrations?.habitChecks !== true) {
        const legacyChecks = (
          (data.questify as { habitChecks?: HabitCheckRow[] } | undefined)?.habitChecks ?? []
        );
        const entries = migrateArrayToDocs(legacyChecks);
        const migrCol = collection(db, 'hubtify_users', uid, 'habitChecks');
        for (let i = 0; i < entries.length; i += HABITCHECKS_BATCH_SIZE) {
          const batch = writeBatch(db);
          for (const { docId, doc: checkDoc } of entries.slice(i, i + HABITCHECKS_BATCH_SIZE)) {
            batch.set(doc(migrCol, docId), checkDoc, { merge: true });
          }
          await batch.commit();
        }
        await setDoc(userRef, { sylMigrations: { habitChecks: true } }, { merge: true });
      }
    } catch (err) {
      console.error('[Sync] habitChecks one-time migration failed (non-fatal):', err);
    }

    // Drawings subcollection — moved out of the main document to keep it under
    // Firestore's 1 MB cap. Read AFTER questify so the tasks they reference exist
    // locally (mergeQuestData drops orphan drawings). Isolated/non-fatal.
    try {
      const drawingsRef = doc(db, 'hubtify_users', uid, 'questify', 'drawings');
      const drawingsSnap = await getDoc(drawingsRef);
      const remoteDrawings = drawingsSnap.exists()
        ? (drawingsSnap.data().drawings as unknown[] | undefined)
        : undefined;
      if (remoteDrawings?.length) {
        const drawingsResult = await window.api.syncMergeQuestData({ drawings: remoteDrawings });
        if (drawingsResult.changed) changed = true;
      }
    } catch (err) {
      console.error('[Sync] drawings subcollection pull failed (non-fatal):', err);
    }

    if (data.nutrify) {
      const nutritionResult = await window.api.syncMergeNutritionData(data.nutrify);
      if (nutritionResult.changed) changed = true;
    }

    if (data.notifications && Array.isArray(data.notifications)) {
      const notifResult = await window.api.syncMergeNotificationData(data.notifications as Record<string, unknown>[]);
      if (notifResult.changed) changed = true;
    }

    // Finance — read from subcollection
    const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
    const financeSnap = await getDoc(financeRef);
    if (financeSnap.exists()) {
      const financeData = financeSnap.data() as Record<string, unknown[]>;
      const financeResult = await window.api.syncMergeFinanceData(financeData);
      if (financeResult.changed) changed = true;
    } else if (data.coinify) {
      // Backward compat: old accounts have finance in main doc
      const legacyData: Record<string, unknown[]> = {};
      if (data.coinify.transactions) legacyData.transactions = data.coinify.transactions;
      if (data.coinify.loans) legacyData.loans = data.coinify.loans;
      if (data.coinify.recurring) legacyData.recurring = data.coinify.recurring;
      if (Object.keys(legacyData).length > 0) {
        const financeResult = await window.api.syncMergeFinanceData(legacyData);
        if (financeResult.changed) changed = true;
      }
    }

    // Cauldron — read from subcollection
    const cauldronRef = doc(db, 'hubtify_users', uid, 'cauldron', 'data');
    const cauldronSnap = await getDoc(cauldronRef);
    if (cauldronSnap.exists()) {
      const cauldronData = cauldronSnap.data() as Record<string, unknown>;
      const cauldronResult = await window.api.syncMergeCauldronData(cauldronData);
      if (cauldronResult.changed) changed = true;
    }

    // Restore settings
    if (data.settings) {
      const s = data.settings as SyncSettings;
      if (s.language) localStorage.setItem('hubtify_lang', s.language);
      if (s.sound !== undefined) localStorage.setItem('hubtify_sound', String(s.sound));
      if (s.reminders !== undefined) localStorage.setItem('hubtify_reminders', String(s.reminders));
      if (s.sidebarCollapsed !== undefined) localStorage.setItem('hubtify_sidebar_collapsed', String(s.sidebarCollapsed));
      if (s.onboarded) localStorage.setItem('hubtify_onboarded', 'true');
    }

    // Track last successful pull time for overwrite guards
    localStorage.setItem('hubtify_last_pull_at', new Date().toISOString());

    return { success: true, hasData: true, changed };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Pull failed:', err);
    return { success: false, error: error.message ?? 'Sync pull failed' };
  }
}
