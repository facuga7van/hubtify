import { useState, useRef, useCallback, useId, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpSeal } from './icons';

interface HelpBubbleProps {
  text: string;
  /** Position of the button within its parent (default: 'top-right') */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** 'sealed' = circle with border (for cards), 'inline' = bare icon (for titles) */
  variant?: 'sealed' | 'inline';
  /** Optional className for the trigger button */
  className?: string;
}

/**
 * Small circular "?" button that opens a click-based tooltip.
 * Place inside any `position: relative` container.
 */
export default function HelpBubble({ text, position = 'top-right', variant = 'sealed', className = '' }: HelpBubbleProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const positionTip = useCallback(() => {
    if (!btnRef.current || !tipRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const tip = tipRef.current;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    // Default: below the button, centered horizontally
    let top = rect.bottom + gap;
    let left = rect.left + rect.width / 2 - tipW / 2;

    // If overflows bottom, place above
    if (top + tipH > vh - 12) {
      top = rect.top - tipH - gap;
    }

    // Clamp horizontal
    if (left < 12) left = 12;
    if (left + tipW > vw - 12) left = vw - tipW - 12;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        tipRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const reposition = () => requestAnimationFrame(positionTip);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, positionTip]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      requestAnimationFrame(() => requestAnimationFrame(positionTip));
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${variant === 'inline' ? 'help-bubble-inline' : `help-bubble help-bubble--${position}`} ${className}`}
        onClick={toggle}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        aria-label="Help"
      >
        <HelpSeal width={variant === 'inline' ? 12 : 14} height={variant === 'inline' ? 12 : 14} />
      </button>
      {open && createPortal(
        <div ref={tipRef} id={tipId} role="tooltip" className="help-bubble__tip">
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
