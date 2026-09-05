/**
 * El cierre de la jornada de comidas, desde el Códice.
 *
 * Había DOS rituales de cierre que pagaban XP por separado y no se mencionaban
 * entre sí: el sello del Códice (anunciado en el brief y en la barra) y el
 * cierre de Nutrify (nunca anunciado, escondido en un footer sticky de
 * `/nutrition`). En la base real: 6 cierres de Nutrify contra 1 sello.
 *
 * Se unifican SIN tocar un solo dato ya otorgado: los dos backends ya son
 * idempotentes por su cuenta (`nutrition:closeDay` responde `alreadyClosed`,
 * `rpg:sealDay` responde `already_sealed`), así que el Códice puede encadenar
 * los dos pasos sin riesgo de pagar dos veces ni de quitar nada. No hace falta
 * migración: nada se reescribe.
 */

/**
 * Lo que el cierre dejó anotado.
 *
 * `xpTotal` es el XP CRUDO del desglose de Nutrify (lo que va en el payload).
 * `xpGained` es lo que el motor pagó de verdad: el crudo pasado por combo,
 * bonus y milestone (`DAY_SUMMARY` no es un evento flat). Es el número que el
 * ledger va a mostrar al reabrir la página, así que es el que se pinta hoy.
 */
export interface NutritionCloseBreakdown {
  xpTotal: number;
  hpChange: number;
  xpGained: number;
}

/**
 * 'Pasos' viene de un input de texto. Vacío = sin dato (NULL en la columna),
 * que es distinto de cero y el handler lo acepta explícitamente. Cualquier cosa
 * que no sea un entero >= 0 se trata como sin dato antes que hacer fallar el
 * cierre entero por un carácter suelto.
 */
export function parseSteps(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** True si este main expone el cierre de nutrición. */
export function nutritionCloseApiReady(): boolean {
  const api = window.api as unknown as Record<string, unknown> | undefined;
  return !!api
    && typeof api.nutritionCloseDay === 'function'
    && typeof api.nutritionIsDayClosed === 'function'
    && typeof api.nutritionSaveDailyMetrics === 'function';
}

export async function isNutritionDayClosed(date: string): Promise<boolean> {
  if (!nutritionCloseApiReady()) return false;
  try {
    return !!(await window.api.nutritionIsDayClosed(date));
  } catch {
    return false;
  }
}

/** Pasos y gimnasio ya guardados para ese día, para precargar el formulario. */
export async function readDayMetrics(date: string): Promise<{ steps: string; gym: boolean }> {
  try {
    const row = await window.api.nutritionGetDailyMetrics(date) as { steps?: number | null; gym?: number | boolean } | null;
    return {
      steps: row?.steps != null ? String(row.steps) : '',
      gym: !!row?.gym,
    };
  } catch {
    return { steps: '', gym: false };
  }
}

/**
 * Guarda métricas, cierra el día y paga el XP de nutrición.
 *
 * Devuelve null si el día ya estaba cerrado — ese es justamente el guard que
 * hace seguro encadenar esto al sello: un día ya pagado no vuelve a pagar.
 */
export async function closeNutritionDay(
  date: string,
  steps: string,
  gym: boolean,
): Promise<NutritionCloseBreakdown | null> {
  await window.api.nutritionSaveDailyMetrics({ date, steps: parseSteps(steps), gym });
  const result = await window.api.nutritionCloseDay(date);
  if (!result?.success || !result.breakdown) return null;

  const b = result.breakdown as { xpTotal?: number; hpChange?: number; xpBonus?: number; xpWeight?: number };
  const xp = b.xpTotal ?? 0;
  const hp = b.hpChange ?? 0;
  // `date` es lo que DAY_REOPENED usa para revertir exactamente este evento.
  // `onTarget`/`weighed` son para los logros: `xpBonus` solo paga si el día
  // cumplió el objetivo (meal-utils `scoreNutritionDay`), `xpWeight` si se pesó.
  const paid = await window.api.processRpgEvent({
    type: 'DAY_SUMMARY',
    moduleId: 'nutrition',
    payload: { xp, hp, date, onTarget: (b.xpBonus ?? 0) > 0, weighed: (b.xpWeight ?? 0) > 0 },
    timestamp: Date.now(),
  });
  // Un main que no devuelva el resultado (stub, versión vieja) no puede dejar
  // la fila en NaN: se cae al crudo, que es lo que había hasta hoy.
  const xpGained = typeof paid?.xpGained === 'number' && Number.isFinite(paid.xpGained) ? paid.xpGained : xp;
  return { xpTotal: xp, hpChange: hp, xpGained };
}
