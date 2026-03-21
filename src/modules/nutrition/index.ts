import type { ModuleDefinition } from '../../core/module-registry';
import { nutritionMigrations } from './nutrition.schema';
import Today from './components/Today';
import NutritionDashboardWidget from './components/NutritionDashboardWidget';

export const nutritionModule: ModuleDefinition = {
  id: 'nutrition',
  name: 'Nutrition',
  icon: () => null,
  routes: [
    { path: '/nutrition', component: Today },
  ],
  dashboardWidget: NutritionDashboardWidget,
  migrations: nutritionMigrations,
  rpgEventHandlers: {
    MEAL_LOGGED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? 10, hp: p.hp ?? 0 };
    },
    DAY_SUMMARY: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? 0, hp: p.hp ?? 0 };
    },
  },
};
