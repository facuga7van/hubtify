import { beforeEach, afterEach, vi } from 'vitest';

/**
 * Ancla el reloj al mediodía del día en curso, para las suites del motor RPG.
 *
 * Dos logros del catálogo miran la hora de pared: `early_bird` (un hecho antes
 * de las 06:00) y `night_owl` (después de las 23:00). Se disparan sobre
 * CUALQUIER evento que toque procesar, y suman 25 XP. Una suite que afirma XP
 * exacto sobre una base nueva pasa todo el día y se pone roja entre las 23:00 y
 * las 06:00 — que fue exactamente cómo cayó el CI a las 23:37, con
 * `expected 25 to be 0`.
 *
 * Se ancla la HORA pero se conserva el DÍA real: los helpers que calculan
 * fechas relativas («hace 3 días», la racha, el sello de ayer) siguen siendo
 * coherentes, y ninguna de las dos ventanas horarias queda en rango.
 *
 * Sólo se falsea `Date`: los temporizadores reales siguen andando, así que no
 * cambia el comportamiento de nada que espere.
 */
export function pinClockToNoon(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    vi.setSystemTime(noon);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
