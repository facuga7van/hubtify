import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  duration?: number;
  locale?: string;
  className?: string;
  ease?: string;
}

export function AnimatedNumber({
  value,
  prefix = '$',
  duration = 600,
  locale = 'es-AR',
  className,
  ease = 'power3.out',
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const proxyRef = useRef({ value: 0 });
  const containerRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (value === 0 && proxyRef.current.value === 0) {
        setDisplay(0);
        return;
      }

      gsap.to(proxyRef.current, {
        value,
        duration: duration / 1000,
        ease,
        onUpdate: () => setDisplay(Math.round(proxyRef.current.value)),
      });
    },
    { dependencies: [value, duration, ease], scope: containerRef }
  );

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(display));

  // Sign before prefix: -$15,000 not $-15,000
  const signed = display < 0 ? `-${prefix}${formatted}` : `${prefix}${formatted}`;

  return (
    <span ref={containerRef} className={className}>
      {signed}
    </span>
  );
}
