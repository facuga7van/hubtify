/**
 * Cálculo puro del pergamino semanal. Sin DB, sin IO, sin reloj.
 *
 * El lunes ancla en T12:00:00 y no en T00:00:00 como `getMondayOfWeek`
 * (shared/date-utils.ts:43): acá es PRIMARY KEY de una tabla, y un cambio de
 * horario a medianoche podría correr la frontera de una semana entera.
 */

import { scoreNutritionDay } from './meal-utils';

function parseNoon(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}

function format(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** El lunes de la semana que contiene `dateStr`. Domingo = fin de semana, no inicio. */
export function mondayOfWeek(dateStr: string): string {
  const d = parseNoon(dateStr);
  const dow = d.getDay();              // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return format(d);
}

/** Desplaza una fecha YYYY-MM-DD por `days`, anclando al mediodía. */
export function shiftDay(dateStr: string, days: number): string {
  const d = parseNoon(dateStr);
  d.setDate(d.getDate() + days);
  return format(d);
}

/** El domingo de la semana que arranca en `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return shiftDay(weekStart, 6);
}

/** Una fila viva de `nutrition_daily_closed`, con consumo y objetivo congelados. */
export interface ClosedDayRow {
  date: string;
  consumed: number;
  target: number;
}

/**
 * El veredicto de una semana. Idéntico esté sellado o en vista previa.
 *
 * Vive acá y no en `shared/types.ts` porque una tarea posterior conecta esto a
 * `window.api` importándolo de este módulo — definirlo dos veces dejaría que
 * las dos copias diverjan en silencio.
 */
export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  daysClosed: number;
  daysCompliant: number;
  avgConsumed: number;
  avgTarget: number;
  weightStart: number | null;
  weightEnd: number | null;
  daysSteps: number;
  daysGym: number;
  streakEnd: number;
  xpTotal: number;
  sealed: boolean;
  closedAt: string | null;
}

/**
 * El denominador del cumplimiento semanal. SIEMPRE 7, nunca `days_closed`.
 *
 * Dividir por los días cerrados haría que cerrar únicamente los tres días que
 * salieron bien diera ratio 1.0 y el máximo. Con el denominador fijado por el
 * calendario, no cerrar un día simplemente cuesta y no queda nada que optimizar.
 */
export const WEEK_DAYS = 7;

/** Techo del bonus semanal, plano. ~12 % de una semana perfecta de cierres diarios. */
export const WEEKLY_XP_CAP = 50;

/**
 * Cuántos de los días cerrados cumplieron el objetivo.
 *
 * `consumed` y `target` vienen congelados de `nutrition_daily_closed`; el único
 * input vivo es `deficitTargetKcal`, que solo elige la banda (déficit / superávit
 * / mantenimiento). Al sellar, el resultado queda escrito y deja de depender de él.
 */
export function countCompliantDays(rows: ClosedDayRow[], deficitTargetKcal: number): number {
  return rows.filter(r => scoreNutritionDay(r.consumed, r.target, deficitTargetKcal).compliant).length;
}

/** Bonus de consistencia. 7/7 = 50; el +10 es exclusivo de la semana perfecta. */
export function weeklyXp(daysCompliant: number): number {
  const capped = Math.max(0, Math.min(WEEK_DAYS, daysCompliant));
  const base = Math.round(40 * capped / WEEK_DAYS);
  return base + (capped === WEEK_DAYS ? 10 : 0);
}

/**
 * Por qué `nutrition:closeWeek` NO selló. Extraído de `CloseWeekResult` para que
 * el bridge del renderer (`weekly-api.ts`) pueda propagarlo sin redefinirlo:
 * "Already closed" y "Waiting for weigh-in" son mensajes distintos y uno de
 * los dos es accionable (andá a pesarte).
 */
export type CloseWeekError =
  | 'Already closed'
  | 'No profile'
  | 'No closed days'
  | 'Week not finished'
  | 'Waiting for weigh-in';

/**
 * Resultado de `nutrition:closeWeek`. Vive acá junto a `WeekReport` por la misma
 * razón: `window.api` lo importa de este módulo, no lo redefine.
 */
export type CloseWeekResult =
  | { success: true; report: WeekReport }
  | { success: false; error: CloseWeekError };
