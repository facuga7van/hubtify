import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getActiveFirestore } from './firebase';

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
    if (questValues.some(arr => Array.isArray(arr) && arr.length > 0)) {
      mainPayload.questify = questData;
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

    // Finance subcollection document — avoids 1MB Firestore limit
    // Guard: never overwrite Firestore with empty data (prevents data loss on cleared SQLite)
    const hasFinanceData = Object.values(financeData as Record<string, unknown[]>)
      .some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasFinanceData) {
      const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
      await setDoc(financeRef, financeData, { merge: true });
    }

    // Cauldron subcollection document
    const hasCauldronData = Object.values(cauldronData as Record<string, unknown[]>)
      .some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasCauldronData) {
      const cauldronRef = doc(db, 'hubtify_users', uid, 'cauldron', 'data');
      await setDoc(cauldronRef, cauldronData, { merge: true });
    }

    return { success: true };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Push failed:', err);
    return { success: false, error: error.message ?? 'Sync push failed' };
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
