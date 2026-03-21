import type { ComponentType } from 'react';
import type { Migration } from '../../shared/types';

export interface RouteDefinition {
  path: string;
  component: ComponentType;
}

export type RpgEventHandler = (payload: unknown) => { xp: number; hp: number };

export interface ModuleDefinition {
  id: string;
  name: string;
  icon: ComponentType;
  routes: RouteDefinition[];
  dashboardWidget: ComponentType;
  migrations: Migration[];
  rpgEventHandlers: Record<string, RpgEventHandler>;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

export class ModuleRegistry {
  private modules = new Map<string, ModuleDefinition>();

  register(module: ModuleDefinition): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Module "${module.id}" already registered`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  getAll(): ModuleDefinition[] {
    return Array.from(this.modules.values());
  }

  getAllRoutes(): RouteDefinition[] {
    return this.getAll().flatMap((m) => m.routes);
  }

  getAllMigrations(): Migration[] {
    return this.getAll().flatMap((m) => m.migrations);
  }

  getEventHandler(eventType: string): { moduleId: string; handler: RpgEventHandler } | undefined {
    for (const mod of this.modules.values()) {
      if (eventType in mod.rpgEventHandlers) {
        return { moduleId: mod.id, handler: mod.rpgEventHandlers[eventType] };
      }
    }
    return undefined;
  }
}
