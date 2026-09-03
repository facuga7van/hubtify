import { daysDiff } from '../../shared/rpg-engine';

/**
 * "Qué pasó mientras no estuviste".
 *
 * The real usage pattern is not daily: 14 active days in five months, with
 * holes of 6, 9, 40 and 54 days. Coming back, the dashboard said exactly the
 * same thing after one day away as after fifty, and nothing explained where
 * the streak went.
 *
 * The tone is not negotiable: C10 ("invita en vez de castigar") is the best
 * thing this app has. This block reports, it never reproaches — there is no
 * "volviste" scolding, no lost-progress framing, and the action it offers is
 * the smallest one available.
 */

/** Below this the ordinary brief already covers it; a card would be noise. */
export const RETURN_BRIEF_MIN_DAYS = 2;

export interface ReturnBrief {
  /** Whole days between the last recorded deed and today. */
  daysAway: number;
  /** The streak as it stands now — 0 means it lapsed while away. */
  streak: number;
  /** Quests whose date passed. Zero is a perfectly good answer. */
  overdueQuests: number;
  /** What the "pick it back up" button should do. */
  action: 'review-overdue' | 'create-quest';
}

export interface ReturnBriefInput {
  /** Local 'YYYY-MM-DD' of the most recent rpg event, or null if there is none. */
  lastEventDate: string | null;
  /** Local 'YYYY-MM-DD' of today. */
  today: string;
  streak: number;
  overdueQuests: number;
}

/**
 * Returns the brief, or null when there is nothing to explain: someone who was
 * here yesterday does not need a summary, and a brand-new account has no
 * absence to describe (that is the empty state's job, not this one's).
 */
export function buildReturnBrief({
  lastEventDate, today, streak, overdueQuests,
}: ReturnBriefInput): ReturnBrief | null {
  if (!lastEventDate) return null;

  const daysAway = daysDiff(lastEventDate, today);
  // A future stamp (clock skew, a device in another timezone) is not an
  // absence. Neither is a gap the ordinary brief already handles.
  if (!Number.isFinite(daysAway) || daysAway < RETURN_BRIEF_MIN_DAYS) return null;

  return {
    daysAway,
    streak,
    overdueQuests,
    action: overdueQuests > 0 ? 'review-overdue' : 'create-quest',
  };
}
