import { useCallback } from 'react';
import { useHoldToRepeat } from '../hooks/useHoldToRepeat';

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
  const clamp = useCallback((v: number) => {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }, [min, max]);

  const adjust = useCallback((dir: 1 | -1) => {
    onChange(clamp(+(value + step * dir).toFixed(2)));
  }, [value, step, clamp, onChange]);

  const { startHold, stopHold, handleClick, handleKeyDown } = useHoldToRepeat(adjust);

  return (
    <div className="rpg-stepper" style={style}>
      <button
        type="button"
        className="rpg-stepper-btn tap-target"
        disabled={value <= min}
        onMouseDown={() => startHold(-1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onClick={() => handleClick(-1)}
        onKeyDown={handleKeyDown}
        aria-label="Decrease"
      >−</button>
      <span className="rpg-stepper-value">
        {value}{suffix && <span className="rpg-stepper-suffix">{suffix}</span>}
      </span>
      <button
        type="button"
        className="rpg-stepper-btn tap-target"
        disabled={value >= max}
        onMouseDown={() => startHold(1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onClick={() => handleClick(1)}
        onKeyDown={handleKeyDown}
        aria-label="Increase"
      >+</button>
    </div>
  );
}
