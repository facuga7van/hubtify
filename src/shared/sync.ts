import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from './firebase';

const firestore = getFirestore(app);

export async function syncPush(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [stats, questData, charData, nutritionProfile, financeTx, loans] = await Promise.all([
      window.api.getRpgStats(),
      window.api.syncGetAllQuestData(),
      window.api.characterLoad(),
      window.api.nutritionGetProfile(),
      window.api.financeGetTransactions(new Date().toISOString().slice(0, 7)),
      window.api.financeGetLoans(),
    ]);

    const userRef = doc(firestore, 'hubtify_users', uid);
    await setDoc(userRef, {
      playerStats: stats,
      characterData: charData,
      questify: questData,
      nutrify: { profile: nutritionProfile },
      coinify: { transactions: financeTx, loans },
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
    const userRef = doc(firestore, 'hubtify_users', uid);
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

    return { success: true, hasData: true, changed };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Pull failed:', err);
    return { success: false, error: error.message ?? 'Sync pull failed' };
  }
}
