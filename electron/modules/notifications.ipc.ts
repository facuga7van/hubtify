import { Notification, BrowserWindow } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import {
  evaluateQuestNotifications,
  evaluateHabitNotifications,
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
const enabledModules: Record<string, boolean> = { quests: true, nutrition: true, finance: true, cauldron: true };

/**
 * El Caldero no pasa por el motor de notificaciones (dispara las suyas al terminar
 * un segmento), asi que necesita consultar el toggle a mano. Sin la clave
 * 'cauldron' arriba, `notifications:setModuleEnabled` la descartaba en silencio y
 * el switch de Ajustes no hacia absolutamente nada.
 */
export function isModuleNotificationEnabled(module: string): boolean {
  return enabledModules[module] !== false;
}

const POLLING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NATIVE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

let habitReminderEnabled = true;
let habitReminderTime = '21:00';

function runNotificationCheck(): number {
  const db = getDb();

  const resolvedCount = autoResolve(db);

  const candidates = [
    ...(enabledModules.quests ? evaluateQuestNotifications(db) : []),
    ...(enabledModules.quests && habitReminderEnabled ? evaluateHabitNotifications(db, habitReminderTime) : []),
    ...(enabledModules.nutrition ? evaluateNutritionNotifications(db) : []),
    ...(enabledModules.finance ? evaluateFinanceNotifications(db) : []),
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
  }

  // Broadcast whenever count changed — new notifications OR resolved ones
  if (newCount > 0 || resolvedCount > 0) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('notifications:updated');
    }
  }

  return newCount;
}

export function startNotificationEngine(): void {
  // The callback MUST NOT be allowed to throw: an unhandled throw inside a
  // setInterval callback has no catch frame above it and takes the whole main
  // process down (there is no uncaughtException handler registered).
  pollingInterval = setInterval(() => {
    try {
      runNotificationCheck();
    } catch (err) {
      console.error('[notifications] scheduled check failed:', err);
    }
  }, POLLING_INTERVAL_MS);
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

  ipcHandle('notifications:setModuleEnabled', (_e, module: string, enabled: boolean) => {
    if (module in enabledModules) {
      enabledModules[module] = enabled;
    }
  });

  ipcHandle('notifications:setHabitReminder', (_e, enabled: boolean, time: string) => {
    habitReminderEnabled = enabled;
    if (time) habitReminderTime = time;
  });
}
