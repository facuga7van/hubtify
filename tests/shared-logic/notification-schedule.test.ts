/**
 * Avisos con la app cerrada — la parte PURA (spec §12 Fase 6).
 *
 * «Dado el estado, qué avisos deben quedar programados en el SO». Sin plugin,
 * sin worker: solo el plan. Lo que ejecuta el plan se prueba en
 * tests/mobile/platform-host.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  CAULDRON_END_TAG,
  CAULDRON_ONGOING_TAG,
  DEFAULT_CAULDRON_LABELS,
  cauldronEndMessage,
  habitTagFor,
  planCauldronNotifications,
  planHabitNotifications,
  pushPlan,
  schedulingSupported,
} from '../../shared-logic/modules/notification-schedule';
import { setPlatform, type NotificationPlan, type PlatformPort } from '../../shared-logic/platform';

const L = DEFAULT_CAULDRON_LABELS;
const MIN = 60_000;

/** Miércoles 2 de septiembre de 2026, mediodía. */
const NOW = new Date(2026, 8, 2, 12, 0, 0);

function cauldronInput(over: Partial<Parameters<typeof planCauldronNotifications>[0]> = {}) {
  return {
    enabled: true,
    status: 'work',
    targetEndTime: NOW.getTime() + 25 * MIN,
    now: NOW.getTime(),
    end: {
      sessionType: 'work' as const,
      currentCycle: 2,
      totalCycles: 4,
      presetName: 'Clásico',
      next: { type: 'break' as const, durationMs: 5 * MIN },
    },
    labels: L,
    ...over,
  };
}

const tags = (plan: NotificationPlan) => plan.schedule.map((n) => n.tag);

describe('planCauldronNotifications', () => {
  it('con el reloj corriendo programa el fin a targetEndTime y el aviso persistente', () => {
    const plan = planCauldronNotifications(cauldronInput());
    expect(plan.scope).toBe('cauldron');
    expect(tags(plan)).toEqual([CAULDRON_END_TAG, CAULDRON_ONGOING_TAG]);

    const end = plan.schedule[0];
    expect(end.at).toBe(NOW.getTime() + 25 * MIN);
    expect(end.ongoing).toBeUndefined();
    expect(end.title).toBe(L.potionDone);
    expect(end.body).toContain('Ciclo 2/4');
    expect(end.body).toContain('Siguiente: Descanso (5 min)');
    expect(end.body).toContain('(Clásico)');

    // El persistente NO lleva `at`: se publica ya y se queda hasta que se cancele.
    const ongoing = plan.schedule[1];
    expect(ongoing.at).toBeUndefined();
    expect(ongoing.ongoing).toBe(true);
    expect(ongoing.body).toBe('Termina a las 12:25 (Clásico)');
  });

  it('gobierna siempre los dos tags: por eso pausar los CANCELA', () => {
    const paused = planCauldronNotifications(cauldronInput({ status: 'work_paused' }));
    expect(paused.schedule).toEqual([]);
    expect(paused.owned).toEqual([CAULDRON_END_TAG, CAULDRON_ONGOING_TAG]);
    // El persistente ya está publicado: cancelar la alarma no lo baja de la bandeja.
    expect(paused.ownedPersistent).toEqual([CAULDRON_ONGOING_TAG]);
  });

  it('en idle y en awaiting_next no queda nada armado', () => {
    expect(planCauldronNotifications(cauldronInput({ status: 'idle' })).schedule).toEqual([]);
    expect(planCauldronNotifications(cauldronInput({ status: 'awaiting_next' })).schedule).toEqual([]);
  });

  it('con el módulo Caldero apagado en Ajustes no programa nada', () => {
    expect(planCauldronNotifications(cauldronInput({ enabled: false })).schedule).toEqual([]);
  });

  it('un fin ya vencido NO se programa: el plugin lo dispararía en el acto', () => {
    const plan = planCauldronNotifications(cauldronInput({ targetEndTime: NOW.getTime() - 1 }));
    expect(plan.schedule).toEqual([]);
  });

  it('el descanso largo anuncia la vuelta completa, no el siguiente segmento', () => {
    const msg = cauldronEndMessage(
      { sessionType: 'long_break', currentCycle: 4, totalCycles: 4, presetName: null, next: { type: 'work', durationMs: 25 * MIN } },
      L,
    );
    expect(msg.title).toBe(L.cycleComplete);
  });

  it('sin segmento siguiente, también', () => {
    const msg = cauldronEndMessage(
      { sessionType: 'work', currentCycle: 1, totalCycles: 4, presetName: null, next: null },
      L,
    );
    expect(msg.title).toBe(L.cycleComplete);
    expect(msg.body).toBe(L.cycleCompleteBody);
  });
});

// ─── Hábitos ────────────────────────────────────────────────

let db: Database.Database;
let seq = 0;

function setupDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  for (const m of questsMigrations) d.exec(m.up);
  return d;
}

function addHabit(spec: {
  frequency: 'daily' | 'weekly' | 'monthly';
  timesPerWeek?: number;
  specificDays?: number[];
  checks?: string[];
}): string {
  const id = `h${++seq}`;
  db.prepare(
    `INSERT INTO habits (id, name, frequency, times_per_week, specific_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '2026-04-29T21:50:47.097Z', '2026-04-29T21:50:47.097Z')`,
  ).run(id, id, spec.frequency, spec.timesPerWeek ?? 1, spec.specificDays?.join(',') ?? null);
  for (const date of spec.checks ?? []) {
    db.prepare(
      `INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at)
       VALUES (?, ?, ?, 'check', ?, ?)`,
    ).run(`c${++seq}`, id, date, `${date}T20:35:15.521Z`, `${date}T20:35:15.521Z`);
  }
  return id;
}

