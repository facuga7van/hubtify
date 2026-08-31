import { useCallback, useEffect, useState } from 'react';
import { useVisibleInterval } from '../../shared/hooks/useVisibleInterval';
import {
  CODEX_SEALED_EVENT,
  addDaysISO,
  codexApiReady,
  getDaySummary,
  isEveningNow,
  localDateISO,
} from './codexApi';

export interface SealInvite {
  /** Local YYYY-MM-DD the invitation would open. */
  date: string;
  /** Which day it is, so the copy can say "you left yesterday unsealed". */
  which: 'today' | 'yesterday';
  xpTotal: number;
  eventsCount: number;
}

interface State {
  /** The main process actually exposes the codex handlers. */
  available: boolean;
  /** Non-null when there is something worth inviting to seal. */
  invite: SealInvite | null;
  /** Today is already sealed — used by the dashboard brief. */
  todaySealed: boolean;
}

const IDLE: State = { available: false, invite: null, todaySealed: false };

/**
 * Decides whether to offer the day-sealing ritual, and for which day.
 *
 * Two rules, in order:
 *  1. Yesterday first. If yesterday had events and was never sealed, that is
 *     what the invitation offers — at any hour. The grace window exists exactly
 *     so a day you were too tired to close is not lost.
 *  2. Otherwise today, but only after 21:00 local and only if today actually
 *     has something in it. Nothing to seal, no invitation.
 *
 * Re-checks on account switch, on RPG stat changes, after a seal, and on a slow
 * visible-only interval so the 21:00 boundary is crossed without a reload.
 */
export function useSealInvite(): State & { reload: () => void } {
  const [state, setState] = useState<State>(IDLE);

  const reload = useCallback(() => {
    if (!codexApiReady()) {
      setState(IDLE);
      return;
    }
    const today = localDateISO();
    const yesterday = addDaysISO(today, -1);

    Promise.all([getDaySummary(today), getDaySummary(yesterday)])
      .then(([t, y]) => {
        let invite: SealInvite | null = null;
        if (y && !y.sealed && y.eventsCount > 0) {
          invite = { date: y.date, which: 'yesterday', xpTotal: y.xpTotal, eventsCount: y.eventsCount };
        } else if (t && !t.sealed && t.eventsCount > 0 && isEveningNow()) {
          invite = { date: t.date, which: 'today', xpTotal: t.xpTotal, eventsCount: t.eventsCount };
        }
        setState({ available: true, invite, todaySealed: t?.sealed ?? false });
      })
      .catch(() => setState({ available: true, invite: null, todaySealed: false }));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('account:switched', handler);
    window.addEventListener('rpg:statsChanged', handler);
    window.addEventListener(CODEX_SEALED_EVENT, handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('rpg:statsChanged', handler);
      window.removeEventListener(CODEX_SEALED_EVENT, handler);
    };
  }, [reload]);

  // Crosses 21:00 (and midnight) without needing a reload; pauses when hidden.
  useVisibleInterval(reload, 5 * 60_000);

  return { ...state, reload };
}
