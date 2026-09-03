/**
 * Layout schedules the debounced cloud push on `nutrition:dataChanged` — and
 * until now nobody dispatched it. Mutations that pay XP were rescued by
 * `rpg:statsChanged`, but a deleted meal, a moved meal, a weigh-in, a profile
 * edit or a reopened day stayed local until the next unrelated push, and the
 * other device could merge the stale row straight back.
 *
 * One helper, called after every successful Nutrify write, so a new call site
 * cannot forget the event name.
 */
export const NUTRITION_DATA_CHANGED_EVENT = 'nutrition:dataChanged';

export function notifyNutritionChanged(): void {
  window.dispatchEvent(new Event(NUTRITION_DATA_CHANGED_EVENT));
}

/**
 * El cierre de la jornada dejó de vivir en `/nutrition`: ahora lo hace el
 * Códice, junto al sello (un solo ritual). La página de Nutrify tiene que
 * enterarse para pasar a solo lectura sin recargar — que es exactamente lo que
 * arregló NUT-02 cuando el cierre era local.
 *
 * Evento propio, no `nutrition:dataChanged`: Today.tsx dispara ese último tras
 * cada escritura suya y escucharlo la haría recargarse a sí misma.
 */
export const NUTRITION_DAY_CLOSED_EVENT = 'nutrition:dayClosed';

export function notifyNutritionDayClosed(): void {
  window.dispatchEvent(new Event(NUTRITION_DAY_CLOSED_EVENT));
}
