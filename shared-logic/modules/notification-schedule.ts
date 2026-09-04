/**
 * Avisos con la app CERRADA (spec §12 Fase 6).
 *
 * El motor de notificaciones y el tick del Caldero viven en un `setInterval`
 * dentro del Worker del WebView, y Android lo congela apenas la app pasa a
 * segundo plano. Todo lo que se emita desde ahí solo existe si la app está
 * abierta — que es exactamente lo que el usuario reportó.
 *
 * La salida no es "correr en background" (Android no lo permite sin un servicio
 * en primer plano), sino **programar en vez de emitir**: se le entrega al
 * sistema, por adelantado, la alarma con su texto ya resuelto. El SO la dispara
 * aunque nuestro proceso no exista.
 *
 * Este archivo es la parte PURA y testeable: dado un estado, qué avisos deben
 * quedar programados. El que habla con el plugin es `src/mobile/platform-host.ts`
 * a través de `PlatformPort.applyNotificationPlan`.
 *
 * Reconciliación TOTAL, no incremental: cada plan declara todos los tags que
 * gobierna (`owned`) y cuáles quedan vivos (`schedule`); el host cancela la
 * diferencia. Diferenciar "qué cambió" exigiría un registro que sobreviva a que
 * el proceso muera, y no lo hay. Cancelar y reprogramar es idempotente: volver
 * a programar el mismo id reemplaza la alarma pendiente, no la duplica.
 *
 * **Nunca se programa nada en el pasado.** El plugin, ante un `at` ya vencido,
 * dispara la notificación EN EL ACTO (LocalNotificationManager.kt: la rama
 * `isTriggered()`), así que reprogramar un aviso de ayer al reabrir la app sería
 * un duplicado garantizado. Un momento que ya pasó simplemente no entra al plan.
 */
import type { SqlDatabase } from '../db';
import { getDb } from '../db';
import { platformOrNull, type NotificationPlan, type ScheduledNotification } from '../platform';
import { habitReminderMessage, habitsPendingToday } from './notification-engine';

// ─── Ámbitos y tags ─────────────────────────────────────────

export const CAULDRON_SCOPE = 'cauldron';
export const HABITS_SCOPE = 'habits';

/** Fin del segmento en curso. */
export const CAULDRON_END_TAG = 'cauldron:end';
/** Aviso persistente «hay una poción al fuego» mientras el segmento corre. */
export const CAULDRON_ONGOING_TAG = 'cauldron:ongoing';

/**
 * Los dos juegos de botones del aviso persistente. Son identidades DISTINTAS
 * (no un solo tipo que se re-registra) porque el aviso corriendo y el pausado
 * conviven en el tiempo: el usuario aprieta «Pausar» y el mismo id de
 * notificación se reemplaza por el pausado. Un solo actionTypeId obligaría a
 * re-registrar en cada transición y a confiar en que el sistema ya vio la
 * versión nueva antes de publicar.
 */
export const CAULDRON_ACTION_RUNNING = 'cauldron-running';
export const CAULDRON_ACTION_PAUSED = 'cauldron-paused';
/**
 * El id de cada botón ES el canal IPC que dispara. No hay tabla de mapeo que se
 * pueda desincronizar: el listener (src/mobile/install-api.ts) valida contra su
 * lista blanca y llama al canal con ese mismo string.
 */
export const CAULDRON_ACTION_PAUSE = 'cauldron:pause';
export const CAULDRON_ACTION_RESUME = 'cauldron:resume';
export const CAULDRON_ACTION_STOP = 'cauldron:stop';

/**
 * Cuántos días de recordatorios de hábitos se dejan armados por adelantado.
 * No es un lujo: si la app no se abre en tres días, esos tres recordatorios
 * tienen que salir igual. `computeHabits` sabe contestar "¿este hábito querría
 * un check tal día?" para una fecha futura (no hay checks todavía), así que la
 * predicción sale de la MISMA función que la del día de hoy.
 */
export const HABIT_HORIZON_DAYS = 7;

/** Tag del recordatorio de hábitos de un día concreto ('YYYY-MM-DD'). */
export function habitTagFor(date: string): string {
  return `habit:${date}`;
}

// ─── Caldero ────────────────────────────────────────────────

/**
 * Textos de las notificaciones del Caldero, ya traducidos por el renderer
 * (`cauldron:setLabels`). Viven acá porque los usa tanto `onTimeUp` (aviso
 * inmediato de escritorio) como el plan de Android, y una sola definición es
 * una sola cosa que se puede desincronizar.
 */
