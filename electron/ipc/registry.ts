import { registerRpgHandlers } from './rpg-handlers';
import { registerQuestsIpcHandlers } from '../modules/quests.ipc';

export function registerAllIpcHandlers(): void {
  registerRpgHandlers();
  registerQuestsIpcHandlers();
}
