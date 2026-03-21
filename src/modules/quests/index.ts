import type { ModuleDefinition } from '../../core/module-registry';
import { questsMigrations } from './quests.schema';
import TaskList from './components/TaskList';
import QuestsDashboardWidget from './components/QuestsDashboardWidget';

export const questsModule: ModuleDefinition = {
  id: 'quests',
  name: 'Quests',
  icon: () => null,
  routes: [
    { path: '/quests', component: TaskList },
  ],
  dashboardWidget: QuestsDashboardWidget,
  migrations: questsMigrations,
  rpgEventHandlers: {
    TASK_COMPLETED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? 15, hp: p.hp ?? 0 };
    },
    TASK_UNCOMPLETED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? -15, hp: p.hp ?? 0 };
    },
    SUBTASK_COMPLETED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? 5, hp: p.hp ?? 0 };
    },
    SUBTASK_UNCOMPLETED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? -5, hp: p.hp ?? 0 };
    },
  },
};
