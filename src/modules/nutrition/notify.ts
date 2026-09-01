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
