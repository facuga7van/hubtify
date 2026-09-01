import { describe, it, expect } from 'vitest';
import { nextStreak } from '../../shared/rpg-engine';

describe('nextStreak — one-day grace period', () => {
  it('starts at 1 when there is no prior activity', () => {
    expect(nextStreak(0, null, '2026-06-10')).toEqual({ streak: 1, saved: false });
  });

  it('leaves the streak unchanged on a second action the same day', () => {
    expect(nextStreak(7, '2026-06-10', '2026-06-10')).toEqual({ streak: 7, saved: false });
  });

  it('advances on a consecutive day', () => {
    expect(nextStreak(7, '2026-06-09', '2026-06-10')).toEqual({ streak: 8, saved: false });
  });

  it('survives a single missed day without advancing (grace)', () => {
    // Last activity two days ago → one day was missed → streak is saved, not reset.
    expect(nextStreak(7, '2026-06-08', '2026-06-10')).toEqual({ streak: 7, saved: true });
  });

  it('resets to 1 after two or more missed days', () => {
    expect(nextStreak(7, '2026-06-07', '2026-06-10')).toEqual({ streak: 1, saved: false });
    expect(nextStreak(50, '2026-05-10', '2026-06-10')).toEqual({ streak: 1, saved: false });
  });

  it('does not let day-by-day activity farm an infinite streak', () => {
    // Repeatedly acting every other day keeps the streak alive but never grows it.
    let streak = 5;
    let res = nextStreak(streak, '2026-06-08', '2026-06-10'); // diff 2 → saved
    expect(res).toEqual({ streak: 5, saved: true });
    streak = res.streak;
    res = nextStreak(streak, '2026-06-10', '2026-06-12'); // diff 2 again → still saved, still 5
    expect(res).toEqual({ streak: 5, saved: true });
  });

  it('does not flag saved when there was no real streak to protect', () => {
    // currentStreak 0 with a 2-day gap should reset, not falsely "save".
    expect(nextStreak(0, '2026-06-08', '2026-06-10')).toEqual({ streak: 1, saved: false });
  });
});
