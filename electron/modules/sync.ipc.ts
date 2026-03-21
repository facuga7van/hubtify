import { ipcMain } from 'electron';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { getDb } from '../ipc/db';

const firebaseConfig = {
  apiKey: "AIzaSyAXs0DtXOmjf2bdWce43vKY2fAeNi3hID8",
  authDomain: "hubtify-ab4ab.firebaseapp.com",
  projectId: "hubtify-ab4ab",
  storageBucket: "hubtify-ab4ab.firebasestorage.app",
  messagingSenderId: "792579152721",
  appId: "1:792579152721:web:e7cfe94e831605e3561170"
};

const app = initializeApp(firebaseConfig, 'sync');
const firestore = getFirestore(app);

export function registerSyncIpcHandlers(): void {
  // Push local data to Firebase
  ipcMain.handle('sync:push', async (_e, uid: string) => {
    try {
      const db = getDb();

      // Get player stats
      const stats = db.prepare('SELECT * FROM player_stats WHERE user_id = ?').get('default');

      // Get character data
      const charRow = db.prepare('SELECT data FROM character_data WHERE id = ?').get('default') as { data: string } | undefined;
      const charData = charRow ? JSON.parse(charRow.data) : null;

      // Get tasks
      const tasks = db.prepare('SELECT * FROM tasks').all();
      const subtasks = db.prepare('SELECT * FROM subtasks').all();
      const categories = db.prepare('SELECT name FROM task_categories').all();

      // Push to Firestore
      const userRef = doc(firestore, 'hubtify_users', uid);
      await setDoc(userRef, {
        playerStats: stats,
        characterData: charData,
        tasks,
        subtasks,
        taskCategories: categories,
        lastSyncAt: new Date().toISOString(),
      }, { merge: true });

      return { success: true };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Sync push failed' };
    }
  });

  // Pull remote data from Firebase
  ipcMain.handle('sync:pull', async (_e, uid: string) => {
    try {
      const userRef = doc(firestore, 'hubtify_users', uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return { success: true, hasData: false };

      const data = snap.data();
      const db = getDb();

      // Restore player stats
      if (data.playerStats) {
        const s = data.playerStats;
        db.prepare(`
          UPDATE player_stats SET level = ?, xp = ?, hp = ?, title = ?,
            streak = ?, daily_combo = ?, combo_date = ?, streak_last_date = ?,
            total_tasks = ?, total_meals = ?, total_expenses = ?
          WHERE user_id = 'default'
        `).run(s.level, s.xp, s.hp, s.title, s.streak, s.daily_combo,
          s.combo_date, s.streak_last_date, s.total_tasks, s.total_meals, s.total_expenses);
      }

      // Restore character
      if (data.characterData) {
        db.prepare('INSERT OR REPLACE INTO character_data (id, data, updated_at) VALUES (?, ?, datetime("now"))')
          .run('default', JSON.stringify(data.characterData));
      }

      // Restore tasks (replace all)
      if (data.tasks && Array.isArray(data.tasks)) {
        db.prepare('DELETE FROM subtasks').run();
        db.prepare('DELETE FROM tasks').run();
        const insertTask = db.prepare(`
          INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction(() => {
          for (const t of data.tasks) {
            insertTask.run(t.id, t.name, t.description ?? '', t.status ?? 0, t.tier ?? 2,
              t.category ?? '', t.due_date ?? null, t.task_order ?? 0,
              t.created_at ?? new Date().toISOString(), t.updated_at ?? new Date().toISOString());
          }
        });
        tx();
      }

      // Restore subtasks
      if (data.subtasks && Array.isArray(data.subtasks)) {
        const insertSub = db.prepare(`
          INSERT INTO subtasks (id, task_id, name, description, tier, status, subtask_order, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction(() => {
          for (const s of data.subtasks) {
            insertSub.run(s.id, s.task_id, s.name, s.description ?? '', s.tier ?? 2,
              s.status ?? 0, s.subtask_order ?? 0, s.completed_at ?? null,
              s.created_at ?? new Date().toISOString(), s.updated_at ?? new Date().toISOString());
          }
        });
        tx();
      }

      return { success: true, hasData: true };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Sync pull failed' };
    }
  });
}
