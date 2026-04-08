import { Notification, BrowserWindow } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import {
  evaluateQuestNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
  setEngineLocale,
  getEngineLocale,
} from './notification-engine';
import type { AppNotification } from '../../shared/types';

let pollingInterval: NodeJS.Timeout | null = null;
let lastNativeNotificationTime = 0;
let systemNotificationsEnabled = true;

const POLLING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NATIVE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

function runNotificationCheck(): number {
  const db = getDb();

  autoResolve(db);

  const candidates = [
    ...evaluateQuestNotifications(db),
    ...evaluateNutritionNotifications(db),
    ...evaluateFinanceNotifications(db),
  ];

  const newCount = deduplicateAndInsert(db, candidates);

  cleanupOldNotifications(db);

  if (newCount > 0) {
    const now = Date.now();
    if (systemNotificationsEnabled && now - lastNativeNotificationTime >= NATIVE_COOLDOWN_MS) {
      const totalActive = (db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE status = 'active' AND deleted_at IS NULL
      `).get() as { count: number }).count;

      if (totalActive > 0 && Notification.isSupported()) {
        const nativeNotif = new Notification({
          title: 'Hubtify',
          body: getEngineLocale() === 'en'
            ? `You have ${totalActive} pending ${totalActive === 1 ? 'item' : 'items'}.`
            : `Tenés ${totalActive} ${totalActive === 1 ? 'cosa pendiente' : 'cosas pendientes'}.`,
        });
        nativeNotif.on('click', () => {
          const mainWin = BrowserWindow.getAllWindows()[0];
          if (mainWin) {
            if (mainWin.isMinimized()) mainWin.restore();
            mainWin.show();
            mainWin.focus();
          }
        });
        nativeNotif.show();
        lastNativeNotificationTime = now;
      }
    }

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
  }

  return newCount;
}

export function startNotificationEngine(): void {
  setTimeout(() => runNotificationCheck(), 5000);
  pollingInterval = setInterval(() => runNotificationCheck(), POLLING_INTERVAL_MS);
}

export function stopNotificationEngine(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function registerNotificationIpcHandlers(): void {
  ipcHandle('notifications:send', (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return true;
    }
    return false;
  });

  ipcHandle('notifications:getAll', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, type, module, title, body,
             action_route AS actionRoute, status,
             snoozed_until AS snoozedUntil,
             created_at AS createdAt,
             updated_at AS updatedAt,
             resolved_at AS resolvedAt,
             deleted_at AS deletedAt,
             ref_id AS refId
      FROM notifications
      WHERE (status = 'active' AND deleted_at IS NULL)
         OR (status = 'snoozed' AND snoozed_until <= datetime('now') AND deleted_at IS NULL)
      ORDER BY created_at DESC
    `).all() as AppNotification[];
  });

  ipcHandle('notifications:dismiss', (_e, id: string) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?`).run(id);
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
  });

  ipcHandle('notifications:snooze', (_e, id: string) => {
    const db = getDb();
    db.prepare(`
      UPDATE notifications
      SET status = 'snoozed', snoozed_until = datetime('now', '+6 hours'), updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
  });

  ipcHandle('notifications:runCheck', () => {
    return runNotificationCheck();
  });

  ipcHandle('notifications:getCount', () => {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE deleted_at IS NULL
        AND (status = 'active' OR (status = 'snoozed' AND snoozed_until <= datetime('now')))
    `).get() as { count: number };
    return result.count;
  });

  ipcHandle('notifications:setSystemEnabled', (_e, enabled: boolean) => {
    systemNotificationsEnabled = enabled;
  });

  ipcHandle('notifications:setLocale', (_e, locale: string) => {
    setEngineLocale(locale);
  });
}
