import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';
import { registerNutritionIpcHandlers } from '../modules/nutrition.ipc';

export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
  registerNutritionIpcHandlers();
}