export interface CauldronLabels {
  cycleComplete: string;   // título: la vuelta entera terminó
  cycleCompleteBody: string;
  potionDone: string;      // título: terminó un enfoque
  breakDone: string;       // título: terminó un descanso
  focus: string;
  longBreak: string;
  shortBreak: string;
  cycle: string;           // «Ciclo» / «Cycle»
  next: string;            // «Siguiente» / «Next»
  minutesShort: string;    // «min»
  /** Cuerpo del aviso persistente: «Termina a las 15:42». */
  endsAt: string;
  /** Título del aviso persistente con el reloj detenido: «Enfoque — Pausado». */
  paused: string;
  /** Cuerpo del mismo: «Quedan 12 min». */
  remaining: string;
  // Los tres botones del aviso persistente. Van traducidos DENTRO del plan: el
  // host los registra tal cual llegan, porque el idioma lo sabe el renderer.
  pause: string;
  resume: string;
  stop: string;
}

export const DEFAULT_CAULDRON_LABELS: CauldronLabels = {
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
  endsAt: 'Termina a las',
  paused: 'Pausado',
  remaining: 'Quedan',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Detener',
};

export type CauldronSegmentType = 'work' | 'break' | 'long_break';

/** Lo que hay que saber para redactar el aviso de fin de segmento. */
export interface CauldronEndContext {
  sessionType: CauldronSegmentType;
  currentCycle: number;
  totalCycles: number;
  presetName: string | null;
  /** El segmento que viene, o null si la receta no encadena nada. */
  next: { type: CauldronSegmentType; durationMs: number } | null;
}

function segmentLabel(type: CauldronSegmentType, labels: CauldronLabels): string {
  if (type === 'work') return labels.focus;
  return type === 'long_break' ? labels.longBreak : labels.shortBreak;
}

/**
 * El texto de «terminó el segmento», idéntico lo dispare quien lo dispare: el
 * `onTimeUp` de escritorio o una alarma de Android programada 25 minutos antes.
 */
export function cauldronEndMessage(
  ctx: CauldronEndContext,
  labels: CauldronLabels,
): { title: string; body: string } {
  const presetLabel = ctx.presetName ? ` (${ctx.presetName})` : '';
  // Una vuelta se cierra cuando termina el DESCANSO LARGO.
  const cycleComplete = ctx.sessionType === 'long_break';
  if (cycleComplete || ctx.next === null) {
    return { title: labels.cycleComplete, body: `${labels.cycleCompleteBody}${presetLabel}` };
  }
  const cycleInfo = `${labels.cycle} ${ctx.currentCycle}/${ctx.totalCycles}`;
  const nextLabel = segmentLabel(ctx.next.type, labels);
  const nextMin = Math.round(ctx.next.durationMs / 60000);
  return {
    title: ctx.sessionType === 'work' ? labels.potionDone : labels.breakDone,
    body: `${cycleInfo} — ${labels.next}: ${nextLabel} (${nextMin} ${labels.minutesShort})${presetLabel}`,
  };
}

/** 'HH:MM' local de un instante. Es lo que lee el aviso persistente. */
function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface CauldronPlanInput {
  /** El toggle de Ajustes → Notificaciones → Caldero. */
  enabled: boolean;
  /** `work` / `on_break` corren; `work_paused` / `break_paused` están detenidos. */
  status: string;
  /** Reloj de pared del fin del segmento. Sin sentido con el reloj detenido. */
  targetEndTime: number;
  /** Lo que queda del segmento. Es lo ÚNICO que sabe la hora en pausa. */
  remainingMs: number;
  now: number;
  end: CauldronEndContext;
  labels: CauldronLabels;
}

/**
 * Qué avisos debe tener armados el Caldero AHORA.
 *
 * | estado                       | ongoing | alarma  | botones           |
 * | ---------------------------- | ------- | ------- | ----------------- |
 * | `work` / `on_break`          | sí      | sí      | Pausar · Detener  |
 * | `work_paused`/`break_paused` | sí      | no      | Reanudar · Detener|
 * | `awaiting_next` / `idle`     | no      | no      | —                 |
 *
 * El aviso persistente SOBREVIVE a la pausa a propósito, y no es cosmético: es
 * donde vive el botón «Reanudar». Cuando pausar borraba el aviso, el botón
 * «Pausar» se suicidaba — lo apretabas y desaparecía la única superficie desde
 * la que se podía volver sin abrir la app.
 *
 * Lo que la pausa SÍ retira es la alarma: `targetEndTime` quedó congelado y el
 * SO la dispararía igual, con el reloj detenido y la app cerrada.
 */
