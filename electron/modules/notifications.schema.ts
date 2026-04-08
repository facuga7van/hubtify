// Lives in electron/modules/ (not inside a single module folder) because
// notifications is a cross-module concern, similar to notifications.ipc.ts.
import type { Migration } from '../../shared/types';

export const notificationsMigrations: Migration[] = [
  {
    namespace: 'notifications',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        module TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        action_route TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        snoozed_until TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        ref_id TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_type_ref ON notifications(type, ref_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    `,
  },
];
