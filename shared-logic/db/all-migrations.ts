import { runModuleMigrations } from './provider';
import { questsMigrations } from '../../src/modules/quests/quests.schema';
import { nutritionMigrations } from '../../src/modules/nutrition/nutrition.schema';
import { financeMigrations } from '../../src/modules/finance/finance.schema';
import { characterMigrations } from '../../src/modules/character/character.schema';
import { notificationsMigrations } from '../modules/notifications.schema';
import { cauldronMigrations } from '../../src/modules/cauldron/cauldron.schema';

/**
 * Every module's migrations, in the order main.ts used to call them. Each
 * binding (Electron main, Android worker) calls this once after getDb().
 */
export function runAllModuleMigrations(): void {
  runModuleMigrations(questsMigrations);
  runModuleMigrations(nutritionMigrations);
  runModuleMigrations(financeMigrations);
  runModuleMigrations(characterMigrations);
  runModuleMigrations(notificationsMigrations);
  runModuleMigrations(cauldronMigrations);
}
