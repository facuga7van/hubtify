import { useRef, useCallback } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  style?: React.CSSProperties;
}

export default function RpgStepper({ value, min = 0, max = 99, step = 1, onChange, suffix, style }: Props) {
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clamp = useCallback((v: number) => {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }, [min, max]);

  const adjust = useCallback((dir: 1 | -1) => {
    onChange(clamp(+(value + step * dir).toFixed(2)));
  }, [value, step, clamp, onChange]);

  const startHold = useCallback((dir: 1 | -1) => {
    adjust(dir);
    let speed = 200;
    const tick = () => {
      intervalRef.current = setTimeout(() => {
        adjust(dir);
        speed = Math.max(50, speed * 0.9);
        tick();
      }, speed);
    };
    intervalRef.current = setTimeout(tick, 400);
  }, [adjust]);

  const stopHold = useCallback(() => {
    if (intervalRef.current) { clearTimeout(intervalRef.current); intervalRef.current = null; }
  }, []);

  return (
    <div className="rpg-stepper" style={style}>
      <button
        type="button"
        className="rpg-stepper-btn"
        disabled={value <= min}
        onMouseDown={() => startHold(-1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        aria-label="Decrease"
      >−</button>
      <span className="rpg-stepper-value">
        {value}{suffix && <span className="rpg-stepper-suffix">{suffix}</span>}
      </span>
      <button
        type="button"
        className="rpg-stepper-btn"
        disabled={value >= max}
        onMouseDown={() => startHold(1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        aria-label="Increase"
      >+</button>
    </div>
  );
}
