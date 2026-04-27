import { useState, useRef, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  text: string;
  children: ReactNode;
}

export default function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const positionTip = useCallback(() => {
    if (!wrapperRef.current || !tipRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const tip = tipRef.current;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below, then above
    let left = rect.left + rect.width / 2 - tipW / 2;
    let top = rect.bottom + 6;

    if (top + tipH > vh - 8) {
      top = rect.top - tipH - 6;
    }

    // Clamp horizontal
    if (left < 8) left = 8;
    if (left + tipW > vw - 8) left = vw - tipW - 8;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.opacity = '1';
  }, []);

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={() => {
        setShow(true);
        requestAnimationFrame(() => requestAnimationFrame(positionTip));
      }}
      onMouseLeave={() => setShow(false)}
      onFocus={() => {
        setShow(true);
        requestAnimationFrame(() => requestAnimationFrame(positionTip));
      }}
      onBlur={() => setShow(false)}
      aria-describedby={show ? tipId : undefined}
      style={{ display: 'flex', minWidth: 0 }}
    >
      {children}
      {show && createPortal(
        <div
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            opacity: 0,
            background: 'linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)',
            border: '1px solid var(--gold-dark)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: 'var(--fs-label)',
            color: 'var(--gold-light)',
            fontFamily: "'IM Fell English', serif",
            whiteSpace: 'nowrap',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(42, 29, 14, 0.5)',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
