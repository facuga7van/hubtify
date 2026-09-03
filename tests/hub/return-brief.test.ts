import { describe, it, expect } from 'vitest';
import { buildReturnBrief, RETURN_BRIEF_MIN_DAYS } from '../../src/hub/return-brief';

const base = { today: '2026-09-03', streak: 0, overdueQuests: 0 };

describe('buildReturnBrief', () => {
  it('no dice nada sin historia: una cuenta nueva no tuvo ausencia', () => {
    expect(buildReturnBrief({ ...base, lastEventDate: null })).toBeNull();
  });

  it('no dice nada si estuviste ayer', () => {
    expect(buildReturnBrief({ ...base, lastEventDate: '2026-09-02' })).toBeNull();
    expect(buildReturnBrief({ ...base, lastEventDate: '2026-09-03' })).toBeNull();
  });

  it('aparece a partir de dos días, que es el hueco real medido', () => {
    expect(RETURN_BRIEF_MIN_DAYS).toBe(2);
    const brief = buildReturnBrief({ ...base, lastEventDate: '2026-09-01' });
    expect(brief).toMatchObject({ daysAway: 2 });
  });

  it('cuenta los días del hueco largo', () => {
    // El hueco mas grande de la base real: 54 dias.
    const brief = buildReturnBrief({ ...base, lastEventDate: '2026-07-11' });
    expect(brief?.daysAway).toBe(54);
  });

  it('propone repasar las vencidas cuando las hay', () => {
    const brief = buildReturnBrief({ ...base, lastEventDate: '2026-08-20', overdueQuests: 7 });
    expect(brief).toMatchObject({ overdueQuests: 7, action: 'review-overdue' });
  });

  it('propone anotar algo nuevo cuando no quedó nada vencido', () => {
    const brief = buildReturnBrief({ ...base, lastEventDate: '2026-08-20' });
    expect(brief?.action).toBe('create-quest');
  });

  it('reporta la racha tal cual está, sin juzgarla', () => {
    expect(buildReturnBrief({ ...base, lastEventDate: '2026-08-20', streak: 0 })?.streak).toBe(0);
    expect(buildReturnBrief({ ...base, lastEventDate: '2026-08-20', streak: 4 })?.streak).toBe(4);
  });

  // Un reloj adelantado en otro dispositivo no es una ausencia.
  it('ignora una fecha futura', () => {
    expect(buildReturnBrief({ ...base, lastEventDate: '2026-09-30' })).toBeNull();
  });
});
