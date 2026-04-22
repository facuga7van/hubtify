import type { ModuleDefinition } from '../../core/module-registry';
import { cauldronMigrations } from './cauldron.schema';
import CauldronPage from './components/CauldronPage';
import CauldronDashboardWidget from './components/CauldronDashboardWidget';

export const cauldronModule: ModuleDefinition = {
  id: 'cauldron',
  name: 'Cauldron',
  icon: () => null,
  routes: [
    { path: '/cauldron', component: CauldronPage },
  ],
  dashboardWidget: CauldronDashboardWidget,
  migrations: cauldronMigrations,
  rpgEventHandlers: {
    POMODORO_COMPLETED: (payload: unknown) => {
      const p = payload as { xp?: number };
      return { xp: p.xp ?? 20, hp: 0 };
    },
  },
};
