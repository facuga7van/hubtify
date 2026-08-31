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
      return { xp: p.xp ?? 8, hp: 0 };
    },
    /**
     * Un enfoque cortado a mano pasado el umbral. Paga CERO: la pérdida es
     * simbólica y legible — el frasco roto en el estante —, jamás numérica.
     * No se descuenta XP, no baja el vigor, no se corta la racha. Este handler
     * existe solo para que el abandono quede REGISTRADO.
     */
    POMODORO_ABANDONED: () => ({ xp: 0, hp: 0 }),
  },
};
