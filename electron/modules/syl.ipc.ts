import { app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { rolloverVigor } from '../ipc/rpg-stats';
import { todayDateString } from '../../shared/date-utils';
import { buildSylSnapshot } from './syl.snapshot';
import type { SylSnapshot } from '../../shared/types';

export function registerSylIpcHandlers(): void {
  // Computes the Syl read-projection snapshot from local SQLite.
  // Called by the renderer during syncPush to mirror a clean/derived view to
  // Firestore (hubtify_users/{uid}/syl/snapshot) for the Syl assistant.
  ipcHandle('syl:buildSnapshot', (): SylSnapshot => {
    const db = getDb();
    // getPlayerStats is deliberately side-effect-free (the snapshot builder must
    // not mutate state), so the daily Vigor reset happens here, at the handler
    // boundary — otherwise Syl would read yesterday's depleted HP all morning.
    rolloverVigor(db);
    return buildSylSnapshot(db, {
      now: new Date().toISOString(),      // ISO-8601 UTC
      computedForDate: todayDateString(), // YYYY-MM-DD, local day
      appVersion: app.getVersion(),
    });
  });
}
