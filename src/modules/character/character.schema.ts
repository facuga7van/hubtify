import type { Migration } from '../../../shared/types';

export const characterMigrations: Migration[] = [
  {
    namespace: 'character',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS character_data (
        id TEXT PRIMARY KEY DEFAULT 'default',
        data TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    namespace: 'character',
    version: 2,
    up: `
      ALTER TABLE user_profile ADD COLUMN character_name TEXT;
    `,
  },
];
