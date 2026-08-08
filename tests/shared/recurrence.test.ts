import { describe, it, expect } from 'vitest';
import {
  parseRecurrenceRule,
  buildRecurrenceRule,
  computeNextDue,
  instanceId,
  recurrenceLabel,
} from '../../shared/recurrence';

describe('parseRecurrenceRule', () => {
  it('parses a bare FREQ', () => {
    expect(parseRecurrenceRule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1 });
  });
  it('parses FREQ with INTERVAL', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2')).toEqual({ freq: 'WEEKLY', interval: 2 });
    expect(parseRecurrenceRule('FREQ=MONTHLY;INTERVAL=3')).toEqual({ freq: 'MONTHLY', interval: 3 });
  });
  it('rejects empty, null, and invalid frequencies', () => {
    expect(parseRecurrenceRule('')).toBeNull();
    expect(parseRecurrenceRule(null)).toBeNull();
    expect(parseRecurrenceRule('FREQ=YEARLY')).toBeNull();
    expect(parseRecurrenceRule('INTERVAL=2')).toBeNull();
  });
});

describe('buildRecurrenceRule', () => {
  it('omits INTERVAL when 1', () => {
    expect(buildRecurrenceRule('DAILY')).toBe('FREQ=DAILY');
    expect(buildRecurrenceRule('WEEKLY', 2)).toBe('FREQ=WEEKLY;INTERVAL=2');
  });
  it('round-trips through the parser', () => {
    expect(parseRecurrenceRule(buildRecurrenceRule('MONTHLY', 3))).toEqual({ freq: 'MONTHLY', interval: 3 });
  });
});

describe('computeNextDue — fixed anchor', () => {
  const TODAY = '2026-01-10';

  it('advances daily/weekly from the current due', () => {
    expect(computeNextDue('FREQ=DAILY', 'fixed', '2026-01-10', '2026-01-10', TODAY)).toBe('2026-01-11');
    expect(computeNextDue('FREQ=WEEKLY', 'fixed', '2026-01-10', '2026-01-10', TODAY)).toBe('2026-01-17');
    expect(computeNextDue('FREQ=DAILY;INTERVAL=3', 'fixed', '2026-01-10', '2026-01-10', TODAY)).toBe('2026-01-13');
  });

  it('skips missed occurrences when completed late (no past pile-up)', () => {
    // Due was Jan 1, completed Jan 10 → next future daily occurrence is Jan 11, not Jan 2.
    expect(computeNextDue('FREQ=DAILY', 'fixed', '2026-01-01', '2026-01-10', TODAY)).toBe('2026-01-11');
  });

  it('clamps the day on monthly (Jan 31 → Feb 28 in a non-leap year)', () => {
    expect(computeNextDue('FREQ=MONTHLY', 'fixed', '2026-01-31', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
  });
});

describe('computeNextDue — completion anchor', () => {
  it('advances from the completion date, not the due date', () => {
    expect(computeNextDue('FREQ=DAILY;INTERVAL=3', 'completion', '2026-01-01', '2026-01-10')).toBe('2026-01-13');
    expect(computeNextDue('FREQ=MONTHLY', 'completion', null, '2026-01-15')).toBe('2026-02-15');
  });
});

describe('computeNextDue — invalid rule', () => {
  it('returns null', () => {
    expect(computeNextDue(null, 'fixed', '2026-01-10', '2026-01-10', '2026-01-10')).toBeNull();
  });
});

describe('instanceId', () => {
  it('is deterministic from parent + due date', () => {
    expect(instanceId('abc-123', '2026-01-10')).toBe('abc-123::2026-01-10');
  });
});

describe('recurrenceLabel', () => {
  it('renders Spanish labels', () => {
    expect(recurrenceLabel('FREQ=DAILY')).toBe('Cada día');
    expect(recurrenceLabel('FREQ=WEEKLY;INTERVAL=2')).toBe('Cada 2 semanas');
    expect(recurrenceLabel('FREQ=MONTHLY')).toBe('Cada mes');
    expect(recurrenceLabel(null)).toBeNull();
  });
});
