import { ipcMain } from 'electron';
import { getHandler, listChannels } from '../../shared-logic/registry';
import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from '../modules/finance.ipc';
import { registerFinanceImportIpcHandlers } from '../modules/finance-import.ipc';
import { registerCharacterIpcHandlers } from '../modules/character.ipc';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';
import { registerNotificationIpcHandlers } from '../modules/notifications.ipc';
import { registerDollarIpcHandlers } from '../modules/dollar.ipc';
import { registerCryptoIpcHandlers } from '../modules/crypto.ipc';
import { registerSyncIpcHandlers } from '../modules/sync.ipc';
import { registerCauldronIpcHandlers } from '../modules/cauldron.ipc';
import { registerFeedbackIpcHandlers } from '../modules/feedback.ipc';
import { registerSylIpcHandlers } from '../modules/syl.ipc';

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
