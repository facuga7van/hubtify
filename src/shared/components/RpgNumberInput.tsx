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
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const arrowBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: '50%', border: 'none', cursor: 'pointer',
    background: 'var(--rpg-wood, #2c1810)', color: 'var(--rpg-gold-light)',
    userSelect: 'none', padding: 0,
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
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rpg-input rpg-number-input"
        style={{
          width: '100%', textAlign: 'center', fontSize: '1.2rem',
          paddingRight: 10,
        }}
        autoFocus={autoFocus}
      />
      {suffix && (
        <span style={{
          position: 'absolute', right: 34, top: '50%', transform: 'translateY(-50%)',
          fontSize: '0.75rem', opacity: 0.5, pointerEvents: 'none',
        }}>
          {suffix}
        </span>
      )}
      <div style={{
        position: 'absolute', right: 2, top: 2, bottom: 2,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderLeft: '1px solid var(--rpg-gold-dark)',
        borderRadius: '0 var(--rpg-radius) var(--rpg-radius) 0',
      }}>
        <button type="button" style={{ ...arrowBtn, borderBottom: '1px solid var(--rpg-gold-dark)' }}
          onMouseDown={() => startHold(1)} onMouseUp={stopHold} onMouseLeave={stopHold}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 7L5 3l3 4"/>
          </svg>
        </button>
        <button type="button" style={arrowBtn}
          onMouseDown={() => startHold(-1)} onMouseUp={stopHold} onMouseLeave={stopHold}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 3L5 7l3-4"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
