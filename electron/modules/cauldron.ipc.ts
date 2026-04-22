import { BrowserWindow, Notification } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import crypto from 'crypto';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronSessionEndResult,
} from '../../shared/types';

function genId(): string {
  return crypto.randomUUID();
}

function broadcast(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

// ─── Timer State ───────────────────────────────────────────

let timerState: CauldronTimerState = {
  status: 'idle',
  remainingMs: 0,
  totalMs: 0,
  currentCycle: 0,
  totalCycles: 0,
  sessionType: 'work',
  presetId: null,
  presetName: null,
};

let timerInterval: NodeJS.Timeout | null = null;
let targetEndTime = 0;
let activePreset: {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLong: number;
} | null = null;
let currentSessionDbId: string | null = null;

function clearTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function getSnapshotState(): CauldronTimerState {
  return { ...timerState };
}

function tick(): void {
  if (timerState.status !== 'work' && timerState.status !== 'on_break') return;

  const now = Date.now();
  timerState.remainingMs = Math.max(0, targetEndTime - now);

  broadcast('cauldron:tick', getSnapshotState());

  if (timerState.remainingMs <= 0) {
    onTimeUp();
  }
}

function onTimeUp(): void {
  const db = getDb();
  const now = new Date().toISOString();
  const wasWork = timerState.sessionType === 'work';

  // Mark session as completed in DB
  if (currentSessionDbId) {
    db.prepare(
      'UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ? WHERE id = ?',
    ).run(now, now, currentSessionDbId);
    currentSessionDbId = null;
  }

  // Determine next segment before changing state
  const nextSegment = getNextSegment();

  const sessionEndResult: CauldronSessionEndResult = {
    sessionType: timerState.sessionType,
    completed: true,
    nextType: nextSegment ? nextSegment.type : null,
  };

  broadcast('cauldron:sessionEnd', sessionEndResult);

  // OS Notification
  if (Notification.isSupported()) {
    if (nextSegment === null) {
      new Notification({
        title: 'Cauldron Cycle Complete!',
        body: 'Full brewing cycle finished.',
      }).show();
    } else {
      const title = wasWork ? 'Brew Complete!' : 'Break Over!';
      const body = wasWork ? 'Time for a break.' : 'Ready for another brew?';
      new Notification({ title, body }).show();
    }
  }

  if (nextSegment) {
    startSegment(nextSegment.type, nextSegment.durationMs);
  } else {
    // Full cycle complete
    clearTimer();
    timerState = { ...timerState, status: 'idle', remainingMs: 0 };
    broadcast('cauldron:tick', getSnapshotState());
  }
}

// ─── Segment Logic ─────────────────────────────────────────

interface NextSegment {
  type: 'work' | 'break' | 'long_break';
  durationMs: number;
}

function getNextSegment(): NextSegment | null {
  if (!activePreset) return null;

  if (timerState.sessionType === 'work') {
    // After work -> break or long_break
    if (timerState.currentCycle >= timerState.totalCycles) {
      // Last cycle done -> long break then end
      return {
        type: 'long_break',
        durationMs: activePreset.longBreakMinutes * 60 * 1000,
      };
    }
    return {
      type: 'break',
      durationMs: activePreset.breakMinutes * 60 * 1000,
    };
  } else if (timerState.sessionType === 'break') {
    // After break -> next work cycle
    return {
      type: 'work',
      durationMs: activePreset.workMinutes * 60 * 1000,
    };
  } else {
    // After long_break -> done
    return null;
  }
}

function startSegment(
  type: 'work' | 'break' | 'long_break',
  durationMs: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Cycle tracking:
  // - First work segment starts at cycle 1
  // - After a break, increment cycle for the next work segment
  // - Break/long_break segments keep the current cycle number
  let newCycle = timerState.currentCycle;
  if (type === 'work') {
    if (
      timerState.sessionType === 'break' ||
      timerState.sessionType === 'long_break'
    ) {
      // Coming back from a break -> next cycle
      newCycle = timerState.currentCycle + 1;
    } else {
      // Very first work segment (from idle)
      newCycle = 1;
    }
  }

  // Create session DB row
  const sessionId = genId();
  db.prepare(
    `INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    sessionId,
    timerState.presetId,
    type,
    Math.round(durationMs / 60000),
    now,
    now,
    now,
  );
  currentSessionDbId = sessionId;

  targetEndTime = Date.now() + durationMs;
  timerState = {
    ...timerState,
    status: type === 'work' ? 'work' : 'on_break',
    remainingMs: durationMs,
    totalMs: durationMs,
    sessionType: type,
    currentCycle: newCycle,
  };

  if (!timerInterval) {
    timerInterval = setInterval(tick, 1000);
  }
}

// ─── IPC Handlers ──────────────────────────────────────────

export function registerCauldronIpcHandlers(): void {
  // ─── Preset CRUD ───

  ipcHandle('cauldron:getPresets', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
              long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong,
              is_default AS isDefault, created_at AS createdAt, updated_at AS updatedAt
       FROM cauldron_presets WHERE deleted_at IS NULL
       ORDER BY is_default DESC, name ASC`,
      )
      .all();
  });

  ipcHandle(
    'cauldron:upsertPreset',
    (_e, preset: Record<string, unknown>) => {
      const db = getDb();
      const id = (preset.id as string) || genId();
      const now = new Date().toISOString();

      if (preset.id) {
        const existing = db
          .prepare('SELECT is_default FROM cauldron_presets WHERE id = ?')
          .get(id) as { is_default: number } | undefined;
        if (existing?.is_default) {
          throw new Error('Cannot modify default preset');
        }
        db.prepare(
          `UPDATE cauldron_presets SET name = ?, work_minutes = ?, break_minutes = ?,
          long_break_minutes = ?, cycles_before_long = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        ).run(
          preset.name,
          preset.workMinutes,
          preset.breakMinutes,
          preset.longBreakMinutes,
          preset.cyclesBeforeLong,
          now,
          id,
        );
      } else {
        db.prepare(
          `INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(
          id,
          preset.name,
          preset.workMinutes,
          preset.breakMinutes,
          preset.longBreakMinutes,
          preset.cyclesBeforeLong,
          now,
          now,
        );
      }
      return id;
    },
  );

  ipcHandle('cauldron:deletePreset', (_e, id: string) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT is_default FROM cauldron_presets WHERE id = ?')
      .get(id) as { is_default: number } | undefined;
    if (existing?.is_default) {
      throw new Error('Cannot delete default preset');
    }
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE cauldron_presets SET deleted_at = ?, updated_at = ? WHERE id = ?',
    ).run(now, now, id);
  });

  // ─── Timer Control ───

  ipcHandle('cauldron:start', (_e, presetId: string) => {
    if (timerState.status !== 'idle') {
      throw new Error('Timer already active');
    }

    const db = getDb();
    const preset = db
      .prepare(
        `SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
              long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong
       FROM cauldron_presets WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(presetId) as CauldronPreset | undefined;

    if (!preset) throw new Error('Preset not found');

    activePreset = {
      workMinutes: preset.workMinutes,
      breakMinutes: preset.breakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
      cyclesBeforeLong: preset.cyclesBeforeLong,
    };

    timerState = {
      status: 'idle',
      remainingMs: 0,
      totalMs: 0,
      currentCycle: 0,
      totalCycles: preset.cyclesBeforeLong,
      sessionType: 'work',
      presetId: preset.id,
      presetName: preset.name,
    };

    startSegment('work', preset.workMinutes * 60 * 1000);
    return getSnapshotState();
  });

  ipcHandle('cauldron:pause', () => {
    if (timerState.status !== 'work' && timerState.status !== 'on_break') {
      throw new Error('Timer not running');
    }
    timerState.remainingMs = Math.max(0, targetEndTime - Date.now());
    timerState.status =
      timerState.status === 'work' ? 'work_paused' : 'break_paused';
    clearTimer();
    broadcast('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:resume', () => {
    if (
      timerState.status !== 'work_paused' &&
      timerState.status !== 'break_paused'
    ) {
      throw new Error('Timer not paused');
    }
    targetEndTime = Date.now() + timerState.remainingMs;
    timerState.status =
      timerState.status === 'work_paused' ? 'work' : 'on_break';
    timerInterval = setInterval(tick, 1000);
    broadcast('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:skip', () => {
    if (timerState.status === 'idle') throw new Error('No active session');

    // Record current session as incomplete
    if (currentSessionDbId) {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE cauldron_sessions SET updated_at = ? WHERE id = ?',
      ).run(now, currentSessionDbId);
      currentSessionDbId = null;
    }

    clearTimer();
    const nextSegment = getNextSegment();

    if (nextSegment) {
      startSegment(nextSegment.type, nextSegment.durationMs);
    } else {
      timerState = { ...timerState, status: 'idle', remainingMs: 0 };
      activePreset = null;
    }

    broadcast('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:stop', () => {
    if (timerState.status === 'idle') return;

    // Record current session as incomplete
    if (currentSessionDbId) {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE cauldron_sessions SET updated_at = ? WHERE id = ?',
      ).run(now, currentSessionDbId);
      currentSessionDbId = null;
    }

    clearTimer();
    timerState = {
      status: 'idle',
      remainingMs: 0,
      totalMs: 0,
      currentCycle: 0,
      totalCycles: 0,
      sessionType: 'work',
      presetId: null,
      presetName: null,
    };
    activePreset = null;
    broadcast('cauldron:tick', getSnapshotState());
  });

  ipcHandle('cauldron:getState', () => {
    return getSnapshotState();
  });

  // ─── Stats ───

  ipcHandle('cauldron:getStats', () => {
    const db = getDb();

    const today = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL
       AND date(started_at) = date('now')`,
      )
      .get() as { count: number };

    const week = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL
       AND started_at >= date('now', '-7 days')`,
      )
      .get() as { count: number };

    const total = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL`,
      )
      .get() as { count: number };

    return { today: today.count, week: week.count, total: total.count };
  });
}
