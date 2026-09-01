import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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



  return (
    <div className="rpg-number" style={style}>
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
        style={{ ...(fontSize ? { fontSize } : {}) }}
        autoFocus={autoFocus}
        required={required}
      />
      {suffix && (
        <span className="rpg-number__suffix">
          {suffix}
        </span>
      )}
      <div className="rpg-number__spin">
        <button type="button" className="rpg-number__arrow" aria-label={t('common.increase', 'Aumentar')}
          tabIndex={-1}
          onMouseDown={() => startHold(1)} onMouseUp={stopHold} onMouseLeave={stopHold}
          onClick={() => handleClick(1)} onKeyDown={handleKeyDown}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7L5 3l3 4"/>
          </svg>
        </button>
        <button type="button" className="rpg-number__arrow" aria-label={t('common.decrease', 'Disminuir')}
          tabIndex={-1}
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
