import { useState, useRef, useCallback, type ReactNode } from 'react';

interface Props {
  text: string;
  children: ReactNode;
}

export default function Tooltip({ text, children }: Props) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handleEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const firstChild = el.firstElementChild as HTMLElement | null;
    const rect = firstChild?.getBoundingClientRect() ?? el.getBoundingClientRect();
    setPos({
      left: rect.right + 8,
      top: rect.top + rect.height / 2,
    });
  }, []);

  return (
    <div
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setPos(null)}
      style={{ display: 'contents' }}
    >
      {children}
      {pos && (
        <div style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
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
