/**
 * Cálculo puro del pergamino semanal. Sin DB, sin IO, sin reloj.
 *
 * El lunes ancla en T12:00:00 y no en T00:00:00 como `getMondayOfWeek`
 * (shared/date-utils.ts:43): acá es PRIMARY KEY de una tabla, y un cambio de
 * horario a medianoche podría correr la frontera de una semana entera.
 */

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
