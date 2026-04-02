import { useState, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  text: string;
  children: ReactNode;
}

export default function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

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
      style={{ display: 'inline-flex' }}
    >
      {children}
      {show && createPortal(
        <div
          ref={tipRef}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            opacity: 0,
            background: 'linear-gradient(135deg, var(--rpg-wood) 0%, var(--rpg-leather) 100%)',
            border: '1px solid var(--rpg-gold-dark)',
            borderRadius: 'var(--rpg-radius)',
            padding: '4px 10px',
            fontSize: '0.75rem',
            color: 'var(--rpg-gold-light)',
            fontFamily: 'Cinzel, serif',
            whiteSpace: 'nowrap',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
