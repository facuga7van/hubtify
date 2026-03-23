import type { Migration } from '../../../shared/types';

export const questsMigrations: Migration[] = [
  {
    namespace: 'quests',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 0,
        tier INTEGER NOT NULL DEFAULT 2,
        category TEXT NOT NULL DEFAULT '',
        due_date TEXT,
        task_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tier INTEGER NOT NULL DEFAULT 2,
        status INTEGER NOT NULL DEFAULT 0,
        subtask_order INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_categories (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_order ON tasks(task_order);
      CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
    `,
  },
  {
    namespace: 'quests',
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#8b7355',
        project_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE task_categories ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE;

      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_categories_project ON task_categories(project_id);
    `,
  },
  {
    namespace: 'quests',
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS task_drawings (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        draw_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_drawings_task ON task_drawings(task_id);
    `,
  },
];
