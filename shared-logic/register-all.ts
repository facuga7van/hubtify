import { registerRpgHandlers } from './modules/rpg-handlers';
import { registerQuestsIpcHandlers } from './modules/quests.ipc';
import { registerNutritionIpcHandlers } from './modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from './modules/finance.ipc';
import { registerFinanceImportIpcHandlers } from './modules/finance-import.ipc';
import { registerCharacterIpcHandlers } from './modules/character.ipc';
import { registerNotificationIpcHandlers } from './modules/notifications.ipc';
import { registerDollarIpcHandlers } from './modules/dollar.ipc';
import { registerCryptoIpcHandlers } from './modules/crypto.ipc';
import { registerSyncIpcHandlers } from './modules/sync.ipc';
import { registerCauldronIpcHandlers } from './modules/cauldron.ipc';
import { registerFeedbackIpcHandlers } from './modules/feedback.ipc';
import { registerSylIpcHandlers } from './modules/syl.ipc';

/**
 * Registers the 13 platform-neutral handler sets (they keep their historical
 * `register*IpcHandlers` names: zero churn). Lives outside registry.ts on
 * purpose — the modules import registry.ts, so registry.ts importing them
 * back would be a cycle. Desktop-only sets (backup, updater, cauldron
 * windows) are registered by the Electron binding before it binds to ipcMain.
 */
export function registerAllHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerFinanceImportIpcHandlers();
  registerCharacterIpcHandlers();
  registerNotificationIpcHandlers();
  registerDollarIpcHandlers();
  registerCryptoIpcHandlers();
  registerSyncIpcHandlers();
  registerCauldronIpcHandlers();
  registerFeedbackIpcHandlers();
  registerSylIpcHandlers();
}
