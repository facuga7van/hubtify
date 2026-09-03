import { describe, it, expect } from 'vitest';
import { pickQuickMeals, QUICK_MEAL_LIMIT } from '@modules/nutrition/quick-meals';
import type { FavoriteLike, FrequentLike } from '@modules/nutrition/quick-meals';

const fav = (id: string, description: string, calories = 300): FavoriteLike =>
  ({ id, description, calories });
const freq = (id: number, name: string, timesUsed: number, calories = 200): FrequentLike =>
  ({ id, name, calories, timesUsed });

describe('pickQuickMeals', () => {
  it('sin nada guardado no ofrece atajos', () => {
    expect(pickQuickMeals([], [])).toEqual([]);
  });

  it('los favoritos van primero: el usuario los eligió a mano', () => {
    const picked = pickQuickMeals([fav('a', 'Ensalada')], [freq(1, 'Café', 30)]);
    expect(picked.map((m) => m.kind)).toEqual(['favorite', 'frequent']);
  });

  it('las frecuentes se ordenan por uso', () => {
    const picked = pickQuickMeals([], [
      freq(1, 'Tostadas', 2),
      freq(2, 'Café', 9),
      freq(3, 'Yogur', 5),
    ]);
    expect(picked.map((m) => m.description)).toEqual(['Café', 'Yogur', 'Tostadas']);
  });

  // La misma milanesa guardada como favorita Y contada como frecuente es UN
  // atajo. Dos botones idénticos serían dos formas de hacer lo mismo.
  it('deduplica por descripción normalizada, acentos incluidos', () => {
    const picked = pickQuickMeals([fav('a', 'Milanesa con puré')], [freq(1, 'MILANESA CON PURE', 8)]);
    expect(picked).toHaveLength(1);
    expect(picked[0].kind).toBe('favorite');
  });

  it('respeta el tope de la tarjeta', () => {
    const many = Array.from({ length: 12 }, (_, i) => freq(i, `Plato ${i}`, 12 - i));
    expect(pickQuickMeals([], many)).toHaveLength(QUICK_MEAL_LIMIT);
    expect(pickQuickMeals([], many, 2)).toHaveLength(2);
  });

  it('las frecuentes llevan su id, para poder contar el uso al registrarlas', () => {
    const [meal] = pickQuickMeals([], [freq(7, 'Café', 3)]);
    expect(meal).toMatchObject({ kind: 'frequent', frequentId: 7 });
  });

  it('descarta un nombre vacío en vez de ofrecer un botón sin texto', () => {
    expect(pickQuickMeals([fav('a', '   ')], [])).toEqual([]);
  });

  it('desempata las frecuentes por nombre, para que el orden no baile', () => {
    const picked = pickQuickMeals([], [freq(1, 'Zapallo', 4), freq(2, 'Arroz', 4)]);
    expect(picked.map((m) => m.description)).toEqual(['Arroz', 'Zapallo']);
  });
});

// Un main viejo contesta null; los atajos son un extra y su ausencia no puede
// tumbar la carga entera del widget (así se rompió el test del caché).
describe('pickQuickMeals — entradas que no son listas', () => {
  it('tolera null en cualquiera de los dos lados', () => {
    expect(pickQuickMeals(null as unknown as FavoriteLike[], null as unknown as FrequentLike[])).toEqual([]);
    expect(pickQuickMeals(null as unknown as FavoriteLike[], [freq(1, 'Café', 2)])).toHaveLength(1);
    expect(pickQuickMeals([fav('a', 'Té')], null as unknown as FrequentLike[])).toHaveLength(1);
  });
});
