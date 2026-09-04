/**
 * Puente del renderer al pergamino semanal.
 *
 * El reparto espeja `closeNutritionDay` (src/hub/codex/nutritionClose.ts): el
 * handler sella y devuelve el veredicto, y el renderer emite el evento RPG.
 */
import type { WeekReport, CloseWeekError } from '../../../shared/week-report';

/**
 * Veredicto de `sealWeek`. Tres estados, no dos:
 * - `ok: true, rpgFailed: false` → sellada y acreditada; `xpGained` es lo que PAGÓ el motor.
 * - `ok: true, rpgFailed: true`  → sellada, pero `processRpgEvent` tiró; `xpGained` es 0.
 * - `ok: false`                  → no se selló; `error` dice por qué.
 */
export type SealOutcome =
  | { ok: true; report: WeekReport; xpGained: number; rpgFailed: boolean }
  | { ok: false; error: CloseWeekError };

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
export async function sealWeek(weekStart: string): Promise<SealOutcome> {
  const res = await window.api.nutritionCloseWeek(weekStart);
  if (!res?.success) return { ok: false, error: res.error };

  const { report } = res;

  // El sello de `nutritionCloseWeek` YA se commiteó acá arriba y no hay
  // `reopenWeek`: es irreversible. Si `processRpgEvent` tira (IPC caído, error
  // en el main process), la semana igual quedó sellada — perder ese hecho en
  // una excepción sin capturar dejaría al caller sin `report` y sin forma de
  // reintentar (una segunda llamada pega contra "Already closed" antes de
  // volver a intentar el pago). Por eso se degrada a `rpgFailed: true` en vez
  // de propagar el throw.
  try {
    const rpg = await window.api.processRpgEvent({
      type: 'WEEK_SUMMARY',
      moduleId: 'nutrition',
      payload: { xp: report.xpTotal, hp: 0, weekStart: report.weekStart },
      timestamp: Date.now(),
    });
    return { ok: true, report, xpGained: rpg?.xpGained ?? 0, rpgFailed: false };
  } catch {
    return { ok: true, report, xpGained: 0, rpgFailed: true };
  }
}
