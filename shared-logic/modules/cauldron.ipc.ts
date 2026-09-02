import { registerHandler as ipcHandle, registerLifecycle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { emit } from '../events';
import { platform } from '../platform';
import { getMondayOfWeek, formatDateString } from '../../shared/date-utils';
import { isModuleNotificationEnabled } from './notifications.ipc';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronSessionEndResult,
} from '../../shared/types';

/**
 * Fase 2 del Caldero: la misión vinculada viaja EN EL ESTADO, no se consulta.
 * Cada superficie (página, chip flotante, ventana PiP) refleja el broadcast de
 * `cauldron:tick` y ya tiene el nombre y el color a mano.
 *
 * TODO(shared/types.ts): estos cuatro campos deberían aterrizar en
 * `CauldronTimerState`. Fuera del alcance de este cambio — el alias los declara
 * mientras tanto.
 */
type CauldronTimerStateEx = CauldronTimerState & {
  /** Misión vinculada, o null. Opcional SIEMPRE: nunca bloquea el play. */
  taskId: string | null;
  taskName: string | null;
  taskProjectId: string | null;
  taskProjectColor: string | null;
};

/** Shape as it leaves SQLite: the two auto-start flags arrive as 0 | 1. */
type CauldronPresetEx = Omit<CauldronPreset, 'autoStartBreak' | 'autoStartWork'> & {
  autoStartBreak: number;
  autoStartWork: number;
};

/**
 * TODO(shared/types.ts): `abandoned` / `elapsedMinutes` en
 * `CauldronSessionEndResult`. El renderer los usa para emitir
 * POMODORO_ABANDONED (XP 0 — es registro, no castigo).
 */
type CauldronSessionEndResultEx = CauldronSessionEndResult & {
  /** True cuando un enfoque se cortó a mano habiendo pasado el umbral. */
  abandoned?: boolean;
  /** Minutos efectivamente enfocados antes de cortar (sin contar pausas). */
  elapsedMinutes?: number;
  taskId?: string | null;
  taskName?: string | null;
};

/**
 * Grace window between a segment ending and the next one starting by itself.
 * Long enough to say "wait", short enough that walking away still works.
 */
const AUTO_START_GRACE_MS = 5000;

/**
 * OS-notification texts, supplied by the renderer (which owns i18n) via
 * `cauldron:setLabels`. Defaults keep the previous Spanish strings so nothing
 * breaks if the renderer hasn't pushed translations yet.
 */
interface CauldronLabels {
  cycleComplete: string;   // title, whole cycle finished
  cycleCompleteBody: string;
  potionDone: string;      // title, work segment finished
  breakDone: string;       // title, break finished
  focus: string;
  longBreak: string;
  shortBreak: string;
  cycle: string;           // "Ciclo" / "Cycle"
  next: string;            // "Siguiente" / "Next"
  minutesShort: string;    // "min"
}

let labels: CauldronLabels = {
  cycleComplete: 'Caldero — ¡Ciclo completo!',
  cycleCompleteBody: 'Ciclo de pociones terminado.',
  potionDone: '¡Poción completada!',
  breakDone: '¡Descanso terminado!',
  focus: 'Enfoque',
  longBreak: 'Descanso largo',
  shortBreak: 'Descanso',
  cycle: 'Ciclo',
  next: 'Siguiente',
  minutesShort: 'min',
};

/**
 * How long an interrupted session stays offerable before startup cleans it up.
 * Anything that should have ended more than this ago is stale, not resumable.
 */
const INTERRUPTED_SESSION_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Debajo de este umbral, cortar un enfoque NO deja cicatriz: la fila se descarta
 * y el estante ni se entera. Un arranque en falso ("me equivoqué de receta") no
 * es una promesa rota. Por encima, queda un frasco roto — memoria, no acusación.
 */
const ABANDON_THRESHOLD_MS = 5 * 60 * 1000;

// ─── Timer State ───────────────────────────────────────────

const IDLE_STATE: CauldronTimerStateEx = {
  status: 'idle',
  remainingMs: 0,
  totalMs: 0,
  currentCycle: 0,
  totalCycles: 0,
  sessionType: 'work',
  presetId: null,
  presetName: null,
  extensionMinutes: 5,
  autoStartAt: null,
  round: 1,
  taskId: null,
  taskName: null,
  taskProjectId: null,
  taskProjectColor: null,
};

let timerState: CauldronTimerStateEx = { ...IDLE_STATE };

let timerInterval: ReturnType<typeof setInterval> | null = null;
/** Ticks the 5 s auto-start countdown; null whenever no auto-start is armed. */
let autoStartInterval: ReturnType<typeof setInterval> | null = null;
let targetEndTime = 0;
let activePreset: {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLong: number;
  extensionMinutes: number;
  autoStartBreak: boolean;
  autoStartWork: boolean;
} | null = null;
let currentSessionDbId: string | null = null;
/** True while the running segment is an extension (see cauldron:extend). */
let currentSessionIsExtension = false;
let pendingNextSegment: NextSegment | null = null;
/**
 * La última fila de enfoque REAL (no prórroga) que se completó en esta corrida.
 *
 * Es el corte de `cauldron:setSessionTask` en `awaiting_next`: al terminar un
 * enfoque ya no hay sesión activa, y ese es exactamente el momento en que el
 * usuario sabe sobre qué trabajó. Se escribe ahí, en el frasco que acaba de
 * depositarse. Una prórroga no lo mueve: el frasco es el pomodoro original.
 */
let lastCompletedWorkSessionId: string | null = null;

// ─── Puente con Questify ───────────────────────────────────

/**
 * ¿Existen ya las tablas de quests en esta base?
 *
 * Misma base de datos, así que el JOIN es directo — pero las migraciones de
 * quests las dispara el renderer al registrar el módulo, y estos handlers se
 * registran en el main al arrancar. En una base nueva (o en un test que solo
 * corre las migraciones del caldero) `tasks` puede no existir todavía, y un
 * JOIN a una tabla inexistente no devuelve vacío: tira. Sin este guard, el
 * estante se rompería entero por un frasco sin etiqueta.
 *
 * No se cachea el `true` para siempre porque la respuesta cambia una sola vez
 * (de false a true) y la consulta a sqlite_master es trivial.
 */