export function planCauldronNotifications(input: CauldronPlanInput): NotificationPlan {
  const owned = [CAULDRON_END_TAG, CAULDRON_ONGOING_TAG];
  const base: NotificationPlan = {
    scope: CAULDRON_SCOPE,
    owned,
    ownedPersistent: [CAULDRON_ONGOING_TAG],
    schedule: [],
  };

  if (!input.enabled) return base;

  const running = input.status === 'work' || input.status === 'on_break';
  const paused = input.status === 'work_paused' || input.status === 'break_paused';
  if (!running && !paused) return base;

  const segment = segmentLabel(input.end.sessionType, input.labels);
  const cycleInfo = `${input.labels.cycle} ${input.end.currentCycle}/${input.end.totalCycles}`;
  const presetLabel = input.end.presetName ? ` (${input.end.presetName})` : '';

  if (paused) {
    // Redondeo hacia ARRIBA: con 40 s en el reloj, «Quedan 0 min» sería mentira
    // y además leería como «ya está», que es justo lo contrario.
    const minutesLeft = Math.max(1, Math.ceil(input.remainingMs / 60000));
    return {
      ...base,
      schedule: [
        {
          tag: CAULDRON_ONGOING_TAG,
          title: `${segment} — ${input.labels.paused}`,
          body: `${input.labels.remaining} ${minutesLeft} ${input.labels.minutesShort}${presetLabel}`,
          ongoing: true,
          actionTypeId: CAULDRON_ACTION_PAUSED,
          actions: [
            { id: CAULDRON_ACTION_RESUME, title: input.labels.resume },
            { id: CAULDRON_ACTION_STOP, title: input.labels.stop },
          ],
        },
      ],
    };
  }

  // `targetEndTime <= now` es un segmento que ya venció y todavía no se procesó:
  // programarlo dispararía el aviso al instante (y otra vez en el próximo tick).
  // Solo aplica al caso corriendo — en pausa no hay alarma que pueda vencer.
  if (input.targetEndTime <= input.now) return base;

  const end = cauldronEndMessage(input.end, input.labels);

  const schedule: ScheduledNotification[] = [
    // El aviso de fin NO lleva botones: cuando suena, el segmento terminó y
    // «Pausar» o «Reanudar» ya no significan nada.
    { tag: CAULDRON_END_TAG, title: end.title, body: end.body, at: input.targetEndTime },
    {
      tag: CAULDRON_ONGOING_TAG,
      title: `${segment} — ${cycleInfo}`,
      body: `${input.labels.endsAt} ${clockTime(input.targetEndTime)}${presetLabel}`,
      ongoing: true,
      actionTypeId: CAULDRON_ACTION_RUNNING,
      actions: [
        { id: CAULDRON_ACTION_PAUSE, title: input.labels.pause },
        { id: CAULDRON_ACTION_STOP, title: input.labels.stop },
      ],
    },
  ];
  return { ...base, schedule };
}

// ─── Hábitos ────────────────────────────────────────────────

/** 'YYYY-MM-DD' local (mismo criterio que el resto del motor). */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mediodía del día `offset` respecto de `from`: inmune a los saltos de DST. */
function dayAt(from: Date, offset: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, 12, 0, 0, 0);
}

/** 'HH:MM' → epoch ms de ese momento en el día de `day`. NaN si el texto no sirve. */
function atTimeOn(day: Date, hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return Number.NaN;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min, 0, 0).getTime();
}

export interface HabitPlanInput {
  /** Questify + el toggle del recordatorio diario, ya combinados. */
  enabled: boolean;
  /** 'HH:MM' local. */
  reminderTime: string;
  now: Date;
  horizonDays?: number;
}

/**
 * Un recordatorio por día, para hoy y los próximos días, en los días en que
 * algún hábito pediría un check.
 *
 * La cuenta de "¿queda algo pendiente?" NO se reimplementa acá: es
 * `habitsPendingToday`, la misma que usan el motor y el auto-resolve. Ya hubo
 * TRES copias de esta pregunta en el repo y las tres se desincronizaron.
 *
 * El día de HOY solo entra si la hora del recordatorio todavía no pasó: un
 * `at` vencido lo dispara el plugin en el acto y sería el duplicado del aviso
 * que ya salió a las 21:00.
 */