function habitPlan(over: Partial<Parameters<typeof planHabitNotifications>[1]> = {}): NotificationPlan {
  return planHabitNotifications(db, { enabled: true, reminderTime: '21:00', now: NOW, ...over });
}

beforeEach(() => {
  db = setupDb();
});

describe('planHabitNotifications', () => {
  it('un diario sin marcar deja armados hoy y los 7 días siguientes', () => {
    addHabit({ frequency: 'daily' });
    const plan = habitPlan();
    expect(tags(plan)).toEqual([
      'habit:2026-09-02', 'habit:2026-09-03', 'habit:2026-09-04', 'habit:2026-09-05',
      'habit:2026-09-06', 'habit:2026-09-07', 'habit:2026-09-08', 'habit:2026-09-09',
    ]);
    expect(plan.schedule[0].at).toBe(new Date(2026, 8, 2, 21, 0, 0).getTime());
    expect(plan.schedule[1].at).toBe(new Date(2026, 8, 3, 21, 0, 0).getTime());
    expect(plan.schedule[0].title).toBe('Hábitos pendientes');
  });

  it('gobierna también ayer: un recordatorio viejo que nunca sonó hay que retirarlo', () => {
    const plan = habitPlan();
    expect(plan.owned[0]).toBe(habitTagFor('2026-09-01'));
    expect(plan.owned).toHaveLength(9); // ayer + hoy + 7
  });

  it('si la hora del recordatorio YA pasó, hoy no entra: sería un duplicado inmediato', () => {
    addHabit({ frequency: 'daily' });
    const plan = habitPlan({ now: new Date(2026, 8, 2, 21, 30, 0) });
    expect(tags(plan)).not.toContain('habit:2026-09-02');
    expect(tags(plan)[0]).toBe('habit:2026-09-03');
  });

  it('marcar el hábito de hoy apaga el recordatorio de hoy y deja los de mañana', () => {
    addHabit({ frequency: 'daily', checks: ['2026-09-02'] });
    const plan = habitPlan();
    expect(tags(plan)).not.toContain('habit:2026-09-02');
    expect(tags(plan)).toContain('habit:2026-09-03');
  });

  it('un Lun/Mie/Vie solo suena los días que pide un check', () => {
    addHabit({ frequency: 'weekly', timesPerWeek: 3, specificDays: [1, 3, 5] });
    expect(tags(habitPlan())).toEqual([
      'habit:2026-09-02', // miércoles
      'habit:2026-09-04', // viernes
      'habit:2026-09-07', // lunes
      'habit:2026-09-09', // miércoles
    ]);
  });

  it('un mensual no molesta fuera de los últimos 3 días del mes (política del motor)', () => {
    addHabit({ frequency: 'monthly' });
    expect(habitPlan().schedule).toEqual([]);
  });

  it('sin hábitos no programa nada, pero sigue gobernando la ventana de días', () => {
    const plan = habitPlan();
    expect(plan.schedule).toEqual([]);
    expect(plan.owned).toHaveLength(9);
  });

  it('con el recordatorio apagado se cancela todo', () => {
    addHabit({ frequency: 'daily' });
    const plan = habitPlan({ enabled: false });
    expect(plan.schedule).toEqual([]);
    expect(plan.owned).toHaveLength(9);
  });

  it('una hora inválida no programa basura', () => {
    addHabit({ frequency: 'daily' });
    expect(habitPlan({ reminderTime: '' }).schedule).toEqual([]);
    expect(habitPlan({ reminderTime: '99:99' }).schedule).toEqual([]);
  });
});

// ─── Despacho ───────────────────────────────────────────────

describe('despacho: desktop no programa NADA', () => {
  const inertPort = (): PlatformPort => ({
    appVersion: () => '0.0.0',
    osInfo: () => 'test',
    notify: async () => undefined,
    openExternal: async () => undefined,
    pickTextFile: async () => null,
    pickBinaryFile: async () => null,
    saveTextFile: async () => false,
    saveBinaryFile: async () => false,
  });

  afterEach(() => setPlatform(inertPort()));

  it('un port SIN applyNotificationPlan (Electron) declara que no sabe programar', () => {
    setPlatform(inertPort());
    expect(schedulingSupported()).toBe(false);
    // Y `pushPlan` no explota ni intenta nada.
    expect(() => pushPlan(planCauldronNotifications(cauldronInput()))).not.toThrow();
  });

  it('un port CON el método recibe el plan tal cual', () => {
    const applyNotificationPlan = vi.fn(async (_plan: NotificationPlan) => undefined);
    setPlatform({ ...inertPort(), applyNotificationPlan });
    expect(schedulingSupported()).toBe(true);
    pushPlan(planCauldronNotifications(cauldronInput()));
    expect(applyNotificationPlan).toHaveBeenCalledTimes(1);
    expect(applyNotificationPlan.mock.calls[0][0]).toMatchObject({ scope: 'cauldron' });
  });

  it('si el host rechaza, el error no sube al handler que lo disparó', async () => {
    const applyNotificationPlan = vi.fn(async (_plan: NotificationPlan): Promise<void> => { throw new Error('plugin caído'); });
    setPlatform({ ...inertPort(), applyNotificationPlan });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => pushPlan(planCauldronNotifications(cauldronInput()))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
