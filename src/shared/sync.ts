import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from './firebase';

const firestore = getFirestore(app);

export async function syncPush(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Gather all data from IPC (SQLite)
    const [stats, tasks, categories, charData, nutritionProfile, financeTx, loans] = await Promise.all([
      window.api.getRpgStats(),
      window.api.questsGetTasks(),
      window.api.questsGetCategories(),
      window.api.characterLoad(),
      window.api.nutritionGetProfile(),
      window.api.financeGetTransactions(new Date().toISOString().slice(0, 7)),
      window.api.financeGetLoans(),
    ]);

    // Get all subtasks for all tasks (parallel)
    const allTasks = tasks as Array<{ id: string }>;
    const subsPerTask = await Promise.all(allTasks.map(t => window.api.questsGetSubtasks(t.id)));
    const allSubs = subsPerTask.flat();

    const userRef = doc(firestore, 'hubtify_users', uid);
    await setDoc(userRef, {
      playerStats: stats,
      characterData: charData,
      questify: { tasks, subtasks: allSubs, categories },
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

export async function syncPull(uid: string): Promise<{ success: boolean; hasData?: boolean; error?: string }> {
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

    return { success: true, hasData: true };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Pull failed:', err);
    return { success: false, error: error.message ?? 'Sync pull failed' };
  }
}