export function planHabitNotifications(db: SqlDatabase, input: HabitPlanInput): NotificationPlan {
  const horizon = input.horizonDays ?? HABIT_HORIZON_DAYS;
  // Se gobierna también el día de ayer: si el recordatorio de ayer nunca llegó a
  // dispararse (app cerrada al cambiar la hora), su alarma sigue pendiente y hay
  // que retirarla, no dejarla sonar mañana con el texto de anteayer.
  const owned: string[] = [];
  for (let offset = -1; offset <= horizon; offset++) {
    owned.push(habitTagFor(localDate(dayAt(input.now, offset))));
  }

  const base: NotificationPlan = { scope: HABITS_SCOPE, owned, schedule: [] };
  if (!input.enabled) return base;

  const nowMs = input.now.getTime();
  const message = habitReminderMessage();
  const schedule: ScheduledNotification[] = [];

  for (let offset = 0; offset <= horizon; offset++) {
    const day = dayAt(input.now, offset);
    const at = atTimeOn(day, input.reminderTime);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    if (habitsPendingToday(db, day) === 0) continue;
    schedule.push({ tag: habitTagFor(localDate(day)), title: message.title, body: message.body, at });
  }

  return { ...base, schedule };
}

// ─── Despacho ───────────────────────────────────────────────

/**
 * ¿Puede esta plataforma entregar avisos con la app cerrada?
 *
 * Es la ausencia del método en el port lo que responde que no: en Electron el
 * proceso principal nunca se congela y sus notificaciones salen por `notify()`,
 * así que ni el plan se calcula (y `computeHabits` × 8 días no se corre por
 * cada check de hábito en escritorio).
 */
export function schedulingSupported(): boolean {
  return typeof platformOrNull()?.applyNotificationPlan === 'function';
}

/** Manda el plan al host. Fire-and-forget: un aviso no vale tumbar un handler. */
export function pushPlan(plan: NotificationPlan): void {
  const port = platformOrNull();
  if (!port?.applyNotificationPlan) return;
  try {
    void port.applyNotificationPlan(plan).catch((err) => {
      console.warn(`[notify-plan:${plan.scope}]`, err);
    });
  } catch (err) {
    console.warn(`[notify-plan:${plan.scope}]`, err);
  }
}

// ─── Configuración del recordatorio de hábitos ──────────────
//
// Vive acá y no en `notifications.ipc.ts` por una razón concreta: quien más
// tiene que reprogramar es `quests.ipc.ts` (marcar un hábito apaga su
// recordatorio), y colgarlo de un módulo hoja evita que Questify tenga que
// importar el módulo de notificaciones entero.

let habitReminderEnabled = true;
let habitReminderTime = '21:00';
/** El toggle de Ajustes → Notificaciones → Questify. */
let questsNotificationsEnabled = true;

export function getHabitReminderConfig(): { enabled: boolean; time: string } {
  return { enabled: habitReminderEnabled, time: habitReminderTime };
}

export function setHabitReminderConfig(enabled: boolean, time?: string): void {
  habitReminderEnabled = enabled;
  if (time) habitReminderTime = time;
  syncHabitSchedule();
}

export function setQuestsNotificationsEnabled(enabled: boolean): void {
  questsNotificationsEnabled = enabled;
  syncHabitSchedule();
}

/** Solo tests: el estado es de módulo y se arrastra entre casos. */
export function resetHabitReminderConfig(): void {
  habitReminderEnabled = true;
  habitReminderTime = '21:00';
  questsNotificationsEnabled = true;
}

/**
 * Recalcula y reprograma los recordatorios de hábitos. Se llama desde todo lo
 * que puede cambiar la respuesta: marcar/saltear un hábito, crear/editar/borrar
 * uno, cambiar la hora o el idioma, y el arranque.
 */
export function syncHabitSchedule(now: Date = new Date()): void {
  if (!schedulingSupported()) return;
  try {
    pushPlan(
      planHabitNotifications(getDb(), {
        enabled: habitReminderEnabled && questsNotificationsEnabled,
        reminderTime: habitReminderTime,
        now,
      }),
    );
  } catch (err) {
    // Sin DB (suspendida, o antes de las migraciones) no hay nada que planificar.
    console.warn('[notify-plan:habits]', err);
  }
}
