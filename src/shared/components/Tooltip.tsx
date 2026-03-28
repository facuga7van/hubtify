import { useState, useRef, type ReactNode } from 'react';

interface Props {
  text: string;
  children: ReactNode;
}

export default function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: 'relative', display: 'contents' }}
    >
      {children}
      {show && (
        <div style={{
          position: 'fixed',
          left: (ref.current?.getBoundingClientRect().right ?? 0) + 8,
          top: (ref.current?.getBoundingClientRect().top ?? 0) + (ref.current?.getBoundingClientRect().height ?? 0) / 2,
          transform: 'translateY(-50%)',
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
        }}>
          {text}
        </div>
      )}
    </div>
  );
}
