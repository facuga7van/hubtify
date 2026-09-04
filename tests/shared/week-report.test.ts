import { describe, it, expect } from 'vitest';
import { mondayOfWeek, weekEndOf, countCompliantDays, weeklyXp, WEEK_DAYS, WEEKLY_XP_CAP } from '../../shared/week-report';
import type { ClosedDayRow } from '../../shared/week-report';

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

  it('una fecha late en diciembre cuyo lunes cae en el mismo año', () => {
    expect(mondayOfWeek('2025-12-31')).toBe('2025-12-29');
  });

  it('un domingo en enero temprano cuyo lunes cae en el año anterior', () => {
    expect(mondayOfWeek('2026-01-04')).toBe('2025-12-29');
  });

  it('el día bisiesto (29 de febrero) obtiene el lunes correcto', () => {
    expect(mondayOfWeek('2024-02-29')).toBe('2024-02-26');
  });

  it('weekEndOf devuelve el domingo', () => {
    expect(weekEndOf('2026-08-31')).toBe('2026-09-06');
  });
});

/** Día que cumple en déficit: consumido por debajo del objetivo. */
const ok = (date: string): ClosedDayRow => ({ date, consumed: 1800, target: 1900 });
/** Día que no cumple: 30 % por encima. */
const bad = (date: string): ClosedDayRow => ({ date, consumed: 2470, target: 1900 });

describe('countCompliantDays', () => {
  it('cuenta solo los días que cumplen la banda del objetivo', () => {
    const rows = [ok('2026-08-31'), ok('2026-09-01'), bad('2026-09-02')];
    expect(countCompliantDays(rows, 500)).toBe(2);
  });

  it('un día sin consumo no cumple', () => {
    expect(countCompliantDays([{ date: '2026-08-31', consumed: 0, target: 1900 }], 500)).toBe(0);
  });
});

describe('weeklyXp — denominador SIEMPRE 7', () => {
  it('7 de 7 paga el techo de 50', () => {
    expect(weeklyXp(7)).toBe(50);
  });

  it('escala linealmente por debajo del pleno', () => {
    expect(weeklyXp(5)).toBe(29);
    expect(weeklyXp(4)).toBe(23);
    expect(weeklyXp(1)).toBe(6);
  });

  it('una semana sin días cumplidos paga 0', () => {
    expect(weeklyXp(0)).toBe(0);
  });

  it('el denominador es 7 y no la cantidad de días cerrados: 4/4 NO es pleno', () => {
    // Cerrar solo los cuatro días buenos no puede pagar lo mismo que cumplir siete.
    expect(weeklyXp(4)).toBe(23);
    expect(weeklyXp(4)).toBeLessThan(weeklyXp(7));
  });

  it('WEEK_DAYS es 7 y es el único denominador', () => {
    expect(WEEK_DAYS).toBe(7);
  });

  // `WEEKLY_XP_CAP` no tenía ningún llamador: el 50 de `weeklyXp` coincidía con
  // el 50 del export por coincidencia aritmética, no porque el código los atara.
  // Este test es lo que los ata: si alguien cambia el 40 o el +10 del bonus sin
  // tocar `WEEKLY_XP_CAP`, o viceversa, algo de esto rompe.
  it('una semana perfecta paga exactamente el techo declarado', () => {
    expect(weeklyXp(WEEK_DAYS)).toBe(WEEKLY_XP_CAP);
  });

  it('ninguna cantidad de días cumplidos supera el techo declarado', () => {
    for (let n = 0; n <= 7; n++) {
      expect(weeklyXp(n)).toBeLessThanOrEqual(WEEKLY_XP_CAP);
    }
  });
});
