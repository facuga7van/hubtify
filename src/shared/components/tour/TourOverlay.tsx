import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTour } from './TourProvider';
import { tourSteps } from './tourSteps';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 10;
const TOOLTIP_GAP = 14;

export function TourOverlay() {
  const { t } = useTranslation();
  const { isActive, currentStep, totalSteps, nextStep, prevStep, skipTour } = useTour();
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [arrowOffset, setArrowOffset] = useState<{ value: number; axis: 'x' | 'y' } | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState<'top' | 'bottom' | 'left' | 'right'>('bottom');
  const maskId = useId();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resizeRafRef = useRef<number>(0);

  const step = tourSteps[currentStep];

  // Measure target element position
  const measureTarget = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [step]);

  // Re-measure on step change and window resize (debounced)
  useEffect(() => {
    if (!isActive) return;

    // Fade out, then measure, then fade in
    setTooltipVisible(false);
    timersRef.current = [];

    const t1 = setTimeout(() => {
      measureTarget();
      const t2 = setTimeout(() => setTooltipVisible(true), 50);
      timersRef.current.push(t2);
    }, 150);
    timersRef.current.push(t1);

    const handleResize = () => {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => measureTarget());
    };
    window.addEventListener('resize', handleResize);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cancelAnimationFrame(resizeRafRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [isActive, currentStep, measureTarget]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); skipTour(); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); nextStep(); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); prevStep(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, skipTour, nextStep, prevStep]);

  // Calculate tooltip position based on target rect and preferred position
  useEffect(() => {
    if (!tooltipRef.current) return;

    // If target not found, center tooltip on screen without spotlight
    if (!targetRect) {
      const tooltip = tooltipRef.current;
      const tooltipRect = tooltip.getBoundingClientRect();
      setTooltipPos({
        top: (window.innerHeight - tooltipRect.height) / 2,
        left: (window.innerWidth - tooltipRect.width) / 2,
      });
      setArrowOffset(null);
      setResolvedPosition('bottom');
      return;
    }

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    let resolvedPos = step?.position || 'bottom';
    let newArrowOffset: { value: number; axis: 'x' | 'y' } | null = null;

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    // Try preferred position, fall back if it would overflow
    const tryPosition = (pos: string): boolean => {
      switch (pos) {
        case 'bottom':
          top = targetRect.top + targetRect.height + SPOTLIGHT_PADDING + TOOLTIP_GAP;
          left = targetCenterX - tooltipRect.width / 2;
          return top + tooltipRect.height <= vh - 16;
        case 'top':
          top = targetRect.top - SPOTLIGHT_PADDING - TOOLTIP_GAP - tooltipRect.height;
          left = targetCenterX - tooltipRect.width / 2;
          return top >= 16;
        case 'right':
          top = targetCenterY - tooltipRect.height / 2;
          left = targetRect.left + targetRect.width + SPOTLIGHT_PADDING + TOOLTIP_GAP;
          return left + tooltipRect.width <= vw - 16;
        case 'left':
          top = targetCenterY - tooltipRect.height / 2;
          left = targetRect.left - SPOTLIGHT_PADDING - TOOLTIP_GAP - tooltipRect.width;
          return left >= 16;
        default:
          return false;
      }
    };

    const positions = [resolvedPos, 'bottom', 'top', 'right', 'left'];
    for (const pos of positions as ('top' | 'bottom' | 'left' | 'right')[]) {
      if (tryPosition(pos)) {
        resolvedPos = pos;
        break;
      }
    }

    // Clamp to viewport
    const clampedLeft = Math.max(16, Math.min(left, vw - tooltipRect.width - 16));
    const clampedTop = Math.max(16, Math.min(top, vh - tooltipRect.height - 16));

    // Calculate arrow offset when tooltip was clamped
    if (resolvedPos === 'top' || resolvedPos === 'bottom') {
      if (clampedLeft !== left) {
        const arrowLeft = targetCenterX - clampedLeft;
        newArrowOffset = { value: Math.max(20, Math.min(arrowLeft, tooltipRect.width - 20)), axis: 'x' };
      }
    } else if (resolvedPos === 'left' || resolvedPos === 'right') {
      if (clampedTop !== top) {
        const arrowTop = targetCenterY - clampedTop;
        newArrowOffset = { value: Math.max(20, Math.min(arrowTop, tooltipRect.height - 20)), axis: 'y' };
      }
    }

    setArrowOffset(newArrowOffset);
    setTooltipPos({ top: clampedTop, left: clampedLeft });
    setResolvedPosition(resolvedPos);
  }, [targetRect, step?.position, currentStep]);

  if (!isActive || !step) return null;

  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  // Spotlight cutout dimensions (with padding)
  const cutout = targetRect
    ? {
        x: targetRect.left - SPOTLIGHT_PADDING,
        y: targetRect.top - SPOTLIGHT_PADDING,
        width: targetRect.width + SPOTLIGHT_PADDING * 2,
        height: targetRect.height + SPOTLIGHT_PADDING * 2,
        rx: 6,
      }
    : null;

  // Arrow custom style when offset (tooltip clamped near edge)
  const arrowStyle = arrowOffset
    ? arrowOffset.axis === 'x'
      ? { left: arrowOffset.value, transform: 'translateX(-50%)' }
      : { top: arrowOffset.value, transform: 'translateY(-50%)' }
    : undefined;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={t(step.titleKey, step.id)}>
      {/* SVG spotlight overlay
          NOTE: The dark overlay intentionally blocks clicks outside the spotlight.
          The highlighted element is NOT interactive during the tour — this is by design
          to prevent users from accidentally navigating away mid-tour. */}
      <svg className="tour-spotlight__svg" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <defs>
          <mask id={`tour-mask-${maskId}`}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {cutout && (
              <rect
                x={cutout.x}
                y={cutout.y}
                width={cutout.width}
                height={cutout.height}
                rx={cutout.rx}
                fill="black"
              />
            )}
          </mask>
        </defs>

        <rect
          className="tour-spotlight__mask-click"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask={`url(#tour-mask-${maskId})`}
          style={{ pointerEvents: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        />

        {cutout && (
          <rect
            className="tour-spotlight__glow"
            x={cutout.x}
            y={cutout.y}
            width={cutout.width}
            height={cutout.height}
            rx={cutout.rx}
          />
        )}
      </svg>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`tour-tooltip tour-tooltip--${resolvedPosition} ${tooltipVisible ? 'tour-tooltip--visible' : ''}`}
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        {/* Arrow — hidden when no target element found */}
        {targetRect && (
          <div className="tour-tooltip__arrow" style={arrowStyle} />
        )}

        {/* Content */}
        <div className="tour-tooltip__title">
          {t(step.titleKey, step.id)}
        </div>
        <div className="tour-tooltip__desc">
          {t(step.descKey, step.id)}
        </div>

        {/* Navigation buttons */}
        <div className="tour-tooltip__nav">
          <button
            className="rpg-button tour-tooltip__nav-back"
            onClick={prevStep}
            disabled={isFirstStep}
          >
            {t('tour.back', 'Back')}
          </button>
          <button
            className="rpg-button tour-tooltip__nav-next"
            onClick={nextStep}
          >
            {isLastStep ? t('tour.finish', 'Finish') : t('tour.next', 'Next')}
          </button>
          <button
            className="tour-tooltip__nav-skip"
            onClick={skipTour}
          >
            {t('tour.skip', 'Skip')}
          </button>
        </div>

        {/* Step indicator */}
        <div className="tour-tooltip__steps">
          {tourSteps.map((_, i) => (
            <div
              key={i}
              className={`tour-tooltip__dot ${
                i === currentStep
                  ? 'tour-tooltip__dot--active'
                  : i < currentStep
                    ? 'tour-tooltip__dot--done'
                    : ''
              }`}
            />
          ))}
        </div>
        <div className="tour-tooltip__step-text">
          {currentStep + 1} / {totalSteps}
        </div>
      </div>
    </div>
  );
}
