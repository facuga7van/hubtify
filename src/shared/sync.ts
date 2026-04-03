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
    const [stats, questData, charData, nutritionData, financeData] = await Promise.all([
      window.api.getRpgStats(),
      window.api.syncGetAllQuestData(),
      window.api.characterLoad(),
      window.api.syncGetAllNutritionData(),
      window.api.syncGetAllFinanceData(),
    ]);

    const db = getActiveFirestore();
    const userRef = doc(db, 'hubtify_users', uid);

    // Main document — everything except finance
    await setDoc(userRef, {
      playerStats: stats,
      characterData: charData,
      questify: questData,
      nutrify: nutritionData,
      settings: {
        language: localStorage.getItem('hubtify_lang') || 'es',
        sound: localStorage.getItem('hubtify_sound') !== 'false',
        reminders: localStorage.getItem('hubtify_reminders') === 'true',
        sidebarCollapsed: localStorage.getItem('hubtify_sidebar_collapsed') === 'true',
        onboarded: localStorage.getItem('hubtify_onboarded') === 'true',
      },
      lastSyncAt: new Date().toISOString(),
    }, { merge: true });

    // Finance subcollection document — avoids 1MB Firestore limit
    const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
    await setDoc(financeRef, financeData);

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

    if (data.playerStats) {
      await window.api.syncRestoreStats(data.playerStats);
    }

    if (data.characterData) {
      await window.api.characterSave(data.characterData);
    }

    if (data.questify) {
      const result = await window.api.syncMergeQuestData(data.questify);
      if (result.changed) changed = true;
    }

    if (data.nutrify) {
      const nutritionResult = await window.api.syncMergeNutritionData(data.nutrify);
      if (nutritionResult.changed) changed = true;
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

    // Restore settings
    if (data.settings) {
      const s = data.settings as SyncSettings;
      if (s.language) localStorage.setItem('hubtify_lang', s.language);
      if (s.sound !== undefined) localStorage.setItem('hubtify_sound', String(s.sound));
      if (s.reminders !== undefined) localStorage.setItem('hubtify_reminders', String(s.reminders));
      if (s.sidebarCollapsed !== undefined) localStorage.setItem('hubtify_sidebar_collapsed', String(s.sidebarCollapsed));
      if (s.onboarded) localStorage.setItem('hubtify_onboarded', 'true');
    }

    return { success: true, hasData: true, changed };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Pull failed:', err);
    return { success: false, error: error.message ?? 'Sync pull failed' };
  }
}
