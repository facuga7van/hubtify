import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../modules/nutrition.ipc';
import { registerFinanceIpcHandlers } from '../modules/finance.ipc';
import { registerCharacterIpcHandlers } from '../modules/character.ipc';
import { registerAuthIpcHandlers } from '../modules/auth.ipc';
import { registerSyncIpcHandlers } from '../modules/sync.ipc';
import { registerBackupIpcHandlers } from '../modules/backup.ipc';

export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
  registerFinanceIpcHandlers();
  registerCharacterIpcHandlers();
  registerAuthIpcHandlers();
  registerSyncIpcHandlers();
  registerBackupIpcHandlers();
}
