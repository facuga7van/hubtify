import { doc, setDoc, increment, serverTimestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from '../../shared/firebase';

const firestore = getFirestore(app);

function normalizeId(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/\//g, '-');
}

export async function upsertFoodItems(items: Array<{ name: string; calories: number }>): Promise<void> {
  for (const item of items) {
    if (!item.name || item.calories <= 0) continue;
    const id = normalizeId(item.name);
    if (!id) continue;
    try {
      const ref = doc(firestore, 'foods', id);
      await setDoc(ref, {
        name: item.name.trim(),
        totalCalories: increment(item.calories),
        count: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error('[food-telemetry]', item.name, err);
    }
  }
}
