/**
 * Renderer-side access to `nutrition:getEventDays` (fase 3, modo evento).
 *
 * Igual que history-api.ts: el preload y `shared/types.ts` se cablean por fuera
 * de este cambio, así que `window.api` todavía no declara el método. El cast
 * vive acá una sola vez y la UI degrada — sin fechas de evento, el heatmap
 * simplemente no distingue los asados, no se rompe.
 */
interface NutritionEventApi {
  nutritionGetEventDays: (start: string, end: string) => Promise<string[]>;
}

/** Fechas YYYY-MM-DD con al menos un evento vivo en el rango, o [] si el bridge no llegó. */
export async function getEventDays(start: string, end: string): Promise<string[]> {
  const fn = (window.api as unknown as Partial<NutritionEventApi>).nutritionGetEventDays;
  if (typeof fn !== 'function') return [];
  try {
    return (await fn(start, end)) ?? [];
  } catch (err) {
    // Un heatmap sin marcas de evento es mejor que un heatmap que no carga.
    console.error('[Nutrition] getEventDays failed', err);
    return [];
  }
}
