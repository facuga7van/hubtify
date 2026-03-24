import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from '../modules/finance.ipc';
import { registerCharacterIpcHandlers } from '../modules/character.ipc';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';
import { registerNotificationIpcHandlers } from '../modules/notifications.ipc';
import { registerDollarIpcHandlers } from '../modules/dollar.ipc';
import { registerSyncIpcHandlers } from '../modules/sync.ipc';

export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerCharacterIpcHandlers();
  registerBackupIpcHandlers();
  registerNotificationIpcHandlers();
  registerDollarIpcHandlers();
  registerSyncIpcHandlers();
}
