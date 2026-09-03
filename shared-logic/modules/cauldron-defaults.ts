import type { SqlDatabase } from '../db';

/**
 * Con qué receta arranca el caldero cuando nadie eligió — sacado del historial.
 *
 * Evidencia de la base real del usuario (copia read-only, solo agregados): 41
 * sesiones, **30 de una receta propia** y 11 de `preset-classic`; sobre las
 * últimas 20, 16 contra 4. Pero `cauldron:getPresets` ordena
 * `is_default DESC, name ASC`, así que el `p[0]` que usaban la página y el
 * widget era SIEMPRE «Classic» y las recetas propias quedaban al final de la
 * lista: el default era, medido, el valor menos frecuente de la base.
 *
 * El renderer ya recuerda la última receta en `localStorage`
 * (`hubtify_cauldron_last_preset`), pero eso no cruza de la compu al teléfono ni
 * sobrevive a una instalación nueva. Esto es el mismo dato, leído del historial
 * que SÍ sincroniza.
 *
 * Se devuelve la ÚLTIMA usada y no la MÁS usada a propósito: es la definición
 * literal de la banda alta del criterio («el default es el último valor usado»),
 * y es la misma regla que aplica `quickStartPresetId` en el renderer. Dos
 * respuestas distintas para la misma pregunta harían que la compu y el teléfono
 * discrepen sobre qué es «el default».
 */

export interface CauldronPresetDefault {
  presetId: string | null;
  /** Sesiones utilizables detrás de la respuesta — 0 = no hay de dónde inferir. */
  sampleSize: number;
}

export function getLastUsedPresetId(db: SqlDatabase): CauldronPresetDefault {
  /*
   * El JOIN descarta las sesiones cuya receta ya no existe: se puede borrar una
   * receta (local o por sync) y las sesiones quedan en el estante para siempre.
   * Proponer ese id dejaría el select en blanco y `cauldron:start` tiraría
   * «Preset not found».
   */
  const rows = db.prepare(`
    SELECT s.preset_id AS presetId
    FROM cauldron_sessions s
    JOIN cauldron_presets p ON p.id = s.preset_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.preset_id IS NOT NULL
    ORDER BY s.started_at DESC
  `).all() as Array<{ presetId: string | null }>;

  const usable = rows.filter((r): r is { presetId: string } => typeof r.presetId === 'string' && r.presetId !== '');
  if (usable.length === 0) return { presetId: null, sampleSize: 0 };
  return { presetId: usable[0].presetId, sampleSize: usable.length };
}
