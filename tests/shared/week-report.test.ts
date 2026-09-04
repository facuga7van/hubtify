import { describe, it, expect } from 'vitest';
import { mondayOfWeek, weekEndOf } from '../../shared/week-report';

describe('mondayOfWeek', () => {
  it('devuelve el lunes de la semana de un miércoles', () => {
    expect(mondayOfWeek('2026-09-02')).toBe('2026-08-31'); // mié → lun
  });

  it('un lunes se devuelve a sí mismo', () => {
    expect(mondayOfWeek('2026-08-31')).toBe('2026-08-31');
  });

  it('el domingo pertenece a la semana que termina, no a la que empieza', () => {
    expect(mondayOfWeek('2026-09-06')).toBe('2026-08-31'); // dom → lun anterior
  });

  it('weekEndOf devuelve el domingo', () => {
    expect(weekEndOf('2026-08-31')).toBe('2026-09-06');
  });
});
