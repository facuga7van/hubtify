import { useEffect, useRef } from 'react';

/**
 * `setInterval` that only ticks while the window is actually on screen.
 *
 * The sidebar badges and the notification bell both polled every 30 s for the
 * whole life of the process — minimised, hidden behind another window, tray'd —
 * each tick costing an IPC round-trip and a SQLite query for a number nobody
 * could see. Both already have push listeners for in-app changes, so the poll is
 * only there to catch time passing (a quest going overdue, a scheduled
 * notification firing).
 *
 * Pausing on `visibilitychange` rather than `blur` is deliberate: a window that
 * is visible but unfocused (side by side with something else) still shows those
 * badges, so it keeps refreshing. When the window comes back the callback fires
 * once immediately, so nothing is ever stale by more than a frame.
 *
 * The callback is held in a ref, so a new closure each render does not tear the
 * interval down and restart it.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
    const start = () => { if (id === null) id = setInterval(() => cbRef.current(), ms); };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { cbRef.current(); start(); }
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [ms]);
}

export default useVisibleInterval;
