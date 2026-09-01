import { useState, useRef, useCallback, useId, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpSeal } from './icons';

interface HelpBubbleProps {
  text: string;
  /** Position of the button within its parent (default: 'top-right') */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** 'sealed' = circle with border (for cards), 'inline' = bare icon (for titles) */
  variant?: 'sealed' | 'inline';
  /** Optional className for the trigger */
  className?: string;
}

/**
 * Small circular "?" icon that shows a tooltip on hover.
 * Place inside any `position: relative` container.
 */
export default function HelpBubble({ text, position = 'top-right', variant = 'sealed', className = '' }: HelpBubbleProps) {
  const [hidden, setHidden] = useState(() => localStorage.getItem('hubtify_help_bubbles') === 'false');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setHidden(localStorage.getItem('hubtify_help_bubbles') === 'false');
    window.addEventListener('helpBubbles:changed', handler);
    return () => window.removeEventListener('helpBubbles:changed', handler);
  }, []);

  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const positionTip = useCallback(() => {
    if (!triggerRef.current || !tipRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tip = tipRef.current;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    let top = rect.bottom + gap;
    let left = rect.left + rect.width / 2 - tipW / 2;

    if (top + tipH > vh - 12) {
      top = rect.top - tipH - gap;
    }

    if (left < 12) left = 12;
    if (left + tipW > vw - 12) left = vw - tipW - 12;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, []);

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

  // All hooks above run on every render; bail out only after they're declared.
  if (hidden) return null;

  const show = () => {
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(positionTip));
  };

  // Early return AFTER all hooks — toggling `helpBubbles:changed` must not
  // change the number of hooks rendered (React: "Rendered fewer hooks than expected").
  if (hidden) return null;

  return (
    <>
      <span
        ref={triggerRef}
        className={`${variant === 'inline' ? 'help-bubble-inline' : `help-bubble help-bubble--${position}`} ${className}`}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        aria-describedby={open ? tipId : undefined}
        aria-label="Help"
        tabIndex={0}
      >
        <HelpSeal width={variant === 'inline' ? 12 : 14} height={variant === 'inline' ? 12 : 14} />
      </span>
      {open && createPortal(
        <div ref={tipRef} id={tipId} role="tooltip" className="help-bubble__tip">
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
