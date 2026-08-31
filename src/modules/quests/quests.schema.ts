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
  {
    namespace: 'quests',
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '⚡',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS habit_checks (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(habit_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_habit_checks_habit ON habit_checks(habit_id);
      CREATE INDEX IF NOT EXISTS idx_habit_checks_date ON habit_checks(date);
    `,
  },
  {
    namespace: 'quests',
    version: 5,
    up: `
      ALTER TABLE habits ADD COLUMN frequency TEXT NOT NULL DEFAULT 'daily';
      ALTER TABLE habits ADD COLUMN times_per_week INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    namespace: 'quests',
    version: 6,
    up: `
      ALTER TABLE tasks ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE subtasks ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE projects ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE habits ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE task_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE task_categories ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE habit_checks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE habit_checks ADD COLUMN deleted_at TEXT DEFAULT NULL;

      UPDATE task_categories SET updated_at = datetime('now') WHERE updated_at = '';
      UPDATE habit_checks SET updated_at = datetime('now') WHERE updated_at = '';

      CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_subtasks_deleted ON subtasks(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_habits_deleted ON habits(deleted_at);
    `,
  },
  {
    namespace: 'quests',
    version: 7,
    up: `
      ALTER TABLE projects ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE projects SET updated_at = created_at WHERE updated_at = '';

      CREATE INDEX IF NOT EXISTS idx_tasks_project_deleted ON tasks(project_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_subtasks_task_deleted ON subtasks(task_id, deleted_at, subtask_order);
      CREATE INDEX IF NOT EXISTS idx_categories_name_project ON task_categories(name, project_id);
      CREATE INDEX IF NOT EXISTS idx_drawings_task_order ON task_drawings(task_id, draw_order);
    `,
  },
  {
    namespace: 'quests',
    version: 8,
    up: `
      ALTER TABLE tasks ADD COLUMN completed_at TEXT DEFAULT NULL;
      UPDATE tasks SET completed_at = updated_at WHERE status = 1 AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at);
    `,
  },
  {
    namespace: 'quests',
    version: 9,
    up: `
      CREATE TABLE IF NOT EXISTS task_categories_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT DEFAULT NULL,
        UNIQUE(name, project_id)
      );

      INSERT OR IGNORE INTO task_categories_new (id, name, project_id, created_at, updated_at, deleted_at)
        SELECT LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || SUBSTR('89ab', ABS(RANDOM()) % 4 + 1, 1) || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6))),
               name, project_id, created_at, updated_at, deleted_at
        FROM task_categories;

      DROP TABLE task_categories;
      ALTER TABLE task_categories_new RENAME TO task_categories;

      CREATE INDEX IF NOT EXISTS idx_categories_project ON task_categories(project_id);
      CREATE INDEX IF NOT EXISTS idx_categories_name_project ON task_categories(name, project_id);
      CREATE INDEX IF NOT EXISTS idx_categories_deleted ON task_categories(deleted_at);
    `,
  },
  {
    namespace: 'quests',
    version: 10,
    up: `
      ALTER TABLE task_drawings ADD COLUMN deleted_at TEXT DEFAULT NULL;
      ALTER TABLE task_drawings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE task_drawings SET updated_at = created_at WHERE updated_at = '';
      CREATE INDEX IF NOT EXISTS idx_drawings_deleted ON task_drawings(deleted_at);

      ALTER TABLE habits ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE habits SET updated_at = created_at WHERE updated_at = '';
    `,
  },
  {
    namespace: 'quests',
    version: 11,
    up: `
      -- ── "today" convention ────────────────────────────────────────────────
      -- tasks.completed_at and subtasks.completed_at are LOCAL timestamps
      -- ('YYYY-MM-DD HH:MM:SS' via localTimestamp(), or a bare 'YYYY-MM-DD' for
      -- retroactive subtask checks). They used to be written as UTC ISO strings
      -- while every reader compared them against a LOCAL todayDateString(), so in
      -- UTC-3 anything completed after 21:00 fell out of "today".
      -- Backfill converts the old UTC ISO rows (the ones containing a 'T') to the
      -- same local format; bare dates are left alone.
      UPDATE tasks SET completed_at = datetime(completed_at, 'localtime')
        WHERE completed_at IS NOT NULL AND completed_at LIKE '%T%';
      UPDATE subtasks SET completed_at = datetime(completed_at, 'localtime')
        WHERE completed_at IS NOT NULL AND completed_at LIKE '%T%';

      -- Indexes for the hot dashboard/list queries. Readers use half-open ranges
      -- (col >= day AND col < nextDay) instead of DATE(col) = ? so these are usable.
      CREATE INDEX IF NOT EXISTS idx_tasks_due_open     ON tasks(due_date, status, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_status_order ON tasks(status, deleted_at, task_order);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated      ON tasks(updated_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_completed_status ON tasks(completed_at, status, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_subtasks_completed ON subtasks(completed_at, status, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_habit_checks_live  ON habit_checks(deleted_at, habit_id, date);
    `,
  },
  {
    namespace: 'quests',
    version: 12,
    up: `
      -- ── Fase 1: specific weekday habits + forgiving streaks ───────────────
      -- specific_days: CSV of ISO weekday numbers ('1,3,5' = Mon/Wed/Fri).
      -- NULL keeps the legacy "N times per week" counting behaviour.
      ALTER TABLE habits ADD COLUMN specific_days TEXT DEFAULT NULL;

      -- Streak shields: earned once per multiple-of-7 streak milestone (capped
      -- at 3). last_shield_streak remembers the highest milestone already paid
      -- so oscillating around 7 never farms shields.
      ALTER TABLE habits ADD COLUMN shield_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE habits ADD COLUMN last_shield_streak INTEGER NOT NULL DEFAULT 0;

      -- habit_checks rows are no longer all "I did it":
      --   'check'  — the habit was done (counts, gives XP)          [legacy default]
      --   'skip'   — explicitly excused (bridges the streak, no XP, no count)
      --   'shield' — a streak shield was spent on this day (bridges, no count)
      -- 'shield' rows are what makes shield consumption idempotent: the day is
      -- marked as paid for, so recomputing the streak never spends a second one.
      ALTER TABLE habit_checks ADD COLUMN kind TEXT NOT NULL DEFAULT 'check';
      UPDATE habit_checks SET kind = 'check' WHERE kind IS NULL OR kind = '';

      CREATE INDEX IF NOT EXISTS idx_habit_checks_kind ON habit_checks(kind, deleted_at);
    `,
  },
];
