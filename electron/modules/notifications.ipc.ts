import { ipcMain, Notification, app } from 'electron';

let reminderInterval: NodeJS.Timeout | null = null;

export function clearReminderInterval(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}

export function registerNotificationIpcHandlers(): void {
  ipcMain.handle('notifications:setReminders', (_e, enabled: boolean) => {
    if (reminderInterval) {
      clearInterval(reminderInterval);
      reminderInterval = null;
    }

    if (enabled) {
      // Remind every 3 hours
      reminderInterval = setInterval(() => {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Hubtify',
            body: 'No te olvides de registrar tus comidas y completar tus quests!',
            icon: undefined,
          }).show();
        }
      }, 3 * 60 * 60 * 1000);
    }

    return { success: true };
  });

  ipcMain.handle('notifications:send', (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return true;
    }
    return false;
  });
}
