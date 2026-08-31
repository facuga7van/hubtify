import { useCallback, useEffect, useRef } from 'react';

export type StepDir = 1 | -1;

export interface HoldToRepeat {
  /** Bind to `onMouseDown`. Steps once, then repeats while the button is held. */
  startHold: (dir: StepDir) => void;
  /** Bind to `onMouseUp` and `onMouseLeave`. */
  stopHold: () => void;
  /**
   * Bind to `onClick`. Keyboard activation (Enter / Space) fires `click` but
   * never `mousedown`, so without this a `<button>` is unreachable by keyboard.
   * A real mouse click is suppressed here because `startHold` already stepped.
   */
  handleClick: (dir: StepDir) => void;
  /** Bind to `onKeyDown`. Handles ArrowUp / ArrowDown on the stepper buttons. */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Shared press-and-hold stepping behaviour for RpgNumberInput / RpgStepper.
 *
 * Accessibility: mouse hold-to-repeat is kept, and keyboard users get a single
 * step from Enter/Space (via `click`) plus ArrowUp/ArrowDown.
 */
export function useHoldToRepeat(adjust: (dir: StepDir) => void): HoldToRepeat {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True between mousedown and the click it produces, so the click does not
  // double-step on top of the step startHold already performed.
  const pointerStepRef = useRef(false);
  // Always call the freshest `adjust`; the repeat chain would otherwise close
  // over the value captured when the hold started and never advance.
  const adjustRef = useRef(adjust);
  useEffect(() => { adjustRef.current = adjust; });

  const stopHold = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopHold, [stopHold]);

  const startHold = useCallback((dir: StepDir) => {
    pointerStepRef.current = true;
    adjustRef.current(dir);
    let speed = 200;
    const tick = () => {
      timerRef.current = setTimeout(() => {
        adjustRef.current(dir);
        speed = Math.max(50, speed * 0.9);
        tick();
      }, speed);
    };
    timerRef.current = setTimeout(tick, 400);
  }, []);

  const handleClick = useCallback((dir: StepDir) => {
    if (pointerStepRef.current) {
      pointerStepRef.current = false;
      return;
    }
    adjustRef.current(dir);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      adjustRef.current(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      adjustRef.current(-1);
    }
  }, []);

  return { startHold, stopHold, handleClick, handleKeyDown };
}

export default useHoldToRepeat;