let questsTablesSeen = false;
function hasQuestsTables(): boolean {
  if (questsTablesSeen) return true;
  try {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name IN ('tasks', 'projects')`,
      )
      .get() as { n: number };
    questsTablesSeen = row.n === 2;
    return questsTablesSeen;
  } catch {
    return false;
  }
}

interface TaskMeta {
  taskId: string;
  taskName: string;
  taskProjectId: string | null;
  taskProjectColor: string | null;
}

/** Nombre y color de proyecto de una misión, o null si no existe / fue borrada. */
function readTaskMeta(taskId: string | null): TaskMeta | null {
  if (!taskId || !hasQuestsTables()) return null;
  try {
    const row = getDb()
      .prepare(
        `SELECT t.id AS taskId, t.name AS taskName,
                t.project_id AS taskProjectId, p.color AS taskProjectColor
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
         WHERE t.id = ? AND t.deleted_at IS NULL`,
      )
      .get(taskId) as TaskMeta | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Adjunta la misión al estado. Un id que ya no resuelve (tarea borrada, o traída
 * por sync desde un dispositivo que este no vio) NO se descarta: el vínculo
 * sobrevive, solo se queda sin nombre. El estante lo mostrará «sin etiqueta».
 */
function withTask(state: CauldronTimerStateEx, taskId: string | null): CauldronTimerStateEx {
  const meta = readTaskMeta(taskId);
  return {
    ...state,
    taskId: taskId ?? null,
    taskName: meta?.taskName ?? null,
    taskProjectId: meta?.taskProjectId ?? null,
    taskProjectColor: meta?.taskProjectColor ?? null,
  };
}

function clearTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Disarms the pending auto-start. The segment stays queued in
 * `pendingNextSegment`, so the timer simply falls back to the classic
 * "waiting for you to press Continue" state.
 */
function clearAutoStart(): void {
  if (autoStartInterval) {
    clearInterval(autoStartInterval);
    autoStartInterval = null;
  }
  if (timerState.autoStartAt !== null) {
    timerState = { ...timerState, autoStartAt: null };
  }
}

function getSnapshotState(): CauldronTimerStateEx {
  return { ...timerState };
}

function tick(): void {
  if (timerState.status !== 'work' && timerState.status !== 'on_break') return;

  const now = Date.now();
  timerState.remainingMs = Math.max(0, targetEndTime - now);

  emit('cauldron:tick', getSnapshotState());

  if (timerState.remainingMs <= 0) {
    onTimeUp();
  }
}

function onTimeUp(): void {
  const db = getDb();
  const now = new Date().toISOString();
  // La sesión terminó en `targetEndTime`, no cuando corrió este callback. En
  // desktop es lo mismo (el tick corre ≤ 1 s después del target); en Android el
  // worker se congela en segundo plano y el tick puede llegar minutos tarde —
  // sin esto una sesión reanudada 40 min después quedaba registrada 40 min
  // después (spec §6).
  const endedAt = new Date(targetEndTime).toISOString();
  const wasWork = timerState.sessionType === 'work';
  const wasExtension = currentSessionIsExtension;

  // Mark session as completed in DB
  if (currentSessionDbId) {
    db.prepare(
      'UPDATE cauldron_sessions SET completed = 1, completed_at = ?, updated_at = ?, target_end_time = NULL WHERE id = ?',
    ).run(endedAt, now, currentSessionDbId);
    // Un enfoque real acaba de depositar su frasco: es la fila que
    // `cauldron:setSessionTask` va a etiquetar si el usuario elige la misión
    // recién ahora. Una prórroga NO lo mueve — no es otro frasco.
    if (wasWork && !wasExtension) lastCompletedWorkSessionId = currentSessionDbId;
    currentSessionDbId = null;
  }
  currentSessionIsExtension = false;

  // Determine next segment before changing state
  const nextSegment = getNextSegment();

  // A lap closes when the LONG BREAK ends. The loop no longer stops there, but the
  // milestone is still worth announcing, so it is flagged explicitly instead of
  // being inferred from `nextType === null`.
  const cycleComplete = timerState.sessionType === 'long_break';

  const sessionEndResult: CauldronSessionEndResultEx = {
    sessionType: timerState.sessionType,
    completed: true,
    nextType: nextSegment ? nextSegment.type : null,
    isExtension: wasExtension,
    cycleComplete,
    taskId: timerState.taskId,
    taskName: timerState.taskName,
  };

  emit('cauldron:sessionEnd', sessionEndResult);

  // Native notification via PlatformPort — texts come from the renderer
  // (cauldron:setLabels); they used to be hardcoded Spanish regardless of language.
  if (isModuleNotificationEnabled('cauldron')) {
    const presetLabel = timerState.presetName ? ` (${timerState.presetName})` : '';
    const cycleInfo = `${labels.cycle} ${timerState.currentCycle}/${timerState.totalCycles}`;
    if (cycleComplete || nextSegment === null) {
      void platform().notify({
        title: labels.cycleComplete,
        body: `${labels.cycleCompleteBody}${presetLabel}`,
      });
    } else {
      const nextLabel = nextSegment.type === 'work' ? labels.focus : nextSegment.type === 'long_break' ? labels.longBreak : labels.shortBreak;
      const nextMin = Math.round(nextSegment.durationMs / 60000);
      const title = wasWork ? labels.potionDone : labels.breakDone;
      const body = `${cycleInfo} — ${labels.next}: ${nextLabel} (${nextMin} ${labels.minutesShort})${presetLabel}`;
      void platform().notify({ title, body });
    }
  }

  clearTimer();

  if (nextSegment) {
    pendingNextSegment = nextSegment;

    // Should the next segment start by itself? An extension is a prolongation of
    // the segment you are already in, so it never auto-chains.
    const auto =
      !wasExtension &&
      !!activePreset &&
      (wasWork ? activePreset.autoStartBreak : activePreset.autoStartWork);

    timerState = {
      ...timerState,
      status: 'awaiting_next',
      remainingMs: 0,
      autoStartAt: auto ? Date.now() + AUTO_START_GRACE_MS : null,
    };
    emit('cauldron:tick', getSnapshotState());
    if (auto) armAutoStart();
  } else {
    // No recipe loaded — nothing to chain into.
    pendingNextSegment = null;
    timerState = { ...timerState, status: 'idle', remainingMs: 0, autoStartAt: null };
    emit('cauldron:tick', getSnapshotState());
  }
}

/**
 * Runs the visible countdown and fires the queued segment when it expires. Every
 * surface just reflects the broadcast: the deadline lives here, in the main
 * process, so it survives navigating away and popping the window in and out.
 */
function armAutoStart(): void {
  if (autoStartInterval) clearInterval(autoStartInterval);
  autoStartInterval = setInterval(() => {
    if (timerState.status !== 'awaiting_next' || timerState.autoStartAt === null) {
      clearAutoStart();
      return;
    }
    if (Date.now() >= timerState.autoStartAt) {
      clearAutoStart();
      const next = pendingNextSegment;
      pendingNextSegment = null;
      if (next) startSegment(next.type, next.durationMs, next.resetCycle);
    }
    emit('cauldron:tick', getSnapshotState());
  }, 1000);
}

// ─── Segment Logic ─────────────────────────────────────────

interface NextSegment {
  type: 'work' | 'break' | 'long_break';
  durationMs: number;
  /** Opens a new lap: cycle counter back to 1, round + 1. */
  resetCycle?: boolean;
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
    // After long_break -> a NEW LAP, not the end. This used to return null and
    // drop the timer to 'idle', so a working day meant four manual starts. The
    // loop now only ends when the user says stop.
    return {
      type: 'work',
      durationMs: activePreset.workMinutes * 60 * 1000,
      resetCycle: true,
    };
  }
}

function startSegment(
  type: 'work' | 'break' | 'long_break',
  durationMs: number,
  resetCycle = false,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Cycle tracking:
  // - First work segment starts at cycle 1
  // - After a break, increment cycle for the next work segment
  // - Break/long_break segments keep the current cycle number
  // - A new lap (after the long break) restarts at cycle 1 and bumps the round
  let newCycle = timerState.currentCycle;
  let newRound = timerState.round;
  if (type === 'work') {
    if (resetCycle) {
      newCycle = 1;
      newRound = timerState.round + 1;
    } else if (timerState.sessionType === 'break') {
      // Coming back from a break -> next cycle
      newCycle = timerState.currentCycle + 1;
    } else {
      // Very first work segment (from idle)
      newCycle = 1;
    }
  }

  // Create session DB row. target_end_time is persisted so the session survives an
  // app restart and can be offered back (cauldron:getInterruptedSession) instead of
  // being silently deleted on the next boot.
  targetEndTime = Date.now() + durationMs;
  const sessionId = genId();
  db.prepare(
    `INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at, target_end_time, is_extension, task_id)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?)`,
  ).run(
    sessionId,
    timerState.presetId,
    type,
    Math.round(durationMs / 60000),
    now,
    now,
    now,
    targetEndTime,
    // La misión acompaña a toda la corrida, no solo al primer enfoque: cambiarla
    // a mitad de camino solo afecta de ahí en adelante.
    timerState.taskId ?? null,
  );
  currentSessionDbId = sessionId;
  currentSessionIsExtension = false;

  timerState = {
    ...timerState,
    status: type === 'work' ? 'work' : 'on_break',
    remainingMs: durationMs,
    totalMs: durationMs,
    sessionType: type,
    currentCycle: newCycle,
    round: newRound,
    autoStartAt: null,
  };

  if (!timerInterval) {
    timerInterval = setInterval(tick, 1000);
  }
}

// ─── Startup Cleanup ────────────────────────────────────────

/**
 * Cleans up only STALE incomplete sessions on startup.
 *
 * This used to soft-delete EVERY incomplete session unconditionally: closing the
 * app 20 minutes into a 25-minute pomodoro threw the session away with no XP and
 * no warning. A session whose target_end_time is still within the grace window is
 * left alone so `cauldron:getInterruptedSession` can offer to resume it.
 */
function cleanupOrphanedSessions(): void {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const staleBefore = Date.now() - INTERRUPTED_SESSION_GRACE_MS;
    db.prepare(
      // `abandoned = 0`: un frasco roto es una fila incompleta y sin
      // target_end_time — exactamente el perfil que esta limpieza borra. Sin esta
      // condición, el estante se vaciaba de cicatrices en el próximo arranque, y
      // el estante NUNCA se vacía: ese es todo el mecanismo.
      `UPDATE cauldron_sessions SET updated_at = ?, deleted_at = ?
       WHERE completed = 0 AND deleted_at IS NULL AND abandoned = 0
         AND (target_end_time IS NULL OR target_end_time < ?)`,
    ).run(now, now, staleBefore);
  } catch {
    // Non-critical — silently ignore
  }
}

/** The most recent resumable session, or null. */
function readInterruptedSession(): {
  id: string; presetId: string | null; presetName: string | null;
  type: string; durationMinutes: number; startedAt: string;
  remainingMs: number; totalMs: number; taskId: string | null;
} | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT s.id, s.preset_id AS presetId, s.type, s.duration_minutes AS durationMinutes,
            s.started_at AS startedAt, s.target_end_time AS targetEndTime,
            s.task_id AS taskId,
            p.name AS presetName
     FROM cauldron_sessions s
     LEFT JOIN cauldron_presets p ON p.id = s.preset_id
     WHERE s.completed = 0 AND s.deleted_at IS NULL AND s.abandoned = 0
       AND s.target_end_time IS NOT NULL
     ORDER BY s.started_at DESC LIMIT 1`,
  ).get() as Record<string, unknown> | undefined;
  if (!row) return null;

  const targetEnd = row.targetEndTime as number;
  if (targetEnd < Date.now() - INTERRUPTED_SESSION_GRACE_MS) return null;

  return {
    id: row.id as string,
    presetId: (row.presetId as string) ?? null,
    presetName: (row.presetName as string) ?? null,
    type: row.type as string,
    durationMinutes: row.durationMinutes as number,
    startedAt: row.startedAt as string,
    remainingMs: Math.max(0, targetEnd - Date.now()),
    totalMs: (row.durationMinutes as number) * 60 * 1000,
    taskId: (row.taskId as string) ?? null,
  };
}

