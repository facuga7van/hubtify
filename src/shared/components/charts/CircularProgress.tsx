import React, { useId } from 'react';
import './charts.css';

export interface CircularProgressProps {
  value: number;
  max: number;
  radius?: number;
  strokeWidth?: number;
  gradientStart?: string;
  gradientEnd?: string;
  trackColor?: string;
  className?: string;
  children?: React.ReactNode;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  value,
  max,
  radius = 50,
  strokeWidth = 10,
  gradientStart = '#E0C068',
  gradientEnd = '#A68A3E',
  trackColor = 'rgba(74,45,26,0.15)',
  className = '',
  children,
}) => {
  const uid = useId();
  const gradientId = `cp-grad-${uid}`;

  const normalizedValue = Math.min(Math.max(value, 0), max);
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? normalizedValue / max : 0;
  const dashOffset = circumference * (1 - progress);

  const svgSize = (radius + strokeWidth) * 2;
  const center = radius + strokeWidth;

  return (
    <div
      className={`circular-progress ${className}`}
      style={{ width: svgSize, height: svgSize }}
    >
      <svg
        className="circular-progress-svg"
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradientStart} />
            <stop offset="100%" stopColor={gradientEnd} />
          </linearGradient>
        </defs>

        {/* Track circle */}
        <circle
          className="circular-progress-track"
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />

        {/* Progress arc */}
        <circle
          className="circular-progress-bar"
          cx={center}
          cy={center}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>

      {children && (
        <div className="circular-progress-content">
          {children}
        </div>
      )}
    </div>
  );
};
