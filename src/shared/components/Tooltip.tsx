import { useState, useRef, useCallback, type ReactNode } from 'react';

interface Props {
  text: string;
  children: ReactNode;
}

interface TooltipPos {
  left: number;
  top: number;
  transformX: string;
  transformY: string;
}

export default function Tooltip({ text, children }: Props) {
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const firstChild = el.firstElementChild as HTMLElement | null;
    const rect = firstChild?.getBoundingClientRect() ?? el.getBoundingClientRect();

    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Estimate tooltip width (~250px max for dollar text)
    const estimatedWidth = 280;
    const estimatedHeight = 30;

    // Try right, then left, then bottom, then top
    const spaceRight = vw - rect.right - gap;
    const spaceLeft = rect.left - gap;
    const spaceBottom = vh - rect.bottom - gap;
    const spaceTop = rect.top - gap;

    if (spaceRight >= estimatedWidth) {
      // Right
      setPos({ left: rect.right + gap, top: centerY, transformX: '0', transformY: '-50%' });
    } else if (spaceLeft >= estimatedWidth) {
      // Left
      setPos({ left: rect.left - gap, top: centerY, transformX: '-100%', transformY: '-50%' });
    } else if (spaceBottom >= estimatedHeight) {
      // Bottom
      setPos({ left: centerX, top: rect.bottom + gap, transformX: '-50%', transformY: '0' });
    } else if (spaceTop >= estimatedHeight) {
      // Top
      setPos({ left: centerX, top: rect.top - gap, transformX: '-50%', transformY: '-100%' });
    } else {
      // Fallback: bottom center clamped
      setPos({ left: centerX, top: rect.bottom + gap, transformX: '-50%', transformY: '0' });
    }
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
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: `translate(${pos.transformX}, ${pos.transformY})`,
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
            maxWidth: 'calc(100vw - 16px)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
