import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getActiveFirestore } from './firebase';

export async function syncPush(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [stats, questData, charData, nutritionData, financeTx, loans, incomeSources] = await Promise.all([
      window.api.getRpgStats(),
      window.api.syncGetAllQuestData(),
      window.api.characterLoad(),
      window.api.syncGetAllNutritionData(),
      window.api.financeGetTransactions(new Date().toISOString().slice(0, 7)),
      window.api.financeGetLoans(),
      window.api.financeGetIncomeSources(),
    ]);

    const userRef = doc(getActiveFirestore(), 'hubtify_users', uid);
    await setDoc(userRef, {
      playerStats: stats,
      characterData: charData,
      questify: questData,
      nutrify: nutritionData,
      coinify: { transactions: financeTx, loans, incomeSources },
      settings: {
        language: localStorage.getItem('hubtify_lang') || 'es',
        sound: localStorage.getItem('hubtify_sound') !== 'false',
        reminders: localStorage.getItem('hubtify_reminders') === 'true',
        sidebarCollapsed: localStorage.getItem('hubtify_sidebar_collapsed') === 'true',
        onboarded: localStorage.getItem('hubtify_onboarded') === 'true',
      },
      lastSyncAt: new Date().toISOString(),
    }, { merge: true });

    return { success: true };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Push failed:', err);
    return { success: false, error: error.message ?? 'Sync push failed' };
  }
}

export async function syncPull(uid: string): Promise<{ success: boolean; hasData?: boolean; changed?: boolean; error?: string }> {
  try {
    const userRef = doc(getActiveFirestore(), 'hubtify_users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return { success: true, hasData: false };

    const data = snap.data();

    if (data.playerStats) {
      await window.api.syncRestoreStats(data.playerStats);
    }

    if (data.characterData) {
      await window.api.characterSave(data.characterData);
    }

    // Merge quest data (tasks, subtasks, projects, categories, habits, habitChecks)
    let changed = false;
    if (data.questify) {
      const result = await window.api.syncMergeQuestData(data.questify);
      changed = result.changed;
    }

    // Restore nutrition data
    if (data.nutrify) {
      const nutritionResult = await window.api.syncMergeNutritionData(data.nutrify as Record<string, unknown>);
      if (nutritionResult.changed) changed = true;
    }

    // Restore finance income sources
    if (data.coinify?.incomeSources && Array.isArray(data.coinify.incomeSources)) {
      for (const src of data.coinify.incomeSources) {
        try { await window.api.financeAddIncomeSource(src); } catch { /* already exists */ }
      }
    }

    // Restore settings
    if (data.settings) {
      const s = data.settings as Record<string, unknown>;
      if (s.language) localStorage.setItem('hubtify_lang', String(s.language));
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
