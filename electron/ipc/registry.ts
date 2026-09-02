import { ipcMain } from 'electron';
import { getHandler, listChannels } from '../../shared-logic/registry';
import { registerRpgHandlers } from '../../shared-logic/modules/rpg-handlers';
import { registerQuestsIpcHandlers } from '../../shared-logic/modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../../shared-logic/modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from '../../shared-logic/modules/finance.ipc';
import { registerFinanceImportIpcHandlers } from '../../shared-logic/modules/finance-import.ipc';
import { registerCharacterIpcHandlers } from '../../shared-logic/modules/character.ipc';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';
import { registerNotificationIpcHandlers } from '../modules/notifications.ipc';
import { registerDollarIpcHandlers } from '../../shared-logic/modules/dollar.ipc';
import { registerCryptoIpcHandlers } from '../../shared-logic/modules/crypto.ipc';
import { registerSyncIpcHandlers } from '../modules/sync.ipc';
import { registerCauldronIpcHandlers } from '../modules/cauldron.ipc';
import { registerFeedbackIpcHandlers } from '../../shared-logic/modules/feedback.ipc';
import { registerSylIpcHandlers } from '../../shared-logic/modules/syl.ipc';

/**
 * Registers every handler in the platform-neutral registry, then binds each
 * channel to ipcMain. Anything registered through `ipcHandle` AFTER this call
 * is never bound — desktop-only handlers (updater, cauldron windows) are
 * registered in main.ts BEFORE calling this.
 */
export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerFinanceImportIpcHandlers();
  registerCharacterIpcHandlers();
  registerBackupIpcHandlers();
  registerNotificationIpcHandlers();
  registerDollarIpcHandlers();
  registerCryptoIpcHandlers();
  registerSyncIpcHandlers();
  registerCauldronIpcHandlers();
  registerFeedbackIpcHandlers();
  registerSylIpcHandlers();
  bindToIpcMain();
}

/** Same labeled-error logging the old ipcHandle wrapper had. */
function bindToIpcMain(): void {
  for (const channel of listChannels()) {
    const fn = getHandler(channel)!;
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn({}, ...args);
      } catch (err) {
        console.error(`[${channel}]`, err);
        throw err;
      }
    });
  }
}
