import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleRegistry, type ModuleDefinition } from './module-registry';

function createMockModule(id: string): ModuleDefinition {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    icon: () => null,
    routes: [{ path: `/${id}`, component: () => null }],
    dashboardWidget: () => null,
    migrations: [],
    rpgEventHandlers: {},
  };
}

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  it('starts empty', () => {
    expect(registry.getAll()).toEqual([]);
  });

  it('registers a module', () => {
    const mod = createMockModule('quests');
    registry.register(mod);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get('quests')).toBe(mod);
  });

  it('prevents duplicate registration', () => {
    const mod = createMockModule('quests');
    registry.register(mod);
    expect(() => registry.register(mod)).toThrow('already registered');
  });

  it('returns undefined for unknown module', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('collects all routes', () => {
    registry.register(createMockModule('quests'));
    registry.register(createMockModule('nutrition'));
    expect(registry.getAllRoutes()).toHaveLength(2);
  });

  it('collects all migrations', () => {
    const mod = createMockModule('quests');
    mod.migrations = [{ namespace: 'quests', version: 1, up: 'CREATE TABLE tasks (id TEXT)' }];
    registry.register(mod);
    expect(registry.getAllMigrations()).toHaveLength(1);
  });
});
