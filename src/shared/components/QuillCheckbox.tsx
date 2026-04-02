import { useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

export interface QuillCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: number;
}

// Colors
const COLOR_PARCHMENT = '#f5f0e1';
const COLOR_GOLD = '#d4a017';
const COLOR_SEPIA = '#8b7355';

// Checkmark path: two segments — M6,13 L10,17 and L10,17 L18,7
// Total path for a polyline M6,13 L10,17 L18,7 inside a 24x24 viewBox
// We'll split it into two <line> elements so each can have independent dasharray
// But using a single polyline is cleaner — we measure total length and animate from full → 0

function spawnInkSplatters(container: HTMLElement) {
  // Spawn 2 ink splatter particles near the checkmark endpoint (18,7 in SVG coords)
  // The SVG is 24x24 — endpoint is roughly at 75% x, 29% y of the element
  const rect = container.getBoundingClientRect();
  const svgSize = rect.width; // assume square

  const endX = rect.left + svgSize * (18 / 24);
  const endY = rect.top + svgSize * (7 / 24);

  for (let i = 0; i < 2; i++) {
    const dot = document.createElement('span');
    const size = 2 + Math.random(); // 2–3px
    const offsetX = (Math.random() - 0.5) * 16; // ±8px
    const offsetY = (Math.random() - 0.5) * 16;

    Object.assign(dot.style, {
      position: 'fixed',
      left: `${endX + offsetX}px`,
      top: `${endY + offsetY}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      backgroundColor: i % 2 === 0 ? COLOR_GOLD : COLOR_SEPIA,
      pointerEvents: 'none',
      zIndex: '9999',
      transform: 'translate(-50%, -50%)',
    });

    document.body.appendChild(dot);

    gsap.to(dot, {
      autoAlpha: 0,
      duration: 0.15,
      ease: 'power1.out',
      onComplete: () => dot.remove(),
    });
  }
}

export default function QuillCheckbox({
  checked,
  onChange,
  disabled = false,
  size = 24,
}: QuillCheckboxProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const checkPathRef = useRef<SVGPolylineElement>(null);
  const prevCheckedRef = useRef(checked);

  // Set initial dash state based on current checked prop (no animation on mount)
  useGSAP(
    () => {
      const path = checkPathRef.current;
      if (!path) return;

      const length = path.getTotalLength();
      if (checked) {
        // Already checked (e.g. loaded from persisted state) — show fully drawn, no animation
        gsap.set(path, {
          strokeDasharray: length,
          strokeDashoffset: 0,
          filter: 'blur(0px)',
          autoAlpha: 1,
        });
      } else {
        // Unchecked — path hidden
        gsap.set(path, {
          strokeDasharray: length,
          strokeDashoffset: length,
          filter: 'blur(0px)',
          autoAlpha: 0,
        });
      }
      prevCheckedRef.current = checked;
    },
    { scope: containerRef, dependencies: [] }, // run once on mount
  );

  // React to checked changes after mount
  useGSAP(
    () => {
      const path = checkPathRef.current;
      if (!path) return;

      const wasChecked = prevCheckedRef.current;
      if (checked === wasChecked) return;
      prevCheckedRef.current = checked;

      const length = path.getTotalLength();

      if (checked) {
        // Ensure path is visible before animating
        gsap.set(path, { autoAlpha: 1, strokeDasharray: length, strokeDashoffset: length });

        // 1. Draw stroke (quill pen effect)
        const drawTween = gsap.to(path, {
          strokeDashoffset: 0,
          duration: 0.3,
          ease: 'power1.inOut',
        });

        // 2. Wet ink sharpening in parallel
        gsap.fromTo(
          path,
          { filter: 'blur(1px)' },
          { filter: 'blur(0px)', duration: 0.15, ease: 'power1.out', immediateRender: false },
        );

        // 3. Ink splatter particles
        if (containerRef.current) {
          spawnInkSplatters(containerRef.current);
        }

        return () => {
          drawTween.kill();
        };
      } else {
        // Uncheck — instant reset
        gsap.set(path, {
          strokeDashoffset: length,
          filter: 'blur(0px)',
          autoAlpha: 0,
        });
      }
    },
    { scope: containerRef, dependencies: [checked] },
  );

  const handleChange = useCallback(() => {
    if (!disabled) {
      onChange(!checked);
    }
  }, [disabled, checked, onChange]);

  return (
    <span
      ref={containerRef}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
    >
      {/* Hidden native checkbox for accessibility */}
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-checked={checked}
        style={{
          position: 'absolute',
          opacity: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          cursor: disabled ? 'default' : 'pointer',
          zIndex: 1,
        }}
      />
      {/* Visible SVG checkbox */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{
          cursor: disabled ? 'default' : 'pointer',
          flexShrink: 0,
          opacity: disabled ? 0.5 : 1,
        }}
        aria-hidden="true"
      >
        {/* Parchment box with gold border */}
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="3"
          fill={COLOR_PARCHMENT}
          stroke={COLOR_GOLD}
          strokeWidth="1.5"
        />
        {/* Checkmark drawn like quill on parchment */}
        <polyline
          ref={checkPathRef}
          points="6,13 10,17 18,7"
          stroke={COLOR_SEPIA}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
