import { normalizeDescription } from './normalize';

/**
 * Los atajos de "esto ya lo comí": un toque, cero red.
 *
 * El widget del hub era la superficie más usada para registrar y siempre pegaba
 * a la Cloud Function (35 s de timeout), incluso para el café de todos los
 * días. Los favoritos y las frecuentes sólo existían dentro de `/nutrition`, a
 * un cambio de ruta de distancia.
 */

export interface QuickMealSource {
  /** Favoritos: elección explícita del usuario. Frecuentes: derivadas del log. */
  kind: 'favorite' | 'frequent';
  key: string;
  description: string;
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  aiBreakdown?: string | null;
  /** Sólo las frecuentes: para poder contar el uso al registrarlas. */
  frequentId?: number;
}

/** Cuántos atajos entran en una tarjeta del tablero sin romper la grilla. */
export const QUICK_MEAL_LIMIT = 4;

export interface FavoriteLike {
  id: string; description: string; calories: number;
  proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
  aiBreakdown?: string | null;
}

export interface FrequentLike {
  id: number; name: string; calories: number; timesUsed: number;
  proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
}

/**
 * Favoritos primero (el usuario los eligió a mano), después las frecuentes por
 * uso. Se deduplica por descripción normalizada: la misma milanesa guardada
 * como favorita y contada como frecuente es UN atajo, no dos.
 */
export function pickQuickMeals(
  favorites: FavoriteLike[],
  frequents: FrequentLike[],
  limit: number = QUICK_MEAL_LIMIT,
): QuickMealSource[] {
  const out: QuickMealSource[] = [];
  const seen = new Set<string>();
  // Un main viejo (o el que no expone el canal) contesta null. Los atajos son
  // un extra: su ausencia no puede tumbar la carga entera del widget.
  if (!Array.isArray(favorites)) favorites = [];
  if (!Array.isArray(frequents)) frequents = [];

  const push = (meal: QuickMealSource, name: string) => {
    const norm = normalizeDescription(name);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(meal);
  };

  for (const f of favorites) {
    if (out.length >= limit) break;
    push({
      kind: 'favorite', key: `fav-${f.id}`, description: f.description, calories: f.calories,
      proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, aiBreakdown: f.aiBreakdown ?? null,
    }, f.description);
  }

  const byUse = [...frequents].sort((a, b) => b.timesUsed - a.timesUsed
    || a.name.localeCompare(b.name));
  for (const f of byUse) {
    if (out.length >= limit) break;
    push({
      kind: 'frequent', key: `freq-${f.id}`, description: f.name, calories: f.calories,
      proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, frequentId: f.id,
    }, f.name);
  }

  return out.slice(0, limit);
}
