import type { Migration } from '../../../shared/types';

export const cauldronMigrations: Migration[] = [
  {
    namespace: 'cauldron',
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS cauldron_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_minutes INTEGER NOT NULL DEFAULT 25,
        break_minutes INTEGER NOT NULL DEFAULT 5,
        long_break_minutes INTEGER NOT NULL DEFAULT 15,
        cycles_before_long INTEGER NOT NULL DEFAULT 4,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS cauldron_sessions (
        id TEXT PRIMARY KEY,
        preset_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('work','break','long_break')),
        duration_minutes INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (preset_id) REFERENCES cauldron_presets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_cauldron_sessions_started ON cauldron_sessions(started_at);

      INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default)
      VALUES
        ('preset-classic', 'Classic', 25, 5, 15, 4, 1),
        ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 1),
        ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 1);
    `,
  },
  {
    namespace: 'cauldron',
    version: 2,
    up: `
      INSERT OR IGNORE INTO cauldron_presets (id, name, work_minutes, break_minutes, long_break_minutes, cycles_before_long, is_default)
      VALUES
        ('preset-classic', 'Classic', 25, 5, 15, 4, 1),
        ('preset-long-focus', 'Long Focus', 50, 10, 30, 3, 1),
        ('preset-quick-sprint', 'Quick Sprint', 15, 3, 10, 4, 1);
    `,
  },
  {
    namespace: 'cauldron',
    version: 3,
    up: `
      ALTER TABLE cauldron_presets ADD COLUMN extension_minutes INTEGER NOT NULL DEFAULT 5;
    `,
  },
  {
    namespace: 'cauldron',
    version: 4,
    up: `
      -- The running timer lived only in a module-level 'let'. Closing the app mid
      -- pomodoro lost it, and startup then marked EVERY incomplete session deleted —
      -- 20 minutes of a 25-minute cycle silently thrown away, no XP, no warning.
      -- target_end_time (epoch ms) makes the running session recoverable across a
      -- restart: cauldron:getInterruptedSession reads it to compute the time left.
      ALTER TABLE cauldron_sessions ADD COLUMN target_end_time INTEGER;

      -- cauldron:extend inserted a plain type='work' row, so finishing a 5-minute
      -- extension of an already-paid cycle counted as a WHOLE extra pomodoro:
      -- +8 XP, +1 in "Today", +5 min on the weekly chart. Extensions are now
      -- flagged and excluded from every stat.
      ALTER TABLE cauldron_sessions ADD COLUMN is_extension INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_cauldron_work_done
        ON cauldron_sessions(type, completed, deleted_at, started_at);
    `,
  },
  {
    namespace: 'cauldron',
    version: 5,
    up: `
      -- A finished work segment parked the timer in 'awaiting_next' and waited for
      -- a click: get up for water and the break never started. The break now
      -- arrives on its own after a short grace window you can cancel.
      -- Default ON for the break (the rest is the point of the technique) and OFF
      -- for the work (nobody wants to be dragged back to the desk unannounced).
      ALTER TABLE cauldron_presets ADD COLUMN auto_start_break INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE cauldron_presets ADD COLUMN auto_start_work INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    namespace: 'cauldron',
    version: 6,
    up: `
      -- Fase 2: el vínculo con Questify y el Estante de Pociones.
      --
      -- task_id: la misión sobre la que se enfocó esta sesión. Es OPCIONAL y
      -- POST-HOC: nunca es un peaje antes de apretar play (ese fue el fracaso de
      -- Focus To-Do), se puede asignar durante el foco o al terminarlo, que es
      -- justo cuando el usuario sabe qué hizo.
      --
      -- DELIBERADAMENTE SIN FOREIGN KEY a tasks(id): sync puede traer sesiones de
      -- otro dispositivo cuyas tareas este todavía no vio, y una FK dura haría que
      -- todo el merge del caldero se caiga por un id colgado. El JOIN es LEFT y
      -- una tarea borrada simplemente deja el frasco «sin etiqueta».
      ALTER TABLE cauldron_sessions ADD COLUMN task_id TEXT DEFAULT NULL;

      -- abandoned: la CICATRIZ. Un enfoque cortado a mano después de 5 minutos
      -- deja un frasco roto en el estante en vez de desaparecer. La pérdida es
      -- simbólica y legible, nunca numérica: POMODORO_ABANDONED paga 0 XP.
      -- Menos de 5 minutos no deja rastro — un arranque en falso no es una
      -- promesa rota.
      ALTER TABLE cauldron_sessions ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_cauldron_sessions_task ON cauldron_sessions(task_id);
      -- El estante lee completadas Y abandonadas; el índice anterior solo cubría
      -- (type, completed, deleted_at, started_at).
      CREATE INDEX IF NOT EXISTS idx_cauldron_shelf
        ON cauldron_sessions(type, deleted_at, is_extension, started_at);
    `,
  },
];
