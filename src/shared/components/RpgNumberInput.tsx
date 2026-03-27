import { useRef, useCallback } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  suffix?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}

export default function RpgNumberInput({ value, onChange, step = 1, min, max, placeholder, suffix, autoFocus, style }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const btnStyle: React.CSSProperties = {
    width: 36, height: 36, border: '1px solid var(--rpg-gold-dark)',
    borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-wood)',
    color: 'var(--rpg-gold-light)', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
    fontFamily: 'Cinzel, serif', fontWeight: 'bold', flexShrink: 0,
    userSelect: 'none',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      <button type="button" style={btnStyle}
        onMouseDown={() => startHold(-1)} onMouseUp={stopHold} onMouseLeave={stopHold}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 7H4"/>
        </svg>
      </button>
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          ref={inputRef}
          type="number"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="rpg-input"
          style={{ width: '100%', textAlign: 'center', fontSize: '1.2rem', paddingRight: suffix ? 28 : undefined }}
          autoFocus={autoFocus}
        />
        {suffix && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: '0.75rem', opacity: 0.5, pointerEvents: 'none',
          }}>
            {suffix}
          </span>
        )}
      </div>
      <button type="button" style={btnStyle}
        onMouseDown={() => startHold(1)} onMouseUp={stopHold} onMouseLeave={stopHold}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M7 4v6M4 7h6"/>
        </svg>
      </button>
    </div>
  );
}
