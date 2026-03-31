import { useTranslation } from 'react-i18next';
import { AnimatedNumber } from './AnimatedNumber';

interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  title?: string;
}

const SIZE = 160;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

export function DonutChart({ data, title }: DonutChartProps) {
  const { t } = useTranslation();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (data.length === 0 || total === 0) {
    return (
      <div className="coin-donut-wrap">
        {title && <div className="coin-donut-wrap__title">{title}</div>}
        <div className="coin-donut__empty">
          <svg className="coin-donut__empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12M8 10h8M8 14h8" />
          </svg>
          <span>{t('coinify.noExpensesThisMonth')}</span>
        </div>
      </div>
    );
  }

  // Build segments
  let accumulatedOffset = 0;
  const segments = data.map((d) => {
    const pct = d.value / total;
    const dashLength = CIRCUMFERENCE * pct;
    const dashGap = CIRCUMFERENCE - dashLength;
    const offset = -accumulatedOffset;
    accumulatedOffset += dashLength;
    return { ...d, pct, dashLength, dashGap, offset };
  });

  return (
    <div className="coin-donut-wrap">
      {title && (
        <div className="coin-donut-wrap__title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* SVG Donut */}
        <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            {/* Background ring */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="var(--rpg-parchment-dark)"
              strokeWidth={STROKE}
            />
            {/* Data segments */}
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                strokeWidth={STROKE}
                strokeDasharray={`${seg.dashLength} ${seg.dashGap}`}
                strokeDashoffset={seg.offset}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
                style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
              />
            ))}
          </svg>
          {/* Center label */}
          <div
            className="coin-donut-center"
            style={{
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <AnimatedNumber
              value={total}
              className="coin-donut-center__total"
            />
            <span className="coin-donut-center__label">{t('coinify.total')}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="coin-legend">
          {segments.map((seg, i) => {
            const pctDisplay = Math.round(seg.pct * 100);
            return (
              <div key={i} className="coin-legend__row">
                <div
                  className="coin-legend__swatch"
                  style={{ background: seg.color }}
                />
                <span className="coin-legend__label">{seg.label}</span>
                <div className="coin-legend__bar-wrap">
                  <div
                    className="coin-legend__bar-fill"
                    style={{
                      width: `${pctDisplay}%`,
                      background: seg.color,
                    }}
                  />
                </div>
                <span className="coin-legend__pct">{pctDisplay}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