// ─── IPC Handlers ──────────────────────────────────────────

export function registerCauldronIpcHandlers(): void {
  cleanupOrphanedSessions();

  // Background (Android): freeze the clocks WITHOUT touching state. targetEndTime
  // and autoStartAt are wall-clock, so the first tick after resume catches up on
  // its own (and fires onTimeUp if the deadline passed while suspended).
  registerLifecycle({
    suspend: () => {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      if (autoStartInterval) { clearInterval(autoStartInterval); autoStartInterval = null; }
    },
    resume: () => {
      if ((timerState.status === 'work' || timerState.status === 'on_break') && !timerInterval) {
        timerInterval = setInterval(tick, 1000);
        // El tick inmediato importa: si la sesión venció mientras estábamos
        // congelados se completa AHORA (con `completed_at = targetEndTime`) en
        // vez de un segundo después.
        tick();
        return;
      }
      if (timerState.status === 'awaiting_next' && timerState.autoStartAt !== null && !autoStartInterval) {
        armAutoStart();
      }
    },
  });

  // ─── Preset CRUD ───

  ipcHandle('cauldron:getPresets', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
              long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong,
              extension_minutes AS extensionMinutes,
              auto_start_break AS autoStartBreak, auto_start_work AS autoStartWork,
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

      // Auto-start flags arrive as booleans from the renderer and live as 0/1 in
      // SQLite. Undefined keeps the schema defaults: break on, work off.
      const autoBreak = (preset.autoStartBreak ?? true) ? 1 : 0;
      const autoWork = (preset.autoStartWork ?? false) ? 1 : 0;

      if (preset.id) {
        const existing = db
          .prepare('SELECT is_default FROM cauldron_presets WHERE id = ?')
          .get(id) as { is_default: number } | undefined;
        if (existing?.is_default) {
          throw new Error('Cannot modify default preset');
        }
        db.prepare(
          `UPDATE cauldron_presets SET name = ?, work_minutes = ?, break_minutes = ?,
          long_break_minutes = ?, cycles_before_long = ?, extension_minutes = ?,
          auto_start_break = ?, auto_start_work = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        ).run(
          preset.name,
          preset.workMinutes,
          preset.breakMinutes,
          preset.longBreakMinutes,
          preset.cyclesBeforeLong,
          preset.extensionMinutes ?? 5,
          autoBreak,
          autoWork,
          now,
          id,
        );
      } else {
        db.prepare(
          `INSERT INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, extension_minutes, auto_start_break, auto_start_work, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(
          id,
          preset.name,
          preset.workMinutes,
          preset.breakMinutes,
          preset.longBreakMinutes,
          preset.cyclesBeforeLong,
          preset.extensionMinutes ?? 5,
          autoBreak,
          autoWork,
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

  /**
   * `taskId` es el TERCER estado de un parámetro opcional, y es a propósito:
   * encender el caldero nunca exige elegir una misión. Podés arrancar a ciegas y
   * etiquetar después (o nunca). El peaje previo es lo que hundió a Focus To-Do.
   */
  ipcHandle('cauldron:start', (_e, presetId: string, taskId?: string | null) => {
    if (timerState.status !== 'idle') {
      throw new Error('Timer already active');
    }

    const db = getDb();
    const preset = db
      .prepare(
        `SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
              long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong,
              extension_minutes AS extensionMinutes,
              auto_start_break AS autoStartBreak, auto_start_work AS autoStartWork
       FROM cauldron_presets WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(presetId) as CauldronPresetEx | undefined;

    if (!preset) throw new Error('Preset not found');

    activePreset = {
      workMinutes: preset.workMinutes,
      breakMinutes: preset.breakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
      cyclesBeforeLong: preset.cyclesBeforeLong,
      extensionMinutes: preset.extensionMinutes ?? 5,
      autoStartBreak: (preset.autoStartBreak ?? 1) !== 0,
      autoStartWork: (preset.autoStartWork ?? 0) !== 0,
    };

    lastCompletedWorkSessionId = null;

    // Starting a fresh brew while a resumable session is still on offer is an
    // implicit "discard": without this the old row kept its target_end_time
    // and the "Retomar" banner came back after the next Stop, offering a
    // session the user had already walked away from. Same soft-delete as
    // cauldron:discardInterruptedSession — a crash-orphan is not a scar.
    const stale = readInterruptedSession();
    if (stale) {
      const now = new Date().toISOString();
      db.prepare('UPDATE cauldron_sessions SET deleted_at = ?, updated_at = ?, target_end_time = NULL WHERE id = ?')
        .run(now, now, stale.id);
    }

    timerState = withTask(
      {
        ...IDLE_STATE,
        totalCycles: preset.cyclesBeforeLong,
        presetId: preset.id,
        presetName: preset.name,
        extensionMinutes: preset.extensionMinutes ?? 5,
      },
      taskId ?? null,
    );

    startSegment('work', preset.workMinutes * 60 * 1000);
    return getSnapshotState();
  });

  /**
   * Asignar o cambiar la misión SIN detener nada. Opcional y post-hoc: se puede
   * llamar durante el foco, con el timer pausado, o en `awaiting_next`.
   *
   * El corte en `awaiting_next`:
   *  - si el segmento que acaba de terminar era un ENFOQUE, escribe en el último
   *    frasco depositado (`lastCompletedWorkSessionId`) — ese es el momento en
   *    que el usuario sabe qué hizo, y ese frasco es lo que va a etiquetar;
   *  - si venía de un descanso, no hay frasco que corregir: solo queda cargada
   *    para los segmentos siguientes.
   *
   * En `idle` no hay a qué adjuntarla: la elección previa al play vive en el
   * renderer y viaja como segundo parámetro de `cauldron:start`.
   */
  ipcHandle('cauldron:setSessionTask', (_e, taskId: string | null) => {
    if (timerState.status === 'idle') return getSnapshotState();

    const next = taskId ?? null;
    timerState = withTask(timerState, next);

    const targetRow =
      currentSessionDbId ??
      (timerState.status === 'awaiting_next' && timerState.sessionType === 'work'
        ? lastCompletedWorkSessionId
        : null);

    if (targetRow) {
      const now = new Date().toISOString();
      getDb()
        .prepare('UPDATE cauldron_sessions SET task_id = ?, updated_at = ? WHERE id = ?')
        .run(next, now, targetRow);
    }

    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  /**
   * "Esperá" — disarms the pending auto-start and falls back to the classic
   * awaiting_next, where the queued segment waits for an explicit Continue.
   */
  ipcHandle('cauldron:cancelAutoStart', () => {
    if (timerState.status !== 'awaiting_next' || timerState.autoStartAt === null) {
      return getSnapshotState();
    }
    clearAutoStart();
    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:pause', () => {
    // Pausing during the auto-start countdown means the same thing as "Esperá".
    // Also the fallback the renderer uses while preload does not expose
    // cauldron:cancelAutoStart yet.
    if (timerState.status === 'awaiting_next' && timerState.autoStartAt !== null) {
      clearAutoStart();
      emit('cauldron:tick', getSnapshotState());
      return getSnapshotState();
    }
    if (timerState.status !== 'work' && timerState.status !== 'on_break') {
      throw new Error('Timer not running');
    }
    timerState.remainingMs = Math.max(0, targetEndTime - Date.now());
    timerState.status =
      timerState.status === 'work' ? 'work_paused' : 'break_paused';
    clearTimer();
    // A paused session has no wall-clock deadline; clearing target_end_time keeps
    // it out of the "resume this?" offer until it is resumed again.
    if (currentSessionDbId) {
      const nowIso = new Date().toISOString();
      getDb().prepare('UPDATE cauldron_sessions SET target_end_time = NULL, updated_at = ? WHERE id = ?')
        .run(nowIso, currentSessionDbId);
    }
    emit('cauldron:tick', getSnapshotState());
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
    if (currentSessionDbId) {
      const nowIso = new Date().toISOString();
      getDb().prepare('UPDATE cauldron_sessions SET target_end_time = ?, updated_at = ? WHERE id = ?')
        .run(targetEndTime, nowIso, currentSessionDbId);
    }
    timerInterval = setInterval(tick, 1000);
    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:skip', () => {
    if (timerState.status === 'idle') throw new Error('No active session');

    // Record current session as incomplete
    if (currentSessionDbId) {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE cauldron_sessions SET updated_at = ?, target_end_time = NULL WHERE id = ?',
      ).run(now, currentSessionDbId);
      currentSessionDbId = null;
    }
    currentSessionIsExtension = false;

    clearTimer();
    clearAutoStart();
    pendingNextSegment = null;

    // Broadcast sessionEnd so stats refresh in all UIs
    const sessionEndResult: CauldronSessionEndResult = {
      sessionType: timerState.sessionType,
      completed: false,
      nextType: null,
    };
    emit('cauldron:sessionEnd', sessionEndResult);

    const nextSegment = getNextSegment();

    if (nextSegment) {
      startSegment(nextSegment.type, nextSegment.durationMs, nextSegment.resetCycle);
    } else {
      timerState = { ...timerState, status: 'idle', remainingMs: 0 };
      activePreset = null;
    }

    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:confirmNext', () => {
    if (timerState.status !== 'awaiting_next' || !pendingNextSegment) {
      throw new Error('No segment awaiting confirmation');
    }
    clearAutoStart();
    const next = pendingNextSegment;
    pendingNextSegment = null;
    startSegment(next.type, next.durationMs, next.resetCycle);
    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  ipcHandle('cauldron:extend', (_e, minutes?: number) => {
    if (timerState.status !== 'awaiting_next') {
      throw new Error('Can only extend at segment end');
    }
    // Asking for more time is itself a "not yet" — the queued segment stops
    // auto-starting underneath the extension.
    clearAutoStart();
    // Resume same segment with extra time, track in DB
    const extMin = minutes ?? activePreset?.extensionMinutes ?? 5;
    const durationMs = extMin * 60 * 1000;

    // Create a DB row for the extension so it's tracked, flagged is_extension = 1.
    // Without the flag this row was an ordinary type='work' session and completing
    // it paid a FULL second pomodoro (+8 XP, +1 today, +5 min on the chart) for a
    // cycle that had already been rewarded.
    const db = getDb();
    const now = new Date().toISOString();
    const sessionId = genId();
    targetEndTime = Date.now() + durationMs;
    db.prepare(
      `INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at, target_end_time, is_extension, task_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?)`,
    ).run(sessionId, timerState.presetId, timerState.sessionType, extMin, now, now, now, targetEndTime, timerState.taskId ?? null);
    currentSessionDbId = sessionId;
    currentSessionIsExtension = true;

    timerState = {
      ...timerState,
      status: timerState.sessionType === 'work' ? 'work' : 'on_break',
      remainingMs: durationMs,
      totalMs: durationMs,
      autoStartAt: null,
    };
    if (!timerInterval) {
      timerInterval = setInterval(tick, 1000);
    }
    emit('cauldron:tick', getSnapshotState());
    return getSnapshotState();
  });

  /**
   * Cortar la corrida a mano. Es lo ÚNICO que la termina — y es la única puerta
   * que puede dejar una cicatriz.
   *
   * Cortar un enfoque después del umbral no borra la sesión: la marca
   * `abandoned = 1` y deja un frasco roto en el mismo lugar del estante. La
   * pérdida es simbólica y legible, jamás numérica: no se descuenta XP, no baja
   * ningún contador. El evento POMODORO_ABANDONED que emite el renderer paga 0.
   *
   * `skip` deliberadamente NO deja cicatriz: es la salida barata de un segmento,
   * no una promesa rota.
   */
  ipcHandle('cauldron:stop', () => {
    if (timerState.status === 'idle') return;

    const db = getDb();
    const now = new Date().toISOString();

    // Tiempo REALMENTE enfocado: el pausado no cuenta. `remainingMs` puede tener
    // hasta un segundo de atraso respecto al reloj, así que se recalcula.
    const remainingMs =
      timerState.status === 'work' || timerState.status === 'on_break'
        ? Math.max(0, targetEndTime - Date.now())
        : timerState.remainingMs;
    const elapsedMs = Math.max(0, timerState.totalMs - remainingMs);

    const wasWorkSegment =
      timerState.sessionType === 'work' &&
      (timerState.status === 'work' || timerState.status === 'work_paused');
    // Una prórroga es tiempo extra de un ciclo YA cobrado: cortarla no rompe
    // ninguna promesa, el frasco ya está en el estante.
    const scar =
      !!currentSessionDbId &&
      wasWorkSegment &&
      !currentSessionIsExtension &&
      elapsedMs > ABANDON_THRESHOLD_MS;

    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));

    if (currentSessionDbId) {
      if (scar) {
        // `completed_at` guarda el instante en que este reloj se detuvo
        // (started_at + lo efectivamente enfocado), así el estante puede decir
        // «abandonada a los N min» sin una columna más y sin que las pausas
        // inflen el número.
        const started = db
          .prepare('SELECT started_at AS startedAt FROM cauldron_sessions WHERE id = ?')
          .get(currentSessionDbId) as { startedAt: string } | undefined;
        const stoppedAt = started
          ? new Date(new Date(started.startedAt).getTime() + elapsedMs).toISOString()
          : now;
        db.prepare(
          `UPDATE cauldron_sessions
           SET abandoned = 1, completed_at = ?, updated_at = ?, target_end_time = NULL
           WHERE id = ?`,
        ).run(stoppedAt, now, currentSessionDbId);
      } else {
        // Arranque en falso (o un descanso cortado): se descarta sin dejar rastro.
        db.prepare(
          'UPDATE cauldron_sessions SET updated_at = ?, deleted_at = ?, target_end_time = NULL WHERE id = ?',
        ).run(now, now, currentSessionDbId);
      }
      currentSessionDbId = null;
    }
    currentSessionIsExtension = false;

    // Se emite ANTES de resetear el estado para que lleve la misión vinculada.
    // Una sola vez: el segundo `stop` sale por el `status === 'idle'` de arriba.
    if (scar) {
      const abandonResult: CauldronSessionEndResultEx = {
        sessionType: 'work',
        completed: false,
        nextType: null,
        abandoned: true,
        elapsedMinutes,
        taskId: timerState.taskId,
        taskName: timerState.taskName,
      };
      emit('cauldron:sessionEnd', abandonResult);
    }

    clearTimer();
    clearAutoStart();
    pendingNextSegment = null;
    lastCompletedWorkSessionId = null;
    // The loop runs until here: `stop` is the only thing that ends it.
    timerState = { ...IDLE_STATE };
    activePreset = null;
    emit('cauldron:tick', getSnapshotState());
  });

  ipcHandle('cauldron:getState', () => {
    return getSnapshotState();
  });

  // ─── Stats ───

  /**
   * El Estante de Pociones. Misma API paginada de siempre, ampliada: cada fila
   * es un frasco.
   *
   * Ahora incluye también los ABANDONADOS (`abandoned = 1`), que antes ni
   * existían. El estante no es un log de logros — es memoria completa, y por eso
   * nunca se vacía. El conteo de pomodoros (`cauldron:getStats`) sigue mirando
   * solo `completed = 1`: un frasco roto se ve, no se cuenta.
   */
  ipcHandle('cauldron:getSessions', (_e, offset = 0, limit = 20) => {
    const db = getDb();
    // El JOIN a quests es condicional: en una base donde el módulo todavía no
    // migró, `tasks` no existe y el JOIN tiraría en vez de devolver vacío.
    const withTasks = hasQuestsTables();
    const taskCols = withTasks
      ? `t.name AS taskName, t.project_id AS projectId,
         pr.name AS projectName, pr.color AS projectColor`
      : `NULL AS taskName, NULL AS projectId, NULL AS projectName, NULL AS projectColor`;
    const taskJoin = withTasks
      ? `LEFT JOIN tasks t ON t.id = s.task_id AND t.deleted_at IS NULL
         LEFT JOIN projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL`
      : '';

    const rows = db
      .prepare(
        `SELECT s.id, s.preset_id AS presetId, s.type, s.duration_minutes AS durationMinutes,
                s.completed, s.started_at AS startedAt, s.completed_at AS completedAt,
                s.abandoned, s.retroactive, s.task_id AS taskId,
                p.name AS presetName,
                ${taskCols}
         FROM cauldron_sessions s
         LEFT JOIN cauldron_presets p ON s.preset_id = p.id
         ${taskJoin}
         WHERE s.type = 'work' AND s.deleted_at IS NULL AND s.is_extension = 0
           AND (s.completed = 1 OR s.abandoned = 1)
         ORDER BY s.started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit + 1, offset) as Array<Record<string, unknown>>;

    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map((r) => {
      const abandoned = (r.abandoned as number) === 1;
      // Para un frasco roto, `completed_at` es el instante en que el reloj se
      // detuvo: la diferencia son los minutos que sí se enfocaron.
      let elapsedMinutes: number | null = null;
      if (abandoned && r.completedAt && r.startedAt) {
        const ms = new Date(r.completedAt as string).getTime() - new Date(r.startedAt as string).getTime();
        elapsedMinutes = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 60000)) : null;
      }
      return {
        id: r.id,
        presetId: r.presetId,
        type: r.type,
        durationMinutes: r.durationMinutes,
        completed: (r.completed as number) === 1,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        presetName: r.presetName ?? null,
        abandoned,
        // Registrada a mano, después de ocurrir: el frasco lleva borde punteado.
        retroactive: (r.retroactive as number) === 1,
        elapsedMinutes,
        taskId: r.taskId ?? null,
        // Una tarea borrada deja el vínculo pero se queda sin nombre: el frasco
        // conserva su lugar y pasa a ser «sin etiqueta».
        taskName: r.taskName ?? null,
        projectId: r.projectId ?? null,
        projectName: r.projectName ?? null,
        projectColor: r.projectColor ?? null,
      };
    });

    return { sessions, hasMore };
  });

  /**
   * «Trabajé 90 minutos sin el caldero» — registrar una sesión PASADA.
   *
   * Cuenta para el registro, no para la recompensa (mismo precedente que la
   * prórroga): la fila entra completada y `retroactive = 1`, pero acá NO se
   * emite `cauldron:sessionEnd` ni ningún evento RPG — ese broadcast es la
   * única puerta por la que el renderer paga XP de pomodoros, y esta sesión
   * paga CERO. El estante y las stats la ven igual porque leen
   * `cauldron_sessions` directo (`completed = 1`); el frasco sale con borde
   * punteado gracias a la marca.
   *
   * El INSERT es único y atómico con `completed = 1` desde el primer instante,
   * así `cleanupOrphanedSessions` (que solo barre `completed = 0`) no puede
   * verla jamás, ni siquiera a medio insertar.
   */
  ipcHandle('cauldron:logPastSession', (_e, payload: Record<string, unknown>) => {
    const db = getDb();

    const rawMinutes = Number(payload?.minutes);
    if (!Number.isFinite(rawMinutes)) throw new Error('Invalid minutes');
    // Clamp 1–600: diez horas es el techo de un «me olvidé el caldero un día
    // entero»; más que eso es un typo, no una jornada.
    const minutes = Math.min(600, Math.max(1, Math.round(rawMinutes)));

    const nowMs = Date.now();
    let startMs = nowMs - minutes * 60_000;
    if (payload?.when != null && payload.when !== '') {
      const parsed = new Date(String(payload.when)).getTime();
      if (!Number.isFinite(parsed)) throw new Error('Invalid date');
      startMs = parsed;
    }
    // El pasado se registra; el futuro se vive. Ni el inicio ni el final pueden
    // quedar adelante del reloj (60 s de tolerancia por skew entre superficies).
    if (startMs > nowMs || startMs + minutes * 60_000 > nowMs + 60_000) {
      throw new Error('Cannot log a session in the future');
    }

    // preset_id tiene FK dura: un id que no resuelve tira toda la inserción.
    // Se degrada a null — la receta es color local, la sesión es lo que importa.
    let presetId = typeof payload?.presetId === 'string' ? payload.presetId : null;
    if (presetId) {
      const found = db
        .prepare('SELECT id FROM cauldron_presets WHERE id = ? AND deleted_at IS NULL')
        .get(presetId);
      if (!found) presetId = null;
    }
    // task_id no tiene FK (a propósito, ver migración v6): viaja tal cual.
    const taskId = typeof payload?.taskId === 'string' ? payload.taskId : null;

    const id = genId();
    const nowIso = new Date().toISOString();
    const startedAt = new Date(startMs).toISOString();
    const completedAt = new Date(startMs + minutes * 60_000).toISOString();
    db.prepare(
      `INSERT INTO cauldron_sessions
         (id, preset_id, type, duration_minutes, completed, started_at, completed_at,
          created_at, updated_at, target_end_time, is_extension, task_id, retroactive)
       VALUES (?, ?, 'work', ?, 1, ?, ?, ?, ?, NULL, 0, ?, 1)`,
    ).run(id, presetId, minutes, startedAt, completedAt, nowIso, nowIso, taskId);

    return { id, minutes, startedAt, completedAt };
  });

  /**
   * La respuesta semanal a «¿en qué se me fue el foco?»: enfoques COMPLETADOS de
   * la semana calendario (lunes), agrupados por misión, con el color del proyecto
   * para pintar los frascos.
   *
   * Los abandonados quedan fuera a propósito — el estante ya los muestra; el
   * resumen es de lo que se logró, no un balance con signo negativo.
   */
  ipcHandle('cauldron:getWeekByProject', () => {
    const db = getDb();
    const monday = getMondayOfWeek();
    const withTasks = hasQuestsTables();

    const taskCols = withTasks
      ? `t.name AS taskName, t.project_id AS projectId,
         pr.name AS projectName, pr.color AS projectColor`
      : `NULL AS taskName, NULL AS projectId, NULL AS projectName, NULL AS projectColor`;
    const taskJoin = withTasks
      ? `LEFT JOIN tasks t ON t.id = s.task_id AND t.deleted_at IS NULL
         LEFT JOIN projects pr ON pr.id = t.project_id AND pr.deleted_at IS NULL`
      : '';

    const rows = db
      .prepare(
        // 'localtime' por lo mismo que en getWeeklyFocusTime: started_at es un
        // instante UTC y un date() pelado rueda a las 21:00 en UTC-3.
        `SELECT s.task_id AS taskId,
                ${taskCols},
                COUNT(*) AS sessions,
                COALESCE(SUM(s.duration_minutes), 0) AS minutes
         FROM cauldron_sessions s
         ${taskJoin}
         WHERE s.type = 'work' AND s.completed = 1 AND s.deleted_at IS NULL
           AND s.is_extension = 0 AND s.abandoned = 0
           AND date(s.started_at, 'localtime') >= ?
         GROUP BY s.task_id
         ORDER BY minutes DESC`,
      )
      .all(monday) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      taskId: (r.taskId as string) ?? null,
      taskName: (r.taskName as string) ?? null,
      projectId: (r.projectId as string) ?? null,
      projectName: (r.projectName as string) ?? null,
      projectColor: (r.projectColor as string) ?? null,
      sessions: r.sessions as number,
      minutes: r.minutes as number,
    }));
  });

  ipcHandle('cauldron:getWeeklyFocusTime', () => {
    const db = getDb();
    // Monday is computed in JS, not with SQLite's date('now','weekday 1','-7 days'):
    // 'weekday 1' is a NO-OP when the date is already a Monday, so every Monday the
    // chart showed LAST week and hid the day you were looking at.
    // Both this and cauldron:getStats' "week" now mean the same calendar week.
    const monday = getMondayOfWeek();
    const rows = db
      .prepare(
        `WITH RECURSIVE dates(d, idx) AS (
           SELECT ?, 0
           UNION ALL
           SELECT date(d, '+1 day'), idx + 1
           FROM dates WHERE idx < 6
         )
         SELECT
           dates.d AS day,
           COALESCE(SUM(s.duration_minutes), 0) AS totalMinutes
         FROM dates
         LEFT JOIN cauldron_sessions s
           -- 'localtime': started_at is stored as a UTC ISO instant, so a bare
           -- date(started_at) rolls over at 21:00 in UTC-3.
           ON date(s.started_at, 'localtime') = dates.d
           AND s.type = 'work'
           AND s.completed = 1
           AND s.deleted_at IS NULL
           AND s.is_extension = 0
         GROUP BY dates.d
         ORDER BY dates.d ASC`,
      )
      .all(monday) as Array<{ day: string; totalMinutes: number }>;

    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return rows.map((r) => {
      const dt = new Date(r.day + 'T12:00:00');
      return {
        label: dayLabels[dt.getDay()],
        value: r.totalMinutes,
      };
    });
  });

  ipcHandle('cauldron:getStats', () => {
    const db = getDb();

    // ── "today"/"this week" convention ────────────────────────────────────────
    // started_at is a UTC ISO instant. Reads must convert it with
    // date(started_at, 'localtime') and compare against a LOCAL day computed in JS;
    // the old date('now') / toISOString().slice(0,10) pair evaluated in UTC, so in
    // UTC-3 "today" and the streak both rolled over at 21:00.
    // "This week" is the Monday-based CALENDAR week, matching getWeeklyFocusTime
    // (it used to be a rolling 7 days here — two different weeks in one UI).
    // is_extension = 0 everywhere: an extension is extra time on an already-counted
    // cycle, not another pomodoro.
    const todayStr = formatDateString(new Date());
    const monday = getMondayOfWeek();

    const today = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0
       AND date(started_at, 'localtime') = ?`,
      )
      .get(todayStr) as { count: number };

    const week = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0
       AND date(started_at, 'localtime') >= ?`,
      )
      .get(monday) as { count: number };

    const total = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cauldron_sessions
       WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0`,
      )
      .get() as { count: number };

    // Streak: consecutive days (including today) with at least one completed work session
    const streakRows = db
      .prepare(
        `SELECT DISTINCT date(started_at, 'localtime') AS d FROM cauldron_sessions
         WHERE completed = 1 AND type = 'work' AND deleted_at IS NULL AND is_extension = 0
         ORDER BY d DESC`,
      )
      .all() as Array<{ d: string }>;

    let streak = 0;
    let expectedDate = todayStr;
    for (const row of streakRows) {
      if (row.d === expectedDate) {
        streak++;
        // Move to previous day
        const prev = new Date(expectedDate + 'T12:00:00');
        prev.setDate(prev.getDate() - 1);
        expectedDate = formatDateString(prev);
      } else if (row.d < expectedDate) {
        // Gap found — streak broken
        break;
      }
    }

    return { today: today.count, week: week.count, total: total.count, streak };
  });

  // ─── Interrupted session recovery ───

  /**
   * The session that was running when the app closed, with its remaining time, or
   * null. Startup used to soft-delete every incomplete session instead: quit 20
   * minutes into a 25-minute pomodoro and it vanished, no XP, no notice.
   */
  ipcHandle('cauldron:getInterruptedSession', () => {
    // A live timer takes precedence — nothing was interrupted.
    if (timerState.status !== 'idle') return null;
    return readInterruptedSession();
  });


  /**
   * Retoma la sesion interrumpida *donde quedo*, reusando la fila existente en vez
   * de arrancar la receta de cero. Sin esto, "Retomar" descartaba la sesion y
   * empezaba un pomodoro nuevo: el usuario perdia los minutos ya cumplidos.
   */
  ipcHandle('cauldron:resumeInterruptedSession', () => {
    if (timerState.status !== 'idle') return { success: false, reason: 'timer_active' };

    const session = readInterruptedSession();
    if (!session) return { success: false, reason: 'not_found' };

    const db = getDb();
    const preset = session.presetId
      ? (db
          .prepare(
            `SELECT id, name, work_minutes AS workMinutes, break_minutes AS breakMinutes,
                    long_break_minutes AS longBreakMinutes, cycles_before_long AS cyclesBeforeLong,
                    extension_minutes AS extensionMinutes,
                    auto_start_break AS autoStartBreak, auto_start_work AS autoStartWork
             FROM cauldron_presets WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(session.presetId) as CauldronPresetEx | undefined)
      : undefined;
    if (!preset) return { success: false, reason: 'preset_missing' };

    activePreset = {
      workMinutes: preset.workMinutes,
      breakMinutes: preset.breakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
      cyclesBeforeLong: preset.cyclesBeforeLong,
      extensionMinutes: preset.extensionMinutes ?? 5,
      autoStartBreak: (preset.autoStartBreak ?? 1) !== 0,
      autoStartWork: (preset.autoStartWork ?? 0) !== 0,
    };

    const type = session.type as 'work' | 'break' | 'long_break';
    targetEndTime = Date.now() + session.remainingMs;
    currentSessionDbId = session.id;
    currentSessionIsExtension = false;

    lastCompletedWorkSessionId = null;

    // La misión vuelve con la sesión: retomar no debería costar re-etiquetar.
    timerState = withTask(
      {
        ...IDLE_STATE,
        status: type === 'work' ? 'work' : 'on_break',
        remainingMs: session.remainingMs,
        totalMs: session.totalMs,
        currentCycle: 1,
        totalCycles: preset.cyclesBeforeLong,
        sessionType: type,
        presetId: preset.id,
        presetName: preset.name,
        extensionMinutes: preset.extensionMinutes ?? 5,
        autoStartAt: null,
        round: 1,
      },
      session.taskId,
    );

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE cauldron_sessions SET target_end_time = ?, updated_at = ? WHERE id = ?')
      .run(targetEndTime, nowIso, session.id);

    if (!timerInterval) timerInterval = setInterval(tick, 1000);
    emit('cauldron:tick', getSnapshotState());
    return { success: true, state: getSnapshotState() };
  });

  /** Discards the offered interrupted session (soft delete). */
  ipcHandle('cauldron:discardInterruptedSession', () => {
    const db = getDb();
    const session = readInterruptedSession();
    if (!session) return { success: false };
    const now = new Date().toISOString();
    db.prepare('UPDATE cauldron_sessions SET deleted_at = ?, updated_at = ?, target_end_time = NULL WHERE id = ?')
      .run(now, now, session.id);
    return { success: true };
  });

  /**
   * Receives the OS-notification texts already translated by the renderer. They
   * were hardcoded Spanish regardless of the user's language.
   */
  ipcHandle('cauldron:setLabels', (_e, next: Partial<CauldronLabels>) => {
    if (next && typeof next === 'object') {
      labels = { ...labels, ...next };
    }
  });
}
