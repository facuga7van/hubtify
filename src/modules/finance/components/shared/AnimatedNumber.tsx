import { useState, useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  prefix?: string;
  locale?: string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedNumber({
  value,
  duration = 600,
  prefix = '$',
  locale = 'es-AR',
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState('');
  const prevValueRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Zero: display immediately, no animation
    if (value === 0) {
      setDisplay(formatValue(0, prefix, locale));
      prevValueRef.current = 0;
      return;
    }

    const from = prevValueRef.current;
    const to = value;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = from + (to - from) * eased;

      setDisplay(formatValue(current, prefix, locale));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = to;
      }
    }

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, prefix, locale]);

  return <span className={className}>{display}</span>;
}

function formatValue(n: number, prefix: string, locale: string): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString(locale);
  // Sign before prefix: -$15,000 not $-15,000
  if (n < 0) return `-${prefix}${formatted}`;
  return `${prefix}${formatted}`;
}
