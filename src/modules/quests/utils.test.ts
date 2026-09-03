import { describe, it, expect } from 'vitest';
import { tierXp, bonusMultiplierToTier, getDueDateStatus, bucketTodayTasks, UNDATED_TODAY_LIMIT } from './utils';
import type { Task } from './types';

describe('tierXp', () => {
  it('quick tier returns 5', () => {
    expect(tierXp(1)).toBe(5);
  });
  it('normal tier returns 15', () => {
    expect(tierXp(2)).toBe(15);
  });
  it('epic tier returns 40', () => {
    expect(tierXp(3)).toBe(40);
  });
  it('unknown tier defaults to 15', () => {
    expect(tierXp(99)).toBe(15);
  });
});

describe('bonusMultiplierToTier', () => {
  it('maps the multipliers the main-process rpg engine returns', () => {
    expect(bonusMultiplierToTier(1.0)).toBe('normal');
    expect(bonusMultiplierToTier(1.5)).toBe('good');
    expect(bonusMultiplierToTier(2.0)).toBe('critical');
    expect(bonusMultiplierToTier(3.0)).toBe('legendary');
  });
  it('rounds down to the nearest tier', () => {
    expect(bonusMultiplierToTier(1.4)).toBe('normal');
    expect(bonusMultiplierToTier(1.9)).toBe('good');
    expect(bonusMultiplierToTier(2.5)).toBe('critical');
  });
});

describe('getDueDateStatus', () => {
  const dayOffset = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('en-CA');
  };

  it('classifies bare dates', () => {
    expect(getDueDateStatus(dayOffset(-1))).toBe('overdue');
    expect(getDueDateStatus(dayOffset(0))).toBe('today');
    expect(getDueDateStatus(dayOffset(3))).toBe('this-week');
    expect(getDueDateStatus(dayOffset(30))).toBe('later');
  });

  // A due date carrying a time used to build 'YYYY-MM-DDT09:00T00:00:00' —
  // Invalid Date — and every timed quest was quietly filed under "later".
  it('classifies dates that carry a time exactly like bare ones', () => {
    expect(getDueDateStatus(`${dayOffset(-1)}T09:00`)).toBe('overdue');
    expect(getDueDateStatus(`${dayOffset(0)}T23:59`)).toBe('today');
    expect(getDueDateStatus(`${dayOffset(3)}T09:00`)).toBe('this-week');
    expect(getDueDateStatus(`${dayOffset(30)}T09:00`)).toBe('later');
  });
});

describe('bucketTodayTasks', () => {
  const dayOffset = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('en-CA');
  };

  const task = (over: Partial<Task> & { id: string }): Task => ({
    name: over.id, description: '', status: false, tier: 2, category: '',
    projectId: null, dueDate: null, order: 0, completedAt: null,
    createdAt: '', updatedAt: '', ...over,
  } as Task);

  it('leaves completed tasks out of every bucket', () => {
    const result = bucketTodayTasks([
      task({ id: 'a', status: true, dueDate: dayOffset(0) }),
      task({ id: 'b', status: true }),
    ]);
    expect(result.overdue).toHaveLength(0);
    expect(result.today).toHaveLength(0);
    expect(result.undated).toHaveLength(0);
    expect(result.undatedTotal).toBe(0);
  });

  it('splits overdue, today and undated', () => {
    const result = bucketTodayTasks([
      task({ id: 'late', dueDate: dayOffset(-2) }),
      task({ id: 'now', dueDate: dayOffset(0) }),
      task({ id: 'later', dueDate: dayOffset(5) }),
      task({ id: 'free' }),
    ]);
    expect(result.overdue.map((x) => x.id)).toEqual(['late']);
    expect(result.today.map((x) => x.id)).toEqual(['now']);
    expect(result.undated.map((x) => x.id)).toEqual(['free']);
  });

  // The real database has 67 of 68 quests with no due date. Dumping all of them
  // into the execution list would turn "Hoy" into the backlog it is not.
  it('caps the undated bucket but reports the true total', () => {
    const many = Array.from({ length: UNDATED_TODAY_LIMIT + 4 }, (_, i) =>
      task({ id: `u${i}`, order: i }));
    const result = bucketTodayTasks(many);
    expect(result.undated).toHaveLength(UNDATED_TODAY_LIMIT);
    expect(result.undatedTotal).toBe(UNDATED_TODAY_LIMIT + 4);
    expect(result.undated[0].id).toBe('u0');
  });

  it('sorts undated by order, so the manual ranking survives', () => {
    const result = bucketTodayTasks([
      task({ id: 'c', order: 30 }),
      task({ id: 'a', order: 10 }),
      task({ id: 'b', order: 20 }),
    ]);
    expect(result.undated.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders today by clock time first, then by manual order', () => {
    const d = dayOffset(0);
    const result = bucketTodayTasks([
      task({ id: 'noon', dueDate: `${d}T12:00` }),
      task({ id: 'plain', dueDate: d, order: 1 }),
      task({ id: 'dawn', dueDate: `${d}T07:30` }),
      task({ id: 'plain2', dueDate: d, order: 0 }),
    ]);
    expect(result.today.map((x) => x.id)).toEqual(['dawn', 'noon', 'plain2', 'plain']);
  });

  it('orders overdue oldest first', () => {
    const result = bucketTodayTasks([
      task({ id: 'yesterday', dueDate: dayOffset(-1) }),
      task({ id: 'ancient', dueDate: dayOffset(-9) }),
    ]);
    expect(result.overdue.map((x) => x.id)).toEqual(['ancient', 'yesterday']);
  });
});
