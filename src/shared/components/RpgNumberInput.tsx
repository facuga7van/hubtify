import { useRef, useCallback } from 'react';
import { useHoldToRepeat } from '../hooks/useHoldToRepeat';

interface Props {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  suffix?: string;
  autoFocus?: boolean;
  fontSize?: string;
  style?: React.CSSProperties;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  required?: boolean;
  /** Para poder asociar un <label htmlFor>. */
  id?: string;
  /** Alternativa cuando no hay label visible. */
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export default function RpgNumberInput({
  value, onChange, step = 1, min, max, placeholder, suffix, autoFocus, fontSize, style, onKeyDown, required,
  id, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback((v: number) => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  }, [min, max]);

  const adjust = useCallback((dir: 1 | -1) => {
    const current = parseFloat(value) || 0;
    const next = clamp(+(current + step * dir).toFixed(2));
    onChange(String(next));
  }, [value, step, clamp, onChange]);

  const { startHold, stopHold, handleClick, handleKeyDown } = useHoldToRepeat(adjust);

  const arrowBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, minWidth: 32, height: '50%', minHeight: 16,
    border: 'none', cursor: 'pointer',
    background: 'linear-gradient(180deg, var(--leather-light), var(--leather))',
    color: 'var(--gold)',
    userSelect: 'none', padding: 0, borderRadius: 2,
  };

  return (
    <div style={{ position: 'relative', ...style }}>
      <style>{`
        .rpg-number-input::-webkit-inner-spin-button,
        .rpg-number-input::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .rpg-number-input { -moz-appearance: textfield; }
      `}</style>
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        /* A number input steals the wheel when focused: scrolling the page
           silently changes the amount. Blur instead of scrolling the value. */
        onWheel={(e) => e.currentTarget.blur()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); adjust(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjust(-1); }
          else if (e.key === 'e' || e.key === 'E' || e.key === '+') e.preventDefault();
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        className="rpg-input rpg-number-input"
        style={{
          width: '100%', textAlign: 'center',
          paddingLeft: 36, paddingRight: 36,
          ...(fontSize ? { fontSize } : {}),
        }}
        autoFocus={autoFocus}
        required={required}
      />
      {suffix && (
        <span style={{
          position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)',
          fontSize: 'var(--fs-label)', opacity: 0.65, pointerEvents: 'none',
        }}>
          {suffix}
        </span>
      )}
      <div style={{
        position: 'absolute', right: 2, top: 2, bottom: 2,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <button type="button" style={arrowBtn} aria-label="Increase"
          onMouseDown={() => startHold(1)} onMouseUp={stopHold} onMouseLeave={stopHold}
          onClick={() => handleClick(1)} onKeyDown={handleKeyDown}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7L5 3l3 4"/>
          </svg>
        </button>
        <button type="button" style={arrowBtn} aria-label="Decrease"
          onMouseDown={() => startHold(-1)} onMouseUp={stopHold} onMouseLeave={stopHold}
          onClick={() => handleClick(-1)} onKeyDown={handleKeyDown}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3L5 7l3-4"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
