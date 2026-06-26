import { describe, it, expect } from 'vitest';
import { parseQuickTask } from '@modules/quests/parseQuickTask';

// Thursday 2026-01-01 (getDay() === 4) — fixed anchor for deterministic assertions.
const NOW = new Date('2026-01-01T12:00:00');
const p = (s: string) => parseQuickTask(s, NOW);

describe('parseQuickTask — relative dates', () => {
  it('parses "mañana"', () => {
    expect(p('Comprar pan mañana')).toEqual({ cleanName: 'Comprar pan', dueDate: '2026-01-02', matchedText: 'mañana' });
  });

  it('parses "pasado mañana" before "mañana"', () => {
    expect(p('Pagar luz pasado mañana').dueDate).toBe('2026-01-03');
  });

  it('parses "hoy"', () => {
    expect(p('Llamar a Juan hoy').dueDate).toBe('2026-01-01');
  });

  it('parses "en N días"', () => {
    expect(p('Entregar informe en 3 días').dueDate).toBe('2026-01-04');
    expect(p('Entregar informe en 3 días').cleanName).toBe('Entregar informe');
  });

  it('parses "en una semana" and "en N semanas"', () => {
    expect(p('Revisar en una semana').dueDate).toBe('2026-01-08');
    expect(p('Planificar en 2 semanas').dueDate).toBe('2026-01-15');
  });

  it('parses "la semana que viene"', () => {
    expect(p('Reunión la semana que viene').dueDate).toBe('2026-01-08');
  });

  it('accepts the form without diacritic ("manana")', () => {
    expect(p('Comprar pan manana').dueDate).toBe('2026-01-02');
  });
});

describe('parseQuickTask — weekdays', () => {
  it('resolves the next occurrence of a weekday', () => {
    expect(p('Gimnasio el lunes').dueDate).toBe('2026-01-05');   // Thu → next Mon
    expect(p('Médico el viernes').dueDate).toBe('2026-01-02');   // Thu → tomorrow Fri
  });

  it('same weekday resolves to next week, not today', () => {
    expect(p('Cita el jueves').dueDate).toBe('2026-01-08');
  });

  it('handles accents and "que viene"', () => {
    expect(p('Examen el miércoles').dueDate).toBe('2026-01-07');
    expect(p('Asado el sábado').dueDate).toBe('2026-01-03');
    expect(p('Pago lunes que viene').dueDate).toBe('2026-01-05');
  });
});

describe('parseQuickTask — time suffix and clean name', () => {
  it('strips a trailing time but keeps the date', () => {
    expect(p('Comprar pan mañana 17h')).toEqual({ cleanName: 'Comprar pan', dueDate: '2026-01-02', matchedText: 'mañana 17h' });
    expect(p('Turno el lunes a las 5pm').dueDate).toBe('2026-01-05');
  });
});

describe('parseQuickTask — no false positives', () => {
  it('ignores a date word that is not at the end', () => {
    expect(p('Mañana es otro día')).toEqual({ cleanName: 'Mañana es otro día', dueDate: null, matchedText: null });
  });

  it('does not match inside another word', () => {
    expect(p('Tapar el hoyo').dueDate).toBeNull();
  });

  it('does not strip when the date phrase is the whole text', () => {
    expect(p('mañana')).toEqual({ cleanName: 'mañana', dueDate: null, matchedText: null });
  });

  it('returns a clean no-match for empty input', () => {
    expect(p('')).toEqual({ cleanName: '', dueDate: null, matchedText: null });
  });
});
