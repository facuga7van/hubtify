/**
 * Puente del renderer al pergamino semanal.
 *
 * El reparto espeja `closeNutritionDay` (src/hub/codex/nutritionClose.ts): el
 * handler sella y devuelve el veredicto, y el renderer emite el evento RPG.
 */
import type { WeekReport } from '../../../shared/week-report';

export interface SealResult {
  report: WeekReport;
  /** Lo que el motor PAGÓ. Es lo único que puede mostrar el toast. */
  xpGained: number;
}

/**
 * Sella la semana y cobra el bonus.
 *
 * `weekStart` del payload sale de `report.weekStart`, NUNCA de un
 * `getMondayOfWeek()` local: el renderer corre con el reloj de pared, y a la
 * 01:00 del lunes derivaría un lunes distinto al de la fila recién sellada. Eso
 * es peor que pagar 0 — escribe el pago en el balde equivocado y rompe la
 * unicidad por semana en las dos direcciones.
 *
 * `payload.xp` es obligatorio: no hay entrada de WEEK_SUMMARY en
 * DEFAULT_EVENT_XP, así que omitirlo paga 0 en silencio.
 */
export async function sealWeek(weekStart: string): Promise<SealResult | null> {
  const res = await window.api.nutritionCloseWeek(weekStart);
  if (!res?.success) return null;

  const { report } = res;
  const rpg = await window.api.processRpgEvent({
    type: 'WEEK_SUMMARY',
    moduleId: 'nutrition',
    payload: { xp: report.xpTotal, hp: 0, weekStart: report.weekStart },
    timestamp: Date.now(),
  });

  return { report, xpGained: rpg?.xpGained ?? 0 };
}
